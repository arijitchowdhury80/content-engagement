import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const chatPath = new URL("../algolia-chat.js", import.meta.url);
const themePath = new URL("../algolia-chat-theme-algolia.js", import.meta.url);
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
        window.__identityFetches.push({
          body: init.body,
          runtimeContext: runtimeContext || null,
        });
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
