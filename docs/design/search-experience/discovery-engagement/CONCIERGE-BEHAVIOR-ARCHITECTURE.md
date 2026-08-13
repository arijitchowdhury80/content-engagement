# Algolia.com Concierge Behavior Architecture

**Status:** Accepted architecture direction; event taxonomy and thresholds pending GA4/Looker evidence.
**Date:** 2026-08-12
**Scope:** algolia.com only; app `0EXRPAXB56`; index `Algolia_Prod_Copy_Enhanced`.

## Mission

Turn algolia.com from reactive Q&A into a proactive, white-glove discovery concierge. It must learn from the visitor's behavior, answer accurately, engage only at valuable moments, advance a relevant conversation, and make an appropriate next step such as a POC, app creation, meeting, or specialist handoff easier.

## Decision

The concierge is a layered browser-and-agent system. Agent Studio `turnContext` is **only the current-turn transport** for a compact context summary. It does not capture browser behaviour and it does not decide when to interrupt the visitor.

```text
Browser signal collector
  -> consent-aware session intelligence store
  -> deterministic context compiler
  -> proactive decision engine -> widget engagement
  -> native turnContext -> www Chat - Orchestrator
  -> discovery ledger -> specialist handoff
```

## Ownership Boundaries

| Layer | Owner | Responsibility |
|---|---|---|
| Browser signal collector | Jahia-delivered tracker JavaScript | Capture current page, referrer/campaign, navigation, dwell, scroll/section exposure, CTA/form/search actions, and approved profile signals. |
| Session intelligence store | Browser runtime | Retain ordered, consent-aware session events and shared state for both reactive and proactive experiences. Raw telemetry stays here. |
| Context compiler | Browser/runtime code | Produce a versioned safe packet: observed facts, confidence-labelled hypotheses, unknowns, stage, suppression state, and eligible action. |
| Proactive decision engine | Browser/runtime code | Evaluate every meaningful event and decide `engage`, `wait`, or `suppress` using deterministic policy, timing, caps, consent, active-form/chat, dismissal, and frustration rules. |
| Concierge delivery | Widget JavaScript + optional concierge agent | Open the widget through `chat.engage(...)` only after code declares the moment eligible. An agent may draft wording; it does not unilaterally interrupt. |
| Reactive chat transport | Native Agent Studio `turnContext` | Attach the latest safe context to every visitor question, leaving the question itself intact. |
| Discovery and handoff | Conversation ledger + `www Chat - *` specialists | Record confirmed visitor facts, cautious inferences, unanswered slots, suppression, and evidence. Send a concise context packet to specialists. |

## Identity And Consent Rule

A referrer or campaign URL can identify a campaign, not a person. The concierge may use a personal name or account context only when an approved identity/profile source provides it under the active consent policy. It must never infer identity, company, or buying authority from browsing behavior alone.

## Product Behavior

The same session context drives two experiences:

1. **Reactive:** on every chat question, the answer is tailored to the current page, journey, stated facts, and safe behavioral signals. The answer still comes first.
2. **Proactive:** on meaningful navigation or engagement changes, runtime rules determine whether a timely, helpful interruption is justified. For example, a visitor moving from InstantSearch documentation to pricing after deep reading may receive a POC-oriented offer, not a generic chat popup.

## Role Of `www Person - *`

Person agents do not capture browser data. Browser code captures it first. Person agents may later add bounded interpretation to a validated packet when testing shows that interpretation materially improves a high-value decision. They are not the required per-event or per-turn source of truth.

## Data-First Constraint

The event taxonomy, journey-stage definitions, trigger thresholds, strategic moments, and conversion nudges must be derived from the last 90 days of GA4/Looker evidence. Do not encode imagined hotspots or generic page thresholds before that analysis identifies actual landing patterns, journeys, abandonment points, and conversion paths.

## Required Research Outputs

The GA4/Looker research stream must deliver:

1. Landing, source/campaign, page, section, and event distribution.
2. Common paths, repeat navigation patterns, dwell/engagement, exits, and abandonment points.
3. Conversion journeys for meeting, contact-sales, app-creation, and other approved outcomes.
4. A proposed event taxonomy and data-contract gaps, explicitly grounded in measured behavior.
5. Candidate proactive moments and suppression rules, ranked by evidence and risk.
6. A measurement plan proving whether concierge engagement increases qualified conversion without harming visitor experience.

## Explicit Non-Goals

- Do not treat Agent Studio as an autonomous browser observer.
- Do not expose raw telemetry, identifiers, URLs with query parameters, or consent-restricted data to an agent.
- Do not greet or interrupt every visitor.
- Do not build prompt-only personalization.
- Do not modify Spectrum, production Ask Algolia, any non-`www` agent, or any retrieval index other than `Algolia_Prod_Copy_Enhanced`.
