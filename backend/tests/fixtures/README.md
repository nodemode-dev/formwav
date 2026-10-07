# Test fixtures

Everything else the tests need is generated when they run (tones, noise, rooms, music, sessions). This folder holds only what cannot be: real speech, and the part of a service's own API document that its stand-in checks requests against.

| File | What it is | Source and licence |
| --- | --- | --- |
| `jfk.wav` | 11.0 s of President Kennedy's inaugural address ("And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country"), 16 kHz, mono, 16-bit | Byte-identical to whisper.cpp's `samples/jfk.wav` (352,078 bytes, SHA-256 `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e`). The recording is a work of the United States government (20 January 1961) and in the public domain. |
| `elevenlabs_contract.json` | The 18 operations formwav calls in ElevenLabs' API, as its OpenAPI 3.1 document describes them: parameters and request bodies with their types, enums, required fields and ranges (ranges given only in prose, such as "at least 0 and at most 1", turned into minimum and maximum), every `$ref` resolved, descriptions left out | Written by `stand_ins/extract_elevenlabs_contract.py` from the document ElevenLabs publishes (`ElevenLabs API Documentation` 1.0, fetched 2026-10-06), run as `python -I stand_ins/extract_elevenlabs_contract.py <openapi.json>`. Facts about an interface, kept to test against it. |
