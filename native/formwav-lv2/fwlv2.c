/*
 * fwlv2: formwav's LV2 plugin host (AU-27).
 *
 * Follows lilv's lv2apply (Copyright 2007-2019 David Robillard, ISC licence) in what the two share: each port's value
 * starts at its default (from its range, NaN taken as 0), control values are set by symbol (or here also by index),
 * a mono file is spread round-robin over the plugin's inputs, and with --block 1 the plugin runs a frame at a time as
 * lv2apply's does. Altered and extended for formwav: blocks of frames (1024 by default), a mono plugin run once per
 * channel of a wider file, a tail of silence after the file (for reverbs and delays), atom ports given empty
 * sequences, and the URID map, options and bounded block length many plugins require (lv2apply gives none); a plugin
 * needing a feature or a port type not provided here is refused with the reason, never loaded half-supported.
 *
 *   fwlv2 list                                                        every LV2 plugin found, as JSON
 *   fwlv2 run <uri> <in.wav> <out.wav> [--block N] [--tail S] [port=value ...]   port: a symbol or an index
 */
#include <lilv/lilv.h>
#include <lv2/atom/atom.h>
#include <lv2/buf-size/buf-size.h>
#include <lv2/core/lv2.h>
#include <lv2/options/options.h>
#include <lv2/urid/urid.h>
#include <sndfile.h>

#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ---- the URID map: a growing table, ids from 1 ---- */
static char **uri_table = NULL;
static uint32_t uri_count = 0;

static LV2_URID map_uri(LV2_URID_Map_Handle handle, const char *uri) {
    (void)handle;
    for (uint32_t i = 0; i < uri_count; ++i)
        if (!strcmp(uri_table[i], uri)) return i + 1;
    uri_table = (char **)realloc(uri_table, (uri_count + 1) * sizeof(char *));
    uri_table[uri_count] = strdup(uri);
    return ++uri_count;
}

static const char *unmap_uri(LV2_URID_Unmap_Handle handle, LV2_URID urid) {
    (void)handle;
    return (urid >= 1 && urid <= uri_count) ? uri_table[urid - 1] : NULL;
}

static LV2_URID_Map urid_map = {NULL, map_uri};
static LV2_URID_Unmap urid_unmap = {NULL, unmap_uri};
static int32_t min_block = 1, max_block = 1024;
static LV2_Options_Option options[3];
static LV2_Feature f_map = {LV2_URID__map, &urid_map};
static LV2_Feature f_unmap = {LV2_URID__unmap, &urid_unmap};
static LV2_Feature f_options = {LV2_OPTIONS__options, options};
static LV2_Feature f_bounded = {LV2_BUF_SIZE__boundedBlockLength, NULL};
static const LV2_Feature *features[] = {&f_map, &f_unmap, &f_options, &f_bounded, NULL};
static const char *provided[] = {LV2_URID__map, LV2_URID__unmap, LV2_OPTIONS__options, LV2_BUF_SIZE__boundedBlockLength, NULL};

static void set_options(void) {
    LV2_URID atom_int = map_uri(NULL, LV2_ATOM__Int);
    options[0] = (LV2_Options_Option){LV2_OPTIONS_INSTANCE, 0, map_uri(NULL, LV2_BUF_SIZE__minBlockLength), sizeof(int32_t), atom_int, &min_block};
    options[1] = (LV2_Options_Option){LV2_OPTIONS_INSTANCE, 0, map_uri(NULL, LV2_BUF_SIZE__maxBlockLength), sizeof(int32_t), atom_int, &max_block};
    options[2] = (LV2_Options_Option){LV2_OPTIONS_INSTANCE, 0, 0, 0, 0, NULL};
}

/* ---- JSON ---- */
static void js(const char *s) {
    putchar('"');
    for (; s && *s; ++s) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') printf("\\%c", c);
        else if (c == '\n') printf("\\n");
        else if (c < 0x20) printf("\\u%04x", c);
        else putchar(c);
    }
    putchar('"');
}

static void num(double v) {
    if (isnan(v) || isinf(v)) printf("null");
    else printf("%.9g", v);
}

/* ---- ports ---- */
typedef enum { CONTROL_IN, CONTROL_OUT, AUDIO_IN, AUDIO_OUT, ATOM_IN, ATOM_OUT, OPTIONAL_PORT, UNSUPPORTED } Kind;

typedef struct {
    LilvNode *input, *output, *audio, *control, *atom, *optional, *integer, *toggled;
} Uris;

static Uris uris_for(LilvWorld *w) {
    Uris u;
    u.input = lilv_new_uri(w, LV2_CORE__InputPort);
    u.output = lilv_new_uri(w, LV2_CORE__OutputPort);
    u.audio = lilv_new_uri(w, LV2_CORE__AudioPort);
    u.control = lilv_new_uri(w, LV2_CORE__ControlPort);
    u.atom = lilv_new_uri(w, LV2_ATOM__AtomPort);
    u.optional = lilv_new_uri(w, LV2_CORE__connectionOptional);
    u.integer = lilv_new_uri(w, LV2_CORE__integer);
    u.toggled = lilv_new_uri(w, LV2_CORE__toggled);
    return u;
}

static Kind kind_of(const LilvPlugin *p, const LilvPort *port, const Uris *u) {
    bool in = lilv_port_is_a(p, port, u->input), out = lilv_port_is_a(p, port, u->output);
    if (lilv_port_is_a(p, port, u->control)) return in ? CONTROL_IN : out ? CONTROL_OUT : UNSUPPORTED;
    if (lilv_port_is_a(p, port, u->audio)) return in ? AUDIO_IN : out ? AUDIO_OUT : UNSUPPORTED;
    if (lilv_port_is_a(p, port, u->atom)) return in ? ATOM_IN : out ? ATOM_OUT : UNSUPPORTED;
    if (lilv_port_has_property(p, port, u->optional)) return OPTIONAL_PORT;
    return UNSUPPORTED;
}

/* Why the plugin cannot be hosted here, or NULL: a required feature not provided, or a port of a kind not handled. */
static const char *refusal(const LilvPlugin *p, const Uris *u, char *why, size_t len) {
    LilvNodes *req = lilv_plugin_get_required_features(p);
    LILV_FOREACH (nodes, i, req) {
        const char *f = lilv_node_as_uri(lilv_nodes_get(req, i));
        bool ok = false;
        for (int k = 0; provided[k]; ++k) ok = ok || !strcmp(provided[k], f);
        if (!ok) {
            snprintf(why, len, "needs the host feature %s", f);
            lilv_nodes_free(req);
            return why;
        }
    }
    lilv_nodes_free(req);
    uint32_t n = lilv_plugin_get_num_ports(p);
    for (uint32_t i = 0; i < n; ++i) {
        if (kind_of(p, lilv_plugin_get_port_by_index(p, i), u) == UNSUPPORTED) {
            snprintf(why, len, "port %u is of a kind formwav does not host", i);
            return why;
        }
    }
    return NULL;
}

static int list(void) {
    LilvWorld *world = lilv_world_new();
    lilv_world_load_all(world);
    Uris u = uris_for(world);
    const LilvPlugins *plugins = lilv_world_get_all_plugins(world);
    printf("[");
    bool first = true;
    LILV_FOREACH (plugins, it, plugins) {
        const LilvPlugin *p = lilv_plugins_get(plugins, it);
        LilvNode *name = lilv_plugin_get_name(p);
        const LilvPluginClass *cls = lilv_plugin_get_class(p);
        uint32_t n = lilv_plugin_get_num_ports(p), ins = 0, outs = 0;
        char why[512];
        const char *refused = refusal(p, &u, why, sizeof why);
        float *mins = calloc(n, sizeof(float)), *maxs = calloc(n, sizeof(float)), *defs = calloc(n, sizeof(float));
        lilv_plugin_get_port_ranges_float(p, mins, maxs, defs);
        printf("%s\n {\"uri\": ", first ? "" : ",");
        first = false;
        js(lilv_node_as_uri(lilv_plugin_get_uri(p)));
        printf(", \"name\": ");
        js(name ? lilv_node_as_string(name) : "");
        printf(", \"class\": ");
        js(cls ? lilv_node_as_string(lilv_plugin_class_get_label(cls)) : "");
        printf(", \"controls\": [");
        bool firstc = true;
        for (uint32_t i = 0; i < n; ++i) {
            const LilvPort *port = lilv_plugin_get_port_by_index(p, i);
            Kind k = kind_of(p, port, &u);
            if (k == AUDIO_IN) ++ins;
            if (k == AUDIO_OUT) ++outs;
            if (k != CONTROL_IN) continue;
            printf("%s{\"index\": %u, \"symbol\": ", firstc ? "" : ", ", i);
            firstc = false;
            js(lilv_node_as_string(lilv_port_get_symbol(p, port)));
            LilvNode *pname = lilv_port_get_name(p, port);
            printf(", \"name\": ");
            js(pname ? lilv_node_as_string(pname) : "");
            lilv_node_free(pname);
            printf(", \"min\": ");
            num(mins[i]);
            printf(", \"max\": ");
            num(maxs[i]);
            printf(", \"default\": ");
            num(isnan(defs[i]) ? 0.0 : defs[i]);
            printf(", \"integer\": %s, \"toggled\": %s, \"choices\": [", lilv_port_has_property(p, port, u.integer) ? "true" : "false",
                   lilv_port_has_property(p, port, u.toggled) ? "true" : "false");
            LilvScalePoints *points = lilv_port_get_scale_points(p, port);
            bool firstp = true;
            LILV_FOREACH (scale_points, sp, points) {
                const LilvScalePoint *pt = lilv_scale_points_get(points, sp);
                printf("%s{\"value\": ", firstp ? "" : ", ");
                firstp = false;
                num(lilv_node_as_float(lilv_scale_point_get_value(pt)));
                printf(", \"label\": ");
                js(lilv_node_as_string(lilv_scale_point_get_label(pt)));
                printf("}");
            }
            lilv_scale_points_free(points);
            printf("]}");
        }
        printf("], \"audio_in\": %u, \"audio_out\": %u, \"supported\": %s", ins, outs, refused ? "false" : "true");
        if (refused) {
            printf(", \"reason\": ");
            js(refused);
        }
        printf("}");
        lilv_node_free(name);
        free(mins);
        free(maxs);
        free(defs);
    }
    printf("\n]\n");
    lilv_world_free(world);
    return 0;
}

/* ---- running ---- */
typedef struct {
    LilvInstance *inst;
    float *controls;      /* one value per port (only control ports used) */
    float **audio_in;     /* per audio input: a block */
    float **audio_out;    /* per audio output: a block */
    uint8_t **atoms;      /* per port: an atom buffer, or NULL */
} Instance;

#define ATOM_CAPACITY 8192

static int fail(const char *msg, const char *detail) {
    fprintf(stderr, "fwlv2: %s%s%s\n", msg, detail ? " " : "", detail ? detail : "");
    return 1;
}

static int run(int argc, char **argv) {
    const char *uri = argv[2], *in_path = argv[3], *out_path = argv[4];
    int block = 1024;
    double tail = 0.0;
    LilvWorld *world = lilv_world_new();
    lilv_world_load_all(world);
    Uris u = uris_for(world);
    LilvNode *uri_node = lilv_new_uri(world, uri);
    const LilvPlugin *p = lilv_plugins_get_by_uri(lilv_world_get_all_plugins(world), uri_node);
    lilv_node_free(uri_node);
    if (!p) return fail("no LV2 plugin", uri);
    char why[512];
    const char *refused = refusal(p, &u, why, sizeof why);
    if (refused) return fail("cannot host this plugin:", refused);
    uint32_t n = lilv_plugin_get_num_ports(p);
    Kind *kinds = calloc(n, sizeof(Kind));
    float *values = calloc(n, sizeof(float));
    lilv_plugin_get_port_ranges_float(p, NULL, NULL, values);
    uint32_t n_in = 0, n_out = 0;
    for (uint32_t i = 0; i < n; ++i) {
        kinds[i] = kind_of(p, lilv_plugin_get_port_by_index(p, i), &u);
        if (isnan(values[i])) values[i] = 0.0f; /* as lv2apply */
        if (kinds[i] == AUDIO_IN) ++n_in;
        if (kinds[i] == AUDIO_OUT) ++n_out;
    }
    for (int a = 5; a < argc; ++a) {
        if (!strcmp(argv[a], "--block") && a + 1 < argc) {
            block = atoi(argv[++a]);
            continue;
        }
        if (!strcmp(argv[a], "--tail") && a + 1 < argc) {
            tail = atof(argv[++a]);
            continue;
        }
        char *eq = strchr(argv[a], '=');
        if (!eq) continue;
        *eq = 0;
        const char *key = argv[a];
        float value = (float)atof(eq + 1);
        int index = -1;
        char *end;
        long as_num = strtol(key, &end, 10);
        if (*key && !*end) index = (int)as_num;
        else {
            LilvNode *sym = lilv_new_string(world, key);
            const LilvPort *port = lilv_plugin_get_port_by_symbol(p, sym);
            lilv_node_free(sym);
            if (port) index = (int)lilv_port_get_index(p, port);
        }
        if (index < 0 || index >= (int)n || kinds[index] != CONTROL_IN) return fail("no control input named", key);
        values[index] = value;
    }
    if (block < 1) block = 1;
    if (block > 65536) block = 65536;
    if (n_in == 0) return fail("the plugin takes no audio input", NULL);

    SF_INFO info;
    memset(&info, 0, sizeof info);
    SNDFILE *in = sf_open(in_path, SFM_READ, &info);
    if (!in) return fail("cannot read", in_path);
    int C = info.channels;
    int instances, out_channels;
    if ((int)n_in == C || C == 1) {
        instances = 1; /* lv2apply's case: the inputs from the file's channels (a mono file spread round-robin) */
        out_channels = (int)n_out;
    } else if (n_in == 1 && n_out == 1) {
        instances = C; /* a mono plugin once per channel */
        out_channels = C;
    } else {
        char msg[128];
        snprintf(msg, sizeof msg, "the plugin takes %u audio inputs and the file has %d channels", n_in, C);
        sf_close(in);
        return fail(msg, NULL);
    }
    max_block = block;
    min_block = 1;
    set_options();
    LV2_URID atom_sequence = map_uri(NULL, LV2_ATOM__Sequence), atom_chunk = map_uri(NULL, LV2_ATOM__Chunk);

    Instance *inst = calloc(instances, sizeof(Instance));
    for (int k = 0; k < instances; ++k) {
        Instance *I = &inst[k];
        I->inst = lilv_plugin_instantiate(p, info.samplerate, features);
        if (!I->inst) {
            sf_close(in);
            return fail("the plugin would not instantiate", uri);
        }
        I->controls = calloc(n, sizeof(float));
        memcpy(I->controls, values, n * sizeof(float));
        I->audio_in = calloc(n_in, sizeof(float *));
        I->audio_out = calloc(n_out ? n_out : 1, sizeof(float *));
        I->atoms = calloc(n, sizeof(uint8_t *));
        for (uint32_t i = 0, ai = 0, ao = 0; i < n; ++i) {
            switch (kinds[i]) {
                case CONTROL_IN:
                case CONTROL_OUT:
                    lilv_instance_connect_port(I->inst, i, &I->controls[i]);
                    break;
                case AUDIO_IN:
                    I->audio_in[ai] = calloc(block, sizeof(float));
                    lilv_instance_connect_port(I->inst, i, I->audio_in[ai++]);
                    break;
                case AUDIO_OUT:
                    I->audio_out[ao] = calloc(block, sizeof(float));
                    lilv_instance_connect_port(I->inst, i, I->audio_out[ao++]);
                    break;
                case ATOM_IN:
                case ATOM_OUT:
                    I->atoms[i] = aligned_alloc(64, ATOM_CAPACITY);
                    memset(I->atoms[i], 0, ATOM_CAPACITY);
                    lilv_instance_connect_port(I->inst, i, I->atoms[i]);
                    break;
                default:
                    lilv_instance_connect_port(I->inst, i, NULL);
            }
        }
        lilv_instance_activate(I->inst);
    }

    SF_INFO oinfo;
    memset(&oinfo, 0, sizeof oinfo);
    oinfo.samplerate = info.samplerate;
    oinfo.channels = out_channels;
    oinfo.format = SF_FORMAT_WAV | SF_FORMAT_FLOAT;
    SNDFILE *out = sf_open(out_path, SFM_WRITE, &oinfo);
    if (!out) {
        sf_close(in);
        return fail("cannot write", out_path);
    }
    float *filebuf = calloc((size_t)block * C, sizeof(float));
    float *outbuf = calloc((size_t)block * out_channels, sizeof(float));
    long tail_left = (long)llround(tail * info.samplerate);
    for (;;) {
        long frames = (long)sf_readf_float(in, filebuf, block);
        if (frames <= 0) {
            if (tail_left <= 0) break;
            frames = tail_left < block ? tail_left : block;
            memset(filebuf, 0, (size_t)frames * C * sizeof(float));
            tail_left -= frames;
        }
        for (int k = 0; k < instances; ++k) {
            Instance *I = &inst[k];
            for (long f = 0; f < frames; ++f) {
                if (instances > 1) {
                    I->audio_in[0][f] = filebuf[f * C + k];
                } else {
                    for (uint32_t c = 0; c < n_in; ++c) I->audio_in[c][f] = filebuf[f * C + (c % C)]; /* round-robin */
                }
            }
            for (uint32_t i = 0; i < n; ++i) {
                if (!I->atoms[i]) continue;
                LV2_Atom_Sequence *seq = (LV2_Atom_Sequence *)I->atoms[i];
                if (kinds[i] == ATOM_IN) { /* an empty sequence */
                    seq->atom.type = atom_sequence;
                    seq->atom.size = sizeof(LV2_Atom_Sequence_Body);
                    seq->body.unit = 0;
                    seq->body.pad = 0;
                } else { /* room for the plugin to write */
                    seq->atom.type = atom_chunk;
                    seq->atom.size = ATOM_CAPACITY - sizeof(LV2_Atom);
                }
            }
            lilv_instance_run(I->inst, (uint32_t)frames);
            for (long f = 0; f < frames; ++f) {
                if (instances > 1) outbuf[f * out_channels + k] = I->audio_out[0][f];
                else
                    for (int c = 0; c < out_channels; ++c) outbuf[f * out_channels + c] = I->audio_out[c][f];
            }
        }
        if (sf_writef_float(out, outbuf, frames) != frames) {
            sf_close(out);
            sf_close(in);
            return fail("cannot write", out_path);
        }
    }
    for (int k = 0; k < instances; ++k) {
        lilv_instance_deactivate(inst[k].inst);
        lilv_instance_free(inst[k].inst);
    }
    sf_close(out);
    sf_close(in);
    printf("{\"channels\": %d, \"rate\": %d, \"instances\": %d, \"block\": %d}\n", out_channels, info.samplerate, instances, block);
    lilv_world_free(world);
    return 0;
}

int main(int argc, char **argv) {
    if (argc >= 2 && !strcmp(argv[1], "list")) return list();
    if (argc >= 5 && !strcmp(argv[1], "run")) return run(argc, argv);
    fprintf(stderr, "usage: fwlv2 list | fwlv2 run <uri> <in.wav> <out.wav> [--block N] [--tail S] [port=value ...]\n");
    return 2;
}
