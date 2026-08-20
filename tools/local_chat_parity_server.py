#!/usr/bin/env python3
"""Serve a local Algolia.com-like site for chat widget parity testing.

The server is intentionally small: it hosts representative website routes from
local-sites/algolia-com-parity and serves the current editable widget files from
frontend/chat-widget under /chat/<file>.js. Jahia is not touched.

It also exposes one POST route, /__compare/production, used by the
compare-with-production companion. localhost is not on the production agent's
approved-domains list, so the browser cannot call that agent directly from here;
this route forwards the turn server-side with the approved Origin attached. The
production key stays in this process and is never sent to the browser.

The same companion talks to production directly on surfaces whose origin IS
approved (Jahia), where no proxy is involved at all.
"""

from __future__ import annotations

import argparse
import http.server
import json
import mimetypes
import os
import ssl
import socketserver
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAT_DIR = ROOT / "frontend" / "chat-widget"
SITE_DIR = ROOT / "local-sites" / "algolia-com-parity"
FIXTURE = SITE_DIR / "index.html"
UAT_STANDALONE = ROOT / "testing" / "team-uat" / "content-engagement-team-uat.html"
ENV_FILE = ROOT / ".env.local"

COMPARE_ROUTE = "/__compare/production"
MAX_BODY_BYTES = 256 * 1024          # a chat turn is tiny; refuse anything larger
UPSTREAM_TIMEOUT = 60
APPROVED_ORIGIN = "https://www.algolia.com"
# Corporate TLS interception presents a self-signed root, which urllib rejects.
# Verification stays ON by default; set COMPARE_INSECURE_TLS=1 to relax it for a
# loopback dev harness on an intercepted network. Never set it anywhere else.
INSECURE_TLS = os.environ.get("COMPARE_INSECURE_TLS") == "1"


def ssl_context() -> ssl.SSLContext:
    if INSECURE_TLS:
        return ssl._create_unverified_context()
    system_ca = "/etc/ssl/cert.pem"
    if os.path.exists(system_ca):
        return ssl.create_default_context(cafile=system_ca)
    return ssl.create_default_context()


def load_env(path: Path) -> dict[str, str]:
    """Parse .env.local. Values are used in-process and never returned to a client."""
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


ENV = load_env(ENV_FILE)
PROD_APP_ID = os.environ.get("PROD_ASKAI_APP_ID") or ENV.get("PROD_ASKAI_APP_ID", "")
PROD_SEARCH_KEY = os.environ.get("PROD_ASKAI_SEARCH_KEY") or ENV.get("PROD_ASKAI_SEARCH_KEY", "")
PROD_AGENT_ID = os.environ.get("PROD_ASKAI_AGENT_ID") or ENV.get("PROD_ASKAI_AGENT_ID", "")


def completions_url() -> str:
    return (
        f"https://{PROD_APP_ID}.algolia.net/agent-studio/1/agents/"
        f"{PROD_AGENT_ID}/completions?stream=true&compatibilityMode=ai-sdk-5"
    )


class LocalParityHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        route = path.split("?", 1)[0].split("#", 1)[0]
        if route.startswith("/chat/"):
            target = CHAT_DIR / route.removeprefix("/chat/")
            return str(target)
        if route in {"/team-uat", "/team-uat/"}:
            return str(UAT_STANDALONE)
        if route in {"/", ""} or "." not in Path(route).name:
            return str(FIXTURE)
        return str(SITE_DIR / route.removeprefix("/"))

    # -- compare-with-production ------------------------------------------------
    def _is_compare_route(self) -> bool:
        return self.path.split("?", 1)[0] == COMPARE_ROUTE

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler naming
        # Without this the route falls through to the static handler, which has no
        # extension to key on and would serve the parity fixture with a 200.
        if self._is_compare_route():
            self._json(405, {"error": "POST only"})
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler naming
        if self._is_compare_route():
            self._json(405, {"error": "POST only"})
            return
        super().do_HEAD()

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler naming
        route = self.path.split("?", 1)[0]
        if route != COMPARE_ROUTE:
            self.send_error(404, "Not found")
            return
        if not (PROD_APP_ID and PROD_SEARCH_KEY and PROD_AGENT_ID):
            self._json(503, {"error": "PROD_ASKAI_* is not configured in .env.local"})
            return
        if (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/json":
            self._json(415, {"error": "Expected application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._json(400, {"error": "Bad Content-Length"})
            return
        if length <= 0:
            self._json(400, {"error": "Empty body"})
            return
        if length > MAX_BODY_BYTES:
            self._json(413, {"error": f"Body exceeds {MAX_BODY_BYTES} bytes"})
            return
        raw = self.rfile.read(length)
        try:
            json.loads(raw)  # validate; forwarded verbatim
        except json.JSONDecodeError:
            self._json(400, {"error": "Body is not valid JSON"})
            return

        request = urllib.request.Request(
            completions_url(),
            data=raw,
            method="POST",
            headers={
                "content-type": "application/json",
                "x-algolia-application-id": PROD_APP_ID,
                "x-algolia-api-key": PROD_SEARCH_KEY,
                # The reason this hop exists: the agent's approved-domains list
                # rejects localhost, and Origin is a forbidden header in browsers.
                "origin": APPROVED_ORIGIN,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT, context=ssl_context()) as upstream:
                self.send_response(upstream.status)
                self.send_header("Content-Type", upstream.headers.get("Content-Type", "text/event-stream"))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                for chunk in iter(lambda: upstream.read(8192), b""):
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.HTTPError as exc:
            # Surface upstream status so the companion can show it in its column.
            self._json(exc.code, {"error": f"Production returned HTTP {exc.code}"})
        except (urllib.error.URLError, TimeoutError) as exc:
            hint = ""
            if "CERTIFICATE_VERIFY_FAILED" in str(exc) and not INSECURE_TLS:
                hint = " — TLS interception detected; rerun with COMPARE_INSECURE_TLS=1 for this local harness"
            self._json(502, {"error": f"Upstream unreachable: {exc}{hint}"})

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

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
    parser.add_argument("--host", default="127.0.0.1", help="loopback only by default")
    parser.add_argument("--port", type=int, default=5177)
    args = parser.parse_args()

    if not FIXTURE.exists():
        raise SystemExit(f"Missing local parity fixture: {FIXTURE}")
    if not UAT_STANDALONE.exists():
        raise SystemExit(f"Missing standalone team UAT deck: {UAT_STANDALONE}")

    with socketserver.TCPServer((args.host, args.port), LocalParityHandler) as httpd:
        print(f"Local chat parity server: http://{args.host}:{args.port}/")
        print(f"Team UAT deck: http://{args.host}:{args.port}/team-uat")
        if PROD_APP_ID and PROD_SEARCH_KEY and PROD_AGENT_ID:
            print(f"Compare production route: POST {COMPARE_ROUTE} -> {PROD_APP_ID}/{PROD_AGENT_ID}")
        else:
            print("Compare production route: DISABLED (set PROD_ASKAI_* in .env.local)")
        print("Press Ctrl+C to stop.")
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
