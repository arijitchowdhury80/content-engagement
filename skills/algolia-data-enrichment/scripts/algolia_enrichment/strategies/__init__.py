"""Enrichment methods. A profile DECLARES one; the sniffer sanity-checks the body against it.

A strategy is deliberately thin: the instruction block the writer prompt substitutes, plus the
handful of shape decisions that differ. Grounding, candidate slicing, repair, gates and write are
identical across all of them -- if a strategy needed its own grounding it would be a second
pipeline, and a second pipeline is how the Blog run acquired eleven verifier scripts.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Strategy:
    name: str
    instruction: str


EDITORIAL = Strategy("editorial", """This is an editorial page: an article written to be read.
  Lead the abstract with the thesis -- the claim or question the piece is actually about.
  Highlights here are: concrete findings, numbers, named techniques and named products.
  NEVER open the abstract with: a hook question, a scene-setting anecdote, or the author's bio.""")

PRESS_RELEASE = Strategy("press_release", """This is a press release: a dated announcement.
  Lead the abstract with what was announced and who announced it. Preserve the subject, the
  people, companies and products named, and the date if a span carries it.
  Highlights here are: the specifics of the announcement -- figures, availability, named
  customers, named capabilities.
  NEVER open the abstract with: the dateline, the "About Algolia" boilerplate, the media
  contact block, or a forward-looking-statements disclaimer.""")

CASE_STUDY = Strategy("case_study", """This is a customer case study.
  Lead the abstract with WHO the customer is and WHAT problem they solved. The abstract should
  carry customer, industry, problem, solution and outcome between its spans.
  Highlights here are: outcome metrics WITH the sentence around them, the technical approach,
  and the named products used.
  NEVER open the abstract with: a marketing restatement of the page description, a bare
  statistic with no sentence around it ("+34%"), a logo-wall or "other customers" rail, or a
  customer pull-quote. A bare figure is grounded and meaningless on its own.""")

DOCS_API = Strategy("docs_api", """This is API or SDK reference documentation.
  Lead the abstract with what the method, endpoint, parameter or client DOES. One span is a
  complete answer here; a terse reference page is short and correct, not thin.
  Highlights here are: an operation, a constraint, a parameter WITH its meaning, a response
  behaviour, a plan limitation. Each must be useful read alone.
  NEVER open the abstract with: transport or protocol boilerplate (HTTPS, response format, API
  version), a bare route line, a bare section heading, or a code fragment presented as prose.""")

DEVELOPER_CODE = Strategy("developer_code", """This is a code sample page.
  Lead the abstract with what the sample demonstrates and in which language or framework.
  Highlights here are: what the code does, the API it calls, and any stated prerequisite or
  limit. An explanatory code comment is allowed here and nowhere else -- often it is the only
  prose on the page -- but an install command or an import line is not a highlight.
  NEVER open the abstract with: an install command, an import line, or a bare filename.""")

NO_ABSTRACT = Strategy("no_abstract", """This page is navigation furniture or is not fetchable.
  The correct outcome is NO enrichment, recorded honestly. Return THIN with a reason.""")

REGISTRY = {s.name: s for s in (EDITORIAL, PRESS_RELEASE, CASE_STUDY, DOCS_API,
                                DEVELOPER_CODE, NO_ABSTRACT)}


def get(name: str) -> Strategy:
    if name not in REGISTRY:
        raise KeyError(f"unknown strategy {name!r}; known: {sorted(REGISTRY)}")
    return REGISTRY[name]
