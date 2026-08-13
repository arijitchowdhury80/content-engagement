"""
Two defect classes found in the blog run's OUTPUT, both fixed at the candidate layer.

WHY AT THE CANDIDATE LAYER AND NOT IN A POST-FILTER
  A span the model was never offered cannot be picked. Filtering results afterwards would leave
  the same broken candidates in the menu for Documentation, Website, Resources and every other
  source still to run. Fix the generator, not the output.

DEFECT 1 — DANGLING MARKDOWN LINK (found by Codex, 2026-08-09)
  `canonicalise` unwraps `[text](url)` to `text`. When the link TEXT contains a full stop, the
  sentence splitter cuts inside the link and the `[` is orphaned:

      "...discusses the impacts of AI on ecommerce in this [new episode of the AI Today podcast."

  Codex's detector was `"[" in text and "](" not in text`, which also fires on every literal
  bracket in ordinary prose -- `--admin-api-key [string]`, `range of [0,1]`, a JSON array, an
  editorial `[with enterprise search are]` inside a quotation. On the blog output that rule
  produced 17 hits of which **11 were false positives**. Balance, not presence, is the signal.

DEFECT 2 — COLON LEAD-IN AND OTHER UNTERMINATED SPANS (found by Claude, 2026-08-09)
  64 of 2,065 writable rows (3.1%) held a span with no terminal punctuation. Joined into an
  abstract they read as a run-on and imply a link neither span makes:

      "...believe it's imperative to be able to do real-time course correcting"
      "Algolia, for example, is a search provider that offers near real-time analytics..."

  The cause is the `standalone` relaxation in `_is_whole_unit`, added so a period-less API lede
  could be picked (it had cost the reference family 18 of 50 pages). That relaxation is right for
  a lede and wrong for `"several additional benefits:"` -- a colon promises a list that never
  arrives. So the relaxation stays, minus the colon case.
"""

from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import candidates as C  # noqa: E402


# ---------------------------------------------------------------------------
# defect 1 — bracket balance
# ---------------------------------------------------------------------------

BROKEN = [
    "Our customer [Zenni already lets shoppers virtually try on glasses.",
    "Algolia Chief Technology Officer Sean Mullaney poses this possibility and discusses the "
    "impacts of AI on ecommerce in this [new episode of the AI Today podcast.",
    "“And about 80% of the queries happening on these ecommerce sites are longer queries."
    "…with our [vector search approach, we're getting, like, 30% more sales.",
]

CLEAN = [
    # every one of these was a FALSE POSITIVE under Codex's presence-based rule
    'According to the Journal of Information Science, "62% of dissatisfaction events [with '
    'enterprise search are] due to human rather than technology factors."',
    'By default, this setting is set to ["ignorePlurals", "monoWordSynonym"], which means that '
    'the singular/plural alternative is considered exact.',
    "Any Algolia CLI command can be called with the --admin-api-key [string] and "
    "--application-id [string] flags to specify which application to interact with.",
    "The two most-discussed scaling methods are normalization (rescaling values into a range of "
    "[0,1]) and standardization (rescaling data to have a mean of 0).",
]


@pytest.mark.parametrize("text", BROKEN)
def test_dangling_bracket_is_detected(text):
    assert C.has_broken_brackets(text) is True


@pytest.mark.parametrize("text", CLEAN)
def test_literal_brackets_in_prose_are_not_broken(text):
    assert C.has_broken_brackets(text) is False, "literal brackets in prose are not a defect"


def test_unmatched_closing_bracket_is_also_broken():
    """`children[0]` losing its `[` to link-unwrapping leaves `children0]`."""
    assert C.has_broken_brackets("write things like expect(result.props.children0].props)") is True


def test_balanced_but_crossed_is_broken():
    """
    The real span that made bracket COUNTING insufficient: one orphaned `]` early and one
    orphaned `[` late, so the counts match while both halves are damaged. Order matters, not
    just totals.
    """
    text = ("Using expect-jsx will spare you from writing expect(result.props.children0]"
            ".props.children.className) and it is based on [algolia/react-element-to-jsx-string.")
    assert C.has_broken_brackets(text) is True


def test_broken_bracket_span_is_classified_fragment():
    kind = C.classify("Our customer [Zenni already lets shoppers try on glasses.",
                      complete=True, section_title="", standalone=True)
    assert kind == C.KIND_FRAGMENT


# ---------------------------------------------------------------------------
# defect 2 — colon lead-ins and unterminated standalone spans
# ---------------------------------------------------------------------------

def test_colon_lead_in_is_not_a_whole_unit():
    """
    `complete=True` is the REAL input, and getting this wrong is what made the first version of
    the fix inert. `_TERMINAL` is ".!?:" — the splitter treats a colon as sentence-ending, so a
    colon span reaches `_is_whole_unit` with complete=True and any check placed after the
    `if complete: return True` shortcut never executes. The first draft of this test passed
    complete=False, went green, and changed nothing about the 47 real records.
    """
    assert C._ends_sentence("There are several additional benefits:") is True, \
        "guard: if ':' ever leaves _TERMINAL, this test is no longer testing the real path"
    assert C._is_whole_unit("There are several additional benefits:",
                            complete=True, standalone=True) is False
    assert C._is_whole_unit("There are several additional benefits:",
                            complete=False, standalone=True) is False


def test_colon_lead_in_is_never_offered_as_prose():
    """
    Asserted as "not PROSE" rather than "== FRAGMENT" on purpose. A short colon lead-in is caught
    by `_is_ui` before the whole-unit test ever runs, so it comes back `ui`. Which marked kind it
    lands in does not matter -- what matters is that it is marked, because the prompt forbids
    picking marked entries. Pinning the exact label here would make the test fail on a harmless
    reordering of `classify`.
    """
    for text in ("Here are some notable changes:",
                 "There are several additional benefits for teams that adopt this approach:"):
        assert C.classify(text, complete=False, section_title="",
                          standalone=True) != C.KIND_PROSE


def test_period_less_api_lede_still_survives():
    """
    THE REGRESSION GUARD. Unbanning this sentence is what took the reference family from 18/50
    failures back to usable. The colon fix must not undo it.
    """
    assert C._is_whole_unit("Returns the objects matching the query",
                            complete=False, standalone=True) is True


def test_normal_terminated_sentence_unaffected():
    assert C._is_whole_unit("Dynamic Facets reorders refinements in real time.",
                            complete=True, standalone=False) is True


def test_mid_sentence_cut_is_not_whole_when_not_standalone():
    assert C._is_whole_unit("believe it's imperative to be able to do real-time course correcting",
                            complete=False, standalone=False) is False


# ---------------------------------------------------------------------------
# the abstract-termination rule is family-scoped, and that scoping is load-bearing
# ---------------------------------------------------------------------------

import span_gate as G  # noqa: E402


def test_editorial_abstract_span_must_end_a_sentence():
    errs = G.check_integrity(
        ["believe it's imperative to be able to do real-time course correcting"],
        [], (1, 4), family="editorial")
    assert any("runs into the next" in e for e in errs)


def test_reference_abstract_span_may_lack_a_full_stop():
    """
    THE REGRESSION GUARD FOR THE OTHER DIRECTION. An API page's lede carries no full stop and IS
    the sentence the reference family instruction asks the abstract to lead with. Banning it cost
    that family 18 of 50 pages once already. Editorial gets the rule; reference must not.
    """
    errs = G.check_integrity(["Returns the objects matching the query"], [], (1, 4),
                             family="reference")
    assert not any("runs into the next" in e for e in errs)


def test_colon_span_fails_in_every_family():
    """A colon promises a list. That is true of an API page as much as a blog post."""
    for fam in ("editorial", "reference", "commercial"):
        errs = G.check_integrity(["There are several additional benefits:"], [], (1, 4),
                                 family=fam)
        assert any("colon" in e for e in errs), fam


def test_highlight_without_a_full_stop_is_allowed():
    """350 period-less highlight spans in the blog run were fine: a bullet is not a run-on."""
    errs = G.check_integrity(
        ["A properly terminated abstract sentence."],
        ["Personalization tailors results for each user based on past behavior"],
        (1, 4), family="editorial")
    assert not any("runs into the next" in e for e in errs)
