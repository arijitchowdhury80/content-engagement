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
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/** Returns token totals for one completed conversation from a fixed Agent Studio target. */
@Designate(ocd = TokenTelemetryAction.TokenTelemetryConfig.class)
@Component(service = Action.class)
public class TokenTelemetryAction extends Action {

    static final int CONVERSATION_ID_MAX_LENGTH = 160;
    static final int MAX_UPSTREAM_BYTES = 1_048_576;
    static final int GLOBAL_REQUESTS_PER_MINUTE = 300;
    static final int CLIENT_REQUESTS_PER_MINUTE = 30;
    static final int MAX_TRACKED_CLIENTS = 10_000;
    private static final Pattern APP_ID = Pattern.compile("^[A-Za-z0-9]{6,20}$");
    private static final Pattern AGENT_ID =
            Pattern.compile("^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$");
    private static final Pattern CONVERSATION_ID = Pattern.compile("^[A-Za-z0-9_-]+$");
    private static final String API_KEY_ENV_VAR = "ALGOLIA_TOKEN_TELEMETRY_API_KEY";
    private static final Logger LOG = Logger.getLogger(TokenTelemetryAction.class.getName());

    private String apiKey;
    private String appId;
    private String agentId;
    private String allowedOrigin;
    private final FixedWindowRateLimiter globalRateLimiter =
            new FixedWindowRateLimiter(GLOBAL_REQUESTS_PER_MINUTE, 60_000);
    private final BoundedClientRateLimiter clientRateLimiter =
            new BoundedClientRateLimiter(CLIENT_REQUESTS_PER_MINUTE, 60_000, MAX_TRACKED_CLIENTS);
    private ConnectionFactory connectionFactory = url -> (HttpURLConnection) url.openConnection();

    /** Activates the POST-only action with a fixed app, agent, and browser origin. */
    @Activate
    public void activate(TokenTelemetryConfig config) {
        configure(
                firstNonBlank(config.api_key(), System.getenv(API_KEY_ENV_VAR)),
                config.app_id(),
                config.agent_id(),
                config.allowed_origin());
    }

    void configure(String configuredApiKey, String configuredAppId, String configuredAgentId, String configuredOrigin) {
        setName("algoliaTokenTelemetry");
        setRequiredMethods("POST");
        setRequiredWorkspace(org.jahia.api.Constants.LIVE_WORKSPACE);
        setRequireAuthenticatedUser(false);
        appId = requireMatch("appId", configuredAppId, APP_ID);
        agentId = requireMatch("agentId", configuredAgentId, AGENT_ID);
        allowedOrigin = requireOrigin(configuredOrigin);
        apiKey = firstNonBlank(configuredApiKey, null);
    }

    /** Executes a bounded, fixed-target lookup and returns token counts only. */
    @Override
    public ActionResult doExecute(
            HttpServletRequest request,
            RenderContext renderContext,
            Resource resource,
            JCRSessionWrapper session,
            Map<String, List<String>> parameters,
            URLResolver urlResolver) {
        HttpServletResponse response = renderContext.getResponse();
        if (!"POST".equals(request.getMethod())) {
            return errorResult(HttpServletResponse.SC_METHOD_NOT_ALLOWED, "POST required");
        }
        String origin = request.getHeader("Origin");
        if (!isAllowedOrigin(origin, allowedOrigin)) {
            LOG.log(Level.WARNING, "security_event | token_usage | rejected_origin");
            return errorResult(HttpServletResponse.SC_FORBIDDEN, "Token usage request rejected");
        }
        response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
        response.setHeader("Vary", "Origin");

        String conversationId = singleParam(parameters, "conversationId");
        if (!isValidConversationId(conversationId)) {
            return errorResult(HttpServletResponse.SC_BAD_REQUEST, "Invalid conversationId");
        }
        if (apiKey == null) {
            return errorResult(HttpServletResponse.SC_SERVICE_UNAVAILABLE, "Token usage is not configured");
        }
        long now = System.currentTimeMillis();
        String clientKey = request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
        if (!clientRateLimiter.tryAcquire(clientKey, now) || !globalRateLimiter.tryAcquire(now)) {
            response.setHeader("Retry-After", "60");
            LOG.log(Level.WARNING, "security_event | token_usage | rate_limited");
            return errorResult(429, "Token usage is temporarily unavailable");
        }
        return fetchTokenUsage(conversationId);
    }

    private ActionResult fetchTokenUsage(String conversationId) {
        HttpURLConnection connection = null;
        try {
            connection = connectionFactory.open(new URL(upstreamUrl(appId, agentId, conversationId)));
            connection.setRequestMethod("GET");
            connection.setRequestProperty("X-Algolia-Application-Id", appId);
            connection.setRequestProperty("X-Algolia-API-Key", apiKey);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(10000);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                LOG.log(Level.WARNING, "token_usage | upstream_rejected | status={0}", status);
                return errorResult(HttpServletResponse.SC_BAD_GATEWAY, "Token usage is unavailable");
            }
            String rawBody = readAllLimited(connection.getInputStream(), MAX_UPSTREAM_BYTES);
            return new ActionResult(HttpServletResponse.SC_OK, null, tokenOnlyResponse(new JSONObject(rawBody)));
        } catch (Exception error) {
            LOG.log(Level.WARNING, "token_usage | upstream_failure", error);
            return errorResult(HttpServletResponse.SC_BAD_GATEWAY, "Token usage is unavailable");
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    static String upstreamUrl(String appId, String agentId, String conversationId) {
        return "https://" + appId + ".algolia.net/agent-studio/1/agents/" + agentId
                + "/conversations/" + conversationId;
    }

    static JSONObject tokenOnlyResponse(JSONObject upstream) {
        long inputTokens = requiredTokenCount(upstream, "totalInputTokens");
        long outputTokens = requiredTokenCount(upstream, "totalOutputTokens");
        long totalTokens = upstream.has("totalTokens")
                ? requiredTokenCount(upstream, "totalTokens")
                : inputTokens + outputTokens;
        return new JSONObject()
                .put("inputTokens", inputTokens)
                .put("outputTokens", outputTokens)
                .put("totalTokens", totalTokens);
    }

    private static long requiredTokenCount(JSONObject source, String key) {
        if (!source.has(key)) {
            throw new IllegalArgumentException("Missing token total");
        }
        long value = source.getLong(key);
        if (value < 0) {
            throw new IllegalArgumentException("Invalid token total");
        }
        return value;
    }

    static boolean isValidConversationId(String value) {
        return value != null
                && value.length() <= CONVERSATION_ID_MAX_LENGTH
                && CONVERSATION_ID.matcher(value).matches();
    }

    static boolean isAllowedOrigin(String actual, String expected) {
        return expected != null && expected.equals(actual);
    }

    static String readAllLimited(InputStream input, int maxBytes) throws IOException {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int read;
            while ((read = source.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) {
                    throw new IOException("Upstream response exceeded limit");
                }
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String singleParam(Map<String, List<String>> parameters, String key) {
        if (parameters == null) {
            return null;
        }
        List<String> values = parameters.get(key);
        return values != null && values.size() == 1 ? values.get(0) : null;
    }

    private static String requireMatch(String name, String value, Pattern pattern) {
        if (value == null || !pattern.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid " + name + " configuration");
        }
        return value;
    }

    private static String requireOrigin(String value) {
        if (value == null || !value.matches("^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$")) {
            throw new IllegalArgumentException("Invalid allowedOrigin configuration");
        }
        return value;
    }

    private static String firstNonBlank(String primary, String fallback) {
        if (primary != null && !primary.trim().isEmpty()) {
            return primary.trim();
        }
        return fallback == null || fallback.trim().isEmpty() ? null : fallback.trim();
    }

    private static ActionResult errorResult(int status, String message) {
        return new ActionResult(status, null, new JSONObject().put("error", message));
    }

    static final class FixedWindowRateLimiter {
        private final int limit;
        private final long windowMillis;
        private long windowStartedAt = Long.MIN_VALUE;
        private int requests;

        FixedWindowRateLimiter(int limit, long windowMillis) {
            this.limit = limit;
            this.windowMillis = windowMillis;
        }

        synchronized boolean tryAcquire(long nowMillis) {
            if (windowStartedAt == Long.MIN_VALUE || nowMillis - windowStartedAt >= windowMillis) {
                windowStartedAt = nowMillis;
                requests = 0;
            }
            if (requests >= limit) {
                return false;
            }
            requests += 1;
            return true;
        }
    }

    static final class BoundedClientRateLimiter {
        private final int limit;
        private final long windowMillis;
        private final int maxClients;
        private final LinkedHashMap<String, FixedWindowRateLimiter> clients =
                new LinkedHashMap<>(16, 0.75f, true);

        BoundedClientRateLimiter(int limit, long windowMillis, int maxClients) {
            this.limit = limit;
            this.windowMillis = windowMillis;
            this.maxClients = maxClients;
        }

        synchronized boolean tryAcquire(String clientKey, long nowMillis) {
            FixedWindowRateLimiter limiter = clients.get(clientKey);
            if (limiter == null) {
                if (clients.size() >= maxClients) {
                    clients.remove(clients.keySet().iterator().next());
                }
                limiter = new FixedWindowRateLimiter(limit, windowMillis);
                clients.put(clientKey, limiter);
            }
            return limiter.tryAcquire(nowMillis);
        }

        synchronized int trackedClients() {
            return clients.size();
        }
    }

    @FunctionalInterface
    interface ConnectionFactory {
        HttpURLConnection open(URL url) throws IOException;
    }

    void setConnectionFactoryForTest(ConnectionFactory factory) {
        connectionFactory = factory;
    }

    /** Trusted target, origin, and secret configuration for the telemetry action. */
    @ObjectClassDefinition(name = "Algolia: Token Telemetry Proxy Configuration")
    public @interface TokenTelemetryConfig {

        @AttributeDefinition(name = "Agent Studio API Key", type = AttributeType.PASSWORD)
        String api_key() default "";

        @AttributeDefinition(name = "Algolia Application ID")
        String app_id() default "0EXRPAXB56";

        @AttributeDefinition(name = "Primary Agent ID")
        String agent_id() default "e2c8596a-4420-41d2-80bb-5cd4aaeffda6";

        @AttributeDefinition(name = "Allowed Jahia Origin")
        String allowed_origin() default "https://tmp-content-eng-algolia.cloud.jahia.com";
    }
}
