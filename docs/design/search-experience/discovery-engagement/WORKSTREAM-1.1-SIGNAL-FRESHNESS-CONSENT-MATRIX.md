# Workstream 1.1.1 Signal, Freshness & Consent Matrix

**Status:** Initial source and live Jahia probe complete; consent-source proof still required
**Last updated:** 2026-08-13
**Scope:** `frontend/chat-widget/algolia-chat-tracker.js`, `frontend/chat-widget/algolia-chat-engage.js`, accepted 2026-08-12 architecture.

## Summary

The recovered widget artifacts support a browser-led visitor intelligence path. They capture useful first-party session signals into local storage and expose a visitor data source to the chat widget. The first live Jahia probe confirms the development page is currently loading the standalone `algolia-chat-tracker.js`, not the richer combined WIP tracker inside `algolia-chat-jahia-20260812-wip.js`.

Evidence artifact:

- `docs/evidence/visitor-intelligence/2026-08-13-1.1.1-live-signal-probe.json`
- `docs/evidence/visitor-intelligence/2026-08-13-1.1.1-consent-write-gate-probe.json`

The live page has useful baseline tracking, but it is not production-acceptable for 1.1 yet: no consent group is configured, `trackSearch` is absent, generic navigation clicks are not tracked, event props are not sanitized, and the proactive controller still sends raw-ish event context to its concierge agent.

## Signal Matrix

| Signal | Source evidence | Storage / transport | Freshness | Consent status | Current risk | 1.1 use |
|---|---|---|---|---|---|---|
| User token | Live Jahia probe confirms tracker reads configured `_ALGOLIA` cookie or falls back to session ephemeral token. | `acs_profile.userToken`, `tokenSource`; exposed through `setVisitorDataSource().getProfile()`. | Initialised on tracker load; override updates immediately. | No live consent config. Writes defaulted to allowed. | `_ALGOLIA` identifies a browser token, not a person, company, role, or buying authority. | Safe as anonymous/session continuity only. |
| Visit count / first seen | Live Jahia probe confirms `visits` and `firstSeen`. | `acs_profile.visits`, `firstSeen`. | Updated on tracker load. | No live consent config. | Visit count can overstate intent if sessions are reset or cookie state changes. | Useful for returning-vs-new context, not identity. |
| Session id | Live Jahia probe confirms generated `acs_session.sessionId`. | `acs_session.sessionId`. | New session after missing/expired state; timeout appears to be 30 minutes. | No live consent config. | Must not be sent raw to Agent Studio or displayed. | Runtime-only isolation and debugging. |
| Current page | Live Jahia probe confirms current page path and title in session and `page_view`. | `acs_session.pages[]`; engage context `currentPage`. | Current on page view / route change; dwell updated on hide/unload. | No live consent config. | Query strings are not recorded, which is good; CMS render path needs normalization before agent transport. | Safe projection to turnContext as page category/title after filtering. |
| Page journey | Live source supports route/page tracking; single-page live probe only confirmed one page. | `acs_session.pages[]`; engage context `pagesViewed`. | Updated on initial load and `history.pushState` / `popstate`. | No live consent config. | Need multi-page live journey proof; current standalone tracker replaces duplicate path rather than preserving every repeat. | Core personalization signal for journey stage and context. |
| Dwell time | Live source supports dwell on hide/unload; probe did not wait for final dwell. | `acs_session.pages[].dwellMs`. | Updated when visitor leaves/hides page; not continuously live. | No live consent config. | Freshness is lagging until hide/unload; active-page dwell needs a live delta compiler if used mid-page. | Useful as observed behavior with freshness label. |
| Scroll / read depth | Live Jahia probe triggered `page_read` via scroll. | `acs_events[]`; no persistent max-depth field in live standalone tracker. | Event-time timestamped. | No live consent config. | Live standalone tracker lacks the richer `scroll_depth`, `maxScrollDepth`, and `readDepth` fields found in WIP bundle. | Useful only as coarse read/deep-engagement inference. |
| Page read | Live Jahia probe confirms `page_read` with `trigger: scroll`. | `acs_events[]` with trigger and page path. | Event-time timestamped. | No live consent config. | One per page-load variable in bundle; route changes need browser proof to ensure reset behavior. | High-value observed engagement signal. |
| CTA click | Live Jahia probe confirms synthetic `[data-cta]` click becomes `cta_click`. | `acs_events[]` with `cta` and text label. | Event-time timestamped. | No live consent config. | Only works where host markup has `data-cta`; generic links are not captured by the live standalone tracker. | Important for commercial-action context where markup supports it. |
| Custom semantic event | Live Jahia probe confirms `window.algoliaTracker.trackEvent()`. | `acs_events[]` with event name/properties. | Event-time timestamped. | No live consent config. | Live standalone tracker stored synthetic `email`, `phone`, and `password` props; richer sanitizer is not deployed. | Must sanitize before this is safe for broad host events. |
| Custom search event | Live Jahia probe confirms `trackSearch` is absent and dispatched `algolia:search` did not create a search event. | Not available on current live page. | Not available. | Not available. | Rich WIP bundle includes `trackSearch` and `algolia:search`, but live page does not load it. | Cannot claim search-query signal yet. |
| Profile interests / affinities | Engage reads `acs_profile.topAffinities`; tracker does not compute it in recovered bundle. | Engage context `affinities`, `affinitySource`. | Depends on an external profile/data source not present in tracker. | Depends on source. | No automatic company/role/account/interest enrichment exists. | Treat as unavailable unless approved host/backend source supplies it. |
| Consent grant/revocation | Live page has OneTrust globals, but `ALGOLIA_VISITOR_CONFIG` contains no `consentGroup`; live tracker methods include `setConsentAdapter`. Write-gate probe confirms a registered adapter can block new writes, allow writes after grant, and block later writes after revocation. | Adapter controls writes when registered. | Immediate on adapter callback. | Code gate works after adapter registration; active site policy is not configured at boot. | Normal page load writes immediately because no `consentGroup` is supplied. Published Jahia consent source must be configured before acceptance. | Blocker for production acceptance. |
| Proactive eligibility | Live Jahia probe confirms engage installed and called concierge after synthetic events met `minEvents`. | `algolia-chat-engage.js`; optional cached pending greeting. | Evaluated after widget readiness and delay. | Reads stored context with no explicit consent config. | Current gate is quantity-based and sends raw-ish event context, not deterministic commercial reason-code/suppression model. | Baseline only; 1.2 must replace with evidence-led trigger policy. |

## Live Probe Findings

| Check | Result |
|---|---|
| Live tracker installed | Yes |
| Live tracker methods | `configure`, `identify`, `refreshProfile`, `reset`, `setConsentAdapter`, `snapshot`, `trackEvent` |
| Live `trackSearch` | No |
| Live visitor config | `{ "cookieName": "_ALGOLIA", "region": "us" }` |
| Live consent group | Missing |
| OneTrust globals | Present: `C0001,C0002,C0003,C0004` active |
| Initial storage after load | `acs_profile`, `acs_session`, `acs_events` written immediately |
| Consent write gate | Adapter blocks new writes when denied, allows after grant, blocks after revocation |
| Confirmed events | `page_view`, `probe_custom_event`, `cta_click`, `page_read` |
| Sensitive prop sanitizer | Not present in live standalone tracker; synthetic sensitive fields were stored |
| Proactive controller | Installed and called concierge after synthetic event threshold |

## Freshness Rules To Carry Into 1.1.2

- Every signal needs `observed_at` or an equivalent timestamp.
- Current page should be considered fresh only when read from `location` at compile time or from the latest page-view event.
- Dwell should be marked partial while the visitor remains on the page, then final after hide/unload.
- Journey should preserve order and repeated visits, but raw paths should be mapped to safe categories before Agent Studio transport.
- Any profile/interest/company/role/account field is unavailable unless supplied by an approved source with provenance and consent.
- Unknown values must be omitted or labelled unknown; never inferred into confirmed facts.

## Consent Rules To Validate In Browser

1. With no consent adapter, verify whether the development page writes immediately. This is expected from recovered tracker code, but must be proven.
2. Register the actual site consent source only through the approved Jahia development Drift block before production acceptance. Based on live OneTrust globals, `C0002` is the likely analytics group to test, but it must be confirmed against Algolia's consent policy before use.
3. Prove denied consent prevents profile/event/session writes.
4. Prove grant starts or resumes writes.
5. Prove revocation stops future writes and clears or suppresses existing local state according to the approved policy.
6. Prove no consent-restricted fields appear in `metadata.turnContext`, visible answers, source UI, logs, or specialist handoff.

## Open Questions

- Where is the clean source tree for the chat widget runtime? Current files are recovered bundles, so deeper implementation should first restore readable modules and tests.
- Was `trackSearch()` present in a previous source artifact but lost during cleanup, or was the earlier audit over-broad?
- Which algolia.com consent provider/group is approved for this experiment, and what exact browser API should the tracker adapter read?
- Which host/backend source, if any, is approved to supply company, role, account tier, declared interests, or CRM identity?
- Should Person-agent V1 prompts be repaired now, or deferred until deterministic native turnContext has a baseline journey evaluation?
