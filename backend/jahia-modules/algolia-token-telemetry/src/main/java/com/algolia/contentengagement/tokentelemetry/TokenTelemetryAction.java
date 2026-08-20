package com.algolia.contentengagement.tokentelemetry;

import org.jahia.bin.Action;
import org.jahia.bin.ActionResult;
import org.jahia.services.content.JCRSessionWrapper;
import org.jahia.services.render.RenderContext;
import org.jahia.services.render.Resource;
import org.jahia.services.render.URLResolver;
import org.json.JSONObject;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.metatype.annotations.AttributeDefinition;
import org.osgi.service.metatype.annotations.AttributeType;
import org.osgi.service.metatype.annotations.Designate;
import org.osgi.service.metatype.annotations.ObjectClassDefinition;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/**
 * Proxies Agent Studio's conversation-detail endpoint so the admin/logs-scoped
 * Algolia API key stays server-side instead of living in browser-loaded JS.
 *
 * Registered as a Jahia Action (org.jahia.bin.Action) rather than a raw OSGi
 * HttpService/Whiteboard servlet — the latter proved unreachable through this
 * tenant's public routing (module showed "Started" but every request 404'd
 * identically to a nonexistent path). Actions route through the same
 * dispatcher that serves ordinary content pages, so they're proven reachable.
 *
 * Invoked as POST /sites/algolia-assets/home.algoliaTokenTelemetry.do — see
 * README for why algolia-assets (not www) and why the short-form path (no
 * /cms/render/{mode}/{lang}/ prefix) — both matter, neither is arbitrary.
 */
@Designate(ocd = TokenTelemetryAction.TokenTelemetryConfig.class)
@Component(service = Action.class)
public class TokenTelemetryAction extends Action {

    private static final Logger LOG = Logger.getLogger(TokenTelemetryAction.class.getName());

    // appId is used directly in the outbound hostname, so keep it strictly
    // alphanumeric (e.g. "0EXRPAXB56") — the tightest of the three checks.
    private static final Pattern APP_ID = Pattern.compile("^[A-Za-z0-9]+$");
    // Real Agent Studio agent ids are UUIDs (hyphens), e.g.
    // "a4c3846b-e538-4c9c-8e39-1bb15a21f2c2".
    private static final Pattern AGENT_ID = Pattern.compile("^[A-Za-z0-9-]+$");
    // Real Agent Studio conversation ids look like "alg_cnv_miss_F7qB9wSPhG3z6KRH" —
    // a prefixed, underscore-delimited format, not UUID-style.
    private static final Pattern CONVERSATION_ID = Pattern.compile("^[A-Za-z0-9_-]+$");

    private static final String API_KEY_ENV_VAR = "ALGOLIA_TOKEN_TELEMETRY_API_KEY";
    private static final String BAKED_PROPERTIES_RESOURCE = "/token-telemetry.properties";
    // CORS is fixed rather than OSGi-configurable — no operational need to
    // vary it per-tenant like api_key(). Tighten this to the real site
    // origin before any production use.
    private static final String ALLOWED_ORIGIN = "*";

    private String bakedApiKey;

    private String osgiConfigApiKey;

    @Activate
    public void activate(TokenTelemetryConfig config) {
        setName("algoliaTokenTelemetry");
        setRequireAuthenticatedUser(false);
        bakedApiKey = loadBakedApiKey();
        osgiConfigApiKey = config.api_key();
        setRequireAuthenticatedUser(false);
        super.setRequiredMethods("GET,POST");
        super.setRequiredWorkspace(org.jahia.api.Constants.LIVE_WORKSPACE);
        super.setRequireAuthenticatedUser(false);
    }

    private String loadBakedApiKey() {
        try (InputStream in = getClass().getResourceAsStream(BAKED_PROPERTIES_RESOURCE)) {
            if (in == null) {
                return null;
            }
            Properties props = new Properties();
            props.load(in);
            String value = props.getProperty("apiKey");
            if (value == null || value.isEmpty() || value.contains("${")) {
                return null;
            }
            return value;
        } catch (IOException e) {
            LOG.log(Level.WARNING, "Failed to read " + BAKED_PROPERTIES_RESOURCE, e);
            return null;
        }
    }

    @Override
    public ActionResult doExecute(HttpServletRequest req, RenderContext renderContext, Resource resource,
                                   JCRSessionWrapper session, Map<String, List<String>> parameters,
                                   URLResolver urlResolver) throws Exception {
        HttpServletResponse resp = renderContext.getResponse();
        if (resp != null) {
            resp.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
        }

        String appId = singleParam(parameters, "appId");
        String agentId = singleParam(parameters, "agentId");
        String conversationId = singleParam(parameters, "conversationId");

        if (!isValid(appId, APP_ID) || !isValid(agentId, AGENT_ID)
                || !isValid(conversationId, CONVERSATION_ID)) {
            return errorResult(HttpServletResponse.SC_BAD_REQUEST,
                    "appId, agentId and conversationId are required and must be alphanumeric");
        }

        String resolvedApiKey = resolveApiKey();
        if (resolvedApiKey == null || resolvedApiKey.isEmpty()) {
            return errorResult(HttpServletResponse.SC_SERVICE_UNAVAILABLE,
                    "Token telemetry proxy has no apiKey configured");
        }

        String upstreamUrl = "https://" + appId + ".algolia.net/agent-studio/1/agents/"
                + agentId + "/conversations/" + conversationId;

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(upstreamUrl).openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("X-Algolia-Application-Id", appId);
            conn.setRequestProperty("X-Algolia-API-Key", resolvedApiKey);
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(10000);

            int status = conn.getResponseCode();
            InputStream body = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String rawBody = body != null ? readAll(body) : "";

            JSONObject json;
            try {
                json = rawBody.isEmpty() ? new JSONObject() : new JSONObject(rawBody);
            } catch (Exception parseError) {
                return errorResult(HttpServletResponse.SC_BAD_GATEWAY, "Upstream response was not valid JSON");
            }
            return new ActionResult(status, null, json);
        } catch (IOException e) {
            LOG.log(Level.WARNING, "Upstream conversation fetch failed for " + agentId + "/" + conversationId, e);
            return errorResult(HttpServletResponse.SC_BAD_GATEWAY, "Upstream conversation fetch failed");
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private String resolveApiKey() {
        if (osgiConfigApiKey != null && !osgiConfigApiKey.isEmpty()) {
            return osgiConfigApiKey;
        }
        String envKey = System.getenv(API_KEY_ENV_VAR);
        if (envKey != null && !envKey.isEmpty()) {
            return envKey;
        }
        return bakedApiKey;
    }

    private static String singleParam(Map<String, List<String>> parameters, String key) {
        List<String> values = parameters.get(key);
        return values != null && !values.isEmpty() ? values.get(0) : null;
    }

    private static boolean isValid(String value, Pattern pattern) {
        return value != null && !value.isEmpty() && pattern.matcher(value).matches();
    }

    private static String readAll(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            char[] buffer = new char[4096];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                sb.append(buffer, 0, read);
            }
        }
        return sb.toString();
    }

    private static ActionResult errorResult(int status, String message) {
        JSONObject json = new JSONObject();
        json.put("error", message);
        return new ActionResult(status, null, json);
    }

    @ObjectClassDefinition(
            name = "Algolia: Token Telemetry Proxy Configurations",
            description = "Configurations for the Agent Studio token telemetry proxy action."
    )
    public @interface TokenTelemetryConfig {

        @AttributeDefinition(
                name = "Agent Studio API Key",
                description = "Logs-scoped Algolia Agent Studio API key used to call the upstream "
                        + "conversation-detail endpoint. Takes priority over the "
                        + API_KEY_ENV_VAR + " environment variable and the jar-baked key. Leave "
                        + "blank to fall back to those. Never commit a real value for this into "
                        + "the packaged .cfg file — set it through Configuration Admin at deploy "
                        + "time instead (Felix console, or a config file dropped outside git).",
                type = AttributeType.PASSWORD
        )
        String api_key() default "";

    }
}
