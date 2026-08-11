#!/usr/bin/env python3
"""
curl_secret — run curl without putting a credential in the process argument list.

THE PROBLEM
  `curl -H "Authorization: Bearer sk-..."` puts the token in argv, and argv is world-readable on
  this machine: any local process can run `ps auxww` and read it. The corpus fetch spawns one curl
  per page, so a 10,198-page run would expose the Scout token roughly 20,000 times (POST + poll).
  The same pattern carried the Algolia admin key, the inference-server key, and the Asana PAT.

  Found by Codex, 2026-08-09, in review of the production path. It is a real exposure, not a
  theoretical one -- earlier in the same session a `ps aux` in this very repo printed full command
  lines to the transcript.

THE FIX
  curl's `--config -` reads options from stdin. Options given there never appear in argv. Secret
  headers go through the config; the URL, method, timeouts and request body stay as normal
  arguments because none of them is a credential.

  Config-file syntax is not shell: one option per line, values double-quoted, and a literal
  backslash or double quote inside a value must be escaped. Tokens are base64-ish in practice, but
  the escaping is done properly rather than assumed, because a silently mangled header is an auth
  failure that looks like a network failure.

WHAT THIS DOES NOT FIX
  A credential is still in this process's environment and in `.env.local`. That is a different
  exposure with a different mitigation, and it is not claimed here.
"""

from __future__ import annotations

import subprocess


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def build_config(headers: dict[str, str]) -> str:
    """curl config text carrying one `header = "..."` line per entry."""
    return "\n".join(f'header = "{_escape(name)}: {_escape(value)}"'
                     for name, value in headers.items()) + "\n"


def curl(args: list[str], secret_headers: dict[str, str],
         timeout: int | None = None) -> subprocess.CompletedProcess:
    """`curl <args>` with `secret_headers` supplied out of band.

    `args` must NOT contain the credential. It may contain the URL, -X, -d, --max-time and so on.
    `--config -` is appended, and the config is written to curl's stdin.
    """
    return subprocess.run(
        ["curl", *args, "--config", "-"],
        input=build_config(secret_headers),
        capture_output=True, text=True, timeout=timeout,
    )
