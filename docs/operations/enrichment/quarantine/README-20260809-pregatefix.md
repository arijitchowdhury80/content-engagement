# Pre-gate-fix blog output — PRESERVED, NOT GATE EVIDENCE

Moved 2026-08-09/10. This is the first full blog enrichment run: 2,715 rows, all gates passed
EXCEPT the two defects found afterwards in the output itself.

  * 67 records with an abstract span that does not end a sentence (47 colon lead-ins,
    20 mid-sentence cuts, 3 dangling markdown links)
  * 114 records with a highlight span ending in a colon or carrying a dangling `[`

Both were fixed at the candidate layer and in `check_integrity`. The corpus was then re-run in
full rather than patched, because patching 79 of 97 batches would have left the output half
old-gates and half new-gates. Mixed provenance is the failure class this directory exists for.

Nothing here was written to Algolia. Kept for diff against the re-run, never deleted.
