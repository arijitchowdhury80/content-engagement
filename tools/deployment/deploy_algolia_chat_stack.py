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
from copy import deepcopy
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


def merge_config(current: dict | None, patch: dict | None) -> dict:
    """Apply declared top-level Agent Studio config changes without dropping live controls."""
    return {**(current or {}), **(patch or {})}


def patch_search_tool(tools: list[dict], patch: dict) -> list[dict]:
    """Patch one declared search index while preserving every other tool field."""
    patched = deepcopy(tools)
    matching_tools = [tool for tool in patched if tool.get("name") == patch["toolName"]]
    if len(matching_tools) != 1:
        raise RuntimeError(
            f"Expected exactly one tool named {patch['toolName']!r}; found {len(matching_tools)}"
        )

    tool = matching_tools[0]
    matching_indices = [
        index for index in (tool.get("indices") or []) if index.get("index") == patch["indexName"]
    ]
    if len(matching_indices) != 1:
        raise RuntimeError(
            f"Expected exactly one index named {patch['indexName']!r}; found {len(matching_indices)}"
        )

    index = matching_indices[0]
    index["searchParameters"] = {
        **(index.get("searchParameters") or {}),
        **(patch.get("searchParameters") or {}),
    }
    return patched


def build_search_tool_payload(tools: list[dict], patch: dict) -> dict:
    """Build a tool-only Agent Studio payload; prompts and agent config are out of scope."""
    return {"tools": patch_search_tool(tools, patch)}


def deploy_search_tool(
    manifest: dict,
    apply: bool,
    run_id: str,
    evidence_dir_override: Path | None = None,
) -> dict:
    env = load_env()
    env_spec = manifest["environment"]
    app_id = env.get(env_spec["algoliaAppIdEnv"])
    admin_key = env.get(env_spec["algoliaAdminApiKeyEnv"])
    if not app_id or not admin_key:
        raise RuntimeError(
            f"Missing {env_spec['algoliaAppIdEnv']} or {env_spec['algoliaAdminApiKeyEnv']} in environment/.env.local"
        )

    spec = manifest["agentStudio"]["orchestrator"]
    patch = spec["searchToolPatch"]
    url = BASE_AGENT_URL_TEMPLATE.format(app=app_id, agent_id=spec["agentId"])
    evidence_dir = evidence_dir_override or (
        ROOT / spec["evidenceRoot"] / f"chat-stack-deploy-{run_id}" / "orchestrator-search"
    )
    before = request_json("GET", url, app_id, admin_key)
    payload = build_search_tool_payload(before.get("tools") or [], patch)
    packet = {
        "target": {
            "surface": "Agent Studio",
            "agentId": spec["agentId"],
            "name": spec["name"],
            "url": url,
        },
        "scope": "orchestrator search tool only",
        "searchToolPatch": patch,
        "payloadKeys": sorted(payload.keys()),
        "rollback": {"tools": before.get("tools") or []},
        "apply": apply,
    }
    before_path = evidence_dir / "before-snapshot.json"
    packet_path = evidence_dir / "mutation-packet.json"
    if apply and evidence_dir_override:
        if not before_path.exists() or not packet_path.exists():
            raise RuntimeError("Reviewed private dry-run evidence is required before apply")
        reviewed_before = load_json(before_path)
        reviewed_packet = load_json(packet_path)
        stable_fields = ["tools", "instructions", "systemPrompt", "config", "providerId", "model"]
        if any(before.get(field) != reviewed_before.get(field) for field in stable_fields):
            raise RuntimeError("Agent Studio target drifted after dry-run; refusing search-tool mutation")
        if reviewed_packet.get("searchToolPatch") != patch:
            raise RuntimeError("Search-tool patch drifted after dry-run; refusing mutation")
    else:
        write_json(before_path, before)
        write_json(packet_path, packet)

    evidence_label = str(evidence_dir) if evidence_dir_override else str(evidence_dir.relative_to(ROOT))
    result = {
        "target": "orchestrator-search",
        "apply": apply,
        "evidenceDir": evidence_label,
        "packet": str(packet_path) if evidence_dir_override else str(packet_path.relative_to(ROOT)),
    }
    if not apply:
        result["pass"] = True
        result["message"] = "dry-run tool-only packet created; no Agent Studio mutation applied"
        return result

    request_json("PATCH", url, app_id, admin_key, payload)
    after = request_json("GET", url, app_id, admin_key)
    write_json(evidence_dir / "after-readback.json", after)
    expected_tools = payload["tools"]
    checks = {
        "tools_match": after.get("tools") == expected_tools,
        "instructions_unchanged": after.get("instructions") == before.get("instructions"),
        "system_prompt_unchanged": after.get("systemPrompt") == before.get("systemPrompt"),
        "config_unchanged": after.get("config") == before.get("config"),
        "provider_unchanged": after.get("providerId") == before.get("providerId"),
        "model_unchanged": after.get("model") == before.get("model"),
    }
    validation = {"pass": all(checks.values()), "checks": checks}
    write_json(evidence_dir / "validation.json", validation)
    result["pass"] = validation["pass"]
    validation_path = evidence_dir / "validation.json"
    result["validation"] = str(validation_path) if evidence_dir_override else str(validation_path.relative_to(ROOT))
    return result


def deploy_agent(manifest: dict, role: str, apply: bool, run_id: str) -> dict:
    env = load_env()
    env_spec = manifest["environment"]
    app_id = env.get(env_spec["algoliaAppIdEnv"])
    admin_key = env.get(env_spec["algoliaAdminApiKeyEnv"])
    if not app_id or not admin_key:
        raise RuntimeError(
            f"Missing {env_spec['algoliaAppIdEnv']} or {env_spec['algoliaAdminApiKeyEnv']} in environment/.env.local"
        )

    spec = manifest["agentStudio"][role]
    url = BASE_AGENT_URL_TEMPLATE.format(app=app_id, agent_id=spec["agentId"])
    evidence_dir = ROOT / spec["evidenceRoot"] / f"chat-stack-deploy-{run_id}" / role
    before = request_json("GET", url, app_id, admin_key)
    next_instructions = (ROOT / spec["instructionsPath"]).read_text(encoding="utf-8")
    next_system_prompt = (ROOT / spec["systemPromptPath"]).read_text(encoding="utf-8")
    config_patch = spec.get("configPatch") or {}
    next_config = merge_config(before.get("config"), config_patch)

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
            "configPatch": config_patch,
            "toolsPolicy": spec.get("toolsPolicy", "preserve"),
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
            "Verify providerId, model, and config key set remain unchanged.",
            "Verify the declared tools policy is satisfied.",
        ],
        "apply": apply,
    }
    write_json(evidence_dir / "before-snapshot.json", before)
    write_json(evidence_dir / "mutation-packet.json", packet)

    result = {
        "target": role,
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
    if config_patch:
        payload["config"] = next_config
    if spec.get("toolsPolicy") == "empty":
        payload["tools"] = []
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
        "tools_policy_satisfied": (
            after_summary["toolCount"] == 0
            if spec.get("toolsPolicy") == "empty"
            else after_summary["toolCount"] == before_summary["toolCount"]
        ),
        "config_patch_applied": all(
            (after.get("config") or {}).get(key) == value
            for key, value in config_patch.items()
        ),
        "unpatched_config_preserved": all(
            (after.get("config") or {}).get(key) == value
            for key, value in (before.get("config") or {}).items()
            if key not in config_patch
        ),
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
    parser.add_argument(
        "--target",
        choices=[
            "all",
            "jahia",
            "agent-studio",
            "greetings",
            "orchestrator",
            "orchestrator-search",
            "developer-specialist",
        ],
        default="all",
    )
    parser.add_argument("--apply", action="store_true", help="Apply mutations. Omit for dry-run.")
    parser.add_argument(
        "--evidence-dir",
        help="Private /private/tmp evidence directory for a reviewed orchestrator-search dry-run/apply pair.",
    )
    args = parser.parse_args()

    evidence_dir_override = None
    if args.evidence_dir:
        if args.target != "orchestrator-search":
            parser.error("--evidence-dir is supported only with --target orchestrator-search")
        evidence_dir_override = Path(args.evidence_dir).resolve()
        if not str(evidence_dir_override).startswith("/private/tmp/"):
            parser.error("--evidence-dir must be an absolute path under /private/tmp")

    manifest = load_json(MANIFEST)
    run_id = now_slug()
    results = []
    if args.target in {"all", "jahia"}:
        results.append(run_jahia(manifest, args.apply, run_id))
    if args.target in {"all", "agent-studio", "greetings"}:
        results.append(deploy_agent(manifest, "greetings", args.apply, run_id))
    if args.target in {"all", "agent-studio", "orchestrator"}:
        results.append(deploy_agent(manifest, "orchestrator", args.apply, run_id))
    if args.target == "orchestrator-search":
        results.append(
            deploy_search_tool(
                manifest,
                args.apply,
                run_id,
                evidence_dir_override=evidence_dir_override,
            )
        )
    if args.target in {"all", "agent-studio", "developer-specialist"}:
        results.append(deploy_agent(manifest, "developerSpecialist", args.apply, run_id))

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
