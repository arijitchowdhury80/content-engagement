# Blog lessons, as rules

The Blog slice processed 2,800 records end to end and left 2,694 enriched in the index. These are
the failure classes it produced. Each one is now a mechanism, not a reminder.

1. **A live index can change mid-run.** Re-census before any write. `dry-run-write` refuses when
   the source count moved since `census-before.json`.
2. **Historical artifacts poison validation.** Validate ONE final artifact with explicit
   precedence, never a glob.
3. **A gate fixed in a dead path is no fix.** It happened twice. `run_gates()` is not ported;
   `pipeline.evaluate_selection` is the only live path and the tests drive it.
4. **Tests must hit the live path.** A refusal test that calls a helper proves the helper refuses.
   Every refusal test here enters through `algolia_enrich.main()` and asserts the exit code.
5. **Empty verification is a failure.** A verifier filtered on a non-faceted attribute, matched
   nothing, and reported success. Every validator raises on zero.
6. **A fetched page can be the wrong document.** Assert served URL == requested URL. 2 of 237
   case studies return HTTP 200 while redirecting.
7. **A shell-only page should not be forced.** Profile `shell_markers`.
8. **A page can be dead without a 404, and alive with a 301.** 1,655 Blog bodies returned 301 and
   ~1,600 of them were live articles. Liveness is decided by the body.
9. **Scout `/health` can be green while jobs cannot execute.** It reported healthy for three hours
   while unable to start a worker thread. `health-scout` runs a real job.
10. **Ask the service how fast to go.** Polling 40% faster than Scout's stated
    `retry_after_seconds` tripped the rate limit on 4,123 of 4,779 pages.
11. **Repair beats quarantine when the source text can fix it.** Repair recovered 310 of 349
    affected records. A bad span is a bad CUT, not a bad page.
12. **The judge is quality control, not grounding**, and a judge whose verdict does not change
    writability is not a gate.
13. **Large verification must paginate.** `hitsPerPage` alone silently caps at 1,000.
14. **Search settings are separate from write completion.** A slice can be perfectly enriched and
    not worth enabling in production settings.
15. **Reports are evidence, not runtime dependencies.**
16. **One canonicalisation.** Both grounding failures were two code paths normalising the same
    characters differently — the markdown-link branch skipped the fold and the
    space-before-punctuation rule the main loop applied. Idempotence is asserted directly.
17. **The prompt banned the sentence it asked for.** Period-less ledes marked `[FRAGMENT]` cost the
    reference family 18 of 50 pages while the instruction asked the abstract to lead with exactly
    that sentence. Print the literal model input before believing a prompt.
18. **A scale factor whose denominator came from the measurement.** A spread check divided by the
    position of the last selected span, so a tight selection high on the page got a huge
    multiplier; three consecutive sentences were rejected as "37,708 characters apart". Check a
    gate's arithmetic on one record before believing it.
19. **The English-only regex class.** An ASCII-only sentence-start lookahead never split an
    accented sentence. 65% of the next slice is de/fr. One defect found by reading means siblings
    that reading will not find — test the class, not the word.
