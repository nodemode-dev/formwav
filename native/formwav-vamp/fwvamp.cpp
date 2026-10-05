/*
 * fwvamp: formwav's Vamp plugin host (AU-40).
 *
 * Altered from vamp-simple-host in the Vamp plugin SDK 2.10 (Chris Cannam; Copyright 2006-2017 Queen Mary, University
 * of London; MIT-style licence in sdk/COPYING): the same block and step sizes, adapters (ADAPT_ALL_SAFE), processing
 * loop and feature timing, with every output reported at once (each with its own fixed-rate count), parameters set by
 * name, and JSON out.
 *
 *   fwvamp list                              every plugin on the Vamp path, with its parameters and outputs
 *   fwvamp run <key> <in.wav> [id=value ...]  every output's features, times in seconds
 */
#include <vamp-hostsdk/PluginHostAdapter.h>
#include <vamp-hostsdk/PluginInputDomainAdapter.h>
#include <vamp-hostsdk/PluginLoader.h>
#include <vamp-hostsdk/PluginWrapper.h>

#include <sndfile.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

using Vamp::Plugin;
using Vamp::RealTime;
using Vamp::HostExt::PluginInputDomainAdapter;
using Vamp::HostExt::PluginLoader;
using Vamp::HostExt::PluginWrapper;

static std::string js(const std::string &s) {
    std::string o = "\"";
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') { o += '\\'; o += char(c); }
        else if (c == '\n') o += "\\n";
        else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
        else o += char(c);
    }
    return o + "\"";
}

static std::string num(double v) {
    if (!std::isfinite(v)) return "null";
    char b[40];
    snprintf(b, sizeof b, "%.9g", v);
    return b;
}

static double seconds(const RealTime &t) { return t.sec + t.nsec / 1e9; }

static const char *sample_type(Plugin::OutputDescriptor::SampleType t) {
    return t == Plugin::OutputDescriptor::OneSamplePerStep ? "one-per-step"
         : t == Plugin::OutputDescriptor::FixedSampleRate ? "fixed-rate" : "variable-rate";
}

static int list() {
    PluginLoader *loader = PluginLoader::getInstance();
    std::cout << "[";
    bool first = true;
    for (const auto &key : loader->listPlugins()) {
        Plugin *p = loader->loadPlugin(key, 48000);
        if (!p) continue;
        std::cout << (first ? "" : ",") << "\n {\"key\": " << js(key) << ", \"name\": " << js(p->getName())
                  << ", \"maker\": " << js(p->getMaker()) << ", \"description\": " << js(p->getDescription()) << ", \"parameters\": [";
        first = false;
        auto params = p->getParameterDescriptors();
        for (size_t i = 0; i < params.size(); ++i) {
            const auto &d = params[i];
            std::cout << (i ? ", " : "") << "{\"id\": " << js(d.identifier) << ", \"name\": " << js(d.name) << ", \"unit\": " << js(d.unit)
                      << ", \"min\": " << num(d.minValue) << ", \"max\": " << num(d.maxValue) << ", \"default\": " << num(d.defaultValue)
                      << ", \"quantize\": " << (d.isQuantized ? num(d.quantizeStep) : "null") << ", \"choices\": [";
            for (size_t j = 0; j < d.valueNames.size(); ++j) std::cout << (j ? ", " : "") << js(d.valueNames[j]);
            std::cout << "]}";
        }
        std::cout << "], \"outputs\": [";
        auto outs = p->getOutputDescriptors();
        for (size_t i = 0; i < outs.size(); ++i) {
            const auto &o = outs[i];
            std::cout << (i ? ", " : "") << "{\"id\": " << js(o.identifier) << ", \"name\": " << js(o.name) << ", \"unit\": " << js(o.unit)
                      << ", \"bins\": " << (o.hasFixedBinCount ? num(o.binCount) : "null") << ", \"type\": \"" << sample_type(o.sampleType)
                      << "\", \"duration\": " << (o.hasDuration ? "true" : "false") << "}";
        }
        std::cout << "]}";
        delete p;
    }
    std::cout << "\n]\n";
    return 0;
}

struct Collected {
    Plugin::OutputDescriptor desc;
    int count = -1;  // the fixed-rate count, as vamp-simple-host keeps it (one per output here)
    std::vector<std::string> rows;
};

// vamp-simple-host's printFeatures, gathering instead of printing: a variable-rate feature at its own timestamp, a
// fixed-rate one counted (or rounded from its timestamp) at the output's rate, anything else at the block's frame
static void collect(int frame, int sr, int index, const Plugin::FeatureSet &features, Collected &c) {
    auto it = features.find(index);
    if (it == features.end()) return;
    for (const auto &f : it->second) {
        RealTime rt;
        bool have = false;
        if (c.desc.sampleType == Plugin::OutputDescriptor::VariableSampleRate) {
            rt = f.timestamp;
            have = true;
        } else if (c.desc.sampleType == Plugin::OutputDescriptor::FixedSampleRate) {
            int n = c.count + 1;
            if (f.hasTimestamp) n = int(round(seconds(f.timestamp) * c.desc.sampleRate));
            rt = RealTime::fromSeconds(double(n) / c.desc.sampleRate);
            have = true;
            c.count = n;
        }
        if (!have) rt = RealTime::frame2RealTime(frame, sr);
        std::ostringstream row;
        row << "{\"time\": " << num(seconds(rt)) << ", \"frame\": " << RealTime::realTime2Frame(rt, sr);
        if (f.hasDuration) row << ", \"duration\": " << num(seconds(f.duration));
        row << ", \"values\": [";
        for (size_t j = 0; j < f.values.size(); ++j) row << (j ? ", " : "") << num(f.values[j]);
        row << "], \"label\": " << js(f.label) << "}";
        c.rows.push_back(row.str());
    }
}

static int run(const std::string &key, const char *path, const std::map<std::string, float> &params) {
    SF_INFO info;
    memset(&info, 0, sizeof info);
    SNDFILE *sf = sf_open(path, SFM_READ, &info);
    if (!sf) {
        fprintf(stderr, "fwvamp: cannot read %s: %s\n", path, sf_strerror(nullptr));
        return 1;
    }
    PluginLoader *loader = PluginLoader::getInstance();
    Plugin *plugin = loader->loadPlugin(key, info.samplerate, PluginLoader::ADAPT_ALL_SAFE);
    if (!plugin) {
        fprintf(stderr, "fwvamp: no plugin %s on the Vamp path\n", key.c_str());
        sf_close(sf);
        return 1;
    }
    for (const auto &kv : params) plugin->setParameter(kv.first, kv.second);

    int blockSize = plugin->getPreferredBlockSize();
    int stepSize = plugin->getPreferredStepSize();
    if (blockSize == 0) blockSize = 1024;
    if (stepSize == 0) {
        stepSize = plugin->getInputDomain() == Plugin::FrequencyDomain ? blockSize / 2 : blockSize;
    } else if (stepSize > blockSize) {
        blockSize = plugin->getInputDomain() == Plugin::FrequencyDomain ? stepSize * 2 : stepSize;
    }
    int overlapSize = blockSize - stepSize;
    int channels = info.channels;
    int minch = int(plugin->getMinChannelCount()), maxch = int(plugin->getMaxChannelCount());
    if (channels < minch || channels > maxch) {
        // the channel adapter (in ADAPT_ALL_SAFE) mixes or duplicates channels as the plugin needs
    }
    if (!plugin->initialise(channels, stepSize, blockSize)) {
        fprintf(stderr, "fwvamp: %s did not initialise (channels %d, step %d, block %d)\n", key.c_str(), channels, stepSize, blockSize);
        delete plugin;
        sf_close(sf);
        return 1;
    }
    std::vector<Collected> outs;
    for (const auto &d : plugin->getOutputDescriptors()) {
        Collected c;
        c.desc = d;
        outs.push_back(c);
    }
    RealTime adjustment = RealTime::zeroTime;
    if (auto *wrapper = dynamic_cast<PluginWrapper *>(plugin)) {
        if (auto *ida = wrapper->getWrapper<PluginInputDomainAdapter>()) adjustment = ida->getTimestampAdjustment();
    }
    std::vector<float> filebuf(size_t(blockSize) * channels);
    std::vector<std::vector<float>> chans(channels, std::vector<float>(blockSize));
    std::vector<float *> plugbuf(channels);
    for (int c = 0; c < channels; ++c) plugbuf[c] = chans[c].data();
    int finalStepsRemaining = std::max(1, (blockSize / stepSize) - 1);  // vamp-simple-host: the blocks past the end
    int currentStep = 0;
    RealTime rt;
    do {
        int count;
        if (blockSize == stepSize || currentStep == 0) {
            count = int(sf_readf_float(sf, filebuf.data(), blockSize));
            if (count < 0) break;
            if (count != blockSize) --finalStepsRemaining;
        } else {
            memmove(filebuf.data(), filebuf.data() + size_t(stepSize) * channels, size_t(overlapSize) * channels * sizeof(float));
            count = int(sf_readf_float(sf, filebuf.data() + size_t(overlapSize) * channels, stepSize));
            if (count < 0) break;
            if (count != stepSize) --finalStepsRemaining;
            count += overlapSize;
        }
        for (int c = 0; c < channels; ++c) {
            int j = 0;
            for (; j < count; ++j) chans[c][j] = filebuf[size_t(j) * channels + c];
            for (; j < blockSize; ++j) chans[c][j] = 0.0f;
        }
        rt = RealTime::frame2RealTime(long(currentStep) * stepSize, info.samplerate);
        Plugin::FeatureSet fs = plugin->process(plugbuf.data(), rt);
        int frame = int(RealTime::realTime2Frame(rt + adjustment, info.samplerate));
        for (size_t o = 0; o < outs.size(); ++o) collect(frame, info.samplerate, int(o), fs, outs[o]);
        ++currentStep;
    } while (finalStepsRemaining > 0);
    rt = RealTime::frame2RealTime(long(currentStep) * stepSize, info.samplerate);
    Plugin::FeatureSet rest = plugin->getRemainingFeatures();
    int frame = int(RealTime::realTime2Frame(rt + adjustment, info.samplerate));
    for (size_t o = 0; o < outs.size(); ++o) collect(frame, info.samplerate, int(o), rest, outs[o]);

    std::cout << "{\"key\": " << js(key) << ", \"name\": " << js(plugin->getName()) << ", \"rate\": " << info.samplerate
              << ", \"step\": " << stepSize << ", \"block\": " << blockSize << ", \"outputs\": [";
    for (size_t o = 0; o < outs.size(); ++o) {
        const auto &d = outs[o].desc;
        std::cout << (o ? "," : "") << "\n {\"id\": " << js(d.identifier) << ", \"name\": " << js(d.name) << ", \"unit\": " << js(d.unit)
                  << ", \"type\": \"" << sample_type(d.sampleType) << "\", \"features\": [";
        for (size_t i = 0; i < outs[o].rows.size(); ++i) std::cout << (i ? ", " : "") << outs[o].rows[i];
        std::cout << "]}";
    }
    std::cout << "\n]}\n";
    delete plugin;
    sf_close(sf);
    return 0;
}

int main(int argc, char **argv) {
    if (argc >= 2 && std::string(argv[1]) == "list") return list();
    if (argc >= 4 && std::string(argv[1]) == "run") {
        std::map<std::string, float> params;
        for (int i = 4; i < argc; ++i) {
            std::string a = argv[i];
            auto eq = a.find('=');
            if (eq == std::string::npos) continue;
            params[a.substr(0, eq)] = float(atof(a.c_str() + eq + 1));
        }
        return run(argv[2], argv[3], params);
    }
    fprintf(stderr, "usage: fwvamp list | fwvamp run <key> <in.wav> [id=value ...]\n");
    return 2;
}
