# Blog quarantine repair — batches-out-blog-repair3

**Quality checks: ALL PASS.** **Recovery: 588 of 589, 1 still quarantined.**

Nothing has been written to Algolia. The accepted Blog outputs are untouched; this run lives entirely in its own directory.

## 1. Counts

| | |
|---|---|
| input records | 589 |
| output rows | 589 |
| distinct objectIDs | 589 |
| duplicates | 0 |
| recovered (PASS + JUDGE_REVISE) | **588** |
| still quarantined | **1** |

## 2. Status breakdown

| status | n |
|---|---:|
| PASS | 568 |
| JUDGE_REVISE | 20 |
| QUARANTINED_BY_GATE | 1 |

## 3. Grounding

- spans checked: **4825**
- found in the Scout body, canonical match: **4825**
- found byte-exact: 2134
- supported by the stored offsets: 4820
- **grounding failures: 0**

## 4. Leakage

- **leakage failures: 0**

## 5. Quality gate, re-run over the stored bytes

No record carries any of the seven defects.

## 6. Still quarantined, by reason

| reason | occurrences |
|---|---:|
| INCOMPLETE_SPAN | 2 |

Each of these exhausted the retry ladder rather than failing on first refusal:

- `en_e601b487-b1c1-450e-b588-17c4e118c8ea_0_4` — https://www.algolia.com/blog/engineering/building-a-store-locator-in-react-using-algolia-mapbox-and-twilio-part-3
  - 3 writer calls, 205 candidates banned
  - abstract span 38 is incomplete and the page offers no grounded completion
  - abstract span 39 is incomplete and the page offers no grounded completion

## 7. What the repair actually did

| pre-selection pool action | candidates |
|---|---:|
| REVERSAL_EXTENDED | 1180 |
| EXCLUDED_SECTION | 613 |
| REVERSAL_UNREPAIRABLE | 480 |
| BLACKLIST | 308 |
| EXCLUDED_SECTION_EXTRA | 114 |
| SPEECH_QUOTE | 58 |
| EXTENSION_DUPLICATE_TITLE | 4 |

| writer calls per record | records |
|---|---:|
| 1 | 533 |
| 2 | 50 |
| 3 | 6 |

## 8. Before and after, 10 examples

### 1. `de_0338d957-adab-44ca-8aa6-d59fe4332362_0_1` — https://www.algolia.com/de/blog/algolia/algolia-ai-guidelines-for-candidates

**Before** — QUARANTINED_BY_GATE

> gate: G10 highlight span is followed by a reversal ('Do not submit AI-generated cod') -- selecting it inverts the meaning: "We're hiring you, not your language model."
> gate: G10 highlight span is followed by a reversal ('Do not rely on AI to impersona') -- selecting it inverts the meaning: 'If your work is AI-assisted, be transparent about it.'

**After** — PASS, 1 writer call(s)

> abstract: As AI becomes more integrated into how people write, code, and communicate, we want to share how we view its role in our hiring process. This guidance is designed to help candidates understand how AI use fits into our expectations across interviews, exercises, and communication. We value creativity, curiosity, and auth...

> highlight: Research & learning: It's fine to use AI to understand unfamiliar concepts, explore technologies, or provide clarity on subjects during your preparation.
> highlight: Don't submit AI-generated responses to interview or coding challenge questions as your own.

### 2. `de_051d9bcb-6e95-42fe-987c-349005d38fc9_0_9` — https://www.algolia.com/de/blog/ecommerce/groceryshop-2025-recap

**Before** — QUARANTINED_BY_GATE

> gate: G10 highlight span is followed by a reversal ('In fact, Felipe Alonso Valverd') -- selecting it inverts the meaning: "Algolia's feature your brands offer helps grocers promote ow"

**After** — PASS, 1 writer call(s)

> abstract: Groceryshop 2025 made one thing clear: grocery is no longer just about shelves and SKUs - it's about systems that think. Walmart shared how it's scaling AI through a middleware layer that powers two agents: "Sparky" for customers and "Widely" for developers - streamlining both experience and operations. Groceryshop 202...

> highlight: Colgate echoed the theme, using AI to synthesize consumer and trend data to guide new product innovation, turning insights into faster, smarter launches.
> highlight: Our Agent Studio makes it easy for grocers of any size to offer conversational, agent-powered shopping - like Walmart's - without needing Walmart's engineering ...

### 3. `de_059764c8-8d0d-4deb-8995-02cdb3700c72` — https://www.algolia.com/de/blog/product/5-voice-search-trends-to-look-out-for

**Before** — QUARANTINED_BY_GATE

> gate: G10 abstract span is followed by a reversal ('In fact, 71% of users would pr') -- selecting it inverts the meaning: 'And, this comfort with voice search means a change in search'
> gate: abstract span 1 names no subject: "But, as the dust has settled, we've seen much more modest gr"

**After** — PASS, 1 writer call(s)

> abstract: For years, people have made sweeping predictions about how voice search would soon outpace all other searches. Evidence shows voice and image search have not yet reached 50% of all searches. However, there is a lot of exciting research that shows how powerful voice search is and how users are integrating it into their ...

> highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products fas...
> highlight: And, this comfort with voice search means a change in search behavior. In fact, 71% of users would prefer to search through voice than use a keyboard.

### 4. `de_05ca9a29-d81b-42a1-b1ba-e6844c4ce150` — https://www.algolia.com/de/blog/ux/site-search-content-discovery

**Before** — QUARANTINED_BY_GATE

> gate: G10 abstract span is followed by a reversal ('In fact, content discovery is ') -- selecting it inverts the meaning: 'By enabling businesses to break through all of the noise, it'

**After** — PASS, 1 writer call(s)

> abstract: Content discovery acts as a bridge between site visitors and content, enabling those visitors to find new products, content, and services. Rather than driving more low-quality traffic to the site (much of which will result in an immediate bounce), content discovery helps you better convert the traffic you already have.

> highlight: The content discovery process should not be confused with content discovery networks, which are the advertisement platforms that allow businesses to promote the...
> highlight: Offering personalized experiences: Today, 63% of customers expect services and experiences to be personalized.

### 5. `de_06e44a27-a6d4-45be-8215-b0f8d3f0d7bf` — https://www.algolia.com/de/blog/ai/increase-basket-size-value-and-build-customer-loyalty-with-algolia-recommend-and-analytics

**Before** — QUARANTINED_BY_GATE

> gate: G10 abstract span is followed by a reversal ('But how does Algolia know what') -- selecting it inverts the meaning: "This is how Algolia Recommend increases your customers' bask"

**After** — PASS, 1 writer call(s)

> abstract: By capturing user behavior with Algolia Analytics, and feeding that data into Algolia Recommend, you can start offering meaningful recommendations to your customers that will increase their satisfaction and conversion rates. Recommend works by collecting user behavior (event-based analytics) and training models to disp...

> highlight: We've discovered that training your recommendations models during big shopping events such as Black Friday or Christmas Holidays will help you understand your s...
> highlight: In sum, whenever you want to capture an event, you need to (1) add a line of code that captures the information that your user is doing and (2) send it to Algol...

### 6. `de_07445b5a-e714-46f6-968c-085d84ba0ed7` — https://www.algolia.com/de/blog/ecommerce/the-next-frontier-of-ecommerce-ai

**Before** — QUARANTINED_BY_GATE

> gate: G10 abstract span is followed by a reversal ('This is not a distant vision. ') -- selecting it inverts the meaning: 'The future lies in discovery that feels less mechanical and '
> gate: G10 highlight span is followed by a reversal ('But more than that, we give yo') -- selecting it inverts the meaning: 'Algolia provides a modular, API-first platform that fits int'

**After** — PASS, 1 writer call(s)

> abstract: The future lies in discovery that feels less mechanical and more human… experiences that are intelligent, fluid, conversational, and, increasingly, agentic. This is not a distant vision. Discovery agents are not chatbots. With RAG-based discovery, we unite real-time search with curated, grounded responses-LLMs tethered...

> highlight: There is a discernible progression… From keyword search → to semantic search informed by natural language understanding → to the precision of vector search → to...
> highlight: Gartner frames this next leap as retrieval-augmented generation and agentic AI.

### 7. `de_094f22af-8f4c-4bd2-abbd-0207673774f1_0_9` — https://www.algolia.com/de/blog/engineering/ai-stylist-with-algolia-and-genai

**Before** — QUARANTINED_BY_GATE

> gate: G10 highlight span taken from excluded section 'Challenges and next steps': 'While building this demo, it cost around $40-50 in image gen'

**After** — PASS, 1 writer call(s)

> abstract: It started with a simple question: could AI help merchandisers design on-brand curations of outfits faster, without losing creative control? Behind the scenes, an AI agent looks at the selected item, interprets the style request, queries Algolia for relevant products, and then generates a visual image for the look.

> highlight: I realized I already had everything I needed - Algolia's AI Search and retrieval power, plus modern generative AI models all connected together by Agent Studio.
> highlight: It's not instant - image generation currently takes about a minute - but these models are improving fast.

### 8. `de_0ce87c3a-e623-45cf-9faa-1b59e54e8662` — https://www.algolia.com/de/blog/engineering/designing-a-developer-friendly-api-client-in-scala

**Before** — QUARANTINED_BY_GATE

> gate: G10 highlight span is followed by a reversal ('But there are two things to co') -- selecting it inverts the meaning: 'It seems as simple as we should just return Future[_].'

**After** — PASS, 1 writer call(s)

> abstract: The Algolia Scala API client is our 14th API client and was released earlier this year. Every time we develop a new Algolia API client, our main goal is to finish with something that strongly leverages the language's strengths and, at the same time, is easy to use and feels productive from the very first minute. These ...

> highlight: As we support 10+ languages, we need the documentation to be clear enough that someone can just jump in, regardless of the language.
> highlight: With this simple functionality, and with some clever choice of words, you can have a fluent API that looks like English sentences.

### 9. `de_0d061ea4-d59e-4b6e-9a5b-4148fe6d061c_0_1` — https://www.algolia.com/de/blog/product/site-search-index-strategy

**Before** — QUARANTINED_BY_GATE

> gate: G10 highlight span is followed by a reversal ('But when those pieces are in p') -- selecting it inverts the meaning: 'For this to work, you need enough traffic, a frontend sendin'

**After** — PASS, 1 writer call(s)

> abstract: Search is not just about finding which result best matches the query; it is about deciding which result best matches _the intent behind the query_. Grouping by intent gives you a foundation for separating content, ranking search results, and measuring success.

> highlight: One-size-fits-all search breaks down because it assumes there is one universally correct result order, when the "best" result depends on what the user is trying...
> highlight: Replicas are useful when the same content needs different ranking behavior.

### 10. `de_102a8734-2c0c-4170-bea8-df0d5c675320` — https://www.algolia.com/de/blog/ai/the-anatomy-of-high-performance-recommender-systems-part-2

**Before** — QUARANTINED_BY_GATE

> gate: G10 abstract spans span ~28003 characters of the original page (limit 20000) -- stitched from unrelated parts of the document

**After** — JUDGE_REVISE, 2 writer call(s)

> abstract: Items Dataset Export data from your in-house ecommerce platform, or from your CMS platforms like Shopify, Magento, or WooCommerce. Users Dataset Metadata about your users might include information such as age, gender, or loyalty membership, which can be important signals for recommender systems. Interactions Dataset Go...

> highlight: Include the product catalog (items) along with information such as price, SKU type, or availability.
> highlight: Another option is to export the product catalog in a CSV format from your Shopify, Magento or WooCommerce store.

## 9. Exact commands and tests run

```
# 1. build the batch set from the prior run's quarantined rows, reusing their cached
#    Scout bodies -- no re-fetch, so the source bytes are identical to the run that failed
python3 docs/70-enrichment/make_quarantine_batches.py \
    --status QUARANTINED_BY_GATE --tag repair3 --expect 589

# 2. enrich. --pilot writes NOTHING to Algolia.
python3 docs/70-enrichment/run_batches.py \
    --batches docs/70-enrichment/batches-blog-repair3 \
    --out     docs/70-enrichment/batches-out-blog-repair3 \
    --cache   docs/70-enrichment/cache-scout/blog-repair3-batches --workers 8

# 3. verify -- counts, grounding, leakage, and the seven-defect quality gate
python3 docs/70-enrichment/verify_repair_packet.py \
    --results batches-out-blog-repair3 \
    --cache   cache-scout/blog-repair3-batches --expect 589

# 4. independent second opinion, using the validator that predates this work
python3 docs/70-enrichment/validate_blog_outputs.py \
    --results batches-out-blog-repair3 \
    --cache   cache-scout/blog-repair3-batches

# 5. the test suite
python3 -m pytest docs/70-enrichment/tests -q
```

