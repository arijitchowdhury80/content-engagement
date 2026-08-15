#!/usr/bin/env python3
"""Manifest-driven deploy wrapper for the Algolia.com chat stack."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "config/deployments/algolia-chat-stack.json"
ENV_FILE = ROOT / ".env.local"
BASE_AGENT_URL_TEMPLATE = "https://{app}.algolia.net/agent-studio/1/agents/{agent_id}"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def now_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_env() -> dict[str, str]:
    values = dict(os.environ)
    if ENV_FILE.exists():
        for raw_line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return values


def request_json(
    method: str,
    url: str,
    app_id: str,
    api_key: str,
    payload: dict | None = None,
) -> dict:
    body = None
    headers = {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": app_id,
        "X-Algolia-API-Key": api_key,
        "User-Agent": "curl/8.4.0",
    }
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    context = ssl._create_unverified_context()
    try:
        with urllib.request.urlopen(request, timeout=60, context=context) as response:
            text = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed with {exc.code}: {error_body}") from exc
    return json.loads(text) if text else {}


def agent_summary(agent: dict) -> dict:
    config = agent.get("config") or {}
    tools = agent.get("tools") or []
    return {
        "name": agent.get("name"),
        "providerId": agent.get("providerId"),
        "model": agent.get("model"),
        "instructionsHash": sha256(agent.get("instructions") or ""),
        "systemPromptHash": sha256(agent.get("systemPrompt") or ""),
        "toolCount": len(tools),
        "configKeys": sorted(config.keys()),
    }


def deploy_orchestrator(manifest: dict, apply: bool, run_id: str) -> dict:
    env = load_env()
    env_spec = manifest["environment"]
    app_id = env.get(env_spec["algoliaAppIdEnv"])
    admin_key = env.get(env_spec["algoliaAdminApiKeyEnv"])
    if not app_id or not admin_key:
        raise RuntimeError(
            f"Missing {env_spec['algoliaAppIdEnv']} or {env_spec['algoliaAdminApiKeyEnv']} in environment/.env.local"
        )

    spec = manifest["agentStudio"]["orchestrator"]
    url = BASE_AGENT_URL_TEMPLATE.format(app=app_id, agent_id=spec["agentId"])
    evidence_dir = ROOT / spec["evidenceRoot"] / f"chat-stack-deploy-{run_id}" / "orchestrator"
    before = request_json("GET", url, app_id, admin_key)
    next_instructions = (ROOT / spec["instructionsPath"]).read_text(encoding="utf-8")
    next_system_prompt = (ROOT / spec["systemPromptPath"]).read_text(encoding="utf-8")

    packet = {
        "target": {
            "surface": "Agent Studio",
            "agentId": spec["agentId"],
            "name": spec["name"],
            "url": url,
        },
        "currentValue": agent_summary(before),
        "intendedValue": {
            "instructionsPath": spec["instructionsPath"],
            "instructionsHash": sha256(next_instructions),
            "systemPromptPath": spec["systemPromptPath"],
            "systemPromptHash": sha256(next_system_prompt),
        },
        "rollback": {
            "instructions": before.get("instructions") or "",
            "systemPrompt": before.get("systemPrompt") or "",
            "instructionsHash": sha256(before.get("instructions") or ""),
            "systemPromptHash": sha256(before.get("systemPrompt") or ""),
        },
        "validation": [
            "Read back the agent after PATCH.",
            "Verify instructionsHash equals intendedValue.instructionsHash.",
            "Verify systemPromptHash equals intendedValue.systemPromptHash.",
            "Verify providerId, model, tool count, and config key set remain unchanged.",
        ],
        "apply": apply,
    }
    write_json(evidence_dir / "before-snapshot.json", before)
    write_json(evidence_dir / "mutation-packet.json", packet)

    result = {
        "target": "orchestrator",
        "apply": apply,
        "evidenceDir": str(evidence_dir.relative_to(ROOT)),
        "packet": str((evidence_dir / "mutation-packet.json").relative_to(ROOT)),
    }
    if not apply:
        result["pass"] = True
        result["message"] = "dry-run packet created; no Agent Studio mutation applied"
        return result

    payload = {
        "instructions": next_instructions,
        "systemPrompt": next_system_prompt,
    }
    request_json("PATCH", url, app_id, admin_key, payload)
    after = request_json("GET", url, app_id, admin_key)
    write_json(evidence_dir / "after-readback.json", after)

    before_summary = agent_summary(before)
    after_summary = agent_summary(after)
    checks = {
        "instructions_hash": after_summary["instructionsHash"] == sha256(next_instructions),
        "system_prompt_hash": after_summary["systemPromptHash"] == sha256(next_system_prompt),
        "provider_unchanged": after_summary["providerId"] == before_summary["providerId"],
        "model_unchanged": after_summary["model"] == before_summary["model"],
        "tool_count_unchanged": after_summary["toolCount"] == before_summary["toolCount"],
        "config_keys_unchanged": after_summary["configKeys"] == before_summary["configKeys"],
    }
    validation = {
        "pass": all(checks.values()),
        "checks": checks,
        "before": before_summary,
        "after": after_summary,
    }
    write_json(evidence_dir / "validation.json", validation)
    result["pass"] = validation["pass"]
    result["validation"] = str((evidence_dir / "validation.json").relative_to(ROOT))
    return result


def run_jahia(manifest: dict, apply: bool, run_id: str) -> dict:
    script = ROOT / manifest["jahia"]["deployScript"]
    if not script.exists():
        raise RuntimeError(f"Jahia deploy script missing: {script}")
    evidence_dir = ROOT / "docs/evidence/visitor-intelligence" / f"chat-stack-deploy-{run_id}" / "jahia"
    command = [
        sys.executable,
        str(script),
        "--evidence-dir",
        str(evidence_dir.relative_to(ROOT)),
    ]
    if apply:
        command.append("--apply")
    completed = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    return {
        "target": "jahia",
        "apply": apply,
        "pass": completed.returncode == 0,
        "command": " ".join(command),
        "evidenceDir": str(evidence_dir.relative_to(ROOT)),
        "output": completed.stdout[-8000:],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["all", "jahia", "orchestrator"], default="all")
    parser.add_argument("--apply", action="store_true", help="Apply mutations. Omit for dry-run.")
    args = parser.parse_args()

    manifest = load_json(MANIFEST)
    run_id = now_slug()
    results = []
    if args.target in {"all", "jahia"}:
        results.append(run_jahia(manifest, args.apply, run_id))
    if args.target in {"all", "orchestrator"}:
        results.append(deploy_orchestrator(manifest, args.apply, run_id))

    summary = {
        "manifest": str(MANIFEST.relative_to(ROOT)),
        "runId": run_id,
        "apply": args.apply,
        "pass": all(item.get("pass") for item in results),
        "results": results,
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0 if summary["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
