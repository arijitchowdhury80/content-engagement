---
chapter: 7
title: Documentation refresh — rebuilding a corpus that had gone stale
status: IN PROGRESS (fetch running 2026-08-12)
asana: "4.1.14 Enrich Documentation corpus, 4.1.3 URL liveness census, 4.1.1 taxonomy correctness"
---

# Chapter 7 — Documentation refresh

## The short version

Our search index held **4,337 Documentation records**. The real documentation website has about
**1,890 pages**. We were not holding duplicates by mistake — we were holding an accurate photograph
of a website that has since been rebuilt.

More than half our records pointed at web addresses that no longer work. We rebuilt the corpus from
what the site actually publishes today.

## What happened, in plain terms

We copied Algolia's documentation into our index on **21 July 2026**. On that day the site really
did have a separate page for every programming language — one page explaining `add-api-key` for
Java, another for Python, another for Swift, and so on for thirteen languages.

Algolia then rebuilt its documentation on a new platform (Mintlify) and **merged those thirteen
pages into one page with thirteen tabs**. The old web addresses now forward you to the new single
page.

Our records never changed, so today we hold thirteen records that all describe one page.

## How we know — two counts that agree

We measured this two completely different ways, and they landed within 1.6% of each other.

**Method one — follow every link.** We took all 4,337 stored addresses and asked the website what
happens at each one. They resolved to **1,921 distinct real pages**.

**Method two — ask the site what it has.** Algolia's documentation publishes a sitemap, which is a
list of every page it thinks exists. That file lists **1,890 pages**.

Two independent methods, ~1.6% apart. That is why we trusted the number enough to act on it.

| What we measured | Count |
|---|---:|
| Records in our index | 4,337 |
| Real pages behind them (by following links) | 1,921 |
| Real pages the site itself lists | 1,890 |
| Stored addresses still valid today | 1,869 |
| **Stored addresses that are wrong or dead** | **2,468 (57%)** |
| Addresses that are properly dead (404) | 108 |
| Live pages we never had at all | 14 |

The clearest single example: the site lists **394** pages under `/doc/libraries`. Our index held
**2,588**.

## Why this mattered enough to fix

Agent Studio answers questions by searching this index. When thirteen near-identical records all
match a question, they crowd out everything else and the answer is built from one page repeated
thirteen times instead of thirteen different sources.

A common suggestion is "just switch on de-duplication." That does not work here, and it is worth
saying why: Algolia's `distinct` setting removes records that share the *same* value in a chosen
field. These thirteen records have thirteen *different* web addresses. There is nothing for it to
match on. We confirmed this by measurement rather than argument — making every address fully
qualified changes the distinct count by exactly zero.

## What we built

We rebuilt each page's record from the live page, in one pass:

- **Web address** — the full `https://www.algolia.com/...` form. Every one of the 4,337 old records
  stored only a partial address like `/doc/glossary`.
- **Title** and **description** — taken word-for-word from the page itself.
- **Body text** — the page's actual content. Documentation records previously held between 0 and
  300 characters; the rebuilt ones average around **8,100**. This is the single biggest improvement
  for search quality, and it is not AI-generated — it is the page's own words.
- **Taxonomy tags** — worked out from the web address (explained below).

Anything the old record had that the refresh does not own is **kept, not replaced**.

## How the tagging works

There is no AI in this step. It is pattern matching on the web address.

A table of 100 rules is checked in order, and the first one that matches the address wins. A rule
either states the answer outright:

```
/doc/guides/ab-testing/...   →  page_type: doc-guide,  feature: ab-testing
```

or pulls the answer out of the address itself:

```
/doc/libraries/java/v4/methods/analytics/...  →  language_platform: java,  feature: analytics
```

Every value must come from an approved list — there are exactly 30 allowed values for `feature`,
48 for `page_type`.

Only the tags that make sense for a page get set. Documentation pages never get `industry`,
`solution` or `customer` tags: those belong to industry pages, use-case pages and customer stories.
Leaving them empty is correct, not a gap.

Because every tag comes from a rule, **the same rule run again on the same address must give the
same answer**. That is what makes the tagging checkable rather than a matter of opinion.

## Problems found while building this

Each of these was caught before anything was written to the live index. They are recorded because
the near-misses are more instructive than the successes.

**We were throwing away most of what Scout sent us.** Scout, the tool that fetches pages, returns
23 pieces of information per page. Our code read three of them and discarded the rest — including
the one holding the page's title and description. We then wrote code to dig the title out of the
page text, which failed on 852 of 882 pages because the page text does not contain it. The
information was never missing; we were not reading it. *Lesson: look at what a service actually
returns before writing code to work around what you assume it does not.*

**A rule was writing nonsense into the tags.** The rule for `/doc/api-reference/api-parameters/...`
pulled the last part of the address into the `feature` tag, producing values like `advancedSyntax`
and `distinct`. Those are the names of settings, not product features, and they are not in the
approved list. This was worse than leaving the tag empty: the merge step trusts a filled-in value,
so it would have **overwritten the correct tag on 90 records with a meaningless one**. Values
outside the approved list are now discarded.

**A full replace would have deleted good data.** Writing our rebuilt record over the old one would
have removed every field we did not rebuild — including `abstract`, which is filled in on 4,317
records and is one of the fields search actually looks at. Search quality would have dropped while
the job reported success. The rebuilt record is now merged over the old one instead of replacing
it, and a check fails the run if any field that had content ends up empty.

**Deleting the wrong list.** We planned to delete the records identified as stale. But the refresh
also cleans up malformed record IDs, and 8 records had IDs like `.../send-events/-0`. Writing the
clean ID without deleting the malformed one would have left 8 orphans — creating exactly the
duplication we were removing. The delete list is now worked out by comparing what is in the index
against what we are writing, which cannot miss them.

**Treating a blocked request as a dead page.** An early attempt to check all 11,928 addresses at
high speed tripped the website's bot protection. Nearly half the requests came back empty, and the
code recorded them as "page not found." It would have reported 3,580 dead Documentation pages
against a true figure of 108. Requests that never got an answer are now retried instead of
believed, and the check refuses to report at all if any address remains unresolved.

## Pages the site does not list

The sitemap is not complete. **44 pages** that our records forward to are live and working but
absent from it — `/doc/glossary` among them. We found these by following the links ourselves, and
included them.

This is why the page list is built from two sources rather than trusting the sitemap alone.

## What is honest about the result

- **Titles and web addresses**: verifiable. Taken from the page, word-for-word.
- **Descriptions**: verifiable as *present and word-for-word*. There is no way to check whether a
  description is *good*. A small number of pages genuinely have none; those are left empty and put
  on a review list rather than filled in with a guess.
- **Tags**: provably correct where a rule decided them, because the rule can be re-run and checked.
  Where no rule can decide, the tag is set to `unknown` — which the tagging contract explicitly
  allows on a required tag — and marked as unresolved so it can be found later. **16 tag values**
  across the corpus are in this state.
- **Body text**: the page's own words. No AI wrote or rewrote any of it.

## Numbers

Recorded at the point the fetch was running; final figures to be added on completion.

| Step | Result |
|---|---|
| Page list built | 1,934 addresses (1,876 from both sources, 44 sitemap-only, 14 found by following links) |
| Compared against index | keep 1,904 · add 30 · retire 2,433 |
| Retire reasons | 2,325 moved · 108 dead |
| Predicted final size | 1,934 Documentation records |
| Tag rule coverage | 1,934 / 1,934 addresses matched a rule |
| Tag violations after build | 0 |
| Addresses in full form | 1,934 / 1,934 |
| Tests | 364 passing |

## What was deliberately not done

- **No AI enrichment.** Documentation gets no generated summary or highlights. The bar is correct
  tags, title, description and the page's own text.
- **The body is stored but not yet searchable.** Adding it to the searchable fields would change
  how ranking behaves across the whole index and affects the live demo, so that is a separate
  decision.
- **Only Documentation.** The other seven content sets have not been checked for the same problem.
  Given what we found here, they should be.
