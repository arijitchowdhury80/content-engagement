package com.algolia.contentengagement.tokentelemetry;

import org.jahia.bin.ActionResult;
import org.jahia.services.render.RenderContext;
import org.json.JSONObject;
import org.junit.jupiter.api.Test;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Proxy;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Unit and boundary-contract tests for the fixed-target telemetry action. */
class TokenTelemetryActionTest {

    @Test
    void tokenOnlyResponseWithConversationFieldsReturnsOnlyTotals() {
        JSONObject upstream = new JSONObject()
                .put("totalInputTokens", 10)
                .put("totalOutputTokens", 5)
                .put("totalTokens", 15)
                .put("messages", "private conversation")
                .put("tools", "private tools");

        JSONObject result = TokenTelemetryAction.tokenOnlyResponse(upstream);

        assertEquals(3, result.length());
        assertEquals(10, result.getLong("inputTokens"));
        assertEquals(5, result.getLong("outputTokens"));
        assertEquals(15, result.getLong("totalTokens"));
        assertFalse(result.has("messages"));
        assertFalse(result.has("tools"));
    }

    @Test
    void tokenOnlyResponseWithoutRequiredTotalsThrows() {
        assertThrows(
                IllegalArgumentException.class,
                () -> TokenTelemetryAction.tokenOnlyResponse(new JSONObject()));
    }

    @Test
    void conversationIdValidationAllowsExpectedFormatAndRejectsBoundaries() {
        assertTrue(TokenTelemetryAction.isValidConversationId("alg_cnv_miss_F7qB9wSPhG3z6KRH"));
        assertFalse(TokenTelemetryAction.isValidConversationId(""));
        assertFalse(TokenTelemetryAction.isValidConversationId("bad/path"));
        assertFalse(TokenTelemetryAction.isValidConversationId("x".repeat(161)));
    }

    @Test
    void upstreamUrlUsesTheConfiguredFixedTarget() {
        String result = TokenTelemetryAction.upstreamUrl(
                "0EXRPAXB56",
                "e2c8596a-4420-41d2-80bb-5cd4aaeffda6",
                "alg_cnv_1");

        assertEquals(
                "https://0EXRPAXB56.algolia.net/agent-studio/1/agents/"
                        + "e2c8596a-4420-41d2-80bb-5cd4aaeffda6/conversations/alg_cnv_1",
                result);
    }

    @Test
    void originValidationRequiresExactConfiguredOrigin() {
        String expected = "https://tmp-content-eng-algolia.cloud.jahia.com";
        assertTrue(TokenTelemetryAction.isAllowedOrigin(expected, expected));
        assertFalse(TokenTelemetryAction.isAllowedOrigin("https://attacker.example", expected));
        assertFalse(TokenTelemetryAction.isAllowedOrigin(null, expected));
    }

    @Test
    void readAllLimitedRejectsOversizedUpstreamResponse() {
        ByteArrayInputStream input = new ByteArrayInputStream("12345".getBytes(StandardCharsets.UTF_8));

        assertThrows(IOException.class, () -> TokenTelemetryAction.readAllLimited(input, 4));
    }

    @Test
    void rateLimiterBoundsRequestsAndReopensAfterTheWindow() {
        TokenTelemetryAction.FixedWindowRateLimiter limiter =
                new TokenTelemetryAction.FixedWindowRateLimiter(2, 1_000);

        assertTrue(limiter.tryAcquire(10_000));
        assertTrue(limiter.tryAcquire(10_100));
        assertFalse(limiter.tryAcquire(10_200));
        assertTrue(limiter.tryAcquire(11_000));
    }

    @Test
    void clientRateLimiterContainsOneCallerAndBoundsMemory() {
        TokenTelemetryAction.BoundedClientRateLimiter limiter =
                new TokenTelemetryAction.BoundedClientRateLimiter(1, 1_000, 2);

        assertTrue(limiter.tryAcquire("client-a", 10_000));
        assertFalse(limiter.tryAcquire("client-a", 10_001));
        assertTrue(limiter.tryAcquire("client-b", 10_001));
        assertTrue(limiter.tryAcquire("client-c", 10_001));
        assertEquals(2, limiter.trackedClients());
    }

    @Test
    void actionRejectsGetBeforeCallingUpstream() throws Exception {
        AtomicInteger opens = new AtomicInteger();
        TokenTelemetryAction action = configuredAction(url -> {
            opens.incrementAndGet();
            return connection(url, 200, totalsBody());
        });

        ActionResult result = execute(action, "GET", ALLOWED_ORIGIN, "127.0.0.1", validParameters());

        assertEquals(405, result.getResultCode());
        assertEquals(0, opens.get());
    }

    @Test
    void actionRejectsMissingSecretOriginAndInvalidParameters() throws Exception {
        TokenTelemetryAction missingSecret = configuredAction(url -> connection(url, 200, totalsBody()), "");
        assertEquals(503, execute(missingSecret, "POST", ALLOWED_ORIGIN, "127.0.0.1", validParameters()).getResultCode());

        TokenTelemetryAction action = configuredAction(url -> connection(url, 200, totalsBody()));
        assertEquals(403, execute(action, "POST", "https://attacker.example", "127.0.0.1", validParameters()).getResultCode());
        assertEquals(400, execute(action, "POST", ALLOWED_ORIGIN, "127.0.0.1", Map.of()).getResultCode());
        assertEquals(400, execute(action, "POST", ALLOWED_ORIGIN, "127.0.0.1",
                Map.of("conversationId", List.of("one", "two"))).getResultCode());
    }

    @Test
    void actionReturnsOnlyTokenTotalsOnSuccess() throws Exception {
        TokenTelemetryAction action = configuredAction(url -> connection(url, 200,
                new JSONObject(totalsBody()).put("messages", "private").toString()));

        ActionResult result = execute(action, "POST", ALLOWED_ORIGIN, "127.0.0.1", validParameters());

        assertEquals(200, result.getResultCode());
        assertEquals(3, result.getJson().length());
        assertEquals(15, result.getJson().getLong("totalTokens"));
        assertFalse(result.getJson().has("messages"));
    }

    @Test
    void actionContainsUpstreamStatusTimeoutMalformedAndOversizedFailures() throws Exception {
        assertEquals(502, execute(
                configuredAction(url -> connection(url, 401, "denied")),
                "POST", ALLOWED_ORIGIN, "client-1", validParameters()).getResultCode());
        assertEquals(502, execute(
                configuredAction(url -> timeoutConnection(url)),
                "POST", ALLOWED_ORIGIN, "client-2", validParameters()).getResultCode());
        assertEquals(502, execute(
                configuredAction(url -> connection(url, 200, "not-json")),
                "POST", ALLOWED_ORIGIN, "client-3", validParameters()).getResultCode());
        assertEquals(502, execute(
                configuredAction(url -> connection(url, 200, "x".repeat(TokenTelemetryAction.MAX_UPSTREAM_BYTES + 1))),
                "POST", ALLOWED_ORIGIN, "client-4", validParameters()).getResultCode());
    }

    private static final String ALLOWED_ORIGIN = "https://tmp-content-eng-algolia.cloud.jahia.com";
    private static final String APP_ID = "0EXRPAXB56";
    private static final String AGENT_ID = "e2c8596a-4420-41d2-80bb-5cd4aaeffda6";

    private static TokenTelemetryAction configuredAction(TokenTelemetryAction.ConnectionFactory factory) {
        return configuredAction(factory, "test-secret");
    }

    private static TokenTelemetryAction configuredAction(
            TokenTelemetryAction.ConnectionFactory factory, String apiKey) {
        TokenTelemetryAction action = new TokenTelemetryAction();
        action.configure(apiKey, APP_ID, AGENT_ID, ALLOWED_ORIGIN);
        action.setConnectionFactoryForTest(factory);
        return action;
    }

    private static ActionResult execute(
            TokenTelemetryAction action,
            String method,
            String origin,
            String remoteAddress,
            Map<String, List<String>> parameters) throws Exception {
        Map<String, String> responseHeaders = new HashMap<>();
        HttpServletResponse response = proxy(HttpServletResponse.class, (proxy, called, args) -> {
            if ("setHeader".equals(called.getName())) {
                responseHeaders.put((String) args[0], (String) args[1]);
            }
            return defaultValue(called.getReturnType());
        });
        HttpServletRequest request = proxy(HttpServletRequest.class, (proxy, called, args) -> {
            switch (called.getName()) {
                case "getMethod": return method;
                case "getHeader": return "Origin".equals(args[0]) ? origin : null;
                case "getRemoteAddr": return remoteAddress;
                default: return defaultValue(called.getReturnType());
            }
        });
        RenderContext context = new RenderContext(request, response, null);
        return action.doExecute(request, context, null, null, parameters, null);
    }

    @SuppressWarnings("unchecked")
    private static <T> T proxy(Class<T> type, java.lang.reflect.InvocationHandler handler) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler);
    }

    private static Object defaultValue(Class<?> type) {
        if (!type.isPrimitive()) return null;
        if (type == boolean.class) return false;
        if (type == byte.class) return (byte) 0;
        if (type == short.class) return (short) 0;
        if (type == int.class) return 0;
        if (type == long.class) return 0L;
        if (type == float.class) return 0F;
        if (type == double.class) return 0D;
        if (type == char.class) return '\0';
        return null;
    }

    private static Map<String, List<String>> validParameters() {
        return Map.of("conversationId", List.of("alg_cnv_1"));
    }

    private static String totalsBody() {
        return new JSONObject()
                .put("totalInputTokens", 10)
                .put("totalOutputTokens", 5)
                .put("totalTokens", 15)
                .toString();
    }

    private static HttpURLConnection connection(URL url, int status, String body) {
        return new FakeConnection(url, status, body, null);
    }

    private static HttpURLConnection timeoutConnection(URL url) {
        return new FakeConnection(url, 0, "", new SocketTimeoutException("timeout"));
    }

    private static final class FakeConnection extends HttpURLConnection {
        private final int status;
        private final byte[] body;
        private final IOException failure;

        FakeConnection(URL url, int status, String body, IOException failure) {
            super(url);
            this.status = status;
            this.body = body.getBytes(StandardCharsets.UTF_8);
            this.failure = failure;
        }

        @Override public int getResponseCode() throws IOException {
            if (failure != null) throw failure;
            return status;
        }
        @Override public InputStream getInputStream() {
            return new ByteArrayInputStream(body);
        }
        @Override public void disconnect() { }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() { }
    }
}
