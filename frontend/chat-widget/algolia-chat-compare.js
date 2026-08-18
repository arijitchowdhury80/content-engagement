/**
 * algolia-chat-compare.js — companion script (does NOT modify the widget bundle).
 *
 * Adds a "Compare with production" toggle to the widget header, shown ONLY when
 * the widget is expanded (the big "normal"/"maximized" states, not the small
 * docked panel). When on, every question the user sends is also dispatched to the
 * live algolia.com Ask AI via the /prod proxy and rendered beside the widget's
 * own answer.
 *
 * How it hooks the widget without touching the 490KB bundle:
 *   - <algolia-chat> shadow root is OPEN, so we can read/inject DOM.
 *   - "expanded" is detected by the PANEL width (≥60% of the viewport). The widget
 *     has three size modes — docked / normal / maximized — and the expand button
 *     goes docked→normal (a large CENTERED card with margins, not 100vw), so a
 *     strict "maximized" check misses it. Width is robust to the mode naming.
 *   - header      = element with part="header"  → we inject the toggle here.
 *   - the question = element with part="message-user-bubble" renders the exact
 *     user text; a MutationObserver reads it when it appears, so we never race the
 *     composer or need a (nonexistent) "sent" event.
 *   - the production panel is anchored to the PANEL's rectangle (not the viewport),
 *     so it aligns whether the widget is a centered card or full-bleed.
 *
 * Two ways to reach production, auto-selected:
 *   - Direct (no proxy): set window.ACS_COMPARE = { prod: { appId, apiKey, agentId } }
 *     before this script loads. Used where the page's origin is on production's
 *     approved-domains list — e.g. the Jahia dev site, which IS allowlisted, so no
 *     proxy, no Origin spoofing, no mixed content.
 *   - Proxy: with no config, POSTs to /prod (proxy.mjs injects the Origin). Used on
 *     the local harness where localhost is not an approved origin.
 */
(function () {
  "use strict";
  const seenBubbles = new WeakSet();
  let compareOn = false;

  // Production endpoint: direct if configured (approved origin), else the proxy.
  const PROD_CFG = (typeof window !== "undefined" && window.ACS_COMPARE && window.ACS_COMPARE.prod) || null;
  function prodEndpoint() {
    if (PROD_CFG && PROD_CFG.appId && PROD_CFG.agentId) {
      return {
        url: `https://${PROD_CFG.appId}.algolia.net/agent-studio/1/agents/${PROD_CFG.agentId}/completions?stream=true&compatibilityMode=ai-sdk-5`,
        headers: { "content-type": "application/json", "x-algolia-application-id": PROD_CFG.appId, "x-algolia-api-key": PROD_CFG.apiKey || "" },
      };
    }
    return { url: "/prod", headers: { "content-type": "application/json" } };
  }

  // Production conversation state. Agent Studio is stateless per request — the
  // client carries the thread: a STABLE conversation id plus the full message
  // history (prior user + assistant turns). Minting a fresh id with only the
  // current message each turn is exactly why production "forgot" everything.
  let convId = crypto.randomUUID();
  let history = []; // [{ id, role, parts }]
  let lastUserCount = 0;
  function newConversation() { convId = crypto.randomUUID(); history = []; }

  const log = (...a) => { if (new URLSearchParams(location.search).get("algoliaChatDebug") === "1") console.log("[compare]", ...a); };

  const host = () => document.querySelector("algolia-chat");
  const sroot = () => host()?.shadowRoot || null;
  const q = (sel) => sroot()?.querySelector(sel) || null;

  // "Expanded" = the panel fills most of the viewport (normal OR maximized),
  // as opposed to the small docked panel in the corner.
  function isExpanded() {
    const p = q('[part="panel"]');
    if (!p) return false;
    return p.getBoundingClientRect().width >= window.innerWidth * 0.6;
  }

  // ---- SSE parse + source harvest --------------------------------------------
  const BASE = "https://www.algolia.com";
  function harvestSources(obj, into) {
    const visit = (v) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach(visit);
      if (typeof v.url === "string" && (/^https?:/.test(v.url) || v.url.startsWith("/"))) {
        const abs = (v.url.startsWith("/") ? BASE + v.url : v.url).split("#")[0];
        if (!into.some((s) => s.url === abs)) into.push({ url: abs, title: v.title || v.name || abs });
      }
      Object.values(v).forEach(visit);
    };
    visit(obj);
  }
  async function askProd(messages, onUpdate) {
    const ep = prodEndpoint();
    const res = await fetch(ep.url, { method: "POST", headers: ep.headers,
      body: JSON.stringify({ id: convId, messages, trigger: "user" }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = "", out = ""; const sources = [];
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl; while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        let o; try { o = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (o.type === "text-delta") out += (o.delta ?? o.text ?? "");
        else if (o.type === "tool-output-available" || o.type === "data-tool-output-metadata") harvestSources(o, sources);
        onUpdate(out, sources);
      }
    }
    return { text: out, sources };
  }

  // ---- capture a user question and fan it to production (with memory) --------
  // The panel is a running LOG that mirrors the widget: each turn appends the
  // question + its production answer, so prior turns stay on screen instead of
  // being replaced (which read as "production reset every message").
  function handleQuestion(text) {
    if (!text) return;
    log("question →", text, "| turn", history.length / 2 + 1);
    const userMsg = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] };
    const messages = [...history, userMsg]; // full thread, stable convId
    const turn = appendTurn(text); // { answerEl, srcEl } — new block in the log
    renderTurn(turn, { status: "thinking" });
    askProd(messages, (t, s) => renderTurn(turn, { status: "streaming", text: t, sources: s }))
      .then((r) => {
        history = [...messages, { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: r.text }] }];
        renderTurn(turn, { status: "done", text: r.text, sources: r.sources });
      })
      .catch((e) => renderTurn(turn, { status: "error", text: e.message }));
  }
  function scanForNewQuestions() {
    if (!(compareOn && isExpanded())) return;
    sroot()?.querySelectorAll('[part="message-user-bubble"]').forEach((el) => {
      if (seenBubbles.has(el)) return;
      seenBubbles.add(el);
      handleQuestion((el.textContent || "").trim());
    });
  }

  // ---- header toggle ----------------------------------------------------------
  function findToggle() { return sroot()?.querySelector("#acs-compare-toggle") || null; }
  function styleToggle(t) {
    t.textContent = compareOn ? "Comparing with production ✓" : "Compare with production";
    t.dataset.on = compareOn ? "1" : "0"; // colours come from the stylesheet below
  }

  // The widget ships `[part="header"] > div button { width/min-width/height:28px
  // !important }` to size its icon cluster. A text button placed INSIDE that div
  // gets squashed to 28x28 and no inline style can win against !important. We
  // therefore mount the toggle as a direct header child (selector no longer
  // matches) and style it from this scoped sheet, injected once and never removed.
  const TOGGLE_CSS = `
#acs-compare-toggle{
  all: unset;
  box-sizing: border-box;
  display: inline-flex !important;
  align-items: center;
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
#acs-compare-toggle[data-on="0"]{
  background: transparent !important;
  color: var(--algolia-text, #021046) !important;
}
#acs-compare-toggle[data-on="0"]:hover{
  background: var(--algolia-surface-2, #eef1f7) !important;
}
#acs-compare-toggle[data-on="1"]{
  background: var(--algolia-accent, #003DFF) !important;
  color: #fff !important;
  border-color: transparent !important;
}`;
  function ensureToggleStyle() {
    const root = sroot(); if (!root) return;
    if (root.querySelector("#acs-compare-toggle-style")) return;
    const st = document.createElement("style");
    st.id = "acs-compare-toggle-style";
    st.textContent = TOGGLE_CSS;
    root.appendChild(st);
  }
  function ensureToggle() {
    const header = q('[part="header"]');
    const expanded = isExpanded();
    let toggle = findToggle();
    if (expanded && header && !toggle) {
      ensureToggleStyle();
      toggle = document.createElement("button");
      toggle.id = "acs-compare-toggle";
      toggle.type = "button";
      styleToggle(toggle);
      // NOTE: no per-node listener. React re-renders the header and clones our
      // button — markup survives, listeners do not, leaving a dead toggle that
      // findToggle() then happily reuses forever. Clicks are handled by the
      // delegated listener on the shadow root in attach() instead.
      // Place it just LEFT of the header's icon cluster (header's last child).
      // Sit just LEFT of the icon cluster as a HEADER child — putting it inside
      // the cluster subjects it to that cluster's icon-button sizing.
      const cluster = header.lastElementChild;
      if (cluster) header.insertBefore(toggle, cluster);
      else header.appendChild(toggle);
      log("toggle injected");
    } else if (!expanded && toggle) {
      toggle.remove();
    } else if (toggle) {
      styleToggle(toggle);
    }
  }

  // ---- reconcile on every shadow mutation / resize ---------------------------
  // Coalesce bursts WITHOUT cancelling: the widget mutates continuously (timers,
  // auto-engage, streaming), and a cancel-then-reschedule loop starves the callback
  // so it never runs. A pending flag guarantees the first scheduled pass executes.
  let pending = false;
  function reconcile() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const expanded = isExpanded();
      if (!expanded) compareOn = false;
      // Widget new-chat clears ALL bubbles → reset production thread + log too.
      // Only on a full clear (→0), never a transient count wobble during re-render.
      const users = sroot()?.querySelectorAll('[part="message-user-bubble"]').length || 0;
      if (users === 0 && lastUserCount > 0) { newConversation(); clearLog(); }
      lastUserCount = users;
      ensureToggle();
      updatePanelVisibility(compareOn && expanded);
      scanForNewQuestions();
    });
  }
  function attach() {
    const root = sroot();
    if (!root) return false;
    // Delegated click: survives React re-creating/cloning the toggle node.
    root.addEventListener("click", (e) => {
      const hit = (e.composedPath ? e.composedPath() : []).some((n) => n && n.id === "acs-compare-toggle");
      if (!hit) return;
      compareOn = !compareOn;
      reconcile();
      if (compareOn) scanForNewQuestions();
    });
    new MutationObserver(reconcile).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "part"] });
    window.addEventListener("resize", reconcile);
    reconcile();
    log("attached to shadow root");
    return true;
  }
  (function waitForWidget(tries = 0) {
    if (attach()) return;
    if (tries > 100) return log("gave up waiting for <algolia-chat> shadow root");
    setTimeout(() => waitForWidget(tries + 1), 100);
  })();

  // ---- production panel: right ~42% of the PANEL, below header, above composer -
  const PANEL_FRAC = 0.5; // even 50/50 split of the conversation area
  let panel = null;
  function mount() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "acs-compare-panel";
    // A flush interior column, not a floating card: white to match the widget,
    // a single hairline divider on the left, no shadow, no border-radius.
    Object.assign(panel.style, {
      position: "absolute", right: "0", background: "#fff",
      borderLeft: "1px solid #e6e8ef", boxShadow: "none",
      padding: "20px 24px", overflow: "auto", zIndex: "5",
      font: "15px/1.55 system-ui, sans-serif", color: "#021046", display: "none",
      boxSizing: "border-box",
    });
    panel.innerHTML =
      '<div style="display:flex;align-items:center;gap:7px;margin-bottom:2px">' +
        '<span style="width:7px;height:7px;border-radius:50%;background:#8a4fff;display:inline-block"></span>' +
        '<span style="font:700 11px system-ui;letter-spacing:.06em;text-transform:uppercase;color:#8a4fff">Production · live Ask AI</span></div>' +
      '<div style="font-size:12px;color:#8b93a6;margin-bottom:16px">algolia.com</div>' +
      '<div id="acs-compare-log"></div>' +
      '<div id="acs-compare-empty" style="color:#8b93a6">Ask a question below — it goes to both.</div>';
    return panel;
  }
  // Keep the column parented to the widget's own chat-content so it sits INSIDE
  // the rounded container and is clipped by it. chat-content is `relative`, so
  // absolute positioning anchors here. Re-parent if React swaps the node.
  function ensureMounted() {
    const p = mount();
    const cc = q('[part="chat-content"]');
    if (cc && p.parentElement !== cc) cc.appendChild(p);
    return !!cc;
  }
  // Anchor to the widget PANEL rect, so it aligns whether centered or full-bleed.
  // Offsets are relative to chat-content, so the header and the composer keep
  // their FULL width and only the conversation area shares space with us.
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
    Object.assign(p.style, {
      top: top + "px",
      bottom: bottomInset + "px",
      height: "auto",
      width: Math.round(PANEL_FRAC * 100) + "%",
    });
  }
  // Pad the widget's own conversation so its answer keeps the left region.
  function setContentInset(active) {
    const root = sroot(); if (!root) return;
    let style = root.querySelector("#acs-compare-style");
    if (active && !style) {
      style = document.createElement("style");
      style.id = "acs-compare-style";
      // Target the messages scroller only. Padding chat-content would shrink the
      // header and composer too, which is what made the panel look bolted on.
      style.textContent =
        `[part="chat-content"] .overflow-y-auto{ padding-right: calc(${Math.round(PANEL_FRAC * 100)}% + 20px) !important; }`;
      root.appendChild(style);
    } else if (!active && style) {
      style.remove();
    }
  }
  function updatePanelVisibility(show) {
    mount().style.display = show ? "block" : "none";
    setContentInset(show);
    if (show) positionPanel();
  }

  // ---- conversation LOG (mirrors the widget: turns stack, never replace) -----
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const md = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .split(/\n{2,}/).map((p) => `<p style="margin:0 0 10px">${p.replace(/\n/g, "<br>")}</p>`).join("");

  function clearLog() {
    const log = mount().querySelector("#acs-compare-log");
    if (log) log.innerHTML = "";
    const empty = mount().querySelector("#acs-compare-empty");
    if (empty) empty.style.display = "";
  }

  // Add a new turn block (question + empty answer) and return its answer/source nodes.
  function appendTurn(question) {
    const logEl = mount().querySelector("#acs-compare-log");
    mount().querySelector("#acs-compare-empty").style.display = "none";
    const turn = document.createElement("div");
    turn.style.cssText = "margin:0 0 20px;padding:0 0 18px;border-bottom:1px solid #f0f1f5";
    turn.innerHTML =
      '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">' +
        `<div style="background:#003DFF;color:#fff;font-size:13.5px;border-radius:14px 14px 4px 14px;padding:8px 12px;max-width:85%">${esc(question)}</div></div>` +
      '<div class="acs-a" style="color:#021046"></div>' +
      '<div class="acs-src"></div>';
    logEl.appendChild(turn);
    const p = mount(); p.scrollTop = p.scrollHeight;
    return { answerEl: turn.querySelector(".acs-a"), srcEl: turn.querySelector(".acs-src") };
  }

  function renderTurn(turn, state) {
    if (!turn?.answerEl) return;
    if (state.status === "thinking") { turn.answerEl.innerHTML = '<span style="color:#8b93a6">Thinking…</span>'; return; }
    if (state.status === "error") { turn.answerEl.innerHTML = `<span style="color:#b4232c">${esc(state.text)}</span>`; return; }
    turn.answerEl.innerHTML = state.text ? md(state.text) : "";
    const sources = state.sources || [];
    turn.srcEl.innerHTML = sources.length
      ? `<div style="margin-top:12px;border-top:1px solid #eef0f5;padding-top:10px"><div style="font-size:11px;text-transform:uppercase;color:#8b93a6;margin-bottom:6px">Sources</div>` +
        sources.slice(0, 6).map((s) => `<a href="${s.url}" target="_blank" rel="noopener" style="display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;font-size:12px;background:#eef1f7;border-radius:999px;padding:4px 10px;margin:0 6px 6px 0;color:#021046;text-decoration:none">${esc(s.title)}</a>`).join("") + `</div>`
      : "";
    // keep the newest turn in view while it streams
    if (state.status === "streaming") { const p = mount(); p.scrollTop = p.scrollHeight; }
  }
})();
