# Algolia Token Telemetry Proxy (Jahia module)

Server-side proxy for Agent Studio's conversation-detail endpoint
(`https://{appId}.algolia.net/agent-studio/1/agents/{agentId}/conversations/{conversationId}`),
so the admin/logs-scoped Algolia API key never has to live in browser-loaded JS.
The browser sends `appId` + `agentId` + `conversationId` (no secret); this module
attaches the real key server-side and streams the upstream JSON straight back.

## Why this is a Jahia Action, not a plain servlet

Two earlier versions of this module registered a raw OSGi HTTP endpoint —
first via Blueprint + the legacy `HttpService`, then via the modern OSGi HTTP
Whiteboard (`@Component(service = Servlet.class, property =
"osgi.http.whiteboard.servlet.pattern=...")`). Both deployed cleanly and
showed **Started**, but every request to either endpoint returned Jahia's
generic branded 404 page — identical, byte-for-byte, to requesting a
completely made-up path. A real static asset from another installed module
(`/modules/algolia-base-components/css/error.css`) loaded fine at the same
time. Conclusion: on this tenant, raw OSGi-registered HTTP endpoints simply
aren't routed from the public internet, regardless of registration
mechanism — only Jahia's own first-party dispatch paths are (content pages,
module static resources, Actions, GraphQL).

So this module now registers a **Jahia Action** (`org.jahia.bin.Action`)
instead — the same dispatch mechanism Jahia uses to serve ordinary content
pages, so it's proven reachable. See `TokenTelemetryAction.java`, modeled
directly on Jahia's own minimal official example
(`Jahia/OSGi-modules-samples/action-samples/.../SimpleAction.java`).

## Build

```
mvn clean install
```

Requires network access to the Jahia public Nexus repo
(`https://devtools.jahia.com/nexus/content/groups/public`) to resolve the
`org.jahia.modules:jahia-modules` parent POM.

The parent POM version in `pom.xml` is pinned to `8.2.2.3`. **Confirm this
matches the target server's Jahia DX version** (Jahia admin UI → About) before
building — a mismatch will fail dependency resolution or produce a bundle that
won't install cleanly.

## Deploy

Upload the built jar (`target/algolia-token-telemetry-<version>.jar`) via the
normal Jahia admin UI (log in as usual, not `/tools`): **Administration →
Server → System Components → Modules** → Deploy new module. Alternatively,
if you have filesystem access, drop the jar into the server's
`digital-factory-data/modules` directory directly.

After upload, open the module's detail page and check **Usage in sites** —
each site defaults to **Disabled**. Enable it for `algolia-assets` (see "Why
algolia-assets, not www" below — the action is deployed against that site,
not `www`, for a working anonymous path).

The CSRF-guard exemption this Action needs (see below) is packaged inside the
module (`META-INF/configurations/org.jahia.modules.jahiacsrfguard-algolia-token-telemetry.cfg`)
and applies automatically on deploy — no manual step needed for that part.

## Configure the API key

`TokenTelemetryAction` resolves the key from two places, in order:

1. **Environment variable** `ALGOLIA_TOKEN_TELEMETRY_API_KEY` on the Jahia
   server process.
2. **Baked into the jar at build time**, if (1) isn't set.

(An earlier version also supported OSGi Configuration Admin as a third,
higher-priority option. Dropped for simplicity once it became clear OSGi
config isn't reachable at all on this tenant — see "Why this is a Jahia
Action" above — and to rule out the extra `@Activate(Map<String,Object>)`
wiring as a variable while debugging the 401 issue below.)

### Option 2: bake it in at build time (use this on a locked-down Jahia Cloud tenant)

On a Cloud tenant like `tmp-content-eng-algolia.cloud.jahia.com`, none of the
above admin surfaces are reachable — `/tools` (the Felix console) 404s
because Jahia Cloud doesn't expose it to customers, and filesystem/env-var/
Karaf-shell access isn't self-service either. For that case the module
supports baking the key directly into the built jar, so it needs **zero**
post-deploy configuration:

```
mvn clean install -DbakedApiKey='<the logs-scoped Agent Studio API key>'
```

This substitutes the value into `token-telemetry.properties`, a resource
bundled inside the jar, via Maven resource filtering
(`src/main/filtered-resources/`, wired in `pom.xml`). **The key never touches
a tracked file** — `-DbakedApiKey=...` is a command-line argument, not
written to `pom.xml`/`token-telemetry.properties` in git, and the resulting
jar (in `target/`, gitignored) is what you upload, not committed. Build
without the flag (plain `mvn clean install`) and the module ships
unconfigured (`503` from the endpoint) — safe to do by mistake, nothing leaks.

This is a real security tradeoff worth naming: unlike the OSGi-config path, the
key now lives inside the deployed jar, extractable by anyone who can get a
copy of that jar (`unzip -p *.jar token-telemetry.properties`) — e.g. another
admin on the same Jahia instance, or the Jahia Cloud team. That's a much
smaller exposure than the original problem (the key sitting in browser-loaded
JS, readable by any site visitor via dev tools), but it's not equivalent to
proper secret storage. If Jahia support can ever grant env-var access on the
server process, prefer option 1 instead.

## Why `algolia-assets`, not `www`

Anonymous (no logged-in Jahia session) `POST` to this action under the `www`
site was blocked with a `401` login-page redirect, despite
`setRequireAuthenticatedUser(false)` — even with every other lever tried
(`setRequiredMethods`, `setRequiredWorkspace`, CSRF whitelisting, both
workspaces, multiple node paths, clean reinstalls). We even deployed Jahia's
own **unmodified official sample action** (`SimpleAction.java` from
`Jahia/OSGi-modules-samples`) with zero custom code, and it hit the exact
same `401` on `www` — conclusive proof this was never a bug in our code.

The actual fix: the block is a **per-site** setting, not a platform-wide one.
The identical action, identical request, against a page under the
`algolia-assets` site instead of `www`, works — no login redirect. Whatever
guest/anonymous restriction is configured on `www`, `algolia-assets` doesn't
have it. We haven't identified the exact setting (it isn't in the global
Administration → Server → Users and Roles → Roles and permissions list —
that's role *definitions*, not per-site principal assignments), so this
module is deployed against `algolia-assets` as a working path rather than
waiting on that to be found. The action doesn't need to live on the same
site as the page calling it — this is invoked cross-site, with CORS handled
server-side (`Access-Control-Allow-Origin`).

The **short-form URL** matters too: `/sites/{site}/{page}.{action}.do`
routes past the gate; the longer `/cms/render/{mode}/{lang}/sites/{site}/{page}.{action}.do`
form does not, even for the same site/page. Always use the short form.

If `www`'s guest-access setting ever gets fixed (worth asking whoever
administers this tenant, since it likely affects other anonymous-facing
features too, not just this module), switching back to a `www` page is a
one-line change in both `doExecute`'s target and `token-telemetry.js`'s
`TELEMETRY_ACTION_URL` — nothing else depends on which site is used.

## Endpoint

```
POST /sites/algolia-assets/home.algoliaTokenTelemetry.do
Content-Type: application/x-www-form-urlencoded
Accept: application/json

appId=...&agentId=...&conversationId=...
```

**`Accept: application/json` is required**, not optional — Jahia's
`ActionResult` content-negotiates on it. Without it, even a genuine `200`
comes back with a completely empty body (`content-length: 0`); with it, the
real JSON renders. Easy to miss since curl/Postman-style manual tests will
"work" (200, no error) while silently returning nothing.

Verify:

```
curl -i -X POST 'https://tmp-content-eng-algolia.cloud.jahia.com/sites/algolia-assets/home.algoliaTokenTelemetry.do' \
  -H 'Accept: application/json' \
  --data 'appId=x&agentId=x&conversationId=x'
```

A working route returns our own `400` JSON
(`{"error":"appId, agentId and conversationId are required..."}`) for these
deliberately-invalid test values — if you instead get Jahia's branded HTML
404, the node path is wrong; if you get the login-page `401`, you're
probably testing against `www` again, or the short-form-vs-render-path
distinction above.

Returns the same JSON body Algolia's conversation-detail endpoint returns
(`totalInputTokens`, `totalOutputTokens`, `totalTokens`, ...), with the same
HTTP status code Algolia returned. `appId` must be alphanumeric; `agentId` is
alphanumeric-or-hyphen (Agent Studio agent ids are UUIDs); `conversationId`
is alphanumeric/hyphen/underscore (real ids look like
`alg_cnv_miss_F7qB9wSPhG3z6KRH`, not UUIDs). Anything else is rejected with
`400` before it reaches the outbound request (these values are interpolated
into the upstream URL, so this is what prevents SSRF/host injection via a
crafted `appId`). `503` means no `apiKey` is configured yet.

`frontend/chat-widget/token-telemetry.js` calls this same URL (relative, or
via `window.__ALGOLIA_TOKEN_TELEMETRY_BASE__` for cross-origin local dev) —
if you change the node path here, update `TELEMETRY_ACTION_URL` there too.
