/**
 * algolia-chat-compare.js — Compare-with-production companion.
 *
 * Adds a "Compare with production" toggle to the chat header. When enabled BEFORE
 * the first question, every question the visitor asks is also sent to the live
 * algolia.com Ask AI agent and rendered beside the concierge's own answer.
 *
 * Ownership boundaries (deliberate):
 *   - This module owns ONLY the production side. The concierge/left side keeps
 *     whatever agent and index the host page already configured on <algolia-chat>;
 *     nothing here reads, overrides or hardcodes it.
 *   - It does NOT modify algolia-chat.js and does NOT patch window.fetch.
 *     handoff-to-orchestrator.js owns the orchestrator transport through its own
 *     fetch interceptor; our requests target a different agent id, so that
 *     interceptor passes them through untouched.
 *   - Every production failure is contained: the concierge answer path is never
 *     touched, so a 403/429/500/malformed stream degrades only this column.
 *
 * Production endpoint, in priority order:
 *   1. window.ACS_COMPARE.prod = { appId, apiKey, agentId }  → direct call.
 *      Used where the page origin is on the agent's approved-domains list
 *      (the Jahia surface is).
 *   2. window.ACS_COMPARE.prod = { proxyPath: "/__compare/production" } → POST to
 *      the local parity server, which holds the key and injects the Origin.
 *   3. No config → disabled; the toggle never appears.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- config ---
  const CFG = (typeof window !== "undefined" && window.ACS_COMPARE) || {};
  const PROD = CFG.prod || null;
  const DEBUG = new URLSearchParams(location.search).get("algoliaCompareDebug") === "1";
  const log = (...a) => { if (DEBUG) console.log("[compare]", ...a); };

  function prodEndpoint() {
    if (!PROD) return null;
    if (PROD.appId && PROD.agentId) {
      return {
        url: `https://${PROD.appId}.algolia.net/agent-studio/1/agents/${PROD.agentId}/completions?stream=true&compatibilityMode=ai-sdk-5`,
        headers: {
          "content-type": "application/json",
          "x-algolia-application-id": PROD.appId,
          "x-algolia-api-key": PROD.apiKey || "",
        },
      };
    }
    if (PROD.proxyPath) {
      return { url: PROD.proxyPath, headers: { "content-type": "application/json" } };
    }
    return null;
  }
  const ENDPOINT_OK = !!prodEndpoint();

  // ------------------------------------------------------- widget accessors ---
  const host = () => document.querySelector("algolia-chat");
  const sroot = () => host()?.shadowRoot || null;
  const q = (sel) => sroot()?.querySelector(sel) || null;
  const userBubbles = () => sroot()?.querySelectorAll('[part="message-user-bubble"]') || [];

  // "Expanded" = the panel fills most of the viewport. The widget has three size
  // modes (docked / normal / maximized) and the expand control goes docked→normal,
  // a large CENTERED card — so a strict "maximized" check would miss it.
  function isExpanded() {
    const p = q('[part="panel"]');
    if (!p) return false;
    return p.getBoundingClientRect().width >= window.innerWidth * 0.6;
  }

  // ------------------------------------------------------------ turn state ---
  let compareOn = false;
  let locked = false;          // fixed for the conversation once a question is asked
  const seenBubbles = new WeakSet();
  let lastUserCount = 0;

  let convId = crypto.randomUUID();
  let history = [];            // [{ id, role, parts }]
  let generation = 0;          // bumped on reset; older generations are discarded
  let queue = Promise.resolve(); // production turns run strictly in order
  let activeController = null;

  function resetConversation(reason) {
    generation += 1;
    try { activeController?.abort(); } catch { /* already settled */ }
    activeController = null;
    queue = Promise.resolve();
    history = [];
    convId = crypto.randomUUID();
    locked = false;
    clearLog();
    log("reset:", reason, "gen", generation);
  }

  // --------------------------------------------------------- SSE + sources ---
  const BASE = "https://www.algolia.com";

  // Only http/https survive. Returns an absolute href string or null.
  function safeHref(raw) {
    if (typeof raw !== "string" || !raw) return null;
    let u;
    try { u = new URL(raw, BASE); } catch { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  }

  function harvestSources(obj, into) {
    const visit = (v) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach(visit);
      const href = safeHref(v.url);
      if (href) {
        const key = href.split("#")[0];
        if (!into.some((s) => s.url === key)) {
          into.push({ url: key, title: typeof v.title === "string" ? v.title : key });
        }
      }
      Object.values(v).forEach(visit);
    };
    visit(obj);
  }

  async function askProd(messages, signal, onUpdate) {
    const ep = prodEndpoint();
    if (!ep) throw new Error("Compare is not configured.");
    const res = await fetch(ep.url, {
      method: "POST", headers: ep.headers, signal,
      body: JSON.stringify({ id: convId, messages, trigger: "user" }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Production returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
    }
    if (!res.body) throw new Error("Production returned no stream.");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", out = "";
    const sources = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        let o;
        try { o = JSON.parse(line.slice(5).trim()); } catch { continue; } // tolerate partial frames
        if (o.type === "text-delta") out += (o.delta ?? o.text ?? "");
        else if (o.type === "tool-output-available" || o.type === "data-tool-output-metadata") harvestSources(o, sources);
        onUpdate(out, sources);
      }
    }
    return { text: out, sources };
  }

  // ------------------------------------------------------------ turn queue ---
  function enqueueQuestion(text) {
    if (!text || !ENDPOINT_OK) return;
    const gen = generation;
    // Chain so turn two's history always contains turn one's answer.
    queue = queue.then(() => runTurn(text, gen)).catch((e) => log("turn swallowed", e));
  }

  async function runTurn(text, gen) {
    if (gen !== generation) return;                       // reset before we started
    const userMsg = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] };
    const messages = [...history, userMsg];
    const turn = appendTurn(text);
    renderTurn(turn, { status: "thinking" });
    const controller = new AbortController();
    activeController = controller;
    try {
      const r = await askProd(messages, controller.signal, (t, s) => {
        if (gen !== generation) return;
        renderTurn(turn, { status: "streaming", text: t, sources: s });
      });
      if (gen !== generation) return;                     // late response, discard
      history = [...messages, { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: r.text }] }];
      renderTurn(turn, { status: "done", text: r.text, sources: r.sources });
    } catch (e) {
      if (gen !== generation || e?.name === "AbortError") return;
      // Contained: production failed, the concierge column is unaffected.
      renderTurn(turn, { status: "error", text: e?.message || "Production request failed." });
    } finally {
      if (activeController === controller) activeController = null;
    }
  }

  function scanForNewQuestions() {
    const bubbles = userBubbles();
    // Deliberately NOT gated on isExpanded(): a question asked while the chat is
    // docked must still reach production, otherwise turn two would carry a
    // history that no longer matches the conversation on the left.
    if (!compareOn) return;
    bubbles.forEach((el) => {
      if (seenBubbles.has(el)) return;
      seenBubbles.add(el);
      if (!locked) {
        locked = true;                                    // fixed for this conversation
        // Repaint now: reconcile() paints the toggle before this runs, so without
        // this the disabled state would wait for an unrelated later mutation.
        const t = sroot()?.querySelector(`#${TOGGLE_ID}`);
        if (t) paintToggle(t);
      }
      enqueueQuestion((el.textContent || "").trim());
    });
  }

  // Mark everything already on screen as seen, so enabling never replays history.
  function absorbExistingBubbles() {
    userBubbles().forEach((el) => seenBubbles.add(el));
  }

  // --------------------------------------------------------- header toggle ---
  const TOGGLE_ID = "acs-compare-toggle";
  const TOGGLE_CSS = `
#${TOGGLE_ID}{
  all: unset;
  box-sizing: border-box;
  display: inline-flex !important;
  align-items: center; gap: 6px;
  width: auto !important; height: auto !important;
  min-width: 0 !important; min-height: 0 !important;
  flex: 0 0 auto !important;
  white-space: nowrap;
  font: 600 12px/1 system-ui, -apple-system, sans-serif;
  padding: 7px 13px !important;
  border-radius: 999px;
  border: 1px solid var(--algolia-border, #e1e4ec) !important;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
#${TOGGLE_ID}:focus-visible{
  outline: 2px solid var(--algolia-accent, #003DFF) !important;
  outline-offset: 2px !important;
}
#${TOGGLE_ID}[aria-pressed="false"]{ background: transparent !important; color: var(--algolia-text, #021046) !important; }
#${TOGGLE_ID}[aria-pressed="false"]:hover:not([aria-disabled="true"]){ background: var(--algolia-surface-2, #eef1f7) !important; }
#${TOGGLE_ID}[aria-pressed="true"]{ background: var(--algolia-accent, #003DFF) !important; color: #fff !important; border-color: transparent !important; }
#${TOGGLE_ID}[aria-disabled="true"]{ opacity: .55; cursor: default; }
@media (prefers-reduced-motion: reduce){ #${TOGGLE_ID}{ transition: none; } }`;

  function ensureToggleStyle() {
    const root = sroot();
    if (!root || root.querySelector("#acs-compare-toggle-style")) return;
    const st = document.createElement("style");
    st.id = "acs-compare-toggle-style";
    st.textContent = TOGGLE_CSS;
    root.appendChild(st);
  }

  function paintToggle(t) {
    t.textContent = compareOn ? "Comparing with production" : "Compare with production";
    t.setAttribute("aria-pressed", compareOn ? "true" : "false");
    if (locked) {
      t.setAttribute("aria-disabled", "true");
      t.title = "Compare is fixed for this conversation. Start a new chat to change it.";
    } else {
      t.removeAttribute("aria-disabled");
      t.title = "Send each question to the live algolia.com Ask AI as well";
    }
  }

  function ensureToggle() {
    if (!ENDPOINT_OK) return;                             // unconfigured → no UI
    const header = q('[part="header"]');
    const expanded = isExpanded();
    let toggle = sroot()?.querySelector(`#${TOGGLE_ID}`) || null;
    if (expanded && header && !toggle) {
      ensureToggleStyle();
      toggle = document.createElement("button");
      toggle.id = TOGGLE_ID;
      toggle.type = "button";
      paintToggle(toggle);
      // Mount as a DIRECT header child. The widget ships
      // `[part="header"] > div button { width/height: 28px !important }` for its
      // icon cluster; a text button placed inside that div gets squashed and no
      // inline style can beat !important.
      const cluster = header.lastElementChild;
      if (cluster) header.insertBefore(toggle, cluster);
      else header.appendChild(toggle);
      log("toggle mounted");
    } else if (!expanded && toggle) {
      toggle.remove();
    } else if (toggle) {
      paintToggle(toggle);
    }
  }

  // ------------------------------------------------------------- reconcile ---
  // Coalesce WITHOUT cancelling: the widget mutates continuously, and a
  // cancel-then-reschedule loop starves the callback so it never runs.
  let pending = false;
  function reconcile() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      try {
        const expanded = isExpanded();
        // Collapsing only HIDES the production column. Clearing compareOn here
        // stranded the visitor: the choice is locked after turn one, so it could
        // never be switched back on for that conversation.
        // DOM fallback for reset: every user bubble disappeared.
        const count = userBubbles().length;
        if (count === 0 && lastUserCount > 0) resetConversation("dom");
        lastUserCount = count;
        ensureToggle();
        updatePanelVisibility(compareOn && expanded);
        scanForNewQuestions();
      } catch (e) {
        log("reconcile error (contained)", e);            // never break the widget
      }
    });
  }

  function attach() {
    const root = sroot();
    if (!root) return false;

    // Delegated: React re-renders the header and clones our button, which drops
    // per-node listeners and leaves a dead toggle behind.
    root.addEventListener("click", (e) => {
      const path = e.composedPath ? e.composedPath() : [];
      if (!path.some((n) => n && n.id === TOGGLE_ID)) return;
      if (locked) return;                                 // fixed for this conversation
      compareOn = !compareOn;
      if (compareOn) absorbExistingBubbles();             // never replay history
      reconcile();
    });

    new MutationObserver(reconcile).observe(root, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["style", "class", "part"],
    });
    window.addEventListener("resize", reconcile);

    // Primary reset signal, dispatched by algolia-engagement-tracker.js.
    document.addEventListener("algolia-visitor-state-reset", () => resetConversation("event"));

    reconcile();
    log("attached");
    return true;
  }

  (function waitForWidget(tries = 0) {
    if (!ENDPOINT_OK) return log("no production config; compare disabled");
    if (attach()) return;
    if (tries > 100) return log("gave up waiting for <algolia-chat>");
    setTimeout(() => waitForWidget(tries + 1), 100);
  })();

  // ------------------------------------------------------- production panel ---
  const SPLIT = 0.5;              // even 50/50 of the conversation area
  const STACK_BELOW = 720;        // px of chat width below which we stack
  let panel = null;

  function mount() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "acs-compare-panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Production Ask AI answer");
    Object.assign(panel.style, {
      position: "absolute", background: "#fff", boxShadow: "none",
      padding: "20px 24px", overflow: "auto", zIndex: "5",
      font: "15px/1.55 system-ui, sans-serif", color: "#021046",
      display: "none", boxSizing: "border-box",
    });
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:7px;margin-bottom:2px";
    const dot = document.createElement("span");
    dot.style.cssText = "width:7px;height:7px;border-radius:50%;background:#8a4fff;display:inline-block";
    const title = document.createElement("span");
    title.style.cssText = "font:700 11px system-ui;letter-spacing:.06em;text-transform:uppercase;color:#8a4fff";
    title.textContent = "Production · live Ask AI";
    head.append(dot, title);
    const sub = document.createElement("div");
    sub.style.cssText = "font-size:12px;color:#8b93a6;margin-bottom:16px";
    sub.textContent = "algolia.com";
    const logEl = document.createElement("div");
    logEl.id = "acs-compare-log";
    const empty = document.createElement("div");
    empty.id = "acs-compare-empty";
    empty.style.color = "#8b93a6";
    empty.textContent = "Ask a question below — it goes to both.";
    panel.append(head, sub, logEl, empty);
    return panel;
  }

  // Parent to the widget's own chat-content so the column lives INSIDE the
  // rounded container. chat-content is position:relative, so absolute offsets
  // anchor here. Re-parent if the host node is swapped.
  function ensureMounted() {
    const p = mount();
    const cc = q('[part="chat-content"]');
    if (cc && p.parentElement !== cc) cc.appendChild(p);
    return !!cc;
  }

  function positionPanel() {
    if (!ensureMounted()) return;
    const p = mount();
    const cc = q('[part="chat-content"]');
    const header = q('[part="header"]');
    const composer = q('[part="composer"]');
    const ccr = cc.getBoundingClientRect();
    const top = header ? Math.round(header.getBoundingClientRect().bottom - ccr.top) : 60;
    const bottomInset = composer
      ? Math.max(0, Math.round(ccr.bottom - composer.getBoundingClientRect().top))
      : 80;
    const stacked = ccr.width < STACK_BELOW;
    if (stacked) {
      // Narrow: production takes the lower half, full width.
      const usable = Math.max(0, ccr.height - top - bottomInset);
      Object.assign(p.style, {
        left: "0px", right: "0px", width: "auto",
        top: Math.round(top + usable * (1 - SPLIT)) + "px",
        bottom: bottomInset + "px", height: "auto",
        borderLeft: "none", borderTop: "1px solid #e6e8ef",
      });
    } else {
      Object.assign(p.style, {
        left: "auto", right: "0px", width: Math.round(SPLIT * 100) + "%",
        top: top + "px", bottom: bottomInset + "px", height: "auto",
        borderLeft: "1px solid #e6e8ef", borderTop: "none",
      });
    }
    setContentInset(true, stacked);
  }

  // Inset ONLY the messages scroller. Padding [part="chat-content"] would shrink
  // the header and the composer too, since it is the column that contains them.
  function setContentInset(active, stacked) {
    const root = sroot();
    if (!root) return;
    let style = root.querySelector("#acs-compare-style");
    if (!active) { style?.remove(); return; }
    if (!style) {
      style = document.createElement("style");
      style.id = "acs-compare-style";
      root.appendChild(style);
    }
    const pct = Math.round(SPLIT * 100);
    style.textContent = stacked
      ? `[part="chat-content"] .overflow-y-auto{ padding-bottom: calc(${pct}% + 20px) !important; }`
      : `[part="chat-content"] .overflow-y-auto{ padding-right: calc(${pct}% + 20px) !important; }`;
  }

  function updatePanelVisibility(show) {
    mount().style.display = show ? "block" : "none";
    if (show) positionPanel();
    else setContentInset(false, false);
  }

  // ------------------------------------------------------------- rendering ---
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Minimal markdown. Text is escaped first; links are rebuilt only when the URL
  // passes the http/https check, otherwise the label is emitted as plain text.
  function md(src) {
    let s = esc(src).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, rawUrl) => {
      const href = safeHref(rawUrl.replace(/&amp;/g, "&"));
      return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });
    return s.split(/\n{2,}/).map((p) => `<p style="margin:0 0 10px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  }

  function clearLog() {
    const l = mount().querySelector("#acs-compare-log");
    if (l) l.replaceChildren();
    const e = mount().querySelector("#acs-compare-empty");
    if (e) e.style.display = "";
  }

  function appendTurn(question) {
    const logEl = mount().querySelector("#acs-compare-log");
    mount().querySelector("#acs-compare-empty").style.display = "none";
    const turn = document.createElement("div");
    turn.style.cssText = "margin:0 0 20px;padding:0 0 18px;border-bottom:1px solid #f0f1f5";
    const qRow = document.createElement("div");
    qRow.style.cssText = "display:flex;justify-content:flex-end;margin-bottom:10px";
    const qBubble = document.createElement("div");
    qBubble.style.cssText = "background:#003DFF;color:#fff;font-size:13.5px;border-radius:14px 14px 4px 14px;padding:8px 12px;max-width:85%";
    qBubble.textContent = question;               // text node, never markup
    qRow.appendChild(qBubble);
    const answerEl = document.createElement("div");
    answerEl.style.color = "#021046";
    const srcEl = document.createElement("div");
    turn.append(qRow, answerEl, srcEl);
    logEl.appendChild(turn);
    const p = mount(); p.scrollTop = p.scrollHeight;
    return { answerEl, srcEl };
  }

  // Source chips are built with DOM properties — no URL is ever interpolated
  // into innerHTML.
  function renderSources(srcEl, sources) {
    srcEl.replaceChildren();
    if (!sources.length) return;
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-top:12px;border-top:1px solid #eef0f5;padding-top:10px";
    const lbl = document.createElement("div");
    lbl.style.cssText = "font-size:11px;text-transform:uppercase;color:#8b93a6;margin-bottom:6px";
    lbl.textContent = "Sources";
    wrap.appendChild(lbl);
    sources.slice(0, 6).forEach((s) => {
      const href = safeHref(s.url);
      if (!href) return;
      const a = document.createElement("a");
      a.href = href;                                       // property, not markup
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = href;
      a.textContent = s.title || href;
      a.style.cssText = "display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;font-size:12px;background:#eef1f7;border-radius:999px;padding:4px 10px;margin:0 6px 6px 0;color:#021046;text-decoration:none";
      wrap.appendChild(a);
    });
    srcEl.appendChild(wrap);
  }

  function renderTurn(turn, state) {
    if (!turn?.answerEl) return;
    if (state.status === "thinking") {
      turn.answerEl.replaceChildren();
      const s = document.createElement("span");
      s.style.color = "#8b93a6"; s.textContent = "Thinking…";
      turn.answerEl.appendChild(s);
      return;
    }
    if (state.status === "error") {
      turn.answerEl.replaceChildren();
      const s = document.createElement("span");
      s.style.color = "#b4232c";
      s.textContent = state.text;                          // text node
      turn.answerEl.appendChild(s);
      turn.srcEl.replaceChildren();
      return;
    }
    turn.answerEl.innerHTML = state.text ? md(state.text) : "";
    renderSources(turn.srcEl, state.sources || []);
    if (state.status === "streaming") { const p = mount(); p.scrollTop = p.scrollHeight; }
  }

  // Test seam: exposed only when explicitly requested by a test harness.
  if (CFG.exposeForTests) {
    window.__acsCompare = {
      safeHref, md,
      state: () => ({ compareOn, locked, generation, historyLength: history.length, convId }),
      reset: resetConversation,
    };
  }
})();
