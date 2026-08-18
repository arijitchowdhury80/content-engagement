// Local-only token-usage probe for the chat widget harness. Must load after
// window.__ALGOLIA_LOGS_API_KEY__ is set (see index.html) and before
// algolia-chat.js, so the fetch wrapper is in place before the widget makes
// its first completions call.
//
// Not part of any shipped bundle, not present in the Jahia embed. The usage
// pill is injected straight into <algolia-confidence-badge>'s open shadow
// root from here — algolia-confidence-badge.js itself is never touched,
// since it ships to production too.
(() => {
  // <algolia-chat> hasn't been parsed yet at this point in the document, so read
  // its app-id lazily (by the time a completions call happens, it's in the DOM).
  const getAppId = () => document.querySelector('algolia-chat')?.getAttribute('app-id');

  const usage = (window.__algoliaChatUsage = window.__algoliaChatUsage || {});
  const completionsRe = /\/agent-studio\/1\/agents\/([^/]+)\/completions/;
  const origFetch = window.fetch.bind(window);

  // Each visitor turn currently gets its own fresh Agent Studio conversation
  // (algolia-chat.js sends no conversation/message id to continue one), so a
  // conversation's own totals only ever cover one turn. Track every turn's
  // totals keyed by its conversation id and sum them for the running total
  // shown in the widget, rather than letting each fetch overwrite the last.
  const turnTotals = new Map();

  function recomputeCumulative() {
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    for (const t of turnTotals.values()) {
      inputTokens += t.inputTokens || 0;
      outputTokens += t.outputTokens || 0;
      totalTokens += t.totalTokens || 0;
    }
    usage.usage = { inputTokens, outputTokens, totalTokens: totalTokens || null, turns: turnTotals.size };
    window.dispatchEvent(new CustomEvent('algolia-usage-updated', { detail: usage }));
  }

  function resetUsage() {
    turnTotals.clear();
    usage.usage = null;
    usage.conversationId = null;
    console.log('[token-usage probe] conversation reset — cleared running token total');
  }

  // Agent Studio finalizes totalInputTokens/totalOutputTokens only after the
  // turn finishes generating, and persists them shortly after that — not the
  // instant the completions response headers arrive. Retry a few times with
  // a short backoff before giving up, rather than trusting the first read.
  const USAGE_MAX_ATTEMPTS = 3;
  const USAGE_RETRY_DELAY_MS = 2000;

  async function fetchUsage(agentId, conversationId, attempt = 0) {
    if (!window.__ALGOLIA_LOGS_API_KEY__ || window.__ALGOLIA_LOGS_API_KEY__.startsWith('REPLACE_')) {
      console.warn('[token-usage probe] set window.__ALGOLIA_LOGS_API_KEY__ in index.html to fetch usage');
      return;
    }
    try {
      const appId = getAppId();
      const res = await origFetch(
        `https://${appId}.algolia.net/agent-studio/1/agents/${agentId}/conversations/${conversationId}`,
        {
          headers: {
            'X-Algolia-Application-Id': appId,
            'X-Algolia-API-Key': window.__ALGOLIA_LOGS_API_KEY__,
          },
        }
      );
      if (!res.ok) {
        console.warn('[token-usage probe] conversation fetch failed', res.status);
        return;
      }
      const data = await res.json();
      // ConversationFullResponse carries totals at the top level, not under
      // a nested "usage"/"totals" key.
      const inputTokens = data.totalInputTokens ?? null;
      const outputTokens = data.totalOutputTokens ?? null;
      const totalTokens = data.totalTokens ?? ((inputTokens ?? 0) + (outputTokens ?? 0));
      if (!totalTokens && attempt < USAGE_MAX_ATTEMPTS - 1) {
        console.warn(`[token-usage probe] totals still 0, retrying (${attempt + 1}/${USAGE_MAX_ATTEMPTS - 1})`);
        setTimeout(() => fetchUsage(agentId, conversationId, attempt + 1), USAGE_RETRY_DELAY_MS);
        return;
      }
      if (!totalTokens) {
        console.warn(`[token-usage probe] gave up after ${USAGE_MAX_ATTEMPTS} attempts, totals never showed up for`, conversationId);
      }
      turnTotals.set(conversationId, { inputTokens, outputTokens, totalTokens: totalTokens || null });
      recomputeCumulative();
    } catch (err) {
      console.warn('[token-usage probe] conversation fetch error', err);
    }
  }

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const match = url.match(completionsRe);
    const response = await origFetch(input, init);
    if (match && response.body) {
      const agentId = match[1];
      const conversationId = response.headers.get('X-Conversation-Id');
      if (!conversationId) {
        console.warn('[token-usage probe] no X-Conversation-Id on completions response');
        return response;
      }
      // Drain a clone of the stream in the background — don't touch the
      // original body the widget is about to read — and only ask for usage
      // once the answer has actually finished generating.
      const drain = response.clone().body.getReader();
      (async () => {
        try {
          while (!(await drain.read()).done) {}
        } catch (err) {
          console.warn('[token-usage probe] stream drain error', err);
        }
        fetchUsage(agentId, conversationId);
      })();
    }
    return response;
  };

  // --- Usage pill rendering -------------------------------------------
  // <algolia-confidence-badge> uses an open shadow root, so the pill can be
  // inserted from here without touching that shipped file (it ships to the
  // production Jahia embed too; this script never runs there). Only the
  // most recent badge tracks the live running total — once a newer turn's
  // badge appears, earlier badges are never touched again and keep
  // whatever total they last showed.
  const PILL_CLASS = 'algolia-usage-pill';
  const PILL_STYLE_ID = 'algolia-usage-pill-style';
  const pillStyleCSS = `.${PILL_CLASS}{display:inline-flex;align-items:center;width:fit-content;margin-right:6px;border-radius:var(--algolia-radius-full, 9999px);border:1px solid var(--algolia-border, #e0e0e0);background-color:var(--algolia-surface-2, #f0f0f0);color:var(--algolia-text-muted, #757575);padding:4px 12px;font-size:var(--algolia-fs-xs, 12px);font-weight:var(--algolia-fw-medium, 500);font-family:var(--algolia-font-sans, system-ui, sans-serif);line-height:1.4;white-space:nowrap;box-sizing:border-box}`;

  function renderPillInto(badgeEl) {
    const root = badgeEl.shadowRoot;
    const u = usage.usage;
    let pill = root?.querySelector(`.${PILL_CLASS}`);
    if (!root || !u) {
      pill?.remove();
      return;
    }
    if (!root.querySelector(`#${PILL_STYLE_ID}`)) {
      const styleEl = document.createElement('style');
      styleEl.id = PILL_STYLE_ID;
      styleEl.textContent = pillStyleCSS;
      root.prepend(styleEl);
    }
    if (!pill) {
      pill = document.createElement('span');
      pill.className = PILL_CLASS;
      const verdictBadge = root.querySelector('.badge');
      verdictBadge ? root.insertBefore(pill, verdictBadge) : root.appendChild(pill);
    }
    const detail = u.inputTokens != null && u.outputTokens != null
      ? `Input ${u.inputTokens} / Output ${u.outputTokens} tokens`
      : 'Token breakdown unavailable';
    const turnsNote = u.turns ? ` across ${u.turns} turn${u.turns === 1 ? '' : 's'}` : '';
    pill.textContent = u.totalTokens != null ? `${u.totalTokens} tokens` : 'tokens: —';
    pill.title = `${detail} — reported by Agent Studio, summed${turnsNote} (local dev only)`;
  }

  function renderLatestPill(shadowRoot) {
    const badges = shadowRoot.querySelectorAll('algolia-confidence-badge');
    const latest = badges[badges.length - 1];
    if (latest) renderPillInto(latest);
  }

  function whenChatShadowReady(cb) {
    const tryNow = () => {
      const chatEl = document.querySelector('algolia-chat');
      if (chatEl?.shadowRoot) {
        cb(chatEl.shadowRoot);
        return true;
      }
      return false;
    };
    if (tryNow()) return;
    const iv = setInterval(() => tryNow() && clearInterval(iv), 300);
  }

  whenChatShadowReady((shadowRoot) => {
    new MutationObserver(() => renderLatestPill(shadowRoot)).observe(shadowRoot, { childList: true, subtree: true });
    renderLatestPill(shadowRoot);

    // The widget's own "New conversation" button and the header/logo "reset
    // conversation" control both clear the visible transcript, but nothing
    // tells this page's independent token tally about it. Listen in the
    // capture phase so a stopPropagation() inside the widget can't hide the
    // click from us, and match on aria-label since that's the one thing
    // gi()'s button always sets (see algolia-chat.js's `newChatAria` /
    // `resetAria` strings) regardless of visible text or brand name.
    shadowRoot.addEventListener(
      'click',
      (e) => {
        const resetBtn = e.target.closest?.(
          '[aria-label="Start a new conversation"], [aria-label$="reset conversation"]'
        );
        if (resetBtn) resetUsage();
      },
      true
    );
  });

  window.addEventListener('algolia-usage-updated', () => {
    const chatEl = document.querySelector('algolia-chat');
    if (chatEl?.shadowRoot) renderLatestPill(chatEl.shadowRoot);
  });
})();
