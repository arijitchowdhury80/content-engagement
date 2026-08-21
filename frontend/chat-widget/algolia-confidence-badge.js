(function () {
  "use strict";

  const CSS = `:host{display:inline-flex}.badge{display:inline-flex;width:fit-content;align-items:center;gap:6px;border-radius:var(--algolia-radius-full,9999px);border:1px solid;padding:4px 12px;font-size:var(--algolia-fs-xs,12px);font-weight:var(--algolia-fw-medium,500);font-family:var(--algolia-font-sans,system-ui,sans-serif);line-height:1.4;white-space:nowrap;box-sizing:border-box}.badge--muted{border-color:var(--algolia-border,#e0e0e0);background:var(--algolia-surface-2,#f0f0f0);color:var(--algolia-text-muted,#757575)}.badge--unavailable{opacity:.6}.badge--positive{border-color:var(--algolia-positive,#2e7d46);background:var(--algolia-positive-bg,#e6f4ea);color:var(--algolia-positive,#2e7d46)}.badge--notice{border-color:var(--algolia-notice,#a15c00);background:var(--algolia-notice-bg,#fbeedd);color:var(--algolia-notice,#a15c00)}.badge--negative{border-color:var(--algolia-negative,#b3261e);background:var(--algolia-negative-bg,#fbe9e7);color:var(--algolia-negative,#b3261e)}button.badge{appearance:none;background:none;cursor:pointer}button.badge:focus-visible{outline:2px solid var(--algolia-focus,#3a3a3a);outline-offset:2px}.badge__score{font-weight:var(--algolia-fw-bold,700)}.badge__denom{opacity:.7}.badge__flagged{margin-left:2px;border-left:1px solid currentColor;padding-left:6px}.badge__scoring{animation:badge-pulse 1.5s ease-in-out infinite}@media(prefers-reduced-motion:reduce){.badge__scoring{animation:none}}@keyframes badge-pulse{50%{opacity:.4}}`;
  const DEFAULTS = {
    label: "Confidence",
    scoreDenom: "/10",
    scoringStatus: "scoring...",
    scoringAriaLabel: "Confidence score in progress",
    scoredAriaLabel: "Confidence {score} out of 10. Open the judge breakdown.",
    scoredTitle: "Confidence {score}/10. Open the three-judge breakdown.",
    flaggedCount: "{count} to review",
    unavailableAriaLabel: "Confidence score unavailable: {reason}",
    unavailableTail: "unavailable",
    unavailableHint: "Agent Studio judging is unavailable.",
  };

  function interpolate(template, values) {
    return template.replace(/\{(\w+)\}/g, (_match, key) => key in values ? String(values[key]) : `{${key}}`);
  }

  function element(text, className) {
    const node = document.createElement("span");
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function tone(verdict) {
    if (verdict.groundingStatus === "unsupported") return "negative";
    if (verdict.groundingStatus === "needs_review" || verdict.groundingStatus === "disagreement" || verdict.provisional) return "notice";
    if (verdict.composite >= 7.5) return "positive";
    if (verdict.composite >= 5) return "notice";
    return "negative";
  }

  class AlgoliaConfidenceBadge extends HTMLElement {
    _verdict = null;
    _scoring = false;
    _shadow = null;
    _labels = { ...DEFAULTS };

    static get observedAttributes() { return ["verdict", "scoring", "labels"]; }
    get verdict() { return this._verdict; }
    set verdict(value) { this._verdict = value; this._render(); }
    get scoring() { return this._scoring; }
    set scoring(value) { this._scoring = value; this._render(); }
    get labels() { return this._labels; }
    set labels(value) { this._labels = { ...DEFAULTS, ...(value || {}) }; this._render(); }

    connectedCallback() {
      if (!this._shadow) {
        this._shadow = this.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = CSS;
        this._shadow.appendChild(style);
      }
      this._render();
    }

    attributeChangedCallback(name, _oldValue, value) {
      if (name === "verdict") {
        if (!value) this._verdict = null;
        else try { this._verdict = JSON.parse(value); } catch { this._verdict = null; }
      } else if (name === "scoring") {
        this._scoring = value !== null;
      } else if (name === "labels" && value) {
        try { this.labels = JSON.parse(value); } catch {}
      }
      this._render();
    }

    _renderScoring() {
      const judges = Array.isArray(this._verdict?.perJudge) ? this._verdict.perJudge : [];
      const completed = judges.filter((judge) => judge.state === "complete").length;
      const total = judges.length;
      const node = this._verdict?.panelPending ? document.createElement("button") : document.createElement("span");
      if (node.tagName === "BUTTON") node.type = "button";
      node.className = "badge badge--muted";
      node.setAttribute("aria-live", "polite");
      node.setAttribute("aria-label", this._labels.scoringAriaLabel);
      node.append(
        element(this._labels.label),
        element(total ? `${completed}/${total} judged` : this._labels.scoringStatus, "badge__scoring"),
      );
      if (node.tagName === "BUTTON") {
        node.addEventListener("click", () => this.dispatchEvent(new CustomEvent("open-judge", {
          detail: { verdict: this._verdict }, bubbles: true, composed: true,
        })));
      }
      return node;
    }

    _renderUnavailable(verdict) {
      const reason = verdict?.error || this._labels.unavailableHint;
      const node = element("", "badge badge--muted badge--unavailable");
      node.title = reason;
      node.setAttribute("aria-label", interpolate(this._labels.unavailableAriaLabel, { reason }));
      node.append(element(this._labels.label), element(this._labels.unavailableTail));
      return node;
    }

    _renderScored(verdict) {
      const score = verdict.composite.toFixed(1);
      const flagged = Array.isArray(verdict.flaggedClaims) ? verdict.flaggedClaims.length : 0;
      const node = document.createElement("button");
      node.type = "button";
      node.className = `badge badge--${tone(verdict)}`;
      node.title = interpolate(this._labels.scoredTitle, { score });
      node.setAttribute("aria-label", interpolate(this._labels.scoredAriaLabel, { score }));
      node.append(element(this._labels.label), element(score, "badge__score"), element(this._labels.scoreDenom, "badge__denom"));
      if (verdict.gateTripped && flagged) node.append(element(interpolate(this._labels.flaggedCount, { count: flagged }), "badge__flagged"));
      node.addEventListener("click", () => this.dispatchEvent(new CustomEvent("open-judge", {
        detail: { verdict }, bubbles: true, composed: true,
      })));
      return node;
    }

    _render() {
      if (!this._shadow) return;
      this._shadow.querySelector(".badge")?.remove();
      let node;
      if (this._scoring || this._verdict?.panelPending === true) node = this._renderScoring();
      else if (!this._verdict || this._verdict.error || !Number.isFinite(this._verdict.composite)) node = this._renderUnavailable(this._verdict);
      else node = this._renderScored(this._verdict);
      this._shadow.appendChild(node);
    }
  }

  if (!customElements.get("algolia-confidence-badge")) customElements.define("algolia-confidence-badge", AlgoliaConfidenceBadge);
})();
