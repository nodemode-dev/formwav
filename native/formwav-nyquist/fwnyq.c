/*
 * fwnyq: formwav's Nyquist runner (AU-28). The upstream Nyquist 3.15 sources as vendored in libnyquist/ (with the nyx
 * embedding API, BSD-style licence) run a script on a clip: the audio goes in as *TRACK* (as version 4 plug-ins get
 * their selection), the script (a preamble of settings and controls, then the plug-in's or prompt's code) is evaluated
 * form by form, and the last value comes back: a sound is written as a 32-bit float WAV, anything else is printed as
 * one line of JSON. What Nyquist prints goes to stderr.
 *
 *   fwnyq <runtime-dir> <in.wav> <out.wav> <script.lsp>
 */
#include <sndfile.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "nyx.h"

typedef struct {
    float *data;
    int channels;
    long frames;
} Audio;

static int input_audio(float *buffer, int channel, long start, long len, long totlen, void *userdata) {
    Audio *a = (Audio *)userdata;
    (void)totlen;
    for (long i = 0; i < len; i++) {
        long f = start + i;
        buffer[i] = (f >= 0 && f < a->frames) ? a->data[f * a->channels + channel] : 0.0f;
    }
    return 0;
}

static float *out_data = NULL;
static long out_frames = 0;
static int out_channels = 0;

static int output_audio(float *buffer, int channel, long start, long len, long totlen, void *userdata) {
    (void)userdata;
    if (!out_data) {
        out_frames = totlen;
        out_data = (float *)calloc((size_t)(totlen > 0 ? totlen : 1) * (size_t)out_channels, sizeof(float));
        if (!out_data) return -1;
    }
    for (long i = 0; i < len && start + i < out_frames; i++) out_data[(start + i) * out_channels + channel] = buffer[i];
    return 0;
}

static void print_output(int c, void *userdata) {
    (void)userdata;
    fputc(c, stderr);
}

static char *read_text(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *text = (char *)malloc((size_t)n + 1);
    if (text && fread(text, 1, (size_t)n, f) != (size_t)n) {
        free(text);
        text = NULL;
    }
    if (text) text[n] = 0;
    fclose(f);
    return text;
}

static void json_string(const char *s) {
    putchar('"');
    for (; s && *s; s++) {
        if (*s == '"' || *s == '\\') printf("\\%c", *s);
        else if (*s == '\n') printf("\\n");
        else if ((unsigned char)*s < 0x20) printf("\\u%04x", *s);
        else putchar(*s);
    }
    putchar('"');
}

int main(int argc, char **argv) {
    if (argc != 5) {
        fprintf(stderr, "usage: fwnyq <runtime-dir> <in.wav> <out.wav> <script.lsp>\n");
        return 2;
    }
    SF_INFO info;
    memset(&info, 0, sizeof info);
    SNDFILE *in = sf_open(argv[2], SFM_READ, &info);
    if (!in) {
        fprintf(stderr, "fwnyq: cannot read %s: %s\n", argv[2], sf_strerror(NULL));
        return 1;
    }
    Audio a = {(float *)malloc((size_t)(info.frames > 0 ? info.frames : 1) * (size_t)info.channels * sizeof(float)), info.channels, (long)info.frames};
    if (!a.data || sf_readf_float(in, a.data, info.frames) != info.frames) {
        fprintf(stderr, "fwnyq: short read of %s\n", argv[2]);
        return 1;
    }
    sf_close(in);
    char *script = read_text(argv[4]);
    if (!script) {
        fprintf(stderr, "fwnyq: cannot read the script %s\n", argv[4]);
        return 1;
    }

    nyx_set_xlisp_path(argv[1]);
    nyx_init();
    nyx_capture_output(print_output, NULL);
    nyx_set_audio_name("*TRACK*");
    nyx_set_audio_params((double)info.samplerate, (long)info.frames);
    nyx_set_input_audio(input_audio, &a, info.channels, (long)info.frames, (double)info.samplerate);

    nyx_rval kind = nyx_eval_expression(script);
    int status = 0;
    switch (kind) {
        case nyx_audio: {
            out_channels = nyx_get_audio_num_channels();
            // nyx_get_audio returns TRUE on success (it is its callbacks that return 0 for success)
            if (out_channels <= 0 || !nyx_get_audio(output_audio, NULL) || !out_data) {
                fprintf(stderr, "fwnyq: the sound could not be read back\n");
                status = 1;
                break;
            }
            SF_INFO o;
            memset(&o, 0, sizeof o);
            o.samplerate = info.samplerate;
            o.channels = out_channels;
            o.format = SF_FORMAT_WAV | SF_FORMAT_FLOAT;
            SNDFILE *out = sf_open(argv[3], SFM_WRITE, &o);
            if (!out || sf_writef_float(out, out_data, out_frames) != out_frames) {
                fprintf(stderr, "fwnyq: cannot write %s\n", argv[3]);
                status = 1;
                break;
            }
            sf_close(out);
            printf("{\"type\": \"audio\", \"channels\": %d, \"frames\": %ld, \"rate\": %d}\n", out_channels, out_frames, info.samplerate);
            break;
        }
        case nyx_int:
            printf("{\"type\": \"int\", \"value\": %d}\n", nyx_get_int());
            break;
        case nyx_double:
            printf("{\"type\": \"double\", \"value\": %.17g}\n", nyx_get_double());
            break;
        case nyx_string:
            printf("{\"type\": \"string\", \"value\": ");
            json_string(nyx_get_string());
            printf("}\n");
            break;
        case nyx_labels: {
            int n = nyx_get_num_labels();
            printf("{\"type\": \"labels\", \"labels\": [");
            for (int i = 0; i < n; i++) {
                double t0, t1;
                const char *label;
                nyx_get_label(i, &t0, &t1, &label);
                printf("%s[%.9g, %.9g, ", i ? ", " : "", t0, t1);
                json_string(label);
                printf("]");
            }
            printf("]}\n");
            break;
        }
        case nyx_list:
            printf("{\"type\": \"list\"}\n");
            break;
        default:
            fprintf(stderr, "\nfwnyq: the script ended in an error\n");
            status = 1;
    }
    nyx_cleanup();
    free(script);
    free(a.data);
    free(out_data);
    return status;
}
