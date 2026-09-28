# HASHOUT_LOG · native · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the Rust side. Source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here. Read this first, then edit code surgically.

Current build version: v0.1.0
Last updated: 2026-09-28 · formwav-dsp crate with the graph port model

---

## Org-navi-map

```
native/
└── formwav-dsp/
    ├── Cargo.toml               crate manifest, version site, no dependencies yet
    ├── Cargo.lock               lockfile, version site
    └── src/
        ├── lib.rs               public surface and CRATE_VERSION
        └── graph.rs             node and port model, connection rules, processing order
```

---

## Table of contents

- [formwav-dsp/Cargo.toml](#cargo-toml)
- [formwav-dsp/src/lib.rs](#src-lib)
- [formwav-dsp/src/graph.rs](#src-graph)

---

## formwav-dsp/Cargo.toml {#cargo-toml}

### Cargo.toml · crate type and targets
- refers-to: Cargo.toml :: `[lib]`
- kind: todo
- logged: v0.1.0 · 2026-09-28

`rlib` only in v0.1.0. Phase 2 adds the three builds from `DEV_PLAN.md`: a `cdylib` with a pyo3 feature for the engine's offline render, the native build linked into the Tauri shell for realtime I/O, and a wasm32 build for the AudioWorklet. Every dependency added then is cleared against the licensing policy first; none is used now.

---

## formwav-dsp/src/lib.rs {#src-lib}

### src/lib.rs · CRATE_VERSION
- refers-to: src/lib.rs :: `CRATE_VERSION`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Read from Cargo at compile time, so the crate version is stated once in Cargo.toml and bumped with the other version sites.

---

## formwav-dsp/src/graph.rs {#src-graph}

### src/graph.rs · PortKind
- refers-to: src/graph.rs :: `PortKind`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

Two kinds from the first build, per the v0.0.1 plan decision: `Audio { channels }` with any channel count from 1 to 65,535 (mono, stereo, 5.1, 7.1.4, ambisonic orders all fit), and `Event` for note and control data. MIDI tracks, instruments, surround buses and ambisonic buses then arrive as new nodes, not as a reshaped graph. A zero-channel audio port is refused when the node is added.

### src/graph.rs · connect rules
- refers-to: src/graph.rs :: `Graph::connect`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

A connection is accepted only when both ports exist, the kinds are identical (a stereo output never feeds a 5.1 input directly; up-mix and down-mix are explicit nodes so the conversion is visible and automatable), the edge is new, and it would not close a cycle. Fan-in and fan-out are allowed: several sources into one audio input are summed, several event sources are merged, by the processing code that lands in Phase 2. The cycle check walks forward from the target to see whether it reaches the source.

### src/graph.rs · order
- refers-to: src/graph.rs :: `Graph::order`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Kahn's algorithm over node indegrees gives the processing order, sources first. Feedback paths (a delay feeding back) will need an explicit one-block delay node rather than a cycle in this graph.

### src/graph.rs · verification v0.1.0
- refers-to: src/graph.rs :: whole module
- kind: explainer
- logged: v0.1.0 · 2026-09-28

`cargo check` passes on Rust 1.98.1. A scratch crate outside the repo exercised the rules once: event to instrument, instrument to bus and bus to master accepted; stereo into 5.1, event into audio, a duplicate edge, a cycle, a zero-channel port and a missing port refused with the matching error; `order()` returned a valid topological order. Clippy was not run: the minimal toolchain lacks the component.
