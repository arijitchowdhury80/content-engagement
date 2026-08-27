from pathlib import Path
import re
import sys

import pytest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/deployment"))

import judge_release_guard as guard


VALID_BLOCK = '''<algolia-chat-confidence>
<algolia-agent role="skeptic" agent-id="s"></algolia-agent>
<algolia-agent role="referee" agent-id="r"></algolia-agent>
<algolia-agent role="advocate" agent-id="a"></algolia-agent>
</algolia-chat-confidence>'''


def test_block_guard_accepts_only_the_mandatory_three_role_contract():
    guard.validate_block_html(VALID_BLOCK)
    with pytest.raises(RuntimeError, match="must not have a mode attribute"):
        guard.validate_block_html(VALID_BLOCK.replace("<algolia-chat-confidence>", '<algolia-chat-confidence mode="off">'))
    with pytest.raises(RuntimeError, match="must not have a judge-mode attribute"):
        guard.validate_block_html(VALID_BLOCK.replace("<algolia-chat-confidence>", '<algolia-chat judge-mode="off"></algolia-chat><algolia-chat-confidence>'))
    with pytest.raises(RuntimeError, match="exactly one skeptic"):
        guard.validate_block_html(VALID_BLOCK.replace('role="skeptic"', 'role="referee"'))


def test_runtime_guard_accepts_current_source_and_rejects_the_regression():
    runtime = (ROOT / "frontend/chat-widget/algolia-chat.js").read_text(encoding="utf-8")
    guard.validate_chat_runtime(runtime)
    with pytest.raises(RuntimeError, match="shared panel deadline"):
        guard.validate_chat_runtime(runtime + "Judge panel deadline exceeded")


def test_compare_guard_accepts_current_source_and_rejects_judge_control():
    compare = (ROOT / "frontend/chat-widget/algolia-chat-compare.js").read_text(encoding="utf-8")
    guard.validate_compare_runtime(compare)
    with pytest.raises(RuntimeError, match="Compare contains judge control"):
        guard.validate_compare_runtime(compare + "setJudgeMode")
    with pytest.raises(RuntimeError, match="Compare contains judge control"):
        guard.validate_compare_runtime(compare + 'setAttribute("judge-mode", "off")')


def test_every_deployment_uses_the_single_guarded_html_writer():
    deployment_dir = ROOT / "tools/deployment"
    direct_mutators = []
    unguarded_callers = []
    for path in deployment_dir.glob("deploy_*.py"):
        source = path.read_text(encoding="utf-8")
        if "mutation SetBlockHtml" in source and path.name != "deploy_jahia_engagement_tracker.py":
            direct_mutators.append(path.name)
        if path.name != "deploy_jahia_engagement_tracker.py" and re.search(r"\bset_block_html\(", source):
            if "import deploy_jahia_engagement_tracker as jahia" not in source:
                unguarded_callers.append(path.name)
            if re.search(r"(?<!jahia\.)set_block_html\(", source):
                unguarded_callers.append(path.name)
    assert direct_mutators == []
    assert unguarded_callers == []


def test_agent_rules_lock_judge_ownership_for_parallel_tasks():
    rules = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    assert "Browser judging is mandatory" in rules
    assert "Compare is read-only with respect to judging" in rules
    assert "Every Jahia custom-code-block mutation must use" in rules
