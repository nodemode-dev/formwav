"""English words to ARPAbet phonemes for sung lyrics (DEV_PLAN_sung_lyrics L2).

The CMU Pronouncing Dictionary (cmudict/cmudict.dict beside this file, Carnegie Mellon University's BSD-style licence in
cmudict/LICENSE, commit 74790861 of github.com/cmusphinx/cmudict) gives a word's first pronunciation. A word it lacks is
tried as a dictionary word plus a suffix (s, es, 's, ed, ing, er, est, ly, ness), then as two dictionary words, then
guessed letter by letter from the rules in _RULES; each answer says which, so the interface can mark a guess. Stress digits
are kept on vowels (AA1, AH0), the phone names SoulX-Singer takes with its "en_" prefix.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}
CONSONANTS = {"B", "CH", "D", "DH", "F", "G", "HH", "JH", "K", "L", "M", "N", "NG", "P", "R", "S", "SH", "T", "TH", "V", "W", "Y", "Z", "ZH"}

_SUFFIXES = [
    ("'s", ["Z"]), ("ness", ["N", "AH0", "S"]), ("ing", ["IH0", "NG"]), ("est", ["AH0", "S", "T"]), ("ly", ["L", "IY0"]),
    ("er", ["ER0"]), ("ed", ["D"]), ("es", ["IH0", "Z"]), ("s", ["Z"]),
]

_RULES = [
    ("tch", ["CH"]), ("sch", ["S", "K"]), ("igh", ["AY1"]), ("ough", ["AH1", "F"]), ("tion", ["SH", "AH0", "N"]),
    ("sion", ["ZH", "AH0", "N"]), ("ture", ["CH", "ER0"]), ("ck", ["K"]), ("ch", ["CH"]), ("sh", ["SH"]), ("th", ["TH"]),
    ("ph", ["F"]), ("wh", ["W"]), ("ng", ["NG"]), ("qu", ["K", "W"]), ("kn", ["N"]), ("wr", ["R"]), ("gh", []),
    ("ee", ["IY1"]), ("ea", ["IY1"]), ("oo", ["UW1"]), ("ou", ["AW1"]), ("ow", ["OW1"]), ("oi", ["OY1"]), ("oy", ["OY1"]),
    ("ai", ["EY1"]), ("ay", ["EY1"]), ("au", ["AO1"]), ("aw", ["AO1"]), ("ie", ["IY1"]), ("ei", ["EY1"]), ("ey", ["IY0"]),
    ("ar", ["AA1", "R"]), ("er", ["ER0"]), ("ir", ["ER1"]), ("ur", ["ER1"]), ("or", ["AO1", "R"]),
    ("a", ["AE1"]), ("e", ["EH1"]), ("i", ["IH1"]), ("o", ["AA1"]), ("u", ["AH1"]), ("y", ["IY0"]),
    ("b", ["B"]), ("c", ["K"]), ("d", ["D"]), ("f", ["F"]), ("g", ["G"]), ("h", ["HH"]), ("j", ["JH"]), ("k", ["K"]),
    ("l", ["L"]), ("m", ["M"]), ("n", ["N"]), ("p", ["P"]), ("q", ["K"]), ("r", ["R"]), ("s", ["S"]), ("t", ["T"]),
    ("v", ["V"]), ("w", ["W"]), ("x", ["K", "S"]), ("z", ["Z"]),
]


@lru_cache(maxsize=1)
def _dictionary() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for line in (Path(__file__).with_name("cmudict") / "cmudict.dict").read_text(encoding="utf-8").splitlines():
        head, _, rest = line.partition(" ")
        if not head or "(" in head:
            continue
        phones = rest.split("#", 1)[0].split()
        if phones:
            out.setdefault(head, phones)
    return out


def _clean(word: str) -> str:
    return re.sub(r"[^a-z']", "", word.lower().replace("’", "'")).strip("'") if word else ""


def _soft(word: str, phones: list[str]) -> list[str]:
    out = list(phones)
    if word.endswith("e") and len(word) > 2 and word[-2] not in "aeiouy" and out and out[-1] == "EH1":
        out.pop()
    vowels = [i for i, p in enumerate(out) if p.rstrip("012") in VOWELS]
    for i in vowels[1:]:
        out[i] = out[i][:-1] + "0" if out[i][-1] == "1" else out[i]
    return out


def guess(word: str) -> list[str]:
    """Letters to phonemes by _RULES, longest match first; the first vowel stressed, the rest reduced, a silent final e."""
    w, i, out = _clean(word), 0, []
    while i < len(w):
        for letters, phones in _RULES:
            if w.startswith(letters, i):
                out += phones
                i += len(letters)
                break
        else:
            i += 1
    out = _soft(w, out)
    if not any(p.rstrip("012") in VOWELS for p in out):
        out = out[:-1] + ["AH0"] + out[-1:] if len(out) > 1 else out + ["AH0"]
    return out


def pronounce(word: str) -> tuple[list[str], str]:
    """(phonemes, source): source is dictionary, derived (a dictionary word with a suffix or two joined) or guess."""
    w = _clean(word)
    if not w:
        return [], "none"
    d = _dictionary()
    if w in d:
        return list(d[w]), "dictionary"
    for suffix, extra in _SUFFIXES:
        stem = w[: -len(suffix)] if w.endswith(suffix) else ""
        for s in (stem, stem + "e", stem[:-1] if len(stem) > 2 and stem[-1] == stem[-2] else ""):
            if len(s) > 1 and s in d:
                return list(d[s]) + extra, "derived"
    for cut in range(len(w) - 2, 1, -1):
        if w[:cut] in d and w[cut:] in d:
            return list(d[w[:cut]]) + list(d[w[cut:]]), "derived"
    return guess(w), "guess"


def pronounce_all(words: list[str]) -> list[dict]:
    return [{"word": w, "phonemes": p, "source": s} for w in words[:2000] for p, s in [pronounce(str(w))]]
