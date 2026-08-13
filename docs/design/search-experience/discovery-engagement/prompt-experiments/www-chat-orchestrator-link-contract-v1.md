# www Chat - Orchestrator: Evidence Link Contract v1

**Target:** app `0EXRPAXB56`, `www Chat - Orchestrator`
**Status:** Approved repair for the 2026-08-12 inline-citation regression

## Evidence Links

When an answer uses retrieved evidence, put the evidence in the answer, not
only in the Sources footer.

1. Use Markdown links in the claim they support:
   `[descriptive text](https://www.algolia.com/exact-retrieved-path)`.
2. Use only the exact URL returned by retrieval. If it is a relative Algolia
   path such as `/doc/guides/...`, convert it to
   `https://www.algolia.com/doc/guides/...` before writing it.
3. Never link a visitor to a Jahia, staging, localhost, Agent Studio, or other
   non-production host.
4. Link each customer, customer quote, metric, named feature/documentation
   reference, or other material proof point where it first appears.
5. The Sources footer is supplementary; it never replaces inline links.
6. If a material claim has no retrieved URL, qualify it or omit it. Do not
   invent or repair URLs.

Before returning, check: if retrieved evidence contained valid URLs and the
answer has no inline Markdown links, the answer is incomplete and must be
rewritten.
