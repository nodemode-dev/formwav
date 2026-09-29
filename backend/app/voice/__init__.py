"""formwave's generative voice, vendored into formwav.

core/, engine/, extensions/ and routers/ are formwave's backend packages (the owner's uploaded formwav.zip), copied
verbatim; its relative imports resolve inside this package. The one change: engine/config.py finds the models folder one
directory deeper. Mounted by app.main at /api/voice with formwave's routes and contract (/status, /load, /generate,
/generate/stream, /export, /export/formats, /asr/models, /asr/select, /transcribe). The runtime is optional:
requirements_voice.txt (requirements_voice_macos.txt on macOS), then requirements_voice_qwen.txt with --no-deps.
"""
