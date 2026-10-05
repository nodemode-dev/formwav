# formwav-nyquist (AU-28)

`fwnyq` runs Nyquist scripts and Audacity's Nyquist plug-ins on a clip, with Audacity 2.4.2's own Nyquist (libnyquist,
Nyquist 3.15, and its nyx embedding API). Nyquist and XLISP are under BSD-style licences (see `runtime/` and the
libnyquist sources); formwav does not use Nyquist's optional LGPL dependencies' features beyond what libnyquist links.

    fwnyq <runtime-dir> <in.wav> <out.wav> <script.lsp>

The clip goes in as `*TRACK*`; the script is evaluated form by form and its last value comes back: a sound is written
as a 32-bit float WAV, anything else is printed as one line of JSON (the last line of stdout; Nyquist's start-up banner
comes before it).

`runtime/` is Audacity 2.4.2's `nyquist/` directory with one change, marked in `init.lsp`: `underscore` (behind the
translation function `_`) is the identity, as formwav has no translations (Audacity defines `_` in C).
