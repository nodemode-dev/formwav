"""Where each generator and model formwav uses comes from, under what licence, and where it runs (PLAN_v14 W6). Read
from each project's own LICENSE file, model card or terms on 2026-10-15; "not stated" where the project states none."""

THIS_MACHINE = "this machine"

TABLE: list[dict] = [
    {"id": "elevenlabs", "name": "ElevenLabs", "kind": "speech, sound effects, music, dubbing, stems, transcription", "source": "https://elevenlabs.io/terms-of-use", "code": "closed service", "weights": "closed service", "runs": "ElevenLabs' servers", "sends": "the text, and any clip used, is uploaded to ElevenLabs", "note": "Its terms leave you the rights in what it makes; commercial use needs a paid plan."},
    {"id": "fal", "name": "fal", "kind": "music and audio models hosted by fal", "source": "https://fal.ai/terms", "code": "closed service", "weights": "each hosted model's own licence", "runs": "fal's servers", "sends": "the prompt, and any audio used, is uploaded to fal", "note": "Each model on fal carries its own licence; check the model's page before commercial use."},
    {"id": "acestep", "name": "ACE-Step 1.5", "kind": "songs, covers, repaints, layers", "source": "https://github.com/ace-step/ACE-Step-1.5", "code": "MIT", "weights": "MIT", "runs": "its own server, on this machine or one you name", "sends": "nothing leaves the server you run", "note": ""},
    {"id": "kokoro", "name": "Kokoro-82M", "kind": "speech", "source": "https://huggingface.co/hexgrad/Kokoro-82M", "code": "MIT (kokoro-onnx)", "weights": "Apache-2.0", "runs": THIS_MACHINE, "sends": "nothing", "note": ""},
    {"id": "pocket", "name": "Pocket TTS (Kyutai)", "kind": "speech in a clip's voice", "source": "https://github.com/kyutai-labs/pocket-tts", "code": "MIT", "weights": "CC-BY-4.0", "runs": THIS_MACHINE, "sends": "nothing", "note": "Credit Kyutai when you publish what it makes; some of Kyutai's sample voices are non-commercial."},
    {"id": "chatterbox", "name": "Chatterbox (Resemble AI)", "kind": "speech in a clip's voice", "source": "https://github.com/resemble-ai/chatterbox", "code": "MIT", "weights": "MIT", "runs": THIS_MACHINE, "sends": "nothing", "note": "Every file it makes carries Resemble AI's inaudible Perth watermark."},
    {"id": "dubbing", "name": "Dubbing: Whisper, Argos Translate, Kokoro", "kind": "dubbing", "source": "https://github.com/argosopentech/argos-translate", "code": "MIT (Whisper, faster-whisper, kokoro-onnx); MIT or CC0 (Argos Translate)", "weights": "MIT (Whisper), Apache-2.0 (Kokoro); the translation models' licence is not stated", "runs": THIS_MACHINE, "sends": "nothing", "note": ""},
    {"id": "whisper", "name": "Whisper through faster-whisper", "kind": "transcripts and word times", "source": "https://github.com/openai/whisper", "code": "MIT", "weights": "MIT", "runs": THIS_MACHINE, "sends": "nothing", "note": ""},
    {"id": "demucs", "name": "Demucs htdemucs", "kind": "stems", "source": "https://github.com/adefossez/demucs", "code": "MIT", "weights": "not stated", "runs": THIS_MACHINE, "sends": "nothing", "note": ""},
    {"id": "soulx-singer", "name": "SoulX-Singer (Soul AI Lab)", "kind": "singing written notes and lyrics", "source": "https://github.com/Soul-AILab/SoulX-Singer", "code": "Apache-2.0", "weights": "Apache-2.0", "runs": THIS_MACHINE, "sends": "nothing",
     "note": "stock singers from VocalSet (Northwestern University), Creative Commons Attribution; the credit is in NOTICE"},
    {"id": "tiger", "name": "TIGER-DnR", "kind": "speech, music and effects split", "source": "https://huggingface.co/JusperLee/TIGER-DnR", "code": "MIT", "weights": "Apache-2.0", "runs": THIS_MACHINE, "sends": "nothing", "note": ""},
    {"id": "deepfilter", "name": "DeepFilterNet3", "kind": "dialogue isolate", "source": "https://github.com/Rikorose/DeepFilterNet", "code": "MIT or Apache-2.0", "weights": "not stated", "runs": THIS_MACHINE, "sends": "nothing", "note": ""},
    {"id": "silero", "name": "Silero VAD", "kind": "where speech is", "source": "https://github.com/snakers4/silero-vad", "code": "MIT", "weights": "not stated apart from the repository's MIT", "runs": THIS_MACHINE, "sends": "nothing", "note": ""},
    {"id": "dnsmos", "name": "DNSMOS P.835 (Microsoft)", "kind": "speech quality scores", "source": "https://github.com/microsoft/DNS-Challenge", "code": "MIT", "weights": "not stated for the model file; the repository's other content is CC BY 4.0, which formwav credits", "runs": THIS_MACHINE, "sends": "nothing", "note": ""},
    {"id": "samaudio", "name": "SAM-Audio (Meta)", "kind": "isolate a sound by description", "source": "https://github.com/facebookresearch/sam-audio", "code": "SAM License", "weights": "SAM License, gated on Hugging Face", "runs": THIS_MACHINE, "sends": "nothing", "note": "Not an open-source licence: it forbids military and ITAR uses and asks for its text to travel with the model."},
]


def table() -> list[dict]:
    return [dict(row) for row in TABLE]


def find(pid: str) -> dict | None:
    return next((dict(row) for row in TABLE if row["id"] == pid), None)
