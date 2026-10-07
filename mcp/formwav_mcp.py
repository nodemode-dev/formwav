"""Run formwav's MCP server from the repository.

The server is backend/formwav_mcp/server.py; backend/formwav_mcp/serve runs it with the venv formwav_oc_install makes.
This file runs the same module from a checkout, with that venv or the one mcp/oc_install makes.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from formwav_mcp.server import main

if __name__ == "__main__":
    main()
