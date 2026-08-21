# Technical And Business Journey Foundations

## Scope

This change establishes two deterministic proactive journeys and a safe UAT reset.

## Interaction Contract

- Clicking the Algolia Assistant header logo resets only Content Engagement visitor state, spins once as acknowledgement, and starts a fresh tracked session.
- Product pages qualify after 15 seconds of dwell and 50% scroll depth.
- Product to Documentation qualifies after the destination documentation page reaches 10 seconds and 50% scroll depth.
- Solution pages qualify after 15 seconds of dwell and 50% scroll depth.
- Solution to Customer Proof qualifies after the destination story reaches 10 seconds and 50% scroll depth.
- A greeting that was merely shown and then closed does not consume the later cross-page transition.
- A visitor who engages and hands off to the orchestrator is not interrupted by another proactive greeting.

## Data Flow

The tracker owns collection and storage. The compiler creates the context packet. The controller evaluates the deterministic thresholds and calls the Greetings Agent. The chat widget renders the greeting. The handoff tool carries an engaged response to the orchestrator.

## Safety

The reset removes only project-owned `algolia_*` profile, session, event, proactive, pending-greeting, debug, and token keys. It must preserve unrelated Jahia and website storage.

## Verification

- Unit tests cover threshold boundaries, transition context, second-stage opportunities, scoped reset, and logo animation.
- The local parity site is the integration target. Jahia remains unchanged until local headed-browser verification passes.

## Rollback

Revert the tracker reset listener, controller trigger rules, and local parity opt-in attribute together. Existing storage schemas are unchanged.
