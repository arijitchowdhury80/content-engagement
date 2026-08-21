(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AlgoliaJudgeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTRACT_VERSION = "algolia-judge-v3";
  const ROLES = Object.freeze(["skeptic", "referee", "advocate"]);
  const DIMENSIONS = Object.freeze(["grounding", "completeness", "depth", "relevance"]);
  const VERDICTS = new Set(["supported", "unverifiable", "contradicted"]);
  const MATERIALITIES = new Set(["minor", "material", "critical"]);
  const DEFAULT_MAX_INPUT_TOKENS = 96_000;
  const DEFAULT_OUTPUT_RESERVE_TOKENS = 8_000;

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isObject(value)) return value;
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
    return result;
  }

  function canonicalStringify(value) {
    return JSON.stringify(canonicalize(value));
  }

  async function sha256(value) {
    const text = typeof value === "string" ? value : canonicalStringify(value);
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    if (typeof require === "function") {
      return require("node:crypto").createHash("sha256").update(text).digest("hex");
    }
    throw new Error("SHA-256 is unavailable in this runtime");
  }

  function deepClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function nonWhitespaceSpan(text, start, end) {
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    return { start, end };
  }

  function fallbackSentenceSpans(line) {
    const spans = [];
    let start = 0;
    for (let index = 0; index < line.length; index += 1) {
      if (!".!?".includes(line[index])) continue;
      while (index + 1 < line.length && ".!?".includes(line[index + 1])) index += 1;
      if (index + 1 < line.length && !/\s/.test(line[index + 1])) continue;
      spans.push({ index: start, segment: line.slice(start, index + 1) });
      start = index + 1;
    }
    if (start < line.length) spans.push({ index: start, segment: line.slice(start) });
    return spans;
  }

  function sentenceSpans(text) {
    const spans = [];
    const linePattern = /[^\n]+/g;
    const segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter("en", { granularity: "sentence" })
      : null;
    let lineMatch;
    while ((lineMatch = linePattern.exec(text)) !== null) {
      const line = lineMatch[0];
      const segments = segmenter ? [...segmenter.segment(line)] : fallbackSentenceSpans(line);
      for (const segment of segments) {
        spans.push({ start: lineMatch.index + segment.index, end: lineMatch.index + segment.index + segment.segment.length });
      }
    }
    return spans;
  }

  function buildAnswerManifest(answer) {
    const text = String(answer || "");
    const units = [];
    let blockNumber = 0;
    const blockPattern = /(?:^|\n\s*\n)([\s\S]*?)(?=\n\s*\n|$)/g;
    let blockMatch;
    while ((blockMatch = blockPattern.exec(text)) !== null) {
      const raw = blockMatch[1];
      if (!raw || !raw.trim()) continue;
      const rawStart = blockMatch.index + blockMatch[0].indexOf(raw);
      blockNumber += 1;
      let unitNumber = 0;
      for (const unitSpan of sentenceSpans(raw)) {
        const span = nonWhitespaceSpan(raw, unitSpan.start, unitSpan.end);
        if (span.start === span.end) continue;
        unitNumber += 1;
        const start = rawStart + span.start;
        const end = rawStart + span.end;
        units.push({
          blockId: `B${blockNumber}`,
          sentenceId: `B${blockNumber}-S${unitNumber}`,
          start,
          end,
          text: text.slice(start, end),
        });
      }
      if (unitNumber === 0) {
        const span = nonWhitespaceSpan(raw, 0, raw.length);
        units.push({
          blockId: `B${blockNumber}`,
          sentenceId: `B${blockNumber}-S1`,
          start: rawStart + span.start,
          end: rawStart + span.end,
          text: raw.slice(span.start, span.end),
        });
      }
    }
    return { answer: text, units };
  }

  function escapeJsonPointer(value) {
    return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
  }

  function collectPassages(value, path, eventId, output) {
    if (typeof value === "string" && value.trim()) {
      output.push({
        evidencePassageId: `${eventId}:${path || "/"}`,
        eventId,
        fieldPath: path || "/",
        text: value,
      });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectPassages(item, `${path}/${index}`, eventId, output));
      return;
    }
    if (isObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        collectPassages(child, `${path}/${escapeJsonPointer(key)}`, eventId, output);
      }
    }
  }

  function normalizeEvidenceEvents(events) {
    const source = Array.isArray(events) ? events : [];
    if (source.length === 0) return [];
    const alreadyEvents = source.every((entry) => isObject(entry) && (entry.output !== undefined || entry.toolCallId));
    if (alreadyEvents) {
      return source.map((entry, index) => ({
        eventId: entry.eventId || `E${index + 1}`,
        toolCallId: entry.toolCallId || "",
        toolName: entry.toolName || "algolia_search_index",
        callIndex: Number.isInteger(entry.callIndex) ? entry.callIndex : index,
        input: deepClone(entry.input ?? null),
        output: deepClone(entry.output ?? null),
      }));
    }
    return [{
      eventId: "E1",
      toolCallId: "legacy-hits",
      toolName: "algolia_search_index",
      callIndex: 0,
      input: null,
      output: { hits: deepClone(source) },
    }];
  }

  function buildEvidencePacket(events) {
    const normalized = normalizeEvidenceEvents(events);
    const passages = [];
    for (const event of normalized) collectPassages(event.output, "/output", event.eventId, passages);
    const packet = {
      events: normalized,
      passageIndex: passages.map(({ evidencePassageId, eventId, fieldPath, text }) => ({ evidencePassageId, eventId, fieldPath, text })),
    };
    Object.defineProperty(packet, "passages", { value: passages, enumerable: false });
    return packet;
  }

  function estimateTokens(value) {
    return Math.ceil(canonicalStringify(value).length / 3);
  }

  function bindEvaluationIdentifiers(answerManifest, evidencePacket, binding) {
    const prefix = `J${binding}`;
    const units = answerManifest.map((unit) => ({
      ...unit,
      sentenceId: `${prefix}-${unit.sentenceId}`,
    }));
    const passages = evidencePacket.passages.map((passage) => ({
      ...passage,
      evidencePassageId: `${prefix}-${passage.evidencePassageId}`,
    }));
    const packet = {
      events: evidencePacket.events,
      passageIndex: passages.map(({ evidencePassageId, eventId, fieldPath, text }) => ({ evidencePassageId, eventId, fieldPath, text })),
    };
    Object.defineProperty(packet, "passages", { value: passages, enumerable: false });
    return { answerManifest: units, evidencePacket: packet };
  }

  async function createEvaluationPackage(input, options = {}) {
    const question = String(input.question || "").trim();
    const answer = String(input.answer || "").trim();
    const rawAnswerManifest = buildAnswerManifest(answer);
    const rawEvidencePacket = buildEvidencePacket(input.evidenceEvents ?? input.hits ?? []);
    const evidenceHash = await sha256(rawEvidencePacket.events);
    const questionHash = await sha256(question);
    const answerHash = await sha256(answer);
    const evaluationId = input.evaluationId || `judge-${questionHash.slice(0, 8)}-${answerHash.slice(0, 8)}-${evidenceHash.slice(0, 8)}`;
    const binding = `${questionHash.slice(0, 8)}${answerHash.slice(0, 8)}${evidenceHash.slice(0, 8)}`;
    const { answerManifest, evidencePacket } = bindEvaluationIdentifiers(rawAnswerManifest.units, rawEvidencePacket, binding);
    const packet = {
      contractVersion: CONTRACT_VERSION,
      evaluationId,
      question,
      questionHash,
      answer,
      answerHash,
      answerManifest,
      evidenceHash,
      evidencePacket,
    };
    const maxInputTokens = options.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
    const outputReserveTokens = options.outputReserveTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS;
    const estimatedInputTokens = estimateTokens(packet);
    return {
      ...packet,
      capacity: {
        estimatedInputTokens,
        maxInputTokens,
        outputReserveTokens,
        fits: estimatedInputTokens + outputReserveTokens <= maxInputTokens,
      },
    };
  }

  function validateJudgeAgents(agents) {
    const errors = [];
    const byRole = new Map;
    for (const agent of Array.isArray(agents) ? agents : []) {
      const role = String(agent?.role || "").toLowerCase();
      const id = String(agent?.id || "").trim();
      if (!ROLES.includes(role)) {
        errors.push(`unknown or missing judge role: ${role || "(none)"}`);
        continue;
      }
      if (!id) errors.push(`${role} judge has no agent id`);
      if (byRole.has(role)) errors.push(`duplicate judge role: ${role}`);
      byRole.set(role, { ...agent, role, id });
    }
    for (const role of ROLES) if (!byRole.has(role)) errors.push(`missing judge role: ${role}`);
    const ids = [...byRole.values()].map((agent) => agent.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) errors.push("judge agent ids must be distinct");
    if (Array.isArray(agents) && agents.some((agent) => !agent?.role)) errors.push("chief/default judge agents are not supported");
    return { ok: errors.length === 0, errors, byRole: Object.fromEntries(byRole) };
  }

  function scoreObject(value, errors) {
    const result = {};
    for (const dimension of DIMENSIONS) {
      const score = value?.[dimension];
      if (!Number.isInteger(score) || score < 1 || score > 10) {
        errors.push(`${dimension} must be an integer from 1 to 10`);
      } else result[dimension] = score;
    }
    return result;
  }

  function validateEvidenceRefs(ids, verdict, passages, errors, prefix) {
    const result = [];
    const list = Array.isArray(ids) ? ids : [];
    if ((verdict === "supported" || verdict === "contradicted") && list.length === 0) {
      errors.push(`${prefix} ${verdict} claim requires evidencePassageIds`);
    }
    if (verdict === "unverifiable" && list.length > 0) {
      errors.push(`${prefix} unverifiable claim must not contain evidencePassageIds`);
    }
    const seen = new Set;
    for (const [index, evidencePassageId] of list.entries()) {
      if (typeof evidencePassageId !== "string" || !evidencePassageId) {
        errors.push(`${prefix} evidencePassageIds[${index}] must be a non-empty string`);
        continue;
      }
      if (seen.has(evidencePassageId)) {
        errors.push(`${prefix} evidencePassageIds[${index}] is duplicated`);
        continue;
      }
      seen.add(evidencePassageId);
      const passage = passages.get(evidencePassageId);
      if (!passage) {
        errors.push(`${prefix} evidencePassageIds[${index}] is unknown`);
        continue;
      }
      result.push({
        evidencePassageId: passage.evidencePassageId,
        eventId: passage.eventId,
        fieldPath: passage.fieldPath,
        excerpt: passage.text,
        start: 0,
        end: passage.text.length,
      });
    }
    return result;
  }

  function validateJudgeReport(role, report, evaluation) {
    const errors = [];
    if (!ROLES.includes(role)) errors.push(`invalid judge role: ${role}`);
    if (!isObject(report)) return { ok: false, role, errors: ["judge report must be an object"] };
    const dimensionScores = scoreObject(report.dimensionScores, errors);
    const rationales = report.dimensionRationales;
    for (const dimension of DIMENSIONS) {
      if (typeof rationales?.[dimension] !== "string" || !rationales[dimension].trim()) {
        errors.push(`${dimension} rationale is required`);
      }
    }
    const expectedUnits = new Map(evaluation.answerManifest.map((unit) => [unit.sentenceId, unit]));
    const passages = new Map(evaluation.evidencePacket.passages.map((passage) => [passage.evidencePassageId, passage]));
    const seen = new Set;
    const assessments = [];
    const unresolved = [];
    for (const [assessmentIndex, assessment] of (Array.isArray(report.sentenceAssessments) ? report.sentenceAssessments : []).entries()) {
      const prefix = `sentenceAssessments[${assessmentIndex}]`;
      const sentenceId = assessment?.sentenceId;
      const unit = expectedUnits.get(sentenceId);
      if (!unit) {
        errors.push(`${prefix} has an unknown sentenceId`);
        continue;
      }
      if (seen.has(sentenceId)) errors.push(`${prefix} duplicates ${sentenceId}`);
      seen.add(sentenceId);
      const claims = Array.isArray(assessment.claims) ? assessment.claims : [];
      const classification = claims.length > 0 ? "factual" : "not_factual";
      const validatedClaims = [];
      for (const [claimIndex, claim] of claims.entries()) {
        const claimPrefix = `${prefix}.claims[${claimIndex}]`;
        let verdict = claim?.verdict;
        let evidencePassageIds = claim?.evidencePassageIds;
        let reason = claim?.reason;
        if ((verdict === "supported" || verdict === "contradicted") && (!Array.isArray(evidencePassageIds) || evidencePassageIds.length === 0)) {
          verdict = "unverifiable";
          evidencePassageIds = [];
          reason = `${String(reason || "").trim()} The judge supplied no evidence passage ID, so code conservatively treated this claim as unverifiable.`.trim();
        }
        if (!VERDICTS.has(verdict)) errors.push(`${claimPrefix} has invalid verdict`);
        if (!MATERIALITIES.has(claim?.materiality)) errors.push(`${claimPrefix} has invalid materiality`);
        if (typeof claim?.centralToAnswer !== "boolean") errors.push(`${claimPrefix} centralToAnswer must be boolean`);
        if (typeof reason !== "string" || !reason.trim()) errors.push(`${claimPrefix} reason is required`);
        const evidenceRefs = validateEvidenceRefs(evidencePassageIds, verdict, passages, errors, claimPrefix);
        const validated = {
          sentenceId,
          claimIndex,
          claimCount: claims.length,
          claim: unit.text,
          start: unit.start,
          end: unit.end,
          verdict,
          materiality: claim.materiality,
          centralToAnswer: claim.centralToAnswer,
          evidenceRefs,
          reason,
        };
        validatedClaims.push(validated);
        if (verdict === "unverifiable" || verdict === "contradicted") unresolved.push(validated);
      }
      assessments.push({ sentenceId, classification, claims: validatedClaims });
    }
    for (const sentenceId of expectedUnits.keys()) {
      if (!seen.has(sentenceId)) errors.push(`missing sentence assessment: ${sentenceId}`);
    }
    return {
      ok: errors.length === 0,
      role,
      errors,
      value: errors.length ? null : {
        role,
        dimensionScores,
        dimensionRationales: { ...rationales },
        sentenceAssessments: assessments,
        unresolved,
        summary: typeof report.summary === "string" ? report.summary : "",
      },
    };
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function mean(values) {
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  }

  function overlap(a, b) {
    if (a.sentenceId !== b.sentenceId) return false;
    if (a.claimIndex !== b.claimIndex) return false;
    if (a.claimCount !== b.claimCount) return false;
    return Math.max(a.start, b.start) < Math.min(a.end, b.end);
  }

  function findingCap(finding) {
    if (finding.verdict === "unverifiable") {
      if (finding.centralToAnswer || finding.materiality === "critical") return 3;
      if (finding.materiality === "material") return 6;
      return 10;
    }
    if (finding.verdict === "contradicted") {
      if (finding.centralToAnswer || finding.materiality === "critical") return 1;
      if (finding.materiality === "material") return 3;
      return 6;
    }
    return 10;
  }

  function groupFindings(reports) {
    const groups = [];
    for (const report of reports) {
      for (const finding of report.unresolved) {
        let group = groups.find((candidate) => overlap(candidate.anchor, finding));
        if (!group) {
          group = { anchor: finding, findings: [] };
          groups.push(group);
        }
        group.findings.push({ ...finding, role: report.role });
      }
    }
    return groups;
  }

  function consensusFinding(group, requiredVotes) {
    const byRole = new Map;
    for (const finding of group.findings) {
      const prior = byRole.get(finding.role);
      if (!prior || findingCap(finding) < findingCap(prior)) byRole.set(finding.role, finding);
    }
    const findings = [...byRole.values()];
    if (findings.length < requiredVotes) return null;
    const caps = findings.map(findingCap).sort((a, b) => a - b);
    const consensusCap = caps[requiredVotes - 1];
    const representative = findings.slice().sort((a, b) => findingCap(a) - findingCap(b))[requiredVotes - 1];
    return {
      claim: representative.claim,
      sentenceId: representative.sentenceId,
      claimIndex: representative.claimIndex,
      claimCount: representative.claimCount,
      start: Math.min(...findings.map((finding) => finding.start)),
      end: Math.max(...findings.map((finding) => finding.end)),
      verdict: representative.verdict,
      materiality: representative.materiality,
      centralToAnswer: findings.filter((finding) => finding.centralToAnswer).length >= requiredVotes,
      cap: consensusCap,
      judgeCount: findings.length,
      judges: findings.map((finding) => finding.role),
      reasons: findings.map((finding) => finding.reason),
      evidenceRefs: findings.flatMap((finding) => finding.evidenceRefs),
    };
  }

  function deterministicRationale(result) {
    if (result.status === "unavailable") return "Evaluation unavailable because fewer than two judges returned valid complete reports.";
    const participation = result.provisional ? `${result.validJudgeCount} of 3 judges returned valid reports, so this score is provisional.` : "All three judges returned valid complete reports.";
    if (result.groundingStatus === "grounded") return `${participation} No judge found an unresolved factual claim in the retrieved evidence.`;
    if (result.groundingStatus === "disagreement") return `${participation} At least one judge found an unresolved factual claim, but the panel did not reach gate consensus.`;
    return `${participation} The panel confirmed ${result.flaggedClaims.length} grounding finding${result.flaggedClaims.length === 1 ? "" : "s"}; the quality score was capped at ${result.appliedCap}.`;
  }

  function aggregateJudgeReports(reports, options = {}) {
    const valid = (Array.isArray(reports) ? reports : []).filter((report) => report?.ok && report.value).map((report) => report.value);
    const base = {
      contractVersion: CONTRACT_VERSION,
      validJudgeCount: valid.length,
      expectedJudgeCount: 3,
      provisional: valid.length === 2,
      errors: (Array.isArray(reports) ? reports : []).filter((report) => !report?.ok).flatMap((report) => report?.errors || ["invalid judge report"]),
    };
    if (valid.length < 2) {
      const unavailable = { ...base, status: "unavailable", groundingStatus: "unavailable", dims: null, qualityBase: null, composite: null, appliedCap: null, flaggedClaims: [], disagreements: [], perJudge: valid };
      unavailable.rationale = deterministicRationale(unavailable);
      return unavailable;
    }
    const dims = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, round1(mean(valid.map((report) => report.dimensionScores[dimension])))]));
    const qualityBase = round1(mean([dims.completeness, dims.depth, dims.relevance]));
    const groups = groupFindings(valid);
    const requiredVotes = 2;
    const flaggedClaims = groups.map((group) => consensusFinding(group, requiredVotes)).filter(Boolean);
    const disagreements = groups.filter((group) => !consensusFinding(group, requiredVotes)).map((group) => ({
      claim: group.anchor.claim,
      sentenceId: group.anchor.sentenceId,
      claimIndex: group.anchor.claimIndex,
      claimCount: group.anchor.claimCount,
      judges: [...new Set(group.findings.map((finding) => finding.role))],
      reasons: group.findings.map((finding) => finding.reason),
    }));
    let appliedCap = flaggedClaims.length ? Math.min(...flaggedClaims.map((finding) => finding.cap)) : 10;
    const minorConsensus = flaggedClaims.filter((finding) => finding.cap === 10);
    if (minorConsensus.length >= 3) appliedCap = Math.min(appliedCap, 6);
    const hasAnyConcern = groups.length > 0;
    let groundingStatus;
    if (valid.length === 3 && !hasAnyConcern) groundingStatus = "grounded";
    else if (flaggedClaims.some((finding) => finding.cap <= 3)) groundingStatus = "unsupported";
    else if (flaggedClaims.length > 0) groundingStatus = "needs_review";
    else groundingStatus = "disagreement";
    const composite = round1(Math.min(qualityBase, appliedCap));
    const result = {
      ...base,
      status: base.provisional ? "provisional" : "complete",
      groundingStatus,
      dims: { ...dims, coverage: dims.completeness },
      qualityBase,
      composite,
      appliedCap: appliedCap < 10 ? appliedCap : null,
      gateTripped: appliedCap < 10,
      flaggedClaims,
      disagreements,
      perJudge: valid.map((report) => ({ role: report.role, scores: report.dimensionScores, summary: report.summary })),
    };
    result.rationale = deterministicRationale(result);
    return result;
  }

  function buildJudgeInput(evaluation, role, attemptId, validationFeedback = []) {
    if (!ROLES.includes(role)) throw new Error(`Unknown judge role: ${role}`);
    const input = {
      evaluationId: evaluation.evaluationId,
      attemptId,
      cacheNonce: `${evaluation.evaluationId}:${role}:${attemptId}`,
      contractVersion: CONTRACT_VERSION,
      question: evaluation.question,
      answer: evaluation.answer,
      answerManifest: evaluation.answerManifest,
      evidenceHash: evaluation.evidenceHash,
      evidencePacket: evaluation.evidencePacket,
    };
    if (Array.isArray(validationFeedback) && validationFeedback.length > 0) {
      input.validationFeedback = validationFeedback.map((error) => String(error));
    }
    return input;
  }

  return Object.freeze({
    CONTRACT_VERSION,
    ROLES,
    DIMENSIONS,
    canonicalStringify,
    sha256,
    buildAnswerManifest,
    buildEvidencePacket,
    bindEvaluationIdentifiers,
    createEvaluationPackage,
    estimateTokens,
    validateJudgeAgents,
    validateJudgeReport,
    aggregateJudgeReports,
    buildJudgeInput,
  });
});
