# Deduplication dry run

_Index census re-derived from the live index, 2026-08-06 16:52 EDT._


## Census (live)

- records: **16967**
- distinct URLs: **12114**
- excess records: **4853**
- URLs appearing more than once: 2371
- copies per URL: `{1: 9743, 2: 1170, 3: 668, 4: 251, 5: 128, 6: 58, 7: 29, 8: 29, 9: 13, 10: 6, 11: 6, 12: 1, 13: 3, 14: 5, 15: 2, 21: 1, 38: 1}`
- environments: `{'prod20260722': 14394, 'nonprod20260220': 2133, 'prod20260621': 191, 'nonprod9': 130, 'prod03042026': 96, 'nonprod': 22, None: 1}`


## Plan

- survivors (post-dedupe record count): **12114**
- records to delete: **4853**
- ordinary duplicate groups: 1969
- chunk groups (reported separately, never merged in code): 402
- field rescues: **224**


## Rescues by field

| field | rescues |
|---|---|
| `tags` | 194 |
| `keywords` | 12 |
| `abstract` | 8 |
| `description` | 4 |
| `authors` | 3 |
| `category` | 2 |
| `thumbnail` | 1 |


## Rescue samples — REVIEW THESE BEFORE `--apply` (precondition P3)

"Longer is better" is a heuristic. If a rescued value turns out to be nav boilerplate rather than real content, the rule is wrong and must be inverted or narrowed before anything is deleted.


### `tags` — 194 rescues, showing 20

- `/customers/huckberry`
  - survivor: `'[]'`
  - rescued : `"['Search API']"`
- `/customers/kingarthur`
  - survivor: `'[]'`
  - rescued : `"['Personalization']"`
- `/de/customers/edx`
  - survivor: `'[]'`
  - rescued : `"['Personalization']"`
- `/de/resources/asset/ebook-algoliaelasticsearch`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-algoliaopensource`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-b2bimperative`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-b2bsearchaudit`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-boosting-fashion-shopper-engagement`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-build-marketplace-search`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-conscious-friction-in-ai`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-conversationalsearch`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-ctosguide`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-deliveringpersonalizedexperiences`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-designing-gen-ai-systems`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-evaluatinggenai`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-generative-ai-search`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-learn-how-to-optimize-ai-algorithms`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-merchandising-ai-era`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-optimizing-b2b-personalization`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`
- `/de/resources/asset/ebook-personalization-profiles`
  - survivor: `'[]'`
  - rescued : `"['Ebooks']"`

### `keywords` — 12 rescues, showing 12

- `/customers/ubisoft`
  - survivor: `'[]'`
  - rescued : `"['conversion rates', 'search']"`
- `/de/customers/edx`
  - survivor: `'[]'`
  - rescued : `"['search']"`
- `/de/resources/asset/ebook-generative-ai-search`
  - survivor: `'[]'`
  - rescued : `"['search']"`
- `/de/resources/asset/ebook-optimizing-b2b-personalization`
  - survivor: `'[]'`
  - rescued : `"['search']"`
- `/de/resources/asset/ebook-power-up-product-recommendations`
  - survivor: `'[]'`
  - rescued : `"['product']"`
- `/de/resources/asset/ebook-transforming-search-ai`
  - survivor: `'[]'`
  - rescued : `"['search']"`
- `/fr/customers/edx`
  - survivor: `'[]'`
  - rescued : `"['search']"`
- `/fr/resources/asset/ebook-generative-ai-search`
  - survivor: `'[]'`
  - rescued : `"['search']"`
- `/fr/resources/asset/ebook-optimizing-b2b-personalization`
  - survivor: `'[]'`
  - rescued : `"['search']"`
- `/fr/resources/asset/ebook-power-up-product-recommendations`
  - survivor: `'[]'`
  - rescued : `"['product']"`
- `/fr/resources/asset/ebook-transforming-search-ai`
  - survivor: `'[]'`
  - rescued : `"['search']"`
- `/fr/resources/asset/white-paper-what-to-know-when-implementing-rag-with-your-search-solution`
  - survivor: `'[]'`
  - rescued : `"['search']"`

### `abstract` — 8 rescues, showing 8

- `/doc/guides/building-search-ui/resources/demos/react`
  - survivor: `''`
  - rescued : `'This is the React InstantSearch v7 documentation. React InstantSearch v7 is the latest version of Re...'`
- `/doc/guides/building-search-ui/widgets/showcase/flutter`
  - survivor: `''`
  - rescued : `'This component handles search requests and manages search sessions.Represents a search operation sta...'`
- `/doc/tools/crawler/apis/configuration/app-id`
  - survivor: `''`
  - rescued : `'The ID of the application you want to store the crawler extractions in.We appreciate your feedback! ...'`
- `/doc/tools/crawler/apis/configuration/ignore-robots-txt-rules`
  - survivor: `''`
  - rescued : `'When set to true,  the crawler will ignore rules set in your robots.txt.We appreciate your feedback!...'`
- `/doc/tools/crawler/apis/configuration/save-backup`
  - survivor: `''`
  - rescued : `'Whether to save a backup of your production index before it is overwritten by the index generated du...'`
- `/doc/tools/crawler/apis/configuration/start-urls`
  - survivor: `''`
  - rescued : `'The crawler uses these URLs as entry points to start crawling.We appreciate your feedback! Please no...'`
- `/doc/tools/crawler/troubleshooting/error-messages`
  - survivor: `''`
  - rescued : `'Error messages and warnings generated by the Algolia Crawler.We appreciate your feedback! Please not...'`
- `https://academy.algolia.com/training/019559dc-a8ff-75d4-a873-8733c8997d79`
  - survivor: `'None'`
  - rescued : `'In this sprint, you will fine-tune your search relevance by configuring ranking, rules, synonyms, and AI-driven optimizations. By the end of this sprint, your s'`

### `description` — 4 rescues, showing 4

- `/doc/framework-integration/django/upgrade-guide`
  - survivor: `''`
  - rescued : `"Learn how to upgrade Algolia's Django integration from v1, v2 or v3 to v4."`
- `/doc/integration/salesforce-commerce-cloud-b2c/guides/performance-considerations`
  - survivor: `''`
  - rescued : `'Tips for increasing indexing performance'`
- `/doc/integration/salesforce-commerce-cloud-b2c/guides/storefront-sample-app`
  - survivor: `''`
  - rescued : `'Connect Algolia to your headless Salesforce B2C Commerce using the official sample app.'`
- `https://academy.algolia.com/training/019559dc-a8ff-75d4-a873-8733c8997d79`
  - survivor: `'None'`
  - rescued : `'In this sprint, you will fine-tune your search relevance by configuring ranking, rules, synonyms, and AI-driven optimizations. By the end of this sprint, your s'`

### `authors` — 3 rescues, showing 3

- `/blog/ecommerce/e-commerce-personalization-pitfalls-tradeoffs-solutions`
  - survivor: `'[]'`
  - rescued : `"[{'name': 'Eunice Lee', 'imgpath': '/sites/algolia-assets/files/blogs/authorimages/eunice-lee.jpeg'}, {'name': 'Matthew Foyle', 'imgpath': '/sites/algolia-asset"`
- `/blog/engineering/chat-meet-the-searchbox`
  - survivor: `'[]'`
  - rescued : `"[{'name': 'Chuck Meyer', 'imgpath': '/sites/algolia-assets/files/blogs/authorimages/Chuck_headshot_tj-29.jpg', 'desc': 'Sr Manager, Developer Relations'}]"`
- `/fr/blog/engineering/fast-on-the-highway-guardrails-and-limitations-for-fast-scalable-search`
  - survivor: `'[]'`
  - rescued : `"[{'name': 'Jia Lei', 'imgpath': '/sites/algolia-assets/files/blogs/authorimages/Jia-Lei', 'desc': 'Staff Product Manager'}]"`

### `category` — 2 rescues, showing 2

- `/fr/customers/decathlon-singapore`
  - survivor: `''`
  - rescued : `'B2C Ecommerce'`
- `/fr/customers/gymshark-headless`
  - survivor: `''`
  - rescued : `'B2C Ecommerce'`

### `thumbnail` — 1 rescues, showing 1

- `/fr/products/ai/agent-studio`
  - survivor: `''`
  - rescued : `'https://enriched-search-playwright-screenshots.s3.us-east-1.amazonaws.com/thumbnails/fr_29d292e2-818f-405b-a59f-b03b31178aa9_9_0.png'`
