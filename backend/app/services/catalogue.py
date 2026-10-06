"""DS-14: recorded sound effects and music from Wikimedia Commons' audio files, searched, previewed and imported.

Only royalty-free licences are offered: public domain, CC0 and CC BY (any version), which allow any use, commercial
included; share-alike, non-commercial and no-derivatives licences are left out. Each result carries the credit its
licence asks for (title, author, licence, source), which travels with the imported media into the session. Files are
fetched only from Commons' upload host, so the engine cannot be pointed at any other address.
"""

from __future__ import annotations

import html
import json
import re
import urllib.parse
import urllib.request

from . import media

API = "https://commons.wikimedia.org/w/api.php"
UPLOAD_HOST = "upload.wikimedia.org"
# Wikimedia asks API clients for a User-Agent naming the tool and where to reach it
USER_AGENT = "formwav/2 (https://github.com/nodemode-ai/formwav; audio editor)"
MAX_BYTES = 100 * 1024 * 1024

_CC_BY = re.compile(r"^cc[ -]by(?:[ -]\d(?:\.\d)?)?$")


def royalty_free(short_name: str) -> bool:
    """Public domain, CC0 and plain CC BY (any version); share-alike, non-commercial and no-derivatives are not."""
    s = re.sub(r"\s+", " ", short_name.strip().lower())
    if s.startswith("public domain") or s.startswith("pd-") or s == "pd" or s.startswith("cc0") or s.startswith("cc-zero"):
        return True
    return bool(_CC_BY.match(s))


def _text(markup: str) -> str:
    """Commons' metadata is HTML: its plain text, whitespace folded."""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", markup or ""))).strip()


def _get(url: str, timeout: float = 20.0) -> urllib.request.addinfourl:
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=timeout)


def _checked(url: str) -> str:
    """A file URL on Commons' upload host over HTTPS, or an error: nothing else is ever fetched."""
    parts = urllib.parse.urlparse(url)
    if parts.scheme != "https" or parts.hostname != UPLOAD_HOST:
        raise media.MediaError("only Wikimedia Commons' own files can be fetched")
    return url


def search(query: str, limit: int = 20) -> list[dict]:
    """Commons' audio files matching the words, royalty-free ones only, best match first, each with its credit."""
    words = " ".join(query.split())[:100]
    if not words:
        return []
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": f"filetype:audio {words}",
        "gsrnamespace": "6",
        "gsrlimit": str(min(50, max(1, limit) * 3)),
        "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata",
        "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|ObjectName",
    }
    try:
        with _get(f"{API}?{urllib.parse.urlencode(params)}") as res:
            data = json.load(res)
    except (OSError, ValueError) as err:
        raise media.MediaError(f"Wikimedia Commons could not be searched: {err}") from err
    pages = sorted(((data.get("query") or {}).get("pages") or {}).values(), key=lambda p: p.get("index", 0))
    found = []
    for page in pages:
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}
        licence = _text((meta.get("LicenseShortName") or {}).get("value", ""))
        url = info.get("url", "")
        if not royalty_free(licence) or urllib.parse.urlparse(url).hostname != UPLOAD_HOST:
            continue
        title = _text((meta.get("ObjectName") or {}).get("value", "")) or str(page.get("title", "")).removeprefix("File:").rsplit(".", 1)[0]
        author = _text((meta.get("Artist") or {}).get("value", "")) or "an unnamed author"
        source = info.get("descriptionurl", "")
        found.append({
            "title": title,
            "url": url,
            "page": source,
            "license": licence,
            "licenseUrl": (meta.get("LicenseUrl") or {}).get("value", ""),
            "author": author,
            "mime": info.get("mime", ""),
            "bytes": info.get("size", 0),
            "credit": f"\u201c{title}\u201d by {author}, {licence}, from Wikimedia Commons ({source})",
        })
        if len(found) >= limit:
            break
    return found


def _fetch(url: str) -> tuple[bytes, str]:
    try:
        with _get(_checked(url), timeout=60) as res:
            data = res.read(MAX_BYTES + 1)
            kind = res.headers.get("Content-Type", "application/octet-stream")
    except OSError as err:
        raise media.MediaError(f"the file could not be fetched: {err}") from err
    if len(data) > MAX_BYTES:
        raise media.MediaError("the file is larger than 100 MB")
    return data, kind


def preview(url: str) -> tuple[bytes, str]:
    """The file's bytes and type, for the interface to play before adding (served same-origin by the engine)."""
    return _fetch(url)


def import_item(url: str, title: str, credit: str, rate: int | None = None) -> dict:
    """The file imported as media (any format the engine reads), carrying its credit for the session to keep."""
    data, _ = _fetch(url)
    # The suffix from the URL's path alone: Commons appends tracking parameters to its file URLs
    leaf = urllib.parse.urlparse(url).path.rsplit("/", 1)[-1]
    suffix = leaf.rsplit(".", 1)[-1].lower() if "." in leaf else "ogg"
    name = f"{re.sub(r'[\\\\/:*?\"<>|]+', ' ', title).strip()[:80] or 'Commons recording'}.{suffix}"
    ref = media.import_audio(name, data, rate)
    ref["credit"] = credit[:500]
    return ref
