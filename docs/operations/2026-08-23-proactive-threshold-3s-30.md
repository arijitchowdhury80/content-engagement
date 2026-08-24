# Proactive Threshold Migration: 3 Seconds And 30% Scroll

## Active Contract

Every supported proactive singleton and transition journey uses the same qualification boundary:

- visible dwell: at least 3,000 milliseconds
- maximum scroll depth: at least 30%

The canonical singleton trigger identifiers are:

- `product_page_3s_30_scroll`
- `solution_page_3s_30_scroll`
- `developer_page_3s_30_scroll`
- `resource_page_3s_30_scroll`

Transition trigger names do not encode thresholds, but their source and destination qualification uses the same 3-second/30% contract where the journey grammar requires qualification.

## Alignment Scope

The contract is aligned across the engagement tracker, context compiler, proactive controller, local parity fixture, Agent prompts, inspection tools, focused tests, team UAT material, customer documentation, and current design documentation.

With proactive debugging enabled, the controller's `configured` trace entry reports the effective dwell and scroll values for product, solution, documentation, proof, implementation, and resource journey families.

## Historical Records

Dated evidence, archived artifacts, and incident reports that describe an earlier 5-second/25% or 10-second/50% release remain unchanged as historical truth. Current operational and design documents must point to this contract instead.

The tracker continues to record later analytics milestones at 10 and 15 seconds and 50%, 75%, and 100% scroll. Those values are telemetry, not proactive eligibility. Similarly, tests may use 10-second/50% page fixtures to represent visitors who are safely above the boundary; exact boundary tests remain authoritative for qualification behavior.

The release-wide local-versus-published audit is recorded in `2026-08-23-3s-30-threshold-audit.md`.

## Deployment Gate

Validate locally first. Agent Studio prompt and Jahia runtime mutations require snapshot, dry-run, explicit approval, apply, readback, and saved evidence.
