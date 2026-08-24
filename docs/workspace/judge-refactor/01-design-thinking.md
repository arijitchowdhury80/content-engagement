# Judge Refactor Design Thinking

## Mental Model

This is an evidence review, not a dashboard. Users expect a trustworthy verdict, clear reasons, and traceable disputed text. They must never confuse provisional or unavailable evaluation with a low score.

## Information Architecture

- Hero: verdict status and composite score.
- Primary: four dimension means, judge participation, grounding findings.
- Secondary: per-judge scores, deterministic explanation, disagreement.
- Supporting: evidence/prompt versions, hashes, timing, debug metadata.

## Interaction Flow

The answer remains immediately usable. Judging progresses asynchronously. Opening the badge reveals the summary, dimensions, panel, and findings. Loading, provisional, unavailable, and complete states have distinct text and icons.

## Cognitive Load

The closed badge shows one status. The drawer uses four sections: result, dimensions, panel, findings. Judge detail remains collapsed until requested.

## Emotional Journey

Answer first, then calm verification, then precise review if needed. The judge must create confidence through traceability, not alarm through indiscriminate red highlighting.

## Pre-Mortem

- False red headings: only code-validated factual claim spans can highlight.
- Score without three judges: label provisional and show participation.
- Long text overflow: stable responsive tracks and wrapping.
- Color-only meaning: pair color with icon and status text.
- Judge failure damaging chat: keep verdict state outside answer state.

## Aesthetic

Retain the existing restrained Algolia product UI. This is an incremental confidence component, not a new page or visual system.
