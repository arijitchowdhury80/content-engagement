# Chat Architecture Characterization Specification

Status: frozen for Stage 1 comparison
Run: `2026-08-20-001`
Normative baselines: `baseline-manifest.json` and `scope-manifest.json`

## Purpose

This specification defines the executable and inspectable evidence required before an architecture verdict. It separates facts that can be proven on the current baselines from obligations that can only be proven after the selected architecture is implemented.

The comparison may identify a preferred design, but it may not claim implementation parity for a target that does not yet exist.

## Authorities and hard gates

The user is the architecture and release authority. Gate G approves the Stage 1 architecture verdict. Gate K separately authorizes any Jahia deployment. Production Ask Algolia remains read-only evidence.

The following are non-compensating hard gates. A high weighted score cannot override a failure:

| Gate | Current-baseline evidence | Stage 2 acceptance evidence |
|---|---|---|
| Behavioral correctness | Characterization of available fixtures, tests, source, and Jahia runtime | Same public behavior or an approved compatibility change |
| Privacy and consent | Static contract review plus consent-path tests that exist today | Executable denied, granted, withdrawn, expiry, reset, and PII-exclusion tests |
| Accessibility | Semantic DOM inspection and available keyboard/browser tests | WCAG 2.2 AA audit, keyboard/focus/screen-reader checks, and reduced-motion verification |
| Algolia and Spectrum parity | Separate frozen visual and behavioral baselines | Approved visual thresholds and zero unapproved functional drift |
| Rollback safety | Restorable source snapshots and recorded runtime hashes | Executable rollback to the immediately prior pinned release |

## Evidence classes

- **Observed:** directly reproduced by a command, test, browser readback, or content hash.
- **Inspected:** supported by readable source or configuration at a frozen hash.
- **Inferred:** reasoned from inspected evidence but not executed.
- **Obligation:** a requirement for the future target, not a claim about a current baseline.
- **Unknown:** evidence is absent, contradictory, private, or unsafe to collect without approval.

Every comparison claim must name one of these classes and carry a confidence value from 0.0 to 1.0.

## Baseline test environments

| Baseline | Primary purpose | Execution rule |
|---|---|---|
| `algolia-com` snapshot | Current Algolia source, project-owned scripts, tests, and deployment inputs | Read snapshot only; run tests from a disposable copy |
| Jahia development observation | Current deployed Algolia behavior, asset identity, and script order | Read-only; do not send a chat turn or mutate consent without separate approval |
| Sajid upstream snapshot | Current upstream runtime, Spectrum fixtures, token/slot model, build and tests | Read snapshot only; run builds/tests from a disposable copy |
| Shared-integration snapshot | Local committed and uncommitted experiments, provenance, and candidate behavior | Read snapshot only; never attribute dirty integration work to Sajid |
| Production Ask Algolia | Behavioral comparison only | Read-only and non-authoritative for source ownership |

## Characterization domains

### Public embedding contract

Inventory custom-element names, attributes, properties, methods, events, globals, bundle names, required load order, error behavior, and compatibility aliases. Record whether each contract is documented, tested, runtime-observed, or merely incidental.

Acceptance measurement: every public or deployed entry point receives an explicit `preserve`, `version`, `shim`, or `retire` disposition.

### Conversation lifecycle

Characterize welcome, sample questions, send, streaming, abort, retry, completion, reset, persistence, error, source rendering, judge/confidence, follow-up, discovery, specialist routing, handoff, and tool rendering.

Acceptance measurement: canned deterministic streams produce equivalent semantic state transitions and public events. Text or visual changes require an approved presentation mapping; state loss, duplicate turns, wrong source identity, or wrong routing is a hard failure.

### Visitor context, privacy, and consent

Inventory collected fields, provenance, purpose, consent authority, retention, TTL, storage key/version, serialization, transport destination, and deletion/reset behavior. Explicitly test or mark unknown:

- consent absent, denied, granted, and withdrawn;
- malformed, oversized, or stale records;
- cross-tab and concurrent-widget behavior;
- raw telemetry and identifier exclusion;
- a single authoritative visitor-context transport default.

Acceptance measurement: only versioned, bounded, purpose-declared fields cross the transport boundary. No raw event stream, secret, credential, or unauthorized identifier may enter a model request.

### Proactive engagement and specialist handoff

Separate signal collection, journey classification, eligibility, frequency/consent policy, greeting selection, presentation, and handoff composition. Characterize suppression reasons, timers, reset, navigation behavior, race handling, and multi-instance targeting.

Acceptance measurement: identical bounded inputs produce deterministic policy results; presentation cannot change eligibility; one widget cannot trigger, reset, or reroute another.

### Persistence and reset

Inventory all browser keys and in-memory registries, schemas, migrations, TTLs, namespaces, and reset surfaces. Browser profile storage itself is not inspected during the read-only Jahia observation.

Acceptance measurement: schemas are versioned, invalid data fails safely, reset scope is explicit, and Algolia and Spectrum namespaces do not collide.

### Presentation and design-system boundaries

Inventory theme tokens, raw CSS, semantic parts, `data-state` values, slots/templates, recipes, assets, copy mappings, geometry, motion, responsive behavior, and private-selector reach-through.

Acceptance measurement: brand and host presentation is possible through public typed contracts. Presentation code cannot perform transport, persistence, telemetry, consent, routing, or conversation mutation. Neutrality enforcement scans TypeScript, JavaScript, CSS, templates, and generated source manifests.

### Accessibility

Characterize names, roles, values, live regions, focus order, focus restoration, Escape behavior, keyboard-only operation, contrast, zoom/reflow, target size, error announcement, streaming announcements, and reduced motion.

Acceptance measurement: WCAG 2.2 AA with no critical/serious automated findings and no blocking manual keyboard, focus, or screen-reader defect. An accessibility correction may update a visual baseline only through an explicit decision record.

### Multi-instance isolation

Run two simultaneously mounted widgets with different credentials, transports, themes, proactive settings, storage namespaces, and lifecycle timing.

Acceptance measurement: no cross-instance credentials, config, timers, state, events, DOM targeting, or teardown effects. Sequential reconfiguration is not sufficient evidence.

### Build, artifact, release, and rollback

Trace source commit to build command, artifact, source map, content hash, release manifest, consumer pin, Jahia reference, and runtime readback. Inventory optional-bundle order, duplicate load behavior, and failure modes.

Acceptance measurement: two clean builds from identical inputs produce identical declared artifact hashes, subject only to explicitly documented nondeterministic metadata. Rollback restores the prior manifest and browser-read hashes.

### Performance

Measure compressed and uncompressed bundle sizes, parse/startup time, initial render, open-panel responsiveness, and streaming update behavior on equivalent fixtures.

Acceptance measurement: no metric worsens by more than 10% from its characterized baseline unless an ADR exception records the reason, user impact, and mitigation. Algolia and Spectrum are measured separately.

## Current Jahia observation

The sanitized observation in `jahia-runtime-observation.json` records identical edit/live block hashes, deployed asset hashes, and script order. A read-only browser check opened and closed the chat without sending a turn. The initial open state exposed:

- an `AI chat` dialog;
- labeled reset, new-conversation, auto-suggestion, minimize, and close controls;
- a labeled answer-preparation progress bar;
- an empty-state composer whose send action is disabled;
- public parts `panel`, `chat-content`, `header`, `composer`, `composer-input`, and `composer-send`;
- no observed `data-state` values in that initial state;
- a proactive `AlgoliaProactiveDecision.v1` suppression with reason `no_trigger_match`.

This is current-baseline evidence only. It does not prove a complete accessibility, privacy, behavioral, or visual pass.

## Visual comparison protocol

Use fixed viewport, device scale, fonts, animation-disabled mode, locale, canned conversation data, and stable assets. Capture launcher, welcome, composing, streaming, source, follow-up, judge/confidence, error, tool, proactive, handoff, docked, modal, minimized, mobile, zoom, high-contrast, and reduced-motion states where supported.

Pixel thresholds must be set per fixture after masking nondeterministic regions. A pixel match cannot override a semantic or accessibility failure. Algolia and Spectrum each retain their own approved baseline; neither is the other's visual oracle.

## Baseline result versus future obligation

Stage 1 publishes three columns for every test:

1. `current_result`: pass, fail, partial, not runnable, or not present;
2. `evidence`: command/result/hash/path and evidence class;
3. `target_obligation`: preserve, remediate, introduce, intentionally change, or retire.

Gate D may adjudicate architecture using current evidence. Gate I alone determines whether the implemented target meets the future obligations.

## Stop conditions

Stop and request authority before any Jahia write, production mutation, Agent Studio/index mutation, push, Spectrum deployment, consent change, or live chat submission. Stop a scoring decision when a hard-gate fact is contradictory or the supporting baseline cannot be reproduced; record it as disputed and gather additional safe evidence.
