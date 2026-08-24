# Algolia Engagement Tracker

**Status:** implemented, deployed to Jahia dev, and browser validated
**Date:** 2026-08-14
**Workstream:** 1.1 Personalization & Visitor Intelligence
**Asana:** `1.1.1 Build Algolia engagement tracker` (`1217479377616015`)
**Runtime file:** `frontend/chat-widget/algolia-engagement-tracker.js`

## Purpose

The Algolia engagement tracker is client-side JavaScript loaded across the
development algolia.com demo surface.

It observes browser behavior, stores consent-safe facts for the active visitor
session, and exposes a snapshot for the context compiler. It does not call an
LLM, decide what to say, infer commercial intent, or send raw clickstream data
to Agent Studio.

## Replacement Decision

Replace `frontend/chat-widget/algolia-chat-tracker.js` with
`frontend/chat-widget/algolia-engagement-tracker.js`.

The current tracker must be read before implementation and used as the coding
baseline. Preserve its good implementation patterns:

- IIFE wrapper for direct browser loading;
- `algoliaChatDebug=1` debug gating;
- resilient JSON storage helpers;
- consent adapter support;
- bounded event buffers;
- SPA navigation hooks for `pushState` and `popstate`;
- queued pre-load API calls;
- registration with the chat widget's visitor data source.

After migration, references to `algolia-chat-tracker.js` and
`window.algoliaTracker` should be removed or bridged deliberately. Do not leave
two competing trackers active on the page.

## Boundary

The tracker records observed facts only.

Allowed examples:

- visitor viewed `/pricing`;
- visitor clicked a navigation link labeled `Pricing`;
- visitor reached a 10-second dwell milestone on the current page;
- visitor selected the demo persona `Developer`;
- the concierge showed or dismissed a proactive hook.

Not allowed in the tracker:

- visitor is ready to buy;
- visitor is confused;
- visitor wants a demo;
- visitor is a developer because they visited docs.

Those are compiler or engagement-policy inferences, not tracker facts.

## Storage Decision

Use three browser storage records in v1.

| Key | Browser API | Scope | Purpose |
|---|---|---|---|
| `algolia_profile` | `localStorage` | survives page loads and browser restarts | Low-volume visitor/demo profile such as selected persona, anonymous visitor id, first seen, last seen, and visit count. |
| `algolia_session` | `sessionStorage` | current tab/session | Current journey summary: pages, dwell, scroll, current page, and concierge intervention history. |
| `algolia_events` | `sessionStorage` | current tab/session | Rolling raw event buffer for observed facts during the current journey. |

Do not add `algolia_engagement_caps` in v1. Cross-session frequency capping can
be added later if production annoyance control needs it. For the demo,
session-scoped suppression is enough.

## Event Versus Engagement

An event is any timestamped observed fact.

Examples:

- `page_view`;
- `nav_click`;
- `cta_click`;
- `page_dwell`;
- `scroll_depth`;
- `site_search`;
- `chat_open`;
- `engagement_exposed`.

A click is an event. A page view is an event. A scroll milestone is an event.

An engagement is narrower: it is an interaction involving the concierge itself.

Examples:

- the concierge shows a proactive hook;
- the visitor dismisses the hook;
- the visitor clicks the hook;
- the visitor opens chat;
- the visitor asks a chat question.

Concierge engagements are also recorded as raw events, but the session keeps a
small `engagementHistory` summary so the runtime knows what it has already shown
and does not repeat the same intervention.

## Stored Shapes

### `localStorage.algolia_profile`

```json
{
  "schema": "AlgoliaEngagementProfile.v1",
  "visitorId": "anon_abc123",
  "firstSeenAt": 1786750000000,
  "lastSeenAt": 1786750200000,
  "visitCount": 3,
  "persona": {
    "value": "developer",
    "label": "Developer",
    "state": "confirmed",
    "source": "demo_selector",
    "updatedAt": 1786750030000
  }
}
```

### `sessionStorage.algolia_session`

```json
{
  "schema": "AlgoliaEngagementSession.v1",
  "sessionId": "sess_456",
  "startedAt": 1786750000000,
  "lastSeenAt": 1786750200000,
  "currentPageId": "page_789",
  "pages": [
    {
      "pageId": "page_789",
      "url": "https://www.algolia.com/pricing",
      "path": "/pricing",
      "title": "Pricing",
      "referrer": "/products/ai-search",
      "enteredAt": 1786750000000,
      "dwellMs": 3000,
      "maxScrollDepth": 30,
      "pageGroup": "pricing",
      "topic": "pricing"
    }
  ],
  "engagementHistory": [
    {
      "id": "eng_123",
      "pageId": "page_789",
      "messageGoal": "pricing_cost_help",
      "shownAt": 1786750010000,
      "status": "shown_no_action"
    }
  ]
}
```

`engagementHistory` is not browsing history. It is the concierge runtime's
memory of its own interventions in the current session. It exists to prevent
repeated hooks and preserve continuity.

### `sessionStorage.algolia_events`

```json
{
  "schema": "AlgoliaEngagementEvents.v1",
  "sessionId": "sess_456",
  "events": [
    {
      "eventId": "evt_001",
      "name": "page_view",
      "ts": 1786750000000,
      "pageId": "page_789",
      "path": "/pricing",
      "source": "observed",
      "props": {
        "pageGroup": "pricing",
        "topic": "pricing"
      }
    }
  ]
}
```

## V1 Capture Criteria

| Event | Captured facts |
|---|---|
| `page_view` | URL, path, title, referrer, page id, page group, topic, safe UTM/source fields. |
| `page_dwell` | 3-second and 10-second milestones, once per page. |
| `scroll_depth` | 30%, 50%, 75%, and 100%, once per page. |
| `nav_click` | label, href, detected top-level/submenu context, page group, topic. |
| `cta_click` | label, href, CTA type such as demo, pricing, signup, contact, docs, or unknown. |
| `site_search` | sanitized and truncated query, source input, current page. |
| `search_result_click` | query id if available, query if safe, result title, result URL, result position, source type. |
| `persona_select` | selected persona, label, source `demo_selector`. |
| `chat_open` | open source: visitor, launcher, proactive hook, or unknown. |
| `chat_question` | event occurred; do not store full question text in the tracker by default. |
| `engagement_exposed` | hook id, page id, message goal, current persona state, current topic, shown time. |
| `engagement_dismissed` | hook id, page id, dismissal time. |
| `engagement_clicked` | hook id, page id, click time. |
| `form_view` | form type and page id. |
| `form_start` | form type and page id. |
| `form_error` | field category or error category only; never field values. |
| `form_submit` | form type and page id. |
| `form_success` | form type and page id. |
| `consent_change` | allowed or denied state for tracker operation. |

## Privacy Rules

The tracker must not store:

- email, phone, name, company, or free-form form values;
- passwords, credentials, API keys, tokens, or secrets;
- raw DOM snapshots;
- hidden prompts, tool schemas, or Agent Studio configuration;
- authenticated account-page behavior unless explicitly approved;
- consent-restricted values.

Query strings should be sanitized. Search queries should be truncated. Event
buffers should be bounded.

## Public API

The v1 tracker should expose:

```js
window.algoliaEngagementTracker.snapshot()
window.algoliaEngagementTracker.setPersona(personaId)
window.algoliaEngagementTracker.track(eventName, props)
window.algoliaEngagementTracker.reset()
```

The compiler will consume `snapshot()` later and create a flat, 4KB-safe
Agent Studio `metadata.turnContext` payload. That compiler is a separate
component and is out of scope for this tracker document.

## Implementation Notes

The v1 implementation preserves the old tracker's direct-browser loading pattern
while replacing its storage and capture contract.

- `algolia_profile` is written to `localStorage`.
- `algolia_session` and `algolia_events` are written to `sessionStorage`.
- `window.algoliaEngagementTracker` is the canonical API.
- `window.algoliaTracker` remains as a deliberate compatibility bridge.
- The old `frontend/chat-widget/algolia-chat-tracker.js` file has been removed.
- `frontend/chat-widget/algolia-chat-engage.js` and the chat bundle fallback read
  session/events from `sessionStorage`.
- Raw event storage is capped at 100 events.
- URL query strings are stripped except safe UTM fields.
- Form instrumentation records milestones and field/error categories only, never
  submitted values.

## Validation Evidence

Automated unit and browser validation now cover the tracker.

Unit test:

```bash
node --test frontend/chat-widget/tests/algolia-engagement-tracker.test.mjs
```

Browser validation:

```bash
python3 frontend/chat-widget/tests/validate-engagement-tracker-browser.py
```

The browser validation runs a local HTTP fixture in headless Chromium, navigates
from a referrer page, clicks top navigation and submenu links, searches, clicks a
search result, clicks a CTA, submits an invalid then valid form, emits chat and
engagement events, scrolls through 30%, 50%, 75%, and 100%, waits for 3-second and
10-second dwell milestones, and reads back `localStorage` and `sessionStorage`.

Evidence artifact:

`docs/evidence/visitor-intelligence/2026-08-14-engagement-tracker-browser-validation.json`

Jahia deployment evidence:

- `docs/evidence/visitor-intelligence/jahia-deploy-20260814/before-snapshot.json`
- `docs/evidence/visitor-intelligence/jahia-deploy-20260814/deployment-plan.json`
- `docs/evidence/visitor-intelligence/jahia-deploy-20260814/mutation-results.json`
- `docs/evidence/visitor-intelligence/jahia-deploy-20260814/after-readback-final.json`
- `docs/evidence/visitor-intelligence/jahia-deploy-20260814/deployment-validation-final.json`
- `docs/evidence/visitor-intelligence/jahia-deploy-20260814/live-browser-validation.json`

## Remaining Integration Work

These are not tracker build blockers; they belong to the next runtime layers:

1. Add the compiler that turns `snapshot()` into Agent Studio `turnContext`.
2. Add the proactive engagement policy that decides if and when to show hooks.
3. Add cross-origin/session service support only if the demo requires journeys
   across `www`, `support`, and `academy`.

## Jahia Integration

The Jahia development Drift block now loads the new tracker in place of the old
chat tracker:

```html
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-engagement-tracker.js?tracker=20260814"></script>
```

Keep the tracker before `algolia-chat-engage.js` so the proactive engagement
script can read the visitor snapshot immediately. Do not load
`algolia-chat-tracker.js` and `algolia-engagement-tracker.js` together.

Live readback after deployment:

- the Drift block release marker is `engagement-tracker-20260814`;
- `algolia-engagement-tracker.js` is referenced once;
- `algolia-chat-tracker.js` is not referenced;
- `/sites/www/files/algolia-chat-tracker.js` is absent from both EDIT and LIVE;
- the live browser validation writes only `algolia_*` storage keys.

## Acceptance Criteria

- `algolia_profile` persists persona and low-volume profile facts in
  `localStorage`.
- `algolia_session` and `algolia_events` are session-scoped in `sessionStorage`.
- Page views, dwell, scroll, nav clicks, CTA clicks, persona selection, chat
  actions, engagement actions, and form milestones are captured as observed
  facts.
- `engagementHistory` records only concierge interventions, not browsing history.
- Raw event buffer is bounded and contains no disallowed PII or secrets.
- Tracker exposes `snapshot`, `setPersona`, `track`, and `reset`.
- Tracker does not call Agent Studio and does not create `turnContext`; that is
  the compiler's job.
