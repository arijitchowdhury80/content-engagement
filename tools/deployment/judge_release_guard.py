"""Fail-closed invariants for every Jahia chat release path.

This module contains no deployment code. All Jahia writers import it so a
feature-specific release cannot silently disable or replace the judge lifecycle.
"""

from __future__ import annotations

import re


CONFIDENCE_TAG = re.compile(r"<algolia-chat-confidence(?=[\s>])[^>]*>", re.I)
MODE_ATTRIBUTE = re.compile(r"\bmode\s*=", re.I)
JUDGE_MODE_ATTRIBUTE = re.compile(r"\bjudge-mode\s*=", re.I)
ROLE_ATTRIBUTE = re.compile(r"<algolia-agent\b[^>]*\brole=[\"'](skeptic|referee|advocate)[\"']", re.I)


def validate_block_html(html: str) -> None:
    """Reject any block that can configure judging off or omit panel roles."""
    if not isinstance(html, str) or not html:
        raise RuntimeError("Jahia block HTML must be a non-empty string")
    tags = CONFIDENCE_TAG.findall(html)
    if len(tags) != 1:
        raise RuntimeError(f"Expected exactly one algolia-chat-confidence element; found {len(tags)}")
    if MODE_ATTRIBUTE.search(tags[0]):
        raise RuntimeError("Judge release guard: algolia-chat-confidence must not have a mode attribute")
    if JUDGE_MODE_ATTRIBUTE.search(html):
        raise RuntimeError("Judge release guard: the chat block must not have a judge-mode attribute")
    roles = ROLE_ATTRIBUTE.findall(html)
    if sorted(role.lower() for role in roles) != ["advocate", "referee", "skeptic"]:
        raise RuntimeError("Judge release guard: exactly one skeptic, referee, and advocate are required")


def validate_chat_runtime(source: str) -> None:
    """Verify the locked judge lifecycle is present in a candidate chat bundle."""
    required = {
        "mandatory confidence element": 'static get observedAttributes(){return["agents"]}get judgeMode(){return"algolia"}',
        "mandatory judge resolver": 'function wA(e){return"algolia"}',
        "role-specific retry": 'phase:"retrying"',
        "three-role parallel dispatch": 's.ROLES.map(g=>__arrieRunRoleJudge',
    }
    missing = [label for label, marker in required.items() if marker not in source]
    if missing:
        raise RuntimeError(f"Judge release guard: chat runtime is missing {', '.join(missing)}")
    forbidden = {
        "confidence mode switch": 'getAttribute("mode")==="off"',
        "inline mode switch": 'function wA(e){return e==="off"?"off":"algolia"}',
        "shared panel deadline": "Judge panel deadline exceeded",
    }
    present = [label for label, marker in forbidden.items() if marker in source]
    if present:
        raise RuntimeError(f"Judge release guard: chat runtime contains {', '.join(present)}")


def validate_compare_runtime(source: str) -> None:
    """Keep Compare independent from judge state and presentation."""
    forbidden = [
        marker
        for marker in ("setJudgeMode", "judge-mode", "algolia-chat-confidence")
        if marker in source
    ]
    if forbidden:
        raise RuntimeError(f"Judge release guard: Compare contains judge control: {', '.join(forbidden)}")
