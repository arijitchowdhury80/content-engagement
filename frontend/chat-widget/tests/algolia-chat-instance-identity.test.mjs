import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const chatPath = new URL("../algolia-chat.js", import.meta.url);
const themePath = new URL("../algolia-chat-theme-algolia.js", import.meta.url);
const trackerPath = new URL("../algolia-engagement-tracker.js", import.meta.url);
const handoffPath = new URL("../handoff-to-orchestrator.js", import.meta.url);

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

async function createTwoWidgetPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("**/*", async (route) => {
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
  await page.addScriptTag({ content: fs.readFileSync(themePath, "utf8") });
  await page.addScriptTag({ content: fs.readFileSync(chatPath, "utf8") });
  await page.addScriptTag({ content: fs.readFileSync(trackerPath, "utf8") });
  await page.evaluate(() => {
    window.__identityFetches = [];
    window.__identityHarnessEvents = [];
    window.algoliaAnswerHarness = {
      accept(event) {
        window.__identityHarnessEvents.push(JSON.parse(JSON.stringify(event)));
      },
    };
    window.algoliaContextCompiler = {
      compileTurnContext() {
        return { context_schema: "AlgoliaTurnContext.v1", current_page: "/identity-test" };
      },
      mergeTurnContext(existing = {}) {
        return { ...existing, context_schema: "AlgoliaTurnContext.v1", current_page: "/identity-test" };
      },
      fetchPrepared(_url, init, runtimeContext) {
        const record = {
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
          'data: {"type":"text-delta","delta":"Answer"}\n\n',
          { status: 200, headers: { "X-Conversation-Id": `conversation-${window.__identityFetches.length}` } },
        ));
      },
    };
  });
  await page.addScriptTag({ content: fs.readFileSync(handoffPath, "utf8") });
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
