# Algolia Token Telemetry Proxy

This Jahia module exposes a narrow server-side endpoint for the chat widget's
token counter. The browser sends only the completed Agent Studio
`conversationId`. The module supplies the fixed application and agent IDs,
authenticates to Algolia with a server-side key, and returns only aggregate
input, output, and total token counts.

It never returns the upstream conversation payload and never accepts an
application ID, agent ID, endpoint, or API key from the browser.

## Endpoint

```text
POST /sites/algolia-assets/home.algoliaTokenTelemetry.do
Origin: https://tmp-content-eng-algolia.cloud.jahia.com
Accept: application/json
Content-Type: application/x-www-form-urlencoded

conversationId=alg_cnv_...
```

Successful response:

```json
{
  "inputTokens": 123,
  "outputTokens": 45,
  "totalTokens": 168
}
```

Requests with another origin, an invalid conversation ID, an unsupported
method, an unconfigured key, or an invalid upstream response fail without
exposing credentials or upstream conversation content.

The action applies a bounded per-client limit (30 requests/minute) and a
global ceiling (300 requests/minute). Client state is capped at 10,000 entries
to prevent the limiter itself becoming an unbounded memory sink.

## Configuration

The tracked configuration file contains only non-secret defaults:

- `app.id=0EXRPAXB56`
- `agent.id=e2c8596a-4420-41d2-80bb-5cd4aaeffda6`
- `allowed.origin=https://tmp-content-eng-algolia.cloud.jahia.com`
- `api.key=`

Set the API key at runtime using OSGi Configuration Admin for PID
`com.algolia.contentengagement.tokentelemetry.TokenTelemetryAction`, or the
server environment variable `ALGOLIA_TOKEN_TELEMETRY_API_KEY`. Do not put a
real key in a tracked file, Maven argument, built JAR, browser script, or
deployment evidence.

## Build and test

The module uses Jahia's Maven parent pinned in `pom.xml`.

```sh
mvn test
mvn clean package
```

Before deployment, confirm that the parent version matches the target Jahia
server. The build requires access to Jahia's public Maven repository.

## Deployment

The module must be installed and enabled for the `algolia-assets` site. The
browser integration is `frontend/chat-widget/token-telemetry.js`; its action
URL must continue to match this module's Jahia action path.

Install or upgrade the JAR before deploying the browser integration. Jahia's
supported production paths are its Provisioning API or module-management REST
API; do not copy the JAR into the watched modules directory on a production
server. The packaged action configuration starts with Jahia's
`# default configuration` marker, so an upgrade does not replace a runtime
secret with the tracked blank default.

The browser deployment tool refuses to mutate any asset until a supplied
`TOKEN_TELEMETRY_SMOKE_CONVERSATION_ID` succeeds against the live action and
returns exactly the three non-negative token totals. The smoke ID is used only
for this read-only request and is not written to deployment evidence.

Deployment follows the repository mutation controls: snapshot the current
state, produce and review a dry-run plan, obtain approval, apply, read back the
deployed state, test the real headed browser flow, and retain a rollback path.
The API key must be installed through the approved Jahia runtime-secret
mechanism, never through source control.
