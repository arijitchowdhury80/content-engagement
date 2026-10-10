import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { ANSWER_SLOT_STATUS } from "../source/shared/core/answer-record.mjs";
import { toAnswerPresentation } from "../source/shared/widget/answer-presentation.mjs";

const chatPath = new URL("../algolia-chat.js", import.meta.url);
const themePath = new URL("../algolia-chat-theme-algolia.js", import.meta.url);
const trackerPath = new URL("../algolia-engagement-tracker.js", import.meta.url);
const handoffPath = new URL("../handoff-to-orchestrator.js", import.meta.url);
const comparePath = new URL("../algolia-chat-compare.js", import.meta.url);
const telemetryPath = new URL("../token-telemetry.js", import.meta.url);
const chatWidgetRoot = new URL("../", import.meta.url);
const mirrorLoadOrderPath = new URL("fixtures/answer-harness-mirror-load-order.json", import.meta.url);

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

test("answer harness mirror fixture declares the compatibility load order", () => {
  const loadOrder = JSON.parse(fs.readFileSync(mirrorLoadOrderPath, "utf8"));
  assert.deepEqual(loadOrder, [
    "frontend/chat-widget/answer-harness-runtime.mjs",
    "frontend/chat-widget/algolia-chat.js",
    "frontend/chat-widget/handoff-to-orchestrator.js",
    "frontend/chat-widget/algolia-chat-compare.js",
    "frontend/chat-widget/token-telemetry.js",
  ]);
});

async function createTwoWidgetPage({ loadCompare = false, loadTelemetry = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(60000);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/chat-widget/")) {
      const relative = url.pathname.replace(/^\/chat-widget\//, "");
      const file = new URL(relative, chatWidgetRoot);
      if (!file.pathname.startsWith(chatWidgetRoot.pathname) || !fs.existsSync(file)) {
        await route.fulfill({ status: 404, body: "Not found" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: fs.readFileSync(file, "utf8"),
      });
      return;
    }
    if (route.request().isNavigationRequest()) {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><body></body></html>",
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ hits: [], nbHits: 0 }] }),
    });
  });
  await page.goto("http://localhost/");
  const [mirrorEntry] = JSON.parse(fs.readFileSync(mirrorLoadOrderPath, "utf8"));
  const mirrorScript = mirrorEntry.replace(/^frontend\/chat-widget\//, "");
  await page.addScriptTag({ type: "module", url: `/chat-widget/${mirrorScript}` });
  await page.waitForFunction(() =>
    typeof window.algoliaAnswerHarness?.accept === "function" &&
    typeof window.algoliaAnswerContributors?.createAnswerContentContribution === "function"
  );
  await page.evaluate(() => {
    const canonicalHarness = window.algoliaAnswerHarness;
    window.__identityHarnessEvents = [];
    window.__identityHarnessRecords = [];
    window.algoliaAnswerHarness = {
      ...canonicalHarness,
      accept(event) {
        window.__identityHarnessEvents.push(JSON.parse(JSON.stringify(event)));
        const record = canonicalHarness.accept(event);
        if (record) window.__identityHarnessRecords.push(JSON.parse(JSON.stringify(record)));
        return record;
      },
      getRecord(identity) {
        return canonicalHarness.getRecord(identity);
      },
      records() {
        return canonicalHarness.records();
      },
      rejections() {
        return canonicalHarness.rejections();
      },
    };
  });
  await page.addScriptTag({ content: fs.readFileSync(themePath, "utf8") });
  await page.addScriptTag({ content: fs.readFileSync(chatPath, "utf8") });
  await page.addScriptTag({ content: fs.readFileSync(trackerPath, "utf8") });
  await page.evaluate(() => {
    window.__identityFetches = [];
    window.algoliaContextCompiler = {
      compileTurnContext() {
        return { context_schema: "AlgoliaTurnContext.v1", current_page: "/identity-test" };
      },
      mergeTurnContext(existing = {}) {
        return { ...existing, context_schema: "AlgoliaTurnContext.v1", current_page: "/identity-test" };
      },
      fetchPrepared(_url, init, runtimeContext) {
        if (String(_url).includes("home.algoliaTokenTelemetry.do")) {
          window.__identityFetches.push({ body: init.body, runtimeContext: runtimeContext || null, telemetry: true });
          return Promise.resolve(new Response(
            JSON.stringify({ inputTokens: 44414, outputTokens: 819, totalTokens: 45233 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ));
        }
        const record = {
          url: String(_url),
          body: init.body,
          runtimeContext: runtimeContext || null,
        };
        window.__identityFetches.push(record);
        if (window.__identityManualStreams) {
          const index = window.__identityFetches.length - 1;
          const stream = new ReadableStream({
            start(controller) {
              window.__identityStreams ||= [];
              window.__identityStreams.push({
                index,
                record,
                write(text) {
                  controller.enqueue(new TextEncoder().encode(text));
                },
                close() {
                  controller.close();
                },
              });
            },
          });
          return Promise.resolve(new Response(
            stream,
            { status: 200, headers: { "X-Conversation-Id": `conversation-${window.__identityFetches.length}` } },
          ));
        }
        return Promise.resolve(new Response(
          window.__identityResponseText || 'data: {"type":"text-delta","delta":"Answer"}\n\n',
          { status: 200, headers: { "X-Conversation-Id": `conversation-${window.__identityFetches.length}` } },
        ));
      },
    };
  });
  await page.addScriptTag({ content: fs.readFileSync(handoffPath, "utf8") });
  if (loadCompare) {
    await page.evaluate(() => {
      window.ACS_COMPARE = { prod: { proxyPath: "/__compare/production" }, exposeForTests: true };
    });
    await page.addScriptTag({ content: fs.readFileSync(comparePath, "utf8") });
  }
  if (loadTelemetry) {
    await page.evaluate(() => {
      window.ACS_TOKEN_TELEMETRY = { exposeForTests: true };
    });
    await page.addScriptTag({ content: fs.readFileSync(telemetryPath, "utf8") });
  }
  await page.evaluate(async () => {
    await Promise.all([
      customElements.whenDefined("algolia-instant-search"),
      customElements.whenDefined("algolia-chat"),
      customElements.whenDefined("algolia-agent"),
    ]);
    for (let index = 0; index < 2; index += 1) {
      const search = document.createElement("algolia-instant-search");
      search.setAttribute("app-id", "test-app");
      search.setAttribute("api-key", "test-key");
      search.setAttribute("index-name", `test-index-${index}`);

      const widget = document.createElement("algolia-chat");
      widget.setAttribute("theme", "algolia");
      widget.setAttribute("show-welcome", "false");

      const agent = document.createElement("algolia-agent");
      agent.setAttribute("role", "primary");
      agent.setAttribute("agent-id", "test-agent");
      widget.append(agent);
      search.append(widget);
      document.body.append(search);
      widget.open();
    }
  });
  await page.evaluate(() => {
    window.__invokeIdentityTransport = async (payload, runtimeContext = {}) => {
      const response = await window.algoliaHandoffToOrchestrator.orchestratorTransport(
        "https://primary.example/completions",
        { method: "POST", body: JSON.stringify(payload) },
        runtimeContext,
      );
      if (response?.body?.getReader) {
        const reader = response.body.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
        }
      }
      return { status: response?.status || 0 };
    };
  });
  await page.waitForFunction(() =>
    document.querySelectorAll("algolia-chat").length === 2 &&
    [...document.querySelectorAll("algolia-chat")].every((widget) =>
      widget.shadowRoot?.querySelector('[part="panel"]')
    )
  );
  return page;
}

test("two unconfigured widgets in one document emit distinct instance and segment identities", async () => {
  const page = await createTwoWidgetPage();
  try {
    await page.evaluate(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      left.ask("same question");
      right.ask("same question");
    });
    await page.waitForFunction(() =>
      window.__identityHarnessEvents.filter((event) => event.eventName === "completed").length === 2
    );

    const state = await page.evaluate(() => ({
      hostIds: [...document.querySelectorAll("algolia-chat")].map((widget) => widget.__algoliaWidgetInstanceId),
      fetches: window.__identityFetches,
      events: window.__identityHarnessEvents,
    }));
    const prepared = state.events.filter((event) => event.eventName === "prepared");
    const completed = state.events.filter((event) => event.eventName === "completed");

    assert.equal(new Set(state.hostIds).size, 2, "each mounted custom element owns a distinct widget id");
    assert.equal(prepared.length, 2);
    assert.equal(completed.length, 2);
    assert.deepEqual(
      prepared.map((event) => event.detail.answerIdentity.widgetInstanceId).sort(),
      state.hostIds.sort(),
    );
    assert.notEqual(
      prepared[0].detail.answerIdentity.answerSegmentId,
      prepared[1].detail.answerIdentity.answerSegmentId,
      "visible assistant segment ids must be native per rendered assistant segment",
    );
    assert.equal(
      prepared[0].detail.answerIdentity.widgetInstanceId,
      completed[0].detail.answerIdentity.widgetInstanceId,
      "completion keeps the same owning widget identity",
    );
    assert.equal(
      prepared[1].detail.answerIdentity.answerSegmentId,
      completed[1].detail.answerIdentity.answerSegmentId,
      "completion keeps the same native answer segment identity",
    );
    assert.equal(state.fetches.length, 2);
    for (const fetch of state.fetches) {
      assert.equal(fetch.body.includes("widgetInstanceId"), false, "runtime identity must not alter request body bytes");
      assert.equal(fetch.body.includes("answerSegmentId"), false, "runtime identity must not alter request body bytes");
    }
  } finally {
    await page.close();
  }
});

test("widget answer rendering mirrors content and source slots into the answer harness", async () => {
  const page = await createTwoWidgetPage();
  try {
    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      left.ask("mirror this answer");
    });
    await page.waitForFunction(() =>
      window.__identityHarnessEvents.some((event) =>
        event.eventName === "contribution" &&
        event.detail?.contribution?.kind === "content" &&
        event.detail.contribution.slots?.details?.status === "ready"
      )
    );
    await page.waitForFunction(() =>
      window.__identityHarnessEvents.some((event) =>
        event.eventName === "contribution" &&
        event.detail?.contribution?.kind === "sources" &&
        event.detail.contribution.slots?.sources
      )
    );

    const state = await page.evaluate(() => {
      const content = window.__identityHarnessEvents.find((event) =>
        event.eventName === "contribution" &&
        event.detail?.contribution?.kind === "content"
      );
      const sources = window.__identityHarnessEvents.find((event) =>
        event.eventName === "contribution" &&
        event.detail?.contribution?.kind === "sources"
      );
      return { content, sources };
    });

    assert.equal(state.content.detail.contribution.slots.details.value, "Answer");
    assert.equal(state.content.detail.contribution.slots.tldrAnalogy.status, "empty");
    assert.equal(state.content.detail.contribution.slots.tldrShort.status, "empty");
    assert.equal(state.content.detail.contribution.slots.followUp.status, "empty");
    assert.equal(state.sources.detail.contribution.slots.sources.status, "unavailable");
  } finally {
    await page.close();
  }
});

test("widget answer mirror uses canonical TLDR and follow-up splitting", async () => {
  const page = await createTwoWidgetPage();
  try {
    await page.evaluate(() => {
      const answer = [
        "Running search is like opening a clean notebook before touching the evidence.",
        "",
        "Short version: the answer should stay concise and grounded.",
        "",
        "Details live here after the short version.",
      ].join("\n");
      window.__identityResponseText = [
        `data: ${JSON.stringify({ type: "text-delta", delta: answer })}`,
        "",
        `data: ${JSON.stringify({ type: "data-suggestions", data: { suggestions: ["What part should we inspect next?"] } })}`,
        "",
      ].join("\n");
      const [left] = document.querySelectorAll("algolia-chat");
      left.ask("mirror canonical tldr");
    });
    await page.waitForFunction(() =>
      window.__identityHarnessRecords.some((record) =>
        record.slots?.tldrAnalogy?.status === "ready" &&
        record.slots?.tldrShort?.status === "ready" &&
        record.slots?.followUp?.status === "ready"
      )
    );

    const record = await page.evaluate(() =>
      window.__identityHarnessRecords.find((item) =>
        item.slots?.tldrAnalogy?.status === "ready" &&
        item.slots?.tldrShort?.status === "ready" &&
        item.slots?.followUp?.status === "ready"
      )
    );

    assert.match(record.slots.tldrAnalogy.value, /^Running search is like/);
    assert.match(record.slots.tldrShort.value, /^Short version:/);
    assert.equal(record.slots.details.value, "Details live here after the short version.");
    assert.equal(record.slots.followUp.value, "What part should we inspect next?");
  } finally {
    await page.close();
  }
});

test("resetting one widget does not change a sibling widget generation or progress", async () => {
  const page = await createTwoWidgetPage();
  try {
    const state = await page.evaluate(async () => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      const payload = {
        id: "conversation-reset",
        messages: [{ id: "user-reset", role: "user", parts: [{ type: "text", text: "reset scope" }] }],
      };
      right.style.setProperty("--algolia-header-progress", "77%");

      await window.__invokeIdentityTransport(payload, {
        widgetInstanceId: right.__algoliaWidgetInstanceId,
        answerSegmentId: "right-segment",
      });
      left.dispatchEvent(new CustomEvent("algolia-visitor-reset-requested", {
        bubbles: true,
        composed: true,
        detail: { source: "test" },
      }));
      await window.__invokeIdentityTransport(payload, {
        widgetInstanceId: left.__algoliaWidgetInstanceId,
        answerSegmentId: "left-segment",
      });
      await window.__invokeIdentityTransport(payload, {
        widgetInstanceId: right.__algoliaWidgetInstanceId,
        answerSegmentId: "right-segment",
      });

      return {
        events: window.__identityHarnessEvents,
        rightProgress: right.style.getPropertyValue("--algolia-header-progress"),
      };
    });
    const prepared = state.events.filter((event) => event.eventName === "prepared");
    const rightTurns = prepared.filter((event) => event.detail.answerIdentity.answerSegmentId === "right-segment");
    const leftTurns = prepared.filter((event) => event.detail.answerIdentity.answerSegmentId === "left-segment");

    assert.equal(rightTurns.length, 2);
    assert.equal(leftTurns.length, 1);
    assert.equal(leftTurns[0].detail.turnKey.startsWith("1:"), true, "only the reset widget gets a new generation");
    assert.equal(rightTurns[0].detail.turnKey.startsWith("1:"), false);
    assert.equal(rightTurns[1].detail.turnKey.startsWith("1:"), false, "sibling generation remains unchanged");
    assert.equal(
      state.events.some((event) =>
        event.eventName === "prepared" &&
        event.detail.answerIdentity.widgetInstanceId === leftTurns[0].detail.answerIdentity.widgetInstanceId
      ),
      true,
    );
    assert.equal(state.rightProgress, "77%", "resetting one widget must not mutate sibling progress");
  } finally {
    await page.close();
  }
});

test("tracker-before-handoff widget reset keeps a sibling active attempt completable", async () => {
  const page = await createTwoWidgetPage();
  try {
    const state = await page.evaluate(async () => {
      window.__identityManualStreams = true;
      window.__identityStreams = [];
      const [left, right] = document.querySelectorAll("algolia-chat");
      right.style.setProperty("--algolia-header-progress", "77%");
      const payload = {
        id: "conversation-tracker-reset",
        messages: [{ id: "user-tracker-reset", role: "user", parts: [{ type: "text", text: "tracker reset scope" }] }],
      };
      const rightAttempt = window.__invokeIdentityTransport(payload, {
        widgetInstanceId: right.__algoliaWidgetInstanceId,
        answerSegmentId: "right-active-segment",
      });
      await new Promise((resolve) => {
        const poll = () => window.__identityStreams.length >= 1 ? resolve() : setTimeout(poll, 0);
        poll();
      });

      left.dispatchEvent(new CustomEvent("algolia-visitor-reset-requested", {
        bubbles: true,
        composed: true,
        detail: { source: "test" },
      }));

      window.__identityStreams[0].write('data: {"type":"text-delta","delta":"right"}\n\n');
      window.__identityStreams[0].close();
      await rightAttempt;

      return {
        events: window.__identityHarnessEvents,
        receipt: window.__algoliaVisitorResetReceipt,
        leftId: left.__algoliaWidgetInstanceId,
        rightId: right.__algoliaWidgetInstanceId,
        rightProgress: right.style.getPropertyValue("--algolia-header-progress"),
      };
    });
    const completed = state.events.filter((event) => event.eventName === "completed");
    const rightCompleted = completed.find((event) =>
      event.detail.answerIdentity.widgetInstanceId === state.rightId &&
      event.detail.answerIdentity.answerSegmentId === "right-active-segment"
    );

    assert.equal(state.receipt.widgetInstanceId, state.leftId, "tracker state-reset receipt carries the reset owner");
    assert.ok(rightCompleted, "sibling active attempt must still complete after left widget reset");
    assert.equal(state.rightProgress, "77%", "tracker-mediated reset must not mutate sibling progress");
  } finally {
    await page.close();
  }
});

test("retry attempts keep the same answer segment while changing network attempt id", async () => {
  const page = await createTwoWidgetPage();
  try {
    const state = await page.evaluate(async () => {
      const [left] = document.querySelectorAll("algolia-chat");
      const payload = {
        id: "conversation-retry",
        messages: [{ id: "user-retry", role: "user", parts: [{ type: "text", text: "retry scope" }] }],
      };
      const runtimeContext = {
        widgetInstanceId: left.__algoliaWidgetInstanceId,
        answerSegmentId: "assistant-segment-retry",
      };
      await window.__invokeIdentityTransport(payload, runtimeContext);
      await window.__invokeIdentityTransport(payload, runtimeContext);
      return window.__identityHarnessEvents;
    });
    const prepared = state.filter((event) => event.eventName === "prepared");

    assert.equal(prepared.length, 2);
    assert.equal(prepared[0].detail.answerIdentity.answerSegmentId, "assistant-segment-retry");
    assert.equal(prepared[1].detail.answerIdentity.answerSegmentId, "assistant-segment-retry");
    assert.notEqual(
      prepared[0].detail.answerIdentity.networkAttemptId,
      prepared[1].detail.answerIdentity.networkAttemptId,
      "retry/new attempt identity must not be conflated with answer segment identity",
    );
  } finally {
    await page.close();
  }
});

test("runtime turn lookup resolves exact assistant segment without single-answer fallback", async () => {
  const page = await createTwoWidgetPage();
  try {
    const state = await page.evaluate(async () => {
      const [left] = document.querySelectorAll("algolia-chat");
      const payload = {
        id: "conversation-runtime-turn",
        messages: [{ id: "user-runtime-turn", role: "user", parts: [{ type: "text", text: "runtime turn scope" }] }],
      };
      await window.__invokeIdentityTransport(payload, {
        widgetInstanceId: left.__algoliaWidgetInstanceId,
        answerSegmentId: "assistant-segment-one",
        turnId: "ui-turn-one",
      });
      await window.__invokeIdentityTransport(payload, {
        widgetInstanceId: left.__algoliaWidgetInstanceId,
        answerSegmentId: "assistant-segment-two",
        turnId: "ui-turn-two",
      });
      return {
        turnOne: window.algoliaHandoffToOrchestrator.answerIdentityForRuntimeTurn(
          left.__algoliaWidgetInstanceId,
          "ui-turn-one",
        ),
        turnTwo: window.algoliaHandoffToOrchestrator.answerIdentityForRuntimeTurn(
          left.__algoliaWidgetInstanceId,
          "ui-turn-two",
        ),
        wrongSegmentFallback: window.algoliaHandoffToOrchestrator.answerIdentityForSegment(
          left.__algoliaWidgetInstanceId,
          "ui-turn-one",
        ),
      };
    });

    assert.equal(state.turnOne.answerSegmentId, "assistant-segment-one");
    assert.equal(state.turnTwo.answerSegmentId, "assistant-segment-two");
    assert.equal(state.wrongSegmentFallback, null);
  } finally {
    await page.close();
  }
});

test("disconnecting and reconnecting a widget keeps that element identity isolated", async () => {
  const page = await createTwoWidgetPage();
  try {
    const state = await page.evaluate(async () => {
      const searches = document.querySelectorAll("algolia-instant-search");
      const rightSearch = searches[1];
      const right = rightSearch.querySelector("algolia-chat");
      const before = right.__algoliaWidgetInstanceId;
      rightSearch.remove();
      document.body.append(rightSearch);
      await customElements.whenDefined("algolia-chat");
      right.open();
      const after = right.__algoliaWidgetInstanceId;
      await window.__invokeIdentityTransport({
        id: "conversation-reconnect",
        messages: [{ id: "user-reconnect", role: "user", parts: [{ type: "text", text: "reconnect scope" }] }],
      }, {
        widgetInstanceId: right.__algoliaWidgetInstanceId,
        answerSegmentId: "right-reconnected-segment",
      });
      return { before, after, events: window.__identityHarnessEvents };
    });
    const prepared = state.events.filter((event) => event.eventName === "prepared");

    assert.equal(state.before, state.after, "the same custom element keeps its owned widget id across reconnect");
    assert.equal(prepared.at(-1).detail.answerIdentity.widgetInstanceId, state.after);
    assert.equal(prepared.at(-1).detail.answerIdentity.answerSegmentId, "right-reconnected-segment");
  } finally {
    await page.close();
  }
});

test("disconnecting a widget closes its in-flight attempt and rejects late completion", async () => {
  const page = await createTwoWidgetPage();
  try {
    const state = await page.evaluate(async () => {
      window.__identityManualStreams = true;
      window.__identityStreams = [];
      const searches = document.querySelectorAll("algolia-instant-search");
      const rightSearch = searches[1];
      const right = rightSearch.querySelector("algolia-chat");
      const rightId = right.__algoliaWidgetInstanceId;
      const pending = window.__invokeIdentityTransport({
        id: "conversation-disconnect",
        messages: [{ id: "user-disconnect", role: "user", parts: [{ type: "text", text: "disconnect scope" }] }],
      }, {
        widgetInstanceId: rightId,
        answerSegmentId: "right-disconnected-segment",
      });
      await new Promise((resolve) => {
        const poll = () => window.__identityStreams.length >= 1 ? resolve() : setTimeout(poll, 0);
        poll();
      });

      right.remove();
      window.__identityStreams[0].write('data: {"type":"text-delta","delta":"late"}\n\n');
      window.__identityStreams[0].close();
      await pending;

      return {
        rightId,
        events: window.__identityHarnessEvents,
        rejections: window.algoliaAnswerHarness.rejections(),
      };
    });
    const disconnected = state.events.find((event) =>
      event.eventName === "disconnected" &&
      event.detail.answerIdentity.widgetInstanceId === state.rightId
    );
    const completed = state.events.find((event) =>
      event.eventName === "completed" &&
      event.detail.answerIdentity.widgetInstanceId === state.rightId &&
      event.detail.answerIdentity.answerSegmentId === "right-disconnected-segment"
    );

    assert.ok(disconnected, "the actual custom-element disconnect closes the right widget attempt");
    assert.equal(completed, undefined, "late completion after disconnect must not land in the harness");
    assert.equal(
      state.rejections.some((event) => event.reason === "stale_answer_attempt"),
      false,
      "the runtime should suppress the stale completion before it becomes a rejected harness event",
    );
  } finally {
    await page.close();
  }
});

test("late completion from a replaced attempt is rejected without touching the sibling", async () => {
  const page = await createTwoWidgetPage();
  try {
    const state = await page.evaluate(async () => {
      window.__identityManualStreams = true;
      window.__identityStreams = [];
      const [left, right] = document.querySelectorAll("algolia-chat");
      right.style.setProperty("--algolia-header-progress", "77%");
      const payload = {
        id: "conversation-stale",
        messages: [{ id: "user-stale", role: "user", parts: [{ type: "text", text: "stale scope" }] }],
      };
      const runtimeContext = {
        widgetInstanceId: left.__algoliaWidgetInstanceId,
        answerSegmentId: "left-stale-segment",
      };
      const oldAttempt = window.__invokeIdentityTransport(payload, runtimeContext);
      await new Promise((resolve) => {
        const poll = () => window.__identityStreams.length >= 1 ? resolve() : setTimeout(poll, 0);
        poll();
      });
      const replacementAttempt = window.__invokeIdentityTransport(payload, runtimeContext);
      await new Promise((resolve) => {
        const poll = () => window.__identityStreams.length >= 2 ? resolve() : setTimeout(poll, 0);
        poll();
      });
      window.__identityStreams[1].write('data: {"type":"text-delta","delta":"replacement"}\n\n');
      window.__identityStreams[1].close();
      await replacementAttempt;
      window.__identityStreams[0].write('data: {"type":"text-delta","delta":"old"}\n\n');
      window.__identityStreams[0].close();
      await oldAttempt;

      return {
        events: window.__identityHarnessEvents,
        rightProgress: right.style.getPropertyValue("--algolia-header-progress"),
      };
    });
    const prepared = state.events.filter((event) => event.eventName === "prepared");
    const completed = state.events.filter((event) => event.eventName === "completed");

    assert.equal(prepared.length, 2);
    assert.equal(completed.length, 1, "only the replacement attempt may complete");
    assert.equal(
      completed[0].detail.answerIdentity.networkAttemptId,
      prepared[1].detail.answerIdentity.networkAttemptId,
      "late old-attempt completion must be rejected",
    );
    assert.equal(state.rightProgress, "77%", "stale completion from one widget must not affect its sibling");
  } finally {
    await page.close();
  }
});

test("one widget starting work does not reset or advance a sibling widget header", async () => {
  const page = await createTwoWidgetPage();
  try {
    await page.evaluate(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      right.style.setProperty("--algolia-header-progress", "77%");
    });

    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      left.ask("left only");
    });
    await page.waitForFunction(() => window.__identityFetches.length === 1);

    const progress = await page.evaluate(() =>
      [...document.querySelectorAll("algolia-chat")].map((widget) =>
        widget.style.getPropertyValue("--algolia-header-progress")
      )
    );

    assert.notEqual(progress[0], "", "the active widget should own its progress update");
    assert.equal(progress[1], "77%", "starting one widget must not mutate the sibling widget progress");
  } finally {
    await page.close();
  }
});

test("local DOM output matches canonical harness slots for content, sources, and follow-up", async () => {
  const page = await createTwoWidgetPage();
  try {
    await page.evaluate(() => {
      const answer = [
        "API calls are like door swings in a busy store: one entrance is harmless, but every eager widget can make the doorway blur.",
        "",
        "Short version: most interactions that request Algolia data count toward billable search usage.",
        "",
        "## Details",
        "Debounce ordinary typing, avoid duplicate page-load searches, and protect shared backend traffic with server-side throttling.",
      ].join("\n");
      window.__identityResponseText = [
        `data: ${JSON.stringify({
          type: "tool-output-available",
          toolCallId: "search-1",
          output: {
            hits: [
              {
                objectID: "request-usage",
                title: "Understand search request usage",
                url: "https://www.algolia.com/doc/guides/scaling/algolia-service-limits/",
                source: "Documentation",
                description: "Requests are counted when search traffic reaches Algolia.",
              },
            ],
          },
        })}`,
        "",
        `data: ${JSON.stringify({ type: "text-delta", delta: answer })}`,
        "",
        `data: ${JSON.stringify({
          type: "data-suggestions",
          data: { suggestions: ["Are you protecting against bots or normal browsing costs?"] },
        })}`,
        "",
      ].join("\n");
      const [left] = document.querySelectorAll("algolia-chat");
      left.ask("What counts as an API call?");
    });
    await page.waitForFunction(() => {
      const root = document.querySelector("algolia-chat")?.shadowRoot;
      const records = window.algoliaAnswerHarness?.records?.() || [];
      const record = records.find((item) =>
        item.slots?.tldrAnalogy?.status === "ready" &&
        item.slots?.tldrShort?.status === "ready" &&
        item.slots?.details?.status === "ready" &&
        item.slots?.sources?.status === "ready" &&
        item.slots?.followUp?.status === "ready"
      );
      return Boolean(
        record &&
        root?.querySelector(".acs-answer-tldr") &&
        root?.querySelector(".acs-answer-details") &&
        root?.querySelector(".acs-source-section") &&
        root?.querySelector(".acs-followup-card")
      );
    });

    const parity = await page.evaluate(() => {
      const root = document.querySelector("algolia-chat").shadowRoot;
      const record = window.algoliaAnswerHarness.records().find((item) =>
        item.slots?.tldrAnalogy?.status === "ready" &&
        item.slots?.tldrShort?.status === "ready" &&
        item.slots?.details?.status === "ready" &&
        item.slots?.sources?.status === "ready" &&
        item.slots?.followUp?.status === "ready"
      );
      const tldr = root.querySelector(".acs-answer-tldr");
      const analogy = root.querySelector(".acs-answer-analogy");
      const short = root.querySelector(".acs-answer-short");
      const details = root.querySelector(".acs-answer-details");
      const sources = root.querySelector(".acs-source-section");
      const followUp = root.querySelector(".acs-followup-card");
      const answerWithoutFollowUp = followUp?.parentElement?.parentElement?.cloneNode(true);
      answerWithoutFollowUp?.querySelector(".acs-followup-wrap")?.remove();

      return {
        lifecycle: record.lifecycle,
        identityKey: record.identityKey,
        harness: {
          analogy: record.slots.tldrAnalogy.value,
          short: record.slots.tldrShort.value,
          details: record.slots.details.value,
          sourceCount: record.slots.sources.value.length,
          sourceLabel: record.slots.sources.value[0]?.source,
          followUp: record.slots.followUp.value,
          confidenceStatus: record.slots.confidence.status,
        },
        dom: {
          tldrText: tldr?.textContent.replace(/\s+/g, " ").trim(),
          analogyText: analogy?.textContent.replace(/\s+/g, " ").trim(),
          analogyStyle: analogy ? getComputedStyle(analogy).fontStyle : null,
          shortText: short?.textContent.replace(/\s+/g, " ").trim(),
          shortStyle: short ? getComputedStyle(short).fontStyle : null,
          detailsText: details?.textContent.replace(/\s+/g, " ").trim(),
          sourceText: sources?.textContent.replace(/\s+/g, " ").trim(),
          followUpText: followUp?.textContent.replace(/\s+/g, " ").trim(),
          answerWithoutFollowUpText: answerWithoutFollowUp?.textContent.replace(/\s+/g, " ").trim(),
        },
      };
    });

    assert.equal(parity.lifecycle, "complete");
    assert.match(parity.identityKey, /^algolia-chat%3A/);
    assert.equal(parity.dom.analogyText, parity.harness.analogy);
    assert.equal(parity.dom.analogyStyle, "italic");
    assert.equal(parity.dom.shortText, parity.harness.short);
    assert.notEqual(parity.dom.shortStyle, "italic");
    assert.match(parity.dom.tldrText, /door swings in a busy store/);
    assert.match(parity.dom.tldrText, /Short version:/);
    assert.doesNotMatch(parity.dom.tldrText, /Debounce ordinary typing/);
    assert.match(parity.dom.detailsText, /Debounce ordinary typing/);
    assert.equal(parity.dom.followUpText, parity.harness.followUp);
    assert.equal(parity.dom.answerWithoutFollowUpText.includes(parity.harness.followUp), false);
    assert.equal(parity.harness.sourceCount, 1);
    assert.equal(parity.harness.sourceLabel, "Documentation");
    assert.match(parity.dom.sourceText, /Documentation/i);
    assert.equal(parity.dom.sourceText.includes("1"), true);
    assert.equal(
      parity.harness.confidenceStatus,
      "unavailable",
      "confidence/evidence-lineage parity is intentionally not comparable until judge passage IDs are wired",
    );
  } finally {
    await page.close();
  }
});

test("runtime confidence mirror stays unavailable without sealed judge passage lineage", async () => {
  const page = await createTwoWidgetPage();
  try {
    await page.evaluate(() => {
      const answer = [
        "Evidence checking is like keeping one annotated notebook instead of separate piles of sticky notes.",
        "",
        "Short version: judges should point at the same source passages the visitor sees.",
        "",
        "Details remain in the answer while confidence records reference the shared evidence lineage.",
      ].join("\n");
      window.__identityResponseText = [
        `data: ${JSON.stringify({
          type: "tool-output-available",
          output: {
            hits: [
              {
                objectID: "lineage-doc",
                title: "Lineage docs",
                url: "https://www.algolia.com/doc/lineage",
                source: "Documentation",
              },
            ],
          },
        })}`,
        "",
        `data: ${JSON.stringify({ type: "text-delta", delta: answer })}`,
        "",
      ].join("\n");
      const [left] = document.querySelectorAll("algolia-chat");
      left.ask("mirror confidence lineage");
    });
    await page.waitForFunction(() =>
      window.algoliaAnswerHarness?.records?.().some((record) =>
        record.lifecycle === "complete" &&
        record.slots?.sources?.status === "ready" &&
        record.evidence?.passages?.some((passage) => passage.kind === "source")
      )
    );

    const lineage = await page.evaluate(() => {
      const record = window.algoliaAnswerHarness.records().find((item) =>
        item.lifecycle === "complete" &&
        item.slots?.sources?.status === "ready" &&
        item.evidence?.passages?.some((passage) => passage.kind === "source")
      );
      const contribution = window.algoliaAnswerContributors.createConfidenceContribution({
        identity: record.identity,
        confidence: {
          composite: 8.8,
          groundingStatus: "supported",
          perJudge: [
            { role: "skeptic", summary: "Evidence is present." },
            { role: "referee", summary: "Sources align." },
            { role: "advocate", summary: "The answer is useful." },
          ],
        },
      });
      window.algoliaAnswerHarness.accept({
        eventName: "contribution",
        detail: { answerIdentity: record.identity, contribution },
      });
      const updated = window.algoliaAnswerHarness.getRecord(record.identity);
      return {
        confidenceStatus: updated.slots.confidence.status,
        sourceIds: updated.evidence.passages
          .filter((passage) => passage.kind === "source")
          .map((passage) => passage.id),
        evaluationPassageIds: updated.evidence.evaluations.map((evaluation) => evaluation.passageIds),
        evaluationRoles: updated.evidence.evaluations.map((evaluation) => evaluation.role),
      };
    });

    assert.equal(lineage.confidenceStatus, "unavailable");
    assert.deepEqual(lineage.sourceIds, ["source:retrieval:0:lineage-doc"]);
    assert.deepEqual(lineage.evaluationPassageIds, []);
    assert.deepEqual(lineage.evaluationRoles, []);
  } finally {
    await page.close();
  }
});

test("visible content layer prefers the canonical Algolia normalizer when it is loaded", async () => {
  const page = await createTwoWidgetPage();
  try {
    await page.evaluate(() => {
      const originalRuntime = window.algoliaAnswerHarnessRuntime;
      window.algoliaAnswerHarnessRuntime = {
        ...originalRuntime,
        normalizeAnswerContent() {
          return {
            tldrAnalogy: "Canonical Algolia analogy: this should come from the Algolia normalizer.",
            tldrShort: "Short version: canonical parity short answer.",
            details: "Canonical Algolia details body.",
            followUp: null,
          };
        },
      };
      window.__identityResponseText = [
        `data: ${JSON.stringify({
          type: "text-delta",
          delta: [
            "A flat opening that the legacy splitter should not layer.",
            "",
            "A second flat paragraph without a short-answer marker.",
            "",
            "A third flat paragraph.",
          ].join("\n"),
        })}`,
        "",
      ].join("\n");
      const [left] = document.querySelectorAll("algolia-chat");
      left.ask("canonical layer bridge");
    });

    await page.waitForFunction(() => {
      const root = document.querySelector("algolia-chat")?.shadowRoot;
      return root?.querySelector(".acs-answer-tldr")?.textContent.includes("Canonical Algolia analogy") &&
        root?.querySelector(".acs-answer-details")?.textContent.includes("Canonical Algolia details body");
    });

    const state = await page.evaluate(() => {
      const root = document.querySelector("algolia-chat").shadowRoot;
      return {
        tldrText: root.querySelector(".acs-answer-tldr")?.textContent.replace(/\s+/g, " ").trim(),
        analogyStyle: getComputedStyle(root.querySelector(".acs-answer-analogy")).fontStyle,
        shortStyle: getComputedStyle(root.querySelector(".acs-answer-short")).fontStyle,
        detailsText: root.querySelector(".acs-answer-details")?.textContent.replace(/\s+/g, " ").trim(),
      };
    });

    assert.match(state.tldrText, /Canonical Algolia analogy/);
    assert.match(state.tldrText, /Short version: canonical parity short answer/);
    assert.equal(state.analogyStyle, "italic");
    assert.notEqual(state.shortStyle, "italic");
    assert.match(state.detailsText, /Canonical Algolia details body/);
    assert.doesNotMatch(state.detailsText, /flat opening/i);
  } finally {
    await page.close();
  }
});

test("post-answer controls wait for completion and mirror telemetry and compare slots", async () => {
  const page = await createTwoWidgetPage({ loadCompare: true, loadTelemetry: true });
  try {
    await page.evaluate(() => {
      window.__identityManualStreams = true;
      window.__identityStreams = [];
      const [left] = document.querySelectorAll("algolia-chat");
      left.ask("post-answer controls");
    });
    await page.waitForFunction(() => window.__identityStreams?.length === 1);

    const duringStream = await page.evaluate(() => {
      const root = document.querySelector("algolia-chat").shadowRoot;
      return {
        compare: Boolean(root.querySelector("#acs-compare-toggle")),
        telemetry: Boolean(root.querySelector(".algolia-usage-pill")),
      };
    });
    assert.equal(duringStream.compare, false, "Compare must not appear while the answer is still streaming");
    assert.equal(duringStream.telemetry, false, "Telemetry must not appear while the answer is still streaming");

    await page.evaluate(() => {
      const answer = [
        "A governed answer is like a runway checklist: the useful controls show up only after the plane is actually on the ground.",
        "",
        "Short version: sources may be known early, but Compare and token telemetry belong to the completed answer footer.",
        "",
        "Details remain in the answer body while post-answer controls settle below it.",
      ].join("\n");
      window.__identityStreams[0].write([
        `data: ${JSON.stringify({
          type: "tool-output-available",
          output: {
            hits: [
              {
                objectID: "post-answer-source",
                title: "Post answer source",
                url: "https://www.algolia.com/doc/",
                source: "Documentation",
              },
            ],
          },
        })}`,
        "",
        `data: ${JSON.stringify({ type: "text-delta", delta: answer })}`,
        "",
      ].join("\n"));
      window.__identityStreams[0].close();
    });

    await page.waitForFunction(() => {
      const root = document.querySelector("algolia-chat")?.shadowRoot;
      const footer = root?.querySelector("[data-algolia-answer-footer]");
      const record = window.algoliaAnswerHarness?.records?.().find((item) =>
        item.lifecycle === "complete" &&
        item.slots?.telemetry?.status === "ready" &&
        item.slots?.actions?.status === "ready"
      );
      return Boolean(
        footer &&
        record &&
        footer.querySelector(".algolia-usage-pill") &&
        footer.querySelector("#acs-compare-toggle")
      );
    });

    const parity = await page.evaluate(() => {
      const root = document.querySelector("algolia-chat").shadowRoot;
      const footer = root.querySelector("[data-algolia-answer-footer]");
      const sources = root.querySelector(".acs-source-section");
      const record = window.algoliaAnswerHarness.records().find((item) =>
        item.lifecycle === "complete" &&
        item.slots?.telemetry?.status === "ready" &&
        item.slots?.actions?.status === "ready"
      );
      const telemetry = footer.querySelector(".algolia-usage-pill");
      const compare = footer.querySelector("#acs-compare-toggle");
      const completed = window.__identityHarnessEvents.find((event) =>
        event.eventName === "completed" &&
        event.detail?.answerIdentity?.widgetInstanceId === record.identity.widgetInstanceId &&
        event.detail?.answerIdentity?.conversationId === record.identity.conversationId &&
        event.detail?.answerIdentity?.answerSegmentId === record.identity.answerSegmentId &&
        event.detail?.answerIdentity?.networkAttemptId === record.identity.networkAttemptId
      );
      return {
        footerLegacyTurnId: footer.dataset.algoliaAnswerFooter,
        completedMessageId: completed?.detail?.messageId || null,
        footerText: footer.textContent.replace(/\s+/g, " ").trim(),
        sourceText: sources?.textContent.replace(/\s+/g, " ").trim(),
        sourceInsideFooter: Boolean(sources && footer.contains(sources)),
        telemetryText: telemetry?.textContent.replace(/\s+/g, " ").trim(),
        compareText: compare?.textContent.replace(/\s+/g, " ").trim(),
        comparePressed: compare?.getAttribute("aria-pressed"),
        harnessTelemetry: record.slots.telemetry.value,
        harnessCompare: record.slots.actions.value,
      };
    });

    assert.equal(
      parity.footerLegacyTurnId,
      parity.completedMessageId,
      "the legacy footer id must belong to the same completed event as the selected canonical record",
    );
    assert.equal(parity.telemetryText, "In 44,414 / 819 Out");
    assert.deepEqual(parity.harnessTelemetry, {
      inputTokens: 44414,
      outputTokens: 819,
      totalTokens: 45233,
    });
    assert.equal(parity.compareText, "Compare with Prod");
    assert.equal(parity.comparePressed, "false");
    assert.deepEqual(parity.harnessCompare, {
      label: "Compare with Prod",
      pressed: false,
      available: true,
    });
    assert.equal(parity.sourceInsideFooter, false, "sources must remain structurally separate from the post-answer footer");
    assert.match(parity.sourceText, /Documentation/i);
    assert.doesNotMatch(parity.footerText, /Documentation/i);
    assert.match(parity.footerText, /In 44,414 \/ 819 Out/);
    assert.match(parity.footerText, /Compare with Prod/);
  } finally {
    await page.close();
  }
});

test("visible telemetry is scoped per widget and survives sibling reset", async () => {
  const page = await createTwoWidgetPage({ loadTelemetry: true });
  try {
    await page.evaluate(() => {
      window.__identityManualStreams = true;
      window.__identityStreams = [];
      const [left, right] = document.querySelectorAll("algolia-chat");
      left.ask("left telemetry question");
      right.ask("right telemetry question");
    });
    await page.waitForFunction(() => window.__identityStreams?.length === 2);

    await page.evaluate(() => {
      const answer = (side) => [
        `${side} answer analogy stays visible while telemetry lands after completion.`,
        "",
        `Short version: ${side} telemetry belongs only to this widget.`,
        "",
        `${side} details stay in the body.`,
      ].join("\n");
      window.__identityStreams.forEach((stream, index) => {
        stream.write([
          `data: ${JSON.stringify({ type: "text-delta", delta: answer(index === 0 ? "Left" : "Right") })}`,
          "",
        ].join("\n"));
        stream.close();
      });
    });

    await page.waitForFunction(() => {
      const widgets = [...document.querySelectorAll("algolia-chat")];
      return widgets.length === 2 && widgets.every((widget) =>
        widget.shadowRoot?.querySelector("[data-algolia-answer-footer] .algolia-usage-pill")
      );
    });

    const beforeReset = await page.evaluate(() =>
      [...document.querySelectorAll("algolia-chat")].map((widget) => ({
        widgetInstanceId: widget.__algoliaWidgetInstanceId,
        telemetry: widget.shadowRoot
          ?.querySelector("[data-algolia-answer-footer] .algolia-usage-pill")
          ?.textContent
          ?.replace(/\s+/g, " ")
          ?.trim(),
      }))
    );
    assert.equal(beforeReset.length, 2);
    assert.deepEqual(beforeReset.map((entry) => entry.telemetry), [
      "In 44,414 / 819 Out",
      "In 44,414 / 819 Out",
    ]);
    assert.notEqual(beforeReset[0].widgetInstanceId, beforeReset[1].widgetInstanceId);

    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      document.dispatchEvent(new CustomEvent("algolia-visitor-state-reset", {
        detail: { widgetInstanceId: left.__algoliaWidgetInstanceId },
      }));
    });
    await page.waitForFunction(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      return !left.shadowRoot?.querySelector(".algolia-usage-pill") &&
        right.shadowRoot?.querySelector(".algolia-usage-pill");
    });

    const afterReset = await page.evaluate(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      return {
        leftTelemetry: left.shadowRoot?.querySelector(".algolia-usage-pill")?.textContent || null,
        rightTelemetry: right.shadowRoot?.querySelector(".algolia-usage-pill")?.textContent || null,
      };
    });
    assert.equal(afterReset.leftTelemetry, null);
    assert.equal(afterReset.rightTelemetry.replace(/\s+/g, " ").trim(), "In 44,414 / 819 Out");
  } finally {
    await page.close();
  }
});

test("visible Compare actions are scoped per widget and survive sibling reset", async () => {
  const page = await createTwoWidgetPage({ loadCompare: true, loadTelemetry: true });
  try {
    await page.evaluate(() => {
      window.__identityManualStreams = true;
      window.__identityStreams = [];
      const [left, right] = document.querySelectorAll("algolia-chat");
      left.ask("left compare question");
      right.ask("right compare question");
    });
    await page.waitForFunction(() => window.__identityStreams?.length === 2);

    await page.evaluate(() => {
      window.__identityStreams.forEach((stream, index) => {
        const side = index === 0 ? "left" : "right";
        const answer = [
          `${side} Compare answer keeps the action scoped to its own widget.`,
          "",
          `Short version: ${side} Compare belongs to this exact completed attempt.`,
          "",
          `${side} details stay visible while the footer controls settle.`,
        ].join("\n");
        stream.write([
          `data: ${JSON.stringify({ type: "text-delta", delta: answer })}`,
          "",
        ].join("\n"));
        stream.close();
      });
    });

    await page.waitForFunction(() =>
      [...document.querySelectorAll("algolia-chat")].every((widget) =>
        widget.shadowRoot?.querySelector("[data-algolia-answer-footer] .algolia-usage-pill") &&
        widget.shadowRoot?.querySelector("[data-algolia-answer-footer] #acs-compare-toggle")
      )
    );

    const beforeReset = await page.evaluate(() =>
      [...document.querySelectorAll("algolia-chat")].map((widget) => ({
        widgetInstanceId: widget.__algoliaWidgetInstanceId,
        compareText: widget.shadowRoot
          ?.querySelector("[data-algolia-answer-footer] #acs-compare-toggle")
          ?.textContent
          ?.replace(/\s+/g, " ")
          ?.trim(),
        footerOwner: widget.shadowRoot
          ?.querySelector("[data-algolia-answer-footer]")
          ?.dataset
          ?.algoliaAnswerFooter,
      }))
    );
    assert.equal(beforeReset.length, 2);
    assert.deepEqual(beforeReset.map((entry) => entry.compareText), ["Compare with Prod", "Compare with Prod"]);
    assert.notEqual(beforeReset[0].widgetInstanceId, beforeReset[1].widgetInstanceId);
    assert.notEqual(beforeReset[0].footerOwner, beforeReset[1].footerOwner);

    const fetchesBeforeActiveReset = await page.evaluate(() => window.__identityFetches.length);
    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      left.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await page.waitForFunction((count) => window.__identityFetches.length > count, fetchesBeforeActiveReset);
    await page.waitForFunction(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      const state = window.__acsCompare?.state?.();
      return state?.compareOn === true &&
        state.activeWidgetInstanceId === left.__algoliaWidgetInstanceId &&
        left.shadowRoot.querySelector("#acs-compare-toggle")?.getAttribute("aria-pressed") === "true" &&
        right.shadowRoot.querySelector("#acs-compare-toggle")?.getAttribute("aria-pressed") === "false";
    });

    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      document.dispatchEvent(new CustomEvent("algolia-visitor-state-reset", {
        detail: { widgetInstanceId: left.__algoliaWidgetInstanceId },
      }));
    });
    await page.waitForFunction(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      const state = window.__acsCompare?.state?.();
      return state?.compareOn === false &&
        !state.activeWidgetInstanceId &&
        !left.shadowRoot?.querySelector("#acs-compare-toggle") &&
        right.shadowRoot?.querySelector("[data-algolia-answer-footer] #acs-compare-toggle")?.getAttribute("aria-pressed") === "false";
    });

    const fetchesBeforeClick = await page.evaluate(() => window.__identityFetches.length);
    await page.evaluate(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      right.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await page.waitForFunction((count) => window.__identityFetches.length > count, fetchesBeforeClick);

    const state = await page.evaluate(() => {
      const fetch = window.__identityFetches.at(-1);
      return {
        requestBody: fetch?.body || "",
        harnessCompare: window.algoliaAnswerHarness.records()
          .filter((record) => record.lifecycle === "complete" && record.slots?.actions?.status === "ready")
          .map((record) => ({
            identity: record.identity,
            actions: record.slots.actions.value,
          })),
      };
    });
    assert.match(state.requestBody, /right compare question/, "right widget click must replay the right prepared body");
    assert.doesNotMatch(state.requestBody, /left compare question/, "left reset must not leak into the right replay");
    assert.equal(state.harnessCompare.length, 1, "only the surviving widget has a ready mirrored Compare action");
    assert.equal(state.harnessCompare[0].actions.label, "Compare with Prod");
    assert.equal(state.harnessCompare[0].actions.available, true);
    assert.equal(state.harnessCompare[0].identity.widgetInstanceId, beforeReset[1].widgetInstanceId);

    await page.evaluate(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      right.remove();
    });
    await page.waitForFunction(() => {
      const compareState = window.__acsCompare?.state?.();
      return compareState &&
        compareState.hasPreparedTurn === false &&
        compareState.activeTurns === 0 &&
        compareState.completedTurns === 0;
    });
  } finally {
    await page.close();
  }
});

test("switching Compare widgets cleans the prior inset and ignores stale production chunks", async () => {
  const page = await createTwoWidgetPage({ loadCompare: true, loadTelemetry: true });
  try {
    await page.evaluate(() => {
      window.__identityManualStreams = true;
      window.__identityStreams = [];
      const [left, right] = document.querySelectorAll("algolia-chat");
      left.ask("left streaming compare");
      right.ask("right streaming compare");
    });
    await page.waitForFunction(() => window.__identityStreams?.length === 2);

    await page.evaluate(() => {
      window.__identityStreams.forEach((stream, index) => {
        const side = index === 0 ? "left" : "right";
        const answer = [
          `${side} answer.`,
          "",
          `Short version: ${side} footer is ready.`,
          "",
          `${side} details.`,
        ].join("\n");
        stream.write(`data: ${JSON.stringify({ type: "text-delta", delta: answer })}\n\n`);
        stream.close();
      });
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("algolia-chat")].every((widget) =>
        widget.shadowRoot?.querySelector("[data-algolia-answer-footer] #acs-compare-toggle")
      )
    );

    const beforeLeftClick = await page.evaluate(() => window.__identityFetches.length);
    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      left.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await page.waitForFunction((count) => window.__identityFetches.length > count, beforeLeftClick);
    await page.waitForFunction(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      return window.__acsCompare?.state?.().activeWidgetInstanceId === left.__algoliaWidgetInstanceId &&
        left.shadowRoot.querySelector("#acs-compare-style");
    });

    await page.evaluate(() => {
      const productionLeft = window.__identityStreams.at(-1);
      productionLeft.write(`data: ${JSON.stringify({ type: "text-delta", delta: "LEFT PRODUCTION SHOULD BE REPLACED" })}\n\n`);
    });
    await page.waitForFunction(() =>
      document.querySelector("algolia-chat").shadowRoot.querySelector("#acs-compare-panel")?.textContent?.includes("LEFT PRODUCTION SHOULD BE REPLACED")
    );

    const beforeRightClick = await page.evaluate(() => window.__identityFetches.length);
    await page.evaluate(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      right.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await page.waitForFunction((count) => window.__identityFetches.length > count, beforeRightClick);
    await page.waitForFunction(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      return window.__acsCompare?.state?.().activeWidgetInstanceId === right.__algoliaWidgetInstanceId &&
        !left.shadowRoot.querySelector("#acs-compare-style") &&
        right.shadowRoot.querySelector("#acs-compare-style");
    });

    await page.evaluate(() => {
      const productionLeft = window.__identityStreams.at(-2);
      const productionRight = window.__identityStreams.at(-1);
      productionLeft.write(`data: ${JSON.stringify({ type: "text-delta", delta: "STALE LEFT MUST NOT LEAK" })}\n\n`);
      productionLeft.close();
      productionRight.write(`data: ${JSON.stringify({ type: "text-delta", delta: "RIGHT PRODUCTION WINS" })}\n\n`);
      productionRight.close();
    });
    await page.waitForFunction(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      const panelText = right.shadowRoot.querySelector("#acs-compare-panel")?.textContent || "";
      return panelText.includes("RIGHT PRODUCTION WINS");
    });

    const switched = await page.evaluate(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      const panelText = right.shadowRoot.querySelector("#acs-compare-panel")?.textContent || "";
      return {
        leftHasInset: Boolean(left.shadowRoot.querySelector("#acs-compare-style")),
        rightHasInset: Boolean(right.shadowRoot.querySelector("#acs-compare-style")),
        leftPressed: left.shadowRoot.querySelector("#acs-compare-toggle")?.getAttribute("aria-pressed"),
        rightPressed: right.shadowRoot.querySelector("#acs-compare-toggle")?.getAttribute("aria-pressed"),
        panelText,
      };
    });
    assert.equal(switched.leftHasInset, false, "switching to B must remove A's comparison inset");
    assert.equal(switched.rightHasInset, true, "B owns the comparison inset after switch");
    assert.equal(switched.leftPressed, "false");
    assert.equal(switched.rightPressed, "true");
    assert.doesNotMatch(switched.panelText, /STALE LEFT MUST NOT LEAK/);
    assert.match(switched.panelText, /RIGHT PRODUCTION WINS/);

    const beforeSwitchBack = await page.evaluate(() => window.__identityFetches.length);
    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      left.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await page.waitForFunction((count) => window.__identityFetches.length > count, beforeSwitchBack);
    await page.evaluate(() => {
      const productionLeft = window.__identityStreams.at(-1);
      productionLeft.write(`data: ${JSON.stringify({ type: "text-delta", delta: "LEFT REFETCH WINS" })}\n\n`);
      productionLeft.close();
    });
    await page.waitForFunction(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      const panelText = left.shadowRoot.querySelector("#acs-compare-panel")?.textContent || "";
      return window.__acsCompare?.state?.().activeWidgetInstanceId === left.__algoliaWidgetInstanceId &&
        panelText.includes("LEFT REFETCH WINS");
    });
    const switchedBack = await page.evaluate(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      const panelText = left.shadowRoot.querySelector("#acs-compare-panel")?.textContent || "";
      return {
        leftHasInset: Boolean(left.shadowRoot.querySelector("#acs-compare-style")),
        rightHasInset: Boolean(right.shadowRoot.querySelector("#acs-compare-style")),
        leftPressed: left.shadowRoot.querySelector("#acs-compare-toggle")?.getAttribute("aria-pressed"),
        rightPressed: right.shadowRoot.querySelector("#acs-compare-toggle")?.getAttribute("aria-pressed"),
        panelText,
      };
    });
    assert.equal(switchedBack.leftHasInset, true, "switching back to A must restore A comparison inset");
    assert.equal(switchedBack.rightHasInset, false, "switching back to A must remove B comparison inset");
    assert.equal(switchedBack.leftPressed, "true");
    assert.equal(switchedBack.rightPressed, "false");
    assert.match(switchedBack.panelText, /LEFT REFETCH WINS/);
    assert.doesNotMatch(switchedBack.panelText, /RIGHT PRODUCTION WINS/);

    await page.evaluate(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      right.ask("right latest while left compare active");
      left.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await page.waitForFunction(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      const state = window.__acsCompare?.state?.();
      return state?.compareOn === false &&
        !right.shadowRoot.querySelector("#acs-compare-style") &&
        !left.shadowRoot.querySelector("#acs-compare-style");
    });
  } finally {
    await page.close();
  }
});

async function writeNextIdentityStream(page, kind, text) {
  await page.waitForFunction((streamKind) =>
    window.__identityStreams?.some((stream) => {
      if (stream.__used) return false;
      const isProduction = String(stream.record?.url || "").includes("/__compare/production");
      const isPrimary = !isProduction;
      return streamKind === "primary" ? isPrimary : !isPrimary;
    }),
  kind);
  await page.evaluate(({ streamKind, value }) => {
    const stream = window.__identityStreams.find((candidate) => {
      if (candidate.__used) return false;
      const isProduction = String(candidate.record?.url || "").includes("/__compare/production");
      const isPrimary = !isProduction;
      return streamKind === "primary" ? isPrimary : !isPrimary;
    });
    stream.__used = true;
    stream.write(`data: ${JSON.stringify({ type: "text-delta", delta: value })}\n\n`);
    stream.close();
  }, { streamKind: kind, value: text });
}

async function markNextIdentityStreamUsed(page, kind) {
  await page.waitForFunction((streamKind) =>
    window.__identityStreams?.some((stream) => {
      if (stream.__used) return false;
      const isProduction = String(stream.record?.url || "").includes("/__compare/production");
      const isPrimary = !isProduction;
      return streamKind === "primary" ? isPrimary : isProduction;
    }),
  kind);
  await page.evaluate((streamKind) => {
    const stream = window.__identityStreams.find((candidate) => {
      if (candidate.__used) return false;
      const isProduction = String(candidate.record?.url || "").includes("/__compare/production");
      const isPrimary = !isProduction;
      return streamKind === "primary" ? isPrimary : isProduction;
    });
    stream.__used = true;
  }, kind);
}

test("switching back to a widget restores all completed Compare turns in order", async () => {
  const page = await createTwoWidgetPage({ loadCompare: true, loadTelemetry: true });
  try {
    await page.evaluate(() => {
      window.__identityManualStreams = true;
      window.__identityStreams = [];
      window.__pendingComparePrimaryTurns = [];
      window.__publishCompareReadyTurn = (widget, suffix, question, _attemptNumber) => {
        const widgetId = widget.__algoliaWidgetInstanceId;
        const messageId = `${widgetId}-${suffix}-message`;
        const conversationId = `${widgetId}-conversation`;
        const answerSegmentId = `${widgetId}-${suffix}-assistant`;
        const footer = document.createElement("div");
        footer.dataset.algoliaAnswerFooter = messageId;
        const usage = document.createElement("span");
        usage.className = "algolia-usage-pill";
        usage.textContent = "In 1 / 1 Out";
        footer.append(usage);
        widget.shadowRoot.querySelector('[part="chat-content"] .overflow-y-auto').append(footer);
        const payload = {
          id: conversationId,
          messages: [{ id: messageId, role: "user", parts: [{ type: "text", text: question }] }],
        };
        window.__pendingComparePrimaryTurns.push(
          window.__invokeIdentityTransport(payload, { widgetInstanceId: widgetId, answerSegmentId })
            .catch((error) => ({ error: String(error?.message || error) })),
        );
      };
      const [left] = document.querySelectorAll("algolia-chat");
      window.__publishCompareReadyTurn(left, "a1", "left question one", 1);
    });
    await writeNextIdentityStream(page, "primary", "LEFT A1 PRIMARY");
    await page.waitForFunction(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      return left.shadowRoot.querySelector("[data-algolia-answer-footer] #acs-compare-toggle");
    });

    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      left.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await writeNextIdentityStream(page, "production", "LEFT A1 PRODUCTION");
    await page.waitForFunction(() =>
      document.querySelector("algolia-chat").shadowRoot.querySelector("#acs-compare-panel")?.textContent?.includes("LEFT A1 PRODUCTION")
    );

    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      window.__publishCompareReadyTurn(left, "a2", "left question two", 2);
    });
    await writeNextIdentityStream(page, "primary", "LEFT A2 PRIMARY");
    await writeNextIdentityStream(page, "production", "LEFT A2 PRODUCTION");
    await page.waitForFunction(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      const text = left.shadowRoot.querySelector("#acs-compare-panel")?.textContent || "";
      return text.includes("LEFT A1 PRODUCTION") && text.includes("LEFT A2 PRODUCTION");
    });

    await page.evaluate(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      window.__publishCompareReadyTurn(right, "b1", "right question one", 1);
    });
    await writeNextIdentityStream(page, "primary", "RIGHT B1 PRIMARY");
    await page.waitForFunction(() =>
      [...document.querySelectorAll("algolia-chat")][1].shadowRoot.querySelector("[data-algolia-answer-footer] #acs-compare-toggle")
    );
    await page.evaluate(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      right.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await writeNextIdentityStream(page, "production", "RIGHT B1 PRODUCTION");
    await page.waitForFunction(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      return right.shadowRoot.querySelector("#acs-compare-panel")?.textContent?.includes("RIGHT B1 PRODUCTION");
    });

    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      left.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await page.waitForFunction(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      const text = left.shadowRoot.querySelector("#acs-compare-panel")?.textContent || "";
      return text.includes("LEFT A1 PRODUCTION") && text.includes("LEFT A2 PRODUCTION");
    });

    const restored = await page.evaluate(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      const text = left.shadowRoot.querySelector("#acs-compare-panel")?.textContent || "";
      return {
        leftHasInset: Boolean(left.shadowRoot.querySelector("#acs-compare-style")),
        rightHasInset: Boolean(right.shadowRoot.querySelector("#acs-compare-style")),
        text,
        firstIndex: text.indexOf("LEFT A1 PRODUCTION"),
        secondIndex: text.indexOf("LEFT A2 PRODUCTION"),
      };
    });
    assert.equal(restored.leftHasInset, true);
    assert.equal(restored.rightHasInset, false);
    assert.ok(restored.firstIndex >= 0 && restored.secondIndex > restored.firstIndex, "A1 must render before A2 after A→B→A");
    assert.doesNotMatch(restored.text, /RIGHT B1 PRODUCTION/);
  } finally {
    await page.close();
  }
});

test("switching back restores completed Compare history before refetching an incomplete latest turn", async () => {
  const page = await createTwoWidgetPage({ loadCompare: true, loadTelemetry: true });
  try {
    await page.evaluate(() => {
      window.__identityManualStreams = true;
      window.__identityStreams = [];
      window.__pendingComparePrimaryTurns = [];
      window.__publishCompareReadyTurn = (widget, suffix, question, _attemptNumber) => {
        const widgetId = widget.__algoliaWidgetInstanceId;
        const messageId = `${widgetId}-${suffix}-message`;
        const conversationId = `${widgetId}-conversation`;
        const answerSegmentId = `${widgetId}-${suffix}-assistant`;
        const footer = document.createElement("div");
        footer.dataset.algoliaAnswerFooter = messageId;
        const usage = document.createElement("span");
        usage.className = "algolia-usage-pill";
        usage.textContent = "In 1 / 1 Out";
        footer.append(usage);
        widget.shadowRoot.querySelector('[part="chat-content"] .overflow-y-auto').append(footer);
        const payload = {
          id: conversationId,
          messages: [{ id: messageId, role: "user", parts: [{ type: "text", text: question }] }],
        };
        window.__pendingComparePrimaryTurns.push(
          window.__invokeIdentityTransport(payload, { widgetInstanceId: widgetId, answerSegmentId })
            .catch((error) => ({ error: String(error?.message || error) })),
        );
      };
      const [left] = document.querySelectorAll("algolia-chat");
      window.__publishCompareReadyTurn(left, "a1", "left question one", 1);
    });
    await writeNextIdentityStream(page, "primary", "LEFT A1 PRIMARY");
    await page.waitForFunction(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      return left.shadowRoot.querySelector("[data-algolia-answer-footer] #acs-compare-toggle");
    });

    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      left.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await writeNextIdentityStream(page, "production", "LEFT A1 PRODUCTION");
    await page.waitForFunction(() =>
      document.querySelector("algolia-chat").shadowRoot.querySelector("#acs-compare-panel")?.textContent?.includes("LEFT A1 PRODUCTION")
    );

    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      window.__publishCompareReadyTurn(left, "a2", "left question two", 2);
    });
    await writeNextIdentityStream(page, "primary", "LEFT A2 PRIMARY");
    await markNextIdentityStreamUsed(page, "production");
    await page.waitForFunction(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      const text = left.shadowRoot.querySelector("#acs-compare-panel")?.textContent || "";
      return text.includes("LEFT A1 PRODUCTION") && text.includes("Thinking");
    });

    await page.evaluate(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      window.__publishCompareReadyTurn(right, "b1", "right question one", 1);
    });
    await writeNextIdentityStream(page, "primary", "RIGHT B1 PRIMARY");
    await page.waitForFunction(() =>
      [...document.querySelectorAll("algolia-chat")][1].shadowRoot.querySelector("[data-algolia-answer-footer] #acs-compare-toggle")
    );
    await page.evaluate(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      right.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await writeNextIdentityStream(page, "production", "RIGHT B1 PRODUCTION");
    await page.waitForFunction(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      return right.shadowRoot.querySelector("#acs-compare-panel")?.textContent?.includes("RIGHT B1 PRODUCTION");
    });

    await page.evaluate(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      left.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await page.waitForFunction(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      const text = left.shadowRoot.querySelector("#acs-compare-panel")?.textContent || "";
      return text.includes("LEFT A1 PRODUCTION") && text.includes("Thinking");
    });
    await writeNextIdentityStream(page, "production", "LEFT A2 REFETCHED PRODUCTION");
    await page.waitForFunction(() => {
      const [left] = document.querySelectorAll("algolia-chat");
      const text = left.shadowRoot.querySelector("#acs-compare-panel")?.textContent || "";
      return text.includes("LEFT A1 PRODUCTION") && text.includes("LEFT A2 REFETCHED PRODUCTION");
    });

    const restored = await page.evaluate(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      const text = left.shadowRoot.querySelector("#acs-compare-panel")?.textContent || "";
      return {
        leftHasInset: Boolean(left.shadowRoot.querySelector("#acs-compare-style")),
        rightHasInset: Boolean(right.shadowRoot.querySelector("#acs-compare-style")),
        text,
        firstIndex: text.indexOf("LEFT A1 PRODUCTION"),
        secondIndex: text.indexOf("LEFT A2 REFETCHED PRODUCTION"),
      };
    });
    assert.equal(restored.leftHasInset, true);
    assert.equal(restored.rightHasInset, false);
    assert.ok(restored.firstIndex >= 0 && restored.secondIndex > restored.firstIndex, "A1 cache must render before the refetched A2 turn");
    assert.doesNotMatch(restored.text, /RIGHT B1 PRODUCTION/);
  } finally {
    await page.close();
  }
});

test("Compare fallback identity keys include top-level widgetInstanceId", async () => {
  const page = await createTwoWidgetPage({ loadCompare: true, loadTelemetry: true });
  try {
    await page.evaluate(() => {
      window.__identityManualStreams = true;
      window.__identityStreams = [];
      const [left, right] = document.querySelectorAll("algolia-chat");
      left.ask("left fallback visible answer");
      right.ask("right fallback visible answer");
    });
    await page.waitForFunction(() => window.__identityStreams?.length === 2);
    await page.evaluate(() => {
      window.__identityStreams.forEach((stream, index) => {
        const side = index === 0 ? "left" : "right";
        stream.write(`data: ${JSON.stringify({ type: "text-delta", delta: `${side} answer\n\nShort version: ${side} done.\n\nDetails.` })}\n\n`);
        stream.close();
      });
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("algolia-chat")].every((widget) =>
        widget.shadowRoot?.querySelector("[data-algolia-answer-footer] #acs-compare-toggle")
      )
    );

    await page.evaluate(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      const leftFooterId = left.shadowRoot.querySelector("[data-algolia-answer-footer]").dataset.algoliaAnswerFooter;
      const rightFooterId = right.shadowRoot.querySelector("[data-algolia-answer-footer]").dataset.algoliaAnswerFooter;
      window.__acsCompare.acceptPreparedTurn({
        turnKey: "same-fallback-turn-key",
        messageId: leftFooterId,
        question: "left fallback manual",
        body: JSON.stringify({ side: "left-fallback-body" }),
        widgetInstanceId: left.__algoliaWidgetInstanceId,
      });
      window.__acsCompare.acceptCompletedTurn({
        turnKey: "same-fallback-turn-key",
        messageId: leftFooterId,
        widgetInstanceId: left.__algoliaWidgetInstanceId,
      });
      window.__acsCompare.acceptPreparedTurn({
        turnKey: "same-fallback-turn-key",
        messageId: rightFooterId,
        question: "right fallback manual",
        body: JSON.stringify({ side: "right-fallback-body" }),
        widgetInstanceId: right.__algoliaWidgetInstanceId,
      });
      window.__acsCompare.acceptCompletedTurn({
        turnKey: "same-fallback-turn-key",
        messageId: rightFooterId,
        widgetInstanceId: right.__algoliaWidgetInstanceId,
      });
      window.__acsCompare.acceptPreparedTurn({
        turnKey: "missing-widget-turn",
        messageId: rightFooterId,
        question: "missing widget should not attach",
        body: JSON.stringify({ side: "missing-widget-body" }),
        answerIdentity: {
          widgetInstanceId: "missing-widget",
          conversationId: "missing-conversation",
          answerSegmentId: "missing-segment",
          networkAttemptId: "missing-attempt",
        },
      });
    });
    await page.waitForFunction(() => {
      const [left, right] = document.querySelectorAll("algolia-chat");
      return left.shadowRoot.querySelector("[data-algolia-answer-footer] #acs-compare-toggle") &&
        right.shadowRoot.querySelector("[data-algolia-answer-footer] #acs-compare-toggle");
    });

    const beforeClick = await page.evaluate(() => window.__identityFetches.length);
    await page.evaluate(() => {
      const [, right] = document.querySelectorAll("algolia-chat");
      right.shadowRoot.querySelector("#acs-compare-toggle").click();
    });
    await page.waitForFunction((count) => window.__identityFetches.length > count, beforeClick);

    const requestBody = await page.evaluate(() => window.__identityFetches.at(-1)?.body || "");
    assert.match(requestBody, /right-fallback-body/);
    assert.doesNotMatch(requestBody, /left-fallback-body/);
    assert.doesNotMatch(requestBody, /missing-widget-body/);
  } finally {
    await page.close();
  }
});

test("identity-less Compare events fail closed when multiple widgets are mounted", async () => {
  const page = await createTwoWidgetPage({ loadCompare: true });
  try {
    await page.evaluate(() => {
      window.__acsCompare.acceptPreparedTurn({
        body: JSON.stringify({ side: "ambiguous" }),
        turnKey: "ambiguous-conversation:user-1",
        messageId: "user-1",
        question: "ambiguous compare",
      });
      window.__acsCompare.acceptCompletedTurn({
        turnKey: "ambiguous-conversation:user-1",
        messageId: "user-1",
        question: "ambiguous compare",
      });
    });
    await page.waitForTimeout(50);

    const state = await page.evaluate(() => window.__acsCompare.state());
    assert.equal(state.hasPreparedTurn, false);
    assert.equal(state.completedTurns, 0);
  } finally {
    await page.close();
  }
});

test("completed browser answer without optional controls is explicit in canonical presentation", async () => {
  const page = await createTwoWidgetPage();
  try {
    await page.evaluate(() => {
      window.__identityManualStreams = true;
      window.__identityStreams = [];
      const [left] = document.querySelectorAll("algolia-chat");
      left.ask("no contributor terminal projection");
    });
    await page.waitForFunction(() => window.__identityStreams?.length === 1);

    await page.evaluate(() => {
      const answer = [
        "A no-source answer is like a receipt printer with no paper trail: the words may exist, but the evidence drawer is empty.",
        "",
        "Short version: this terminal answer deliberately has no source, telemetry, Compare, confidence, or discovery follow-up contribution.",
        "",
        "Details remain visible while the canonical presentation accounts for every missing post-answer slot.",
      ].join("\n");
      window.__identityStreams[0].write([
        `data: ${JSON.stringify({ type: "text-delta", delta: answer })}`,
        "",
      ].join("\n"));
      window.__identityStreams[0].close();
    });

    await page.waitForFunction(() =>
      window.algoliaAnswerHarness?.records?.().some((item) =>
        item.lifecycle === "complete" &&
        item.slots?.details?.status === "ready" &&
        /canonical presentation accounts/.test(item.slots.details.value)
      )
    );

    const state = await page.evaluate(() => {
      const root = document.querySelector("algolia-chat").shadowRoot;
      const record = window.algoliaAnswerHarness.records().find((item) =>
        item.lifecycle === "complete" &&
        item.slots?.details?.status === "ready" &&
        /canonical presentation accounts/.test(item.slots.details.value)
      );
      return {
        record: JSON.parse(JSON.stringify(record)),
        legacyHasSources: Boolean(root.querySelector(".acs-source-section")),
        legacyHasTelemetry: Boolean(root.querySelector(".algolia-usage-pill")),
        legacyHasCompare: Boolean(root.querySelector("#acs-compare-toggle")),
        legacyHasFollowUp: Boolean(root.querySelector(".acs-followup-card")),
      };
    });

    assert.equal(state.record.slots.sources.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
    assert.equal(state.record.slots.telemetry.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
    assert.equal(state.record.slots.actions.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
    assert.equal(state.record.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
    assert.equal(state.record.slots.followUp.status, ANSWER_SLOT_STATUS.EMPTY);

    const presentation = toAnswerPresentation(state.record);
    assert.equal(presentation.footer.sources.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
    assert.equal(presentation.footer.telemetry.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
    assert.equal(presentation.footer.actions.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
    assert.equal(presentation.footer.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
    assert.equal(presentation.footer.followUp.status, ANSWER_SLOT_STATUS.EMPTY);

    assert.equal(state.legacyHasSources, false, "legacy DOM currently omits unavailable source sections");
    assert.equal(state.legacyHasTelemetry, false, "legacy DOM currently omits unavailable telemetry");
    assert.equal(state.legacyHasCompare, false, "legacy DOM currently omits unavailable Compare");
    assert.equal(state.legacyHasFollowUp, false, "legacy DOM currently omits empty follow-up cards");
  } finally {
    await page.close();
  }
});
