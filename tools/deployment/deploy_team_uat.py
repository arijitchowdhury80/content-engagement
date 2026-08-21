#!/usr/bin/env python3
"""Publish the portable team UAT deck at an unlisted Jahia file URL."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import ssl
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "testing/team-uat/content-engagement-team-uat.html"
ENV_FILE = ROOT / ".env.local"
CONFIG = Path.home() / ".codex/config.toml"
CONFIG_FALLBACKS = (
    Path.home() / ".codex/config.toml.disabled-20260817-233846",
    Path.home() / ".codex/config.toml.bak-jahia-mcp-2026-08-12",
)
DEFAULT_JAHIA_BASE_URL = "https://tmp-content-eng-algolia.cloud.jahia.com"
FILE_NAME = "content-engagement-team-uat.html"
FILE_PATH = f"/sites/www/files/{FILE_NAME}"
EVIDENCE = ROOT / "docs/evidence/deployments/team-uat"


def read_env_value(path: Path, name: str) -> str:
    if not path.exists():
        return ""
    pattern = re.compile(rf"^\s*(?:export\s+)?{re.escape(name)}\s*=\s*(.*?)\s*$")
    for line in path.read_text(encoding="utf-8").splitlines():
        match = pattern.match(line)
        if not match:
            continue
        value = match.group(1).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        return value.strip()
    return ""


def load_authorization(
    environ: dict[str, str] | None = None,
    env_file: Path = ENV_FILE,
    config_files: tuple[Path, ...] = (CONFIG, *CONFIG_FALLBACKS),
) -> str:
    values = environ if environ is not None else os.environ
    token = (
        values.get("JAHIA_API_TOKEN", "").strip()
        or values.get("JHIA_API_TOKEN", "").strip()
        or read_env_value(env_file, "JAHIA_API_TOKEN")
        or read_env_value(env_file, "JHIA_API_TOKEN")
    )
    if token:
        return token if token.startswith("APIToken ") else f"APIToken {token}"

    authorization = values.get("JAHIA_AUTHORIZATION", "").strip()
    if authorization:
        return authorization

    for config_file in config_files:
        if not config_file.exists():
            continue
        match = re.search(
            r'\[mcp_servers\.jahia\][\s\S]*?authorization\s*=\s*"([^"]+)"',
            config_file.read_text(encoding="utf-8"),
        )
        if match:
            return match.group(1)

    raise RuntimeError(
        "Jahia credentials not found in JAHIA_API_TOKEN, JHIA_API_TOKEN, repo .env.local, "
        "JAHIA_AUTHORIZATION, or Codex config backups"
    )


def load_base_url(
    environ: dict[str, str] | None = None,
    env_file: Path = ENV_FILE,
) -> str:
    values = environ if environ is not None else os.environ
    return (
        values.get("JAHIA_BASE_URL", "").strip()
        or values.get("JHIA_BASE_URL", "").strip()
        or read_env_value(env_file, "JAHIA_BASE_URL")
        or read_env_value(env_file, "JHIA_BASE_URL")
        or DEFAULT_JAHIA_BASE_URL
    ).rstrip("/")


def ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def live_url() -> str:
    return f"{load_base_url()}/files/live/sites/www/files/{FILE_NAME}"


def graphql(query: str, variables: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"{load_base_url()}/modules/graphql",
        data=json.dumps({"query": query, "variables": variables or {}}).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": load_authorization(),
        },
    )
    with urllib.request.urlopen(request, timeout=60, context=ssl_context()) as response:
        result = json.loads(response.read().decode("utf-8"))
    if result.get("errors"):
        raise RuntimeError(json.dumps(result["errors"], indent=2))
    return result


def read_node(workspace: str) -> dict | None:
    query = f"""
    query TeamUatFile($path: String!) {{
      jcr(workspace: {workspace}) {{
        nodeByPath(path: $path) {{
          path
          children {{ nodes {{ name properties {{ name value }} }} }}
        }}
      }}
    }}
    """
    try:
        return graphql(query, {"path": FILE_PATH})["data"]["jcr"]["nodeByPath"]
    except RuntimeError as error:
        if "PathNotFoundException" in str(error):
            return None
        raise


def content(node: dict | None) -> str | None:
    if not node:
        return None
    for child in node.get("children", {}).get("nodes", []):
        if child.get("name") != "jcr:content":
            continue
        for prop in child.get("properties", []):
            if prop.get("name") == "jcr:data":
                return prop.get("value")
    return None


def upsert(html: str) -> None:
    if read_node("EDIT"):
        mutation = """
        mutation UpdateTeamUat($path: String!, $content: String!) {
          jcr(workspace: EDIT) {
            mutateNode(pathOrId: $path) {
              mutateDescendant(relPath: "jcr:content") {
                data: mutateProperty(name: "jcr:data") { setValue(type: STRING, value: $content) }
                mime: mutateProperty(name: "jcr:mimeType") { setValue(type: STRING, value: "text/html") }
              }
            }
          }
        }
        """
        graphql(mutation, {"path": FILE_PATH, "content": html})
        return

    mutation = """
    mutation CreateTeamUat($name: String!, $content: String!) {
      jcr(workspace: EDIT) {
        addNode(
          parentPathOrId: "/sites/www/files"
          name: $name
          primaryNodeType: "jnt:file"
          children: [{
            name: "jcr:content"
            primaryNodeType: "jnt:resource"
            properties: [
              { name: "jcr:data", type: STRING, value: $content }
              { name: "jcr:mimeType", type: STRING, value: "text/html" }
            ]
          }]
        ) { node { path } }
      }
    }
    """
    graphql(mutation, {"name": FILE_NAME, "content": html})
    for _ in range(10):
        if read_node("EDIT"):
            return
        time.sleep(0.5)
    raise RuntimeError("Created team UAT file did not become readable in Jahia EDIT workspace")


def publish_path(path: str) -> None:
    mutation = """
    mutation PublishTeamUat($path: String!) {
      jcr(workspace: EDIT) {
        mutateNode(pathOrId: $path) {
          publish(languages: ["en"], publishSubNodes: true, includeSubTree: true)
        }
      }
    }
    """
    graphql(mutation, {"path": path})


def publish() -> None:
    publish_path(f"{FILE_PATH}/jcr:content")
    publish_path(FILE_PATH)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    html = SOURCE.read_text(encoding="utf-8")
    report = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE),
        "path": FILE_PATH,
        "liveUrl": live_url(),
        "bytes": len(html.encode("utf-8")),
        "sha256": sha256(html),
        "applied": args.apply,
    }
    if args.apply:
        upsert(html)
        publish()
        live = None
        for _ in range(30):
            live = content(read_node("LIVE"))
            if live == html:
                break
            time.sleep(2)
        report["liveSha256"] = sha256(live) if live is not None else None
        report["verified"] = live == html
        if not report["verified"]:
            raise RuntimeError("Published team UAT deck did not match the local standalone artifact")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    report_name = "latest.json" if args.apply else "dry-run.json"
    (EVIDENCE / report_name).write_text(
        json.dumps(report, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
