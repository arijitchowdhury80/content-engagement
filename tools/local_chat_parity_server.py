#!/usr/bin/env python3
"""Serve a local Algolia.com-like site for chat widget parity testing.

The server is intentionally small: it hosts representative website routes from
local-sites/algolia-com-parity and serves the current editable widget files from
frontend/chat-widget under /chat/<file>.js. Jahia is not touched.
"""

from __future__ import annotations

import argparse
import http.server
import mimetypes
import socketserver
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAT_DIR = ROOT / "frontend" / "chat-widget"
SITE_DIR = ROOT / "local-sites" / "algolia-com-parity"
FIXTURE = SITE_DIR / "index.html"


class LocalParityHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        route = path.split("?", 1)[0].split("#", 1)[0]
        if route.startswith("/chat/"):
            target = CHAT_DIR / route.removeprefix("/chat/")
            return str(target)
        if route in {"/", ""} or "." not in Path(route).name:
            return str(FIXTURE)
        return str(SITE_DIR / route.removeprefix("/"))

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path: str) -> str:
        if path.endswith(".js"):
            return "application/javascript"
        if path.endswith(".html"):
            return "text/html; charset=utf-8"
        return mimetypes.guess_type(path)[0] or "application/octet-stream"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5177)
    args = parser.parse_args()

    if not FIXTURE.exists():
        raise SystemExit(f"Missing local parity fixture: {FIXTURE}")

    with socketserver.TCPServer((args.host, args.port), LocalParityHandler) as httpd:
        print(f"Local chat parity server: http://{args.host}:{args.port}/")
        print("Press Ctrl+C to stop.")
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
