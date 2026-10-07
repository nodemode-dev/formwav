"""Certificates for the engine's own downloads (models, language packs, the sound catalogue) when Python has none.

python.org's Python on a Mac ships without a certificate store until its Install Certificates step is run, so every
HTTPS fetch through urllib failed verification there (the RNNoise model, first of all). When the default context holds
no certificate authority, urllib's global opener is given certifi's bundle, which httpx already depends on.
"""

from __future__ import annotations

import ssl
import urllib.request


def install() -> bool:
    """Installs certifi's bundle for urllib when the default context has no CA; True when it did."""
    if ssl.create_default_context().cert_store_stats().get("x509_ca", 0) > 0:
        return False
    try:
        import certifi
    except ImportError:
        return False
    context = ssl.create_default_context(cafile=certifi.where())
    urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=context)))
    return True
