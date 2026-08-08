# Pilot validation pack — 30 records

_Generated 2026-08-08 04:56 · writer `claude-sonnet` · judge `gemini-2.5-pro` (cross-vendor) · prompt `abstract_enrichment_v1.1`_

**How to read this.** For each record: the abstract and highlights the pipeline would
write, then the exact source text each span was cut from with its character offsets.
Every span is machine-proved to come from the page — your job is whether it is *right*
and *useful*, and above all whether anything reads as invented.

Mark each record on its `ARIJIT:` line. **One hallucination stops the whole run.**

---

## 1. comparison · commercial · fr

- **URL**: https://www.algolia.com/fr/competitors/compare-algolia-vs-elasticsearch
- **Why in pilot**: largest page in corpus (competitor, 278k chars)
- **Fetch**: `scout` · prose 6323 chars
- **Verdict**: `REAL`
- **Status**: `QUARANTINED_BY_GATE`

**Gate failures:**

- G10 abstract mixes languages ['en', 'fr'] -- the page carries untranslated text and the spans are not consistent with each other

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 2. developer · hub · de

- **URL**: https://www.algolia.com/de/developers/laravel-php-framework
- **Why in pilot**: hub page — expect THIN, the slop trap
- **Fetch**: `scout` · prose 3278 chars
- **Verdict**: `REAL`
- **Status**: `QUARANTINED_BY_GATE`

**Gate failures:**

- G1 not found in source: 'Entwickelt, um die Verwendung der Algolia-API innerhalb des Laravel-Fr'

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 3. developer · hub · de

- **URL**: https://www.algolia.com/de/developers/search-api-kotlin
- **Why in pilot**: hub page — expect THIN, the slop trap
- **Fetch**: `scout` · prose 3361 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> Algolia-Such-API-Client für Kotlin, Version 1 Algolia ermöglicht es modernen Entwicklern, ohne DevOps erstklassige Such- und Entdeckungserlebnisse zu schaffen.

**keyhighlights_enriched:**

1. Bietet API-Zugriff auf alle Algolia-Funktionen, Einstellungen, erweiterten Funktionen und ML/AI-Produkte.
2. Kompatibel mit Kotlin 1.3.30 und höher
3. Nahtlose Stapelverarbeitung über Iteratoren zur Optimierung der Anzahl der Netzwerkaufrufe

**Provenance — offsets into the fetched page:**

```
[1490:1535]
[1632:1745]
[1968:2073]
[2550:2588]
[2390:2480]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 4. academy-training · instructional · en

- **URL**: https://academy.algolia.com/training/019462fb-2448-7dd9-ab3c-5191db97cefe
- **Why in pilot**: Academy — expect DEAD/LOGIN_REQUIRED
- **Fetch**: `auth-wall` · prose 4885 chars
- **Verdict**: `DEAD` (LOGIN_REQUIRED)
- **Status**: `NO_ABSTRACT_DEAD`

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 5. academy-training · instructional · en

- **URL**: https://academy.algolia.com/training/01944673-3558-7be5-a2d8-528417b3e7e4
- **Why in pilot**: Academy — expect DEAD/LOGIN_REQUIRED
- **Fetch**: `auth-wall` · prose 4893 chars
- **Verdict**: `DEAD` (LOGIN_REQUIRED)
- **Status**: `NO_ABSTRACT_DEAD`

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 6. comparison · commercial · en

- **URL**: https://www.algolia.com/competitors/compare-algolia-vs-bloomreach
- **Why in pilot**: flagged is404:true but verified alive
- **Fetch**: `scout` · prose 4571 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> The Bloomreach DXP includes search features, but Algolia's dedicated search platform gives you more power and versatility to understand your users and show them what they need. Algolia's API-first solutions bring you the fastest enterprise AI search we know of. The Bloomreach DXP is a broad ecommerce solution that isn't dedicated to search in the same way, and their black-box AI can be difficult to optimize without support.

**keyhighlights_enriched:**

1. Our MACH Alliance-certified headless architecture and APIs allow you to deploy quickly and efficiently on your own terms - whatever the application.
2. Algolia's proprietary AI powers the whole search and browse experience, from query categorization to recommendations and personalization.
3. Algolia's tools are easy to configure, with a no-code solution that allows business users to fine-tune personalization strategies - no developer time or external support needed.
4. More than 18,000 customers in 150+ countries selected Algolia to grow satisfaction and sales.
5. A Forrester Consulting study found Algolia delivered $3.1M NPV over three years, helping commerce teams improve relevance, automate merchandising, and grow revenue

**Provenance — offsets into the fetched page:**

```
[1555:1731]
[1897:1981]
[2075:2240]
[3900:4048]
[4338:4475]
[4700:4877]
[4933:5034]
[6345:6508]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

_The abstract perfectly captures the core comparison of the page, contrasting Algolia's dedicated search platform with Bloomreach's broader DXP. The highlights add excellent supporting details about architecture, AI, ease of use, and ROI._

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 7. comparison · commercial · fr

- **URL**: https://www.algolia.com/fr/competitors/compare-algolia-vs-bloomreach
- **Why in pilot**: flagged is404:true but verified alive
- **Fetch**: `scout` · prose 6032 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> Algolia ou Bloomreach: quelle solution vous convient le mieux? Les solutions API-first d'Algolia vous offrent la recherche par IA d'entreprise la plus rapide que nous connaissons. La plateforme Bloomreach DXP est une solution e-commerce complète qui n'est pas dédiée à la recherche de la même manière, et son IA opaque peut être difficile à optimiser sans assistance.

**keyhighlights_enriched:**

1. <20 ms réponse à la plupart des recherches
2. Plus de 30 milliards enregistrements indexés
3. 1,7+ billion des recherches chaque année
4. Notre architecture headless certifiée MACH Alliance et nos API vous permettent de déployer rapidement et efficacement selon vos propres conditions, quelle que soit l'application.
5. nos 6 bibliothèques d'interface utilisateur vous aident à créer d'excellentes expériences pour vos utilisateurs et à commercialiser vos produits plus rapidement
6. Plus de 18 000 clients dans plus de 150 pays ont choisi Algolia pour accroître leur satisfaction et leurs ventes.
7. Algolia est reconnue comme un leader dans le Magic Quadrant™ 2026 de Gartner® pour la recherche et la découverte de produits
8. Une étude de Forrester Consulting a révélé qu'Algolia a généré une valeur actuelle nette (VAN) de 3,1 millions de dollars sur trois ans

**Provenance — offsets into the fetched page:**

```
[1576:1640]
[2079:2195]
[2307:2494]
[2713:2755]
[2762:2806]
[2813:2853]
[4428:4606]
[4687:4847]
[5842:5963]
[6936:7060]
[7503:7638]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 8. doc-rest-api · reference · en

- **URL**: https://www.algolia.com/doc/rest-api/search/set-settings
- **Why in pilot**: terse reference, median 117 chars prose
- **Fetch**: `doc-md-twin` · prose 377 chars
- **Verdict**: `REAL`
- **Status**: `QUARANTINED_BY_GATE`

**Gate failures:**

- G10 abstract spans span ~35127 characters of the original page (limit 20000) -- stitched from unrelated parts of the document

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 9. doc-rest-api · reference · en

- **URL**: https://www.algolia.com/doc/rest-api/search/set-dictionary-settings
- **Why in pilot**: terse reference, median 117 chars prose
- **Fetch**: `doc-md-twin` · prose 219 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> Turn on or off the built-in Algolia stop words for a specific language. Key-value pairs of supported language ISO codes and boolean values.

**keyhighlights_enriched:**

1. Date and time when the object was updated, in RFC 3339 format.

**Provenance — offsets into the fetched page:**

```
[9093:9180]
[18285:18507]
[20151:20213]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 10. support-article · instructional · en

- **URL**: https://support.algolia.com/hc/en-us/articles/9842497983889-Why-don-t-my-records-with-a-greater-number-of-search-word-occurrences-rank-higher
- **Why in pilot**: Zendesk API path
- **Fetch**: `zendesk-api` · prose 535 chars
- **Verdict**: `REAL`
- **Status**: `QUARANTINED_BY_GATE`

**Gate failures:**

- G1 not found in source: 'The Algolia "Words" ranking criterion explicitly does not add more wei'

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 11. support-article · instructional · en

- **URL**: https://support.algolia.com/hc/en-us/articles/9772477325841-Why-am-I-getting-retry-errors-when-using-the-api-client
- **Why in pilot**: Zendesk API path
- **Fetch**: `zendesk-api` · prose 383 chars
- **Verdict**: `REAL`
- **Status**: `QUARANTINED_BY_GATE`

**Gate failures:**

- information gain 1 < 8 new content tokens

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 12. support-article · instructional · en

- **URL**: https://support.algolia.com/hc/en-us/articles/9637354680721-How-can-I-add-custom-ranking-attributes-using-the-API-Client
- **Why in pilot**: Zendesk API path
- **Fetch**: `zendesk-api` · prose 550 chars
- **Verdict**: `REAL`
- **Status**: `QUARANTINED_BY_GATE`

**Gate failures:**

- G1 not found in source: 'the asc and desc modifiers must be placed at the top if you are config'

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 13. blog-post · editorial · de

- **URL**: https://www.algolia.com/de/blog/ai/evaluate-quality-non-deterministic-agents
- **Why in pilot**: German — locale leakage check
- **Fetch**: `scout` · prose 14186 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> But in the agentic era, those assumptions break down. LLMs are non-deterministic, meaning they can produce different results for the same input. If exact match testing doesn't cut it, how can we actually evaluate the quality of non-deterministic agents? The answer: understand what makes a test case meaningful, generate a whole dataset of cases from our product catalog, and pull insights from those results with statistics. Non-deterministic agents do not require lower standards; they just require better definitions of quality.

**keyhighlights_enriched:**

1. The input. What query, prompt, or trigger is the agent responding to? What conversation history is included? What context is the agent provided?
2. The expected outcome. What means success in this scenario? What conclusion are we hoping the agent reaches from its context, data retrieval, and reasoning?
3. The evaluation focus. How can we evaluate if the agent produced the expected outcome?
4. Instead of starting with a query and trying to guess the right answer, start with content where the expected answer is already implied.
5. For non-deterministic agents, meaning is the unit of quality.
6. here at Algolia, we use Agent Studio.
7. Agent Studio makes this process easier by letting teams configure and test different models and agent setups against the same search indexes.

**Provenance — offsets into the fetched page:**

```
[2187:2331]
[3381:3661]
[14996:15101]
[3870:4016]
[4024:4181]
[4189:4276]
[9062:9197]
[12798:12859]
[12082:12119]
[14693:14834]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 14. comparison · commercial · de

- **URL**: https://www.algolia.com/de/competitors/compare-algolia-vs-vertex-ai
- **Why in pilot**: German — locale leakage check
- **Fetch**: `scout` · prose 6496 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> Algolia vs. Google AI Commerce: Für welche Lösung sollten Sie sich entscheiden? "AI Commerce Search" (ehemals "Vertex AI") ist die neueste Bezeichnung von Google für sein Suchprodukt für den Einzelhandel, das kürzlich um KI-Funktionen erweitert wurde. Mit "AI Commerce Search" nutzen Sie die Google Cloud-Plattform; es werden keine Inhalte aus der Verbundsuche bereitgestellt.

**keyhighlights_enriched:**

1. Algolia's architecture optimizes for every customer, so you can serve results in <20ms even with catalogs of 90 million+ SKUs.
2. Algolia funktioniert mit allen öffentlichen Cloud-Umgebungen und E-Commerce-Plattformen und bietet standardmäßig eine föderierte Suche - so können Sie es in wenigen Minuten ganz nach Ihren Wünschen einsetzen.
3. Mehr als 18.000 Kunden in über 150 Ländern haben sich für Algolia entschieden, um ihre Zufriedenheit und ihren Umsatz zu steigern.
4. Eine Studie von Forrester Consulting ergab, dass Algolia über einen Zeitraum von drei Jahren einen Nettobarwert (NPV) von 3,1 Mio. US-Dollar erzielte und E-Commerce-Teams dabei unterstützte, die Relevanz zu verbessern, das Merchandising zu automatisieren und den Umsatz zu steigern.
5. Algolia gewann beim "2025 Enterprise Combine for Search and Discovery" von Paradigm B2B insgesamt 12 Auszeichnungen in 12 Kategorien, wobei die Kunden insbesondere die Geschwindigkeit, Transparenz, Analysefunktionen und Benutzerfreundlichkeit lobten.

**Provenance — offsets into the fetched page:**

```
[1569:1649]
[1650:1821]
[2594:2718]
[5152:5278]
[5487:5695]
[6360:6498]
[8062:8344]
[9048:9298]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

_The abstract perfectly introduces the comparison, and the highlights provide strong, specific proof points and differentiators mentioned on the page._

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 15. blog-post · editorial · fr

- **URL**: https://www.algolia.com/fr/blog/product/dynamic-facets
- **Why in pilot**: French — locale leakage check
- **Fetch**: `scout` · prose 5115 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> Dynamic Facets is available now. Rather than showing the same fixed set of filters to everyone, it reorders them in real time based on what people are searching for and how they behave. In beta testing, the results were consistent: users clicked earlier and more often.

**keyhighlights_enriched:**

1. clickthrough rate on specific filters improved by 10 to 15 percentage points, with users reaching results sitting two to three positions higher up the page
2. The system learns from real search behaviour across that query and reorders accordingly - so the filter panel reflects how people actually shop, not how the catalogue was organised at implementation.
3. A/B testing Dynamic Facets allows you to see where it produced large gains.
4. Learn more about configuring Dynamic Facets in our docs.

**Provenance — offsets into the fetched page:**

```
[4323:4355]
[3194:3346]
[3348:3431]
[3456:3616]
[2956:3155]
[4052:4196]
[4552:4677]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 16. blog-post · editorial · fr

- **URL**: https://www.algolia.com/fr/blog/ai/evaluate-quality-non-deterministic-agents
- **Why in pilot**: French — locale leakage check
- **Fetch**: `scout` · prose 14186 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> But in the agentic era, those assumptions break down. LLMs are non-deterministic, meaning they can produce different results for the same input. If exact match testing doesn't cut it, how can we actually evaluate the quality of non-deterministic agents? The answer: understand what makes a test case meaningful, generate a whole dataset of cases from our product catalog, and pull insights from those results with statistics. Non-deterministic agents do not require lower standards; they just require better definitions of quality.

**keyhighlights_enriched:**

1. The input. What query, prompt, or trigger is the agent responding to?
2. The expected outcome. What means success in this scenario?
3. The evaluation focus. How can we evaluate if the agent produced the expected outcome?
4. Instead of starting with a query and trying to guess the right answer, start with content where the expected answer is already implied.
5. For non-deterministic agents, meaning is the unit of quality.
6. Agent Studio makes this process easier by letting teams configure and test different models and agent setups against the same search indexes.

**Provenance — offsets into the fetched page:**

```
[2187:2331]
[3381:3661]
[14996:15101]
[3870:3941]
[4024:4084]
[4189:4276]
[9062:9197]
[12798:12859]
[14693:14834]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

_The abstract perfectly summarizes the problem, the proposed solution, and the core thesis of the article. The highlights capture the key components of the proposed evaluation framework, the method for generating test cases, the guiding principle, and the tool mentioned._

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 17. case-study · evidence · fr

- **URL**: https://www.algolia.com/fr/customers/smartbuyglasses
- **Why in pilot**: customer story — metrics must keep their units
- **Fetch**: `scout` · prose 11488 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> SmartBuyGlasses a augmenté son taux de clics de 20 % et réduit son taux de non-clics, tout en améliorant la rapidité et la pertinence des résultats de recherche. Lorsque SmartBuyGlasses, un détaillant mondial de lunettes en ligne, a constaté que sa solution de recherche interne n'atteignait pas la vitesse et la précision requises pour améliorer son service client, l'entreprise s'est tournée vers Algolia Search. L'entreprise a constaté qu'Algolia Search améliorait considérablement la précision et la vitesse de la recherche sur son site et de sa page de grille, ce qui a entraîné une augmentation de 20 % du taux de clics et une réduction de 10 % du taux de non-clics.

**keyhighlights_enriched:**

1. CLIENT DEPUIS depuis 2015
2. Compatible avec environ 30 pays et 15 langues
3. Augmentation de 20 % des taux de clics
4. Réduction de 10 % des taux de non-clic
5. Girin, qui utilise Algolia depuis environ huit ans, salue le développement et la mise à jour constants de la feuille de route de l'entreprise.
6. CARACTÉRISTIQUES, Analyse, Personnalisation, Recherche, Tests A/B, Reclassement dynamique, Règles, Recommandation

**Provenance — offsets into the fetched page:**

```
[2814:2975]
[2291:2543]
[9406:9663]
[3395:3420]
[3734:3779]
[3784:3822]
[3827:3865]
[10345:10487]
[3421:3541]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 18. case-study · evidence · en

- **URL**: https://www.algolia.com/customers/walgreens
- **Why in pilot**: customer story — metrics must keep their units
- **Fetch**: `scout` · prose 10953 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> When the popular nationwide chain decided to improve the digital customer journey, it found its existing search provider to lack the robustness and feature set needed. It turned to Algolia, implementing Search & Discovery, but also Personalization, AI Reranking, and other features to improve customer experience, increase conversions and revenue, and meet the growing demand for BOPIS (buy online, pickup in store) capabilities. As a result of improving the customer journey through search, Walgreens has seen significant improvements in several key performance indicators, including increases in search conversion, revenue from search, and click-through rate. The solution was implemented quickly - approximately 16 weeks - creating a fast time to value and return on investment.

**keyhighlights_enriched:**

1. shoppers can make their purchases online and pickup at their local Walgreens in as little as 30 minutes.
2. now boasts more than 9,000 conveniently located stores across the US, Puerto Rico, and the US Virgin Islands
3. In addition to adopting Algolia Search for its website and mobile app, Walgreens has implemented Rules, Analytics, A/B Testing, AI Synonyms, AI Reranking, and Personalization.
4. The retail pharmacy has also seen a decrease in click position, indicating that customers are finding what they are looking for in fewer steps.
5. CUSTOMER SINCE since 2021

**Provenance — offsets into the fetched page:**

```
[2062:2491]
[9475:9706]
[6509:6628]
[8441:8545]
[3544:3652]
[7451:7626]
[9707:9850]
[2823:2848]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 19. comparison · commercial · en

- **URL**: https://www.algolia.com/competitors/compare-algolia-vs-vertex-ai
- **Why in pilot**: highest-risk family, written to persuade
- **Fetch**: `scout` · prose 5071 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> AI Commerce Search (formerly Vertex AI) is Google's latest name for their retail search product, with AI features added recently. Choose Algolia for industry-leading AI search developed over 10+ years and relied on by 17k+ customers. Algolia's focus is understanding your users and showing them what they need - fast, at scale and across multiple use cases.

**keyhighlights_enriched:**

1. Algolia's architecture optimizes for every customer, so you can serve results in <20ms even with catalogs of 90 million+ SKUs.
2. Algolia works with all public cloud environments and ecommerce platforms, and delivers federated search as standard - so you can deploy in minutes, however suits you best.
3. More than 18,000 customers in 150+ countries selected Algolia to grow satisfaction and sales.
4. A Forrester Consulting study found Algolia delivered $3.1M NPV over three years, helping commerce teams improve relevance, automate merchandising, and grow revenue

**Provenance — offsets into the fetched page:**

```
[1474:1603]
[1604:1707]
[1910:2033]
[4348:4474]
[4635:4806]
[5367:5468]
[6778:6941]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 4 | 5 | 5 | **ACCEPT** |

_The selection is excellent. It captures the page's purpose, which is to compare Algolia against a Google product and highlight Algolia's strengths. The abstract sets the stage, and the highlights provide specific, compelling proof points from the page. A direct negative comparison sentence about the competitor was available, but the chosen highlight makes the same point implicitly from a positive angle, which is a valid and effective choice._

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 20. comparison · commercial · fr

- **URL**: https://www.algolia.com/fr/competitors/compare-algolia-vs-vertex-ai
- **Why in pilot**: highest-risk family, written to persuade
- **Fetch**: `scout` · prose 6524 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> AI Commerce Search (anciennement Vertex AI) est le nouveau nom de Google pour son produit de recherche pour le commerce de détail, enrichi récemment de fonctionnalités d'IA. Choisissez Algolia pour une recherche IA de pointe, développée depuis plus de 10 ans et utilisée par plus de 17 000 clients. Algolia fonctionne avec tous les environnements de cloud public et les plateformes de e-commerce, et propose la recherche fédérée en standard; vous pouvez donc déployer en quelques minutes, de la manière qui vous convient le mieux.

**keyhighlights_enriched:**

1. AI Commerce Search utilise la plateforme Google Cloud et ne propose pas de contenu de recherche fédérée.
2. Algolia's architecture optimizes for every customer, so you can serve results in <20ms even with catalogs of 90 million+ SKUs.
3. Plus de 18 000 clients dans plus de 150 pays ont choisi Algolia pour accroître leur satisfaction et leurs ventes.
4. Une étude de Forrester Consulting a révélé qu'Algolia a généré une valeur actuelle nette (VAN) de 3,1 millions de dollars sur trois ans, aidant les équipes commerciales à améliorer la pertinence, à automatiser le merchandising et à accroître leurs revenus.
5. Algolia a remporté 12 médailles dans 12 catégories lors du Paradigm B2B's Enterprise Combine 2025 pour la recherche et la découverte, les clients saluant sa rapidité, sa transparence, ses analyses et sa facilité d'utilisation.

**Provenance — offsets into the fetched page:**

```
[1627:1800]
[1801:1925]
[5410:5642]
[2552:2656]
[5061:5187]
[6356:6477]
[7995:8251]
[8963:9189]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 21. program · corporate · en

- **URL**: https://www.algolia.com/awards
- **Why in pilot**: thin, boilerplate-heavy
- **Fetch**: `scout` · prose 5988 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> Recognized by IDC, Gartner, Forrester, and Paradigm B2B, Algolia helps enterprises turn search into a growth engine for AI-native experiences. Algolia is recognized as a Leader in the 2026 Gartner® Magic Quadrant™ for Search and Product Discovery as the market shifts toward AI-powered, agentic discovery.

**keyhighlights_enriched:**

1. Algolia Named a Leader in 2025 Gartner® Magic Quadrant™ for Search and Product Discovery
2. A Forrester Consulting study found Algolia delivered $3.1M NPV over three years, helping commerce teams improve relevance, automate merchandising, and grow revenue
3. Algolia earned 12 medals across 12 categories in Paradigm B2B's 2025 Enterprise Combine for Search and Discovery, with customers praising speed, transparency, analytics, and ease of use
4. IDC recognized Algolia as a leader in general-purpose knowledge discovery software, citing the growing role of search in AI-powered workflows and enterprise knowledge experiences
5. 20-Time Champion: Ranked a Leader in G2's Enterprise Grid®
6. Award Coveted AWS Retail Competency Status

**Provenance — offsets into the fetched page:**

```
[6402:6544]
[6733:6895]
[1758:1846]
[7225:7388]
[7984:8169]
[7561:7739]
[2170:2228]
[3140:3182]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 22. doc-tool · reference · en

- **URL**: https://www.algolia.com/doc/tools/cli/examples
- **Why in pilot**: reference, mainstream case
- **Fetch**: `doc-md-twin` · prose 3330 chars
- **Verdict**: `REAL`
- **Status**: `QUARANTINED_BY_GATE`

**Gate failures:**

- self-reference 'this page' in span
- information gain 5 < 8 new content tokens

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 23. doc-tool · reference · en

- **URL**: https://www.algolia.com/doc/tools/cli/completion
- **Why in pilot**: reference, mainstream case
- **Fetch**: `doc-md-twin` · prose 1693 chars
- **Verdict**: `REAL`
- **Status**: `QUARANTINED_BY_GATE`

**Gate failures:**

- G1 not found in source: 'To enable completion in the current session, run: source <(algolia com'

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 24. doc-tool · reference · en

- **URL**: https://www.algolia.com/doc/tools/cli/commands
- **Why in pilot**: reference, mainstream case
- **Fetch**: `doc-md-twin` · prose 412 chars
- **Verdict**: `REAL`
- **Status**: `QUARANTINED_BY_GATE`

**Gate failures:**

- information gain 1 < 8 new content tokens

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 25. academy-training · instructional · en

- **URL**: https://academy.algolia.com/training/7ea73420-0247-11ef-90fa-02a84b0442e5
- **Why in pilot**: instructional, mainstream case
- **Fetch**: `auth-wall` · prose 4889 chars
- **Verdict**: `DEAD` (LOGIN_REQUIRED)
- **Status**: `NO_ABSTRACT_DEAD`

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 26. academy-training · instructional · en

- **URL**: https://academy.algolia.com/training/019465d6-0539-7661-8640-9b0c3656c165
- **Why in pilot**: instructional, mainstream case
- **Fetch**: `auth-wall` · prose 4880 chars
- **Verdict**: `DEAD` (LOGIN_REQUIRED)
- **Status**: `NO_ABSTRACT_DEAD`

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 27. academy-training · instructional · en

- **URL**: https://academy.algolia.com/training/019465c0-b210-7d60-8bb6-355967b2dbec
- **Why in pilot**: instructional, mainstream case
- **Fetch**: `auth-wall` · prose 4885 chars
- **Verdict**: `DEAD` (LOGIN_REQUIRED)
- **Status**: `NO_ABSTRACT_DEAD`

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 28. resource · editorial · en

- **URL**: https://www.algolia.com/resources/asset/video-bbc-interview
- **Why in pilot**: editorial, mainstream case
- **Fetch**: `scout` · prose 2494 chars
- **Verdict**: `REAL`
- **Status**: `QUARANTINED_BY_GATE`

**Gate failures:**

- G1 not found in source: 'In this @BBC Talking Business interview, Algolia CEO Steven Lynch disc'

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 29. blog-post · editorial · en

- **URL**: https://www.algolia.com/blog/engineering/agents-can-now-sign-up-for-algolia
- **Why in pilot**: editorial, mainstream case
- **Fetch**: `scout` · prose 10943 chars
- **Verdict**: `REAL`
- **Status**: `QUARANTINED_BY_GATE`

**Gate failures:**

- G1 not found in source: "We're shipping an algolia-quickstart skill alongside the existing algo"

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---

## 30. press-release · editorial · en

- **URL**: https://www.algolia.com/about/news/algolia-launches-dynamic-facets-to-make-product-discovery-faster-smarter-and-more-relevant
- **Why in pilot**: editorial, mainstream case
- **Fetch**: `scout` · prose 8715 chars
- **Verdict**: `REAL`
- **Status**: `PASS`

**abstract_enriched:**

> Algolia, the AI Search and Retrieval platform powering more than 1.75 trillion queries each year for over 18,000 businesses worldwide, today announced the availability of Dynamic Facets, a new capability that automatically surfaces the most relevant filters based on what a shopper is actively searching for. Algolia's Dynamic Facets addresses this challenge by intelligently adapting the filtering experience to each search.

**keyhighlights_enriched:**

1. New capability uses shopper behavior to automatically prioritize the most relevant filters for every search, helping retailers improve conversion while reducing manual merchandising work
2. In the strongest-performing markets, clickthrough rates on specific filters improved by 10 to 15 percent, with shoppers clicking results that appeared two to three positions higher on the page.
3. Dynamic Facets also surfaces data on which filter values are seeing the most interaction, for example which brand, size, color, or attribute users are actually clicking on.
4. Dynamic Facets builds on Algolia's existing faceting suite, including searchable facets, which let users search within long filter lists without scrolling.

**Provenance — offsets into the fetched page:**

```
[2243:2578]
[3838:3954]
[2015:2201]
[4805:4998]
[5190:5362]
[7715:7870]
```

**Judge (Gemini, cross-vendor):**

| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |
|---|---|---|---|---|---|
| 5 | 5 | 5 | 5 | 5 | **ACCEPT** |

```
ARIJIT:  accept / reject / HALLUCINATION
notes:
```

---
