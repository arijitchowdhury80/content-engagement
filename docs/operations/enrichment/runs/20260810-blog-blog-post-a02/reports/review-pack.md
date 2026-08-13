# Review pack -- Blog/blog-post

run: `20260810-blog-blog-post-a02`  profile: `blog-post:2946b4b57a45`
minimum_review_sample: 20

## writable_pass (20)

### `en_3bb87fa8-6725-4cb6-abae-f93efdb93725`
- url: /blog/engineering/how-to-build-a-simulator-for-any-feature-part-1-unit-testing
- status: PASS  language: en
- abstract: Unit tests are just little pieces of code that verify that things are functioning as they should. Here's one idea: refactor whatever you can into a new pure function so that the impure function contains as little as possible. It's not as straightforward to test UI elements and entire workflows with simple unit tests.
  - highlight: Once we chunk up our large tasks into these small functions, many of them will happen to be pure functions: deterministic functions that always return the same output given the same input, without affecting or being affected by anything outside of the function.
  - highlight: Sure enough, that last line reveals a bug in our code.
  - highlight: It's not deterministic (that is, the function doesn't always return the same output for a given input), and it contains a few side effects that reach outside of the scope of the function.
  - highlight: I could have gone even further if I used a for loop instead of map, but the point here is that creating unit tests often won't require a big change from you as the developer.
  - highlight: Check out part 2 in this series: simulating the entire browser.
- source body: 12051 chars

### `en_bba29101-248b-40e0-893c-c94493f7983d`
- url: /blog/product/what-is-search-relevance
- status: PASS  language: en
- abstract: Search relevance is the measure of accuracy of the relationship between the search query and the search results. Website owners can fine-tune their search relevance to order search results in the most helpful way to users.
  - highlight: Research shows 43% of website visitors go immediately to the search bar, and these searchers are about 2-3 times more likely to convert.
  - highlight: Early search engines and protocols such as Archie, created in 1990 by a postgraduate student at McGill University, and Gopher, created in 1991 by researchers at the University of Minnesota, were important milestones in the development of modern search relevance systems.
  - highlight: For instance, a classic algorithm known as TF-IDF would look at the number of times keywords appeared in the respective documents (Term Frequency) and at the number of times keywords appeared in all other documents in the repository (Inverse Document Frequency).
  - highlight: For our own search engine, we developed a tie-breaking and custom ranking system that makes it easier for businesses to see what's happening under the hood, which enables them to tailor the relevance to their own needs.
  - highlight: We have added scoring with neural technology and vector search to expand the relevance of our keyword search to more use cases.
  - highlight: There are other methods, too, such as MRR (mean reciprocal rank) and MAP (mean average precision), each with their own pros and cons.
- source body: 14988 chars

### `en_da7273c6-7a27-4cae-b7eb-0691f6110971_0_1`
- url: /blog/engineering/why-imports-are-important-in-js-1
- status: PASS  language: en
- abstract: While the Zen of Python isn't a direct set of guidelines for JavaScript, it definitely lays out what good software architecture looks like, and the fact of the matter is, JavaScript's modern import and export syntax checks all the boxes. It's explicit, readable (for us and the computer), practical, unambiguous, and it encourages proper use of namespaces.
  - highlight: The import statement and its associated syntax from ES2015 is also known for being much easier to read than its predecessor require().
  - highlight: Assuming those definitions are all the same size and you're only canonizing four of the Beatles, we just cut the size of the code in this file to 25% of what it was.
  - highlight: This is called "tree-shaking", since it's basically the software version of shaking a fruit tree so the useless ones fall off.
  - highlight: If we've given up on tree shaking, then we could also use dynamic imports.
  - highlight: It's not uncommon for what once was a small encapsulated file with a single function to mushroom into a 4000-line mess just because all of those additions felt logical as we made them.
- source body: 13227 chars

### `de_e1028147-1e4c-4fe6-9e08-3713b851e1ce`
- url: /de/blog/ai/why-chatgpt-wont-replace-search-engines-any-time-soon
- status: PASS  language: de
- abstract: The lack of real danger to them has to do with search relevance and user experience in chat-based environments. I've learned what works and what doesn't, and while I'm long on LLMs (large language models), I'm not long on replacing the existing search paradigm. But I do think that the lack of context and multiple choices is inescapable within a pure chat context.
  - highlight: ChatGPT responses are, however, heavily dependent on the prompt (i.e., query) formulation.
  - highlight: Search must understand searchers even with misspellings, or else the experience is a step back.
  - highlight: At Algolia, we take two approaches: one is a straightforward edit distance between text; the other is via our upcoming AI Search that matches on concepts and takes into account contextual clues to better match the correct spelling even when the edit distance is large.
  - highlight: This blog post claims that the number one result on a Google search is clicked 28% of the time.
  - highlight: Chatbot natural language understanding (NLU) can sometimes have a high failure rate (we've seen customers approaching 50% failure) and search seems like a natural fallback.
  - highlight: In these situations, it is _so_ important for searchers to be able to see options, filter down with a click, and generally get deep into a "discovery phase." This is not what chat is suited for.
  - highlight: There are other hurdles: legal (Australia has a law requiring payment from Google and Facebook for news; what will they think when the news is automatically summarized without sources?), cost, and speed immediately come to mind.
- source body: 13370 chars

### `en_e9c088ef-63b9-4bfd-bf69-3d628aa28c04_0_9`
- url: /blog/ai/using-pre-trained-ai-algorithms-to-solve-the-cold-start-problem
- status: PASS  language: en
- abstract: That circular dependency is the cold start problem, and it remains one of the biggest challenges teams face when building or adopting AI features. Combined with the relevance judgments, these synthetic queries created the complete reference set needed to activate NeuralSearch without waiting for live traffic.
  - highlight: NeuralSearch blends two complementary search systems: semantic relevance through vector embeddings and keyword relevance through traditional lexical matching.
  - highlight: Our own experiments confirmed it: LLMs consistently matched expert annotations with roughly 97% accuracy, proving they could serve as a suitable alternative for event-driven relevance scoring during onboarding.
  - highlight: Once the approach proved reliable, we integrated a fully automated synthetic data workflow directly into the NeuralSearch dashboard.
  - highlight: This removes the need for fully instrumented event pipelines before experimenting with NeuralSearch, which has historically been an onboarding requirement.
  - highlight: This synthetic data workflow is now generally available directly in NeuralSearch for Algolia Elevate customers.
- source body: 11526 chars

### `fr_9685f45f-69bd-4809-bd3e-bc9e4cca244f`
- url: /fr/blog/ai/what-is-cognitive-search-and-what-could-it-mean-for-your-business
- status: PASS  language: fr
- abstract: Forrester describes cognitive search as "a new generation of enterprise search solutions that employ AI technologies such as natural language processing and machine learning to ingest, understand, organize, and query digital content from multiple data sources." The improved relevance and efficiency, and the time savings as a result, lead to enterprise benefits such as a higher conversion rate, a more loyal customer base, a more productive sales force, and higher revenue.
  - highlight: It uses natural language processing (NLP) and machine learning to make sense of and process product specifications, descriptions, and images in a database.
  - highlight: Unlike keyword search, cognitive search crawls unstructured data and structured data, recognizes patterns and meaning, and generates high-quality search results from all the sources.
  - highlight: Did you know that according to McKinsey, employees spend roughly 19% of their work day searching for information?
  - highlight: And with 88% of online customers saying they won't return to a website where they've had an unpleasant experience, companies' producing seamless user experiences is vital.
  - highlight: According to MIT, 80-90% of data is unstructured: in a format that's not easily searchable, for example, text and social media posts.
  - highlight: Recognized by IDC, Gartner, Forrester, and Paradigm B2B, Algolia helps enterprises turn search into a growth engine for AI-native experiences.
- source body: 15596 chars

### `de_f55b4f45-2c33-42a7-934e-486ea8d256a7`
- url: /de/blog/ai/experience-essential-tips-for-evaluating-genai-content-quality/essential-tips-for-evaluating-genai-content-quality-1
- status: PASS  language: de
- abstract: Evaluating and maintaining high standards for genAI content is not just a technical task but a strategic necessity that directly impacts user satisfaction, engagement, and business outcomes. By understanding the importance of content evaluation, leveraging prompt engineering, and employing continuous monitoring, businesses can keep their genAI outputs relevant, accurate, and engaging.
  - highlight: Using readability tools such as the Flesch-Kincaid score helps assess the complexity of content, adjusting language and sentence structure to match the audience's reading level.
  - highlight: Tools like the Retrieval-Augmented Generation Assessment System (RAGAS) help measure how well AI-generated content aligns with user queries, breaking down responses to verify their accuracy and contextual relevance.
  - highlight: Real-time analytics platforms, such as Google Cloud's Natural Language API or AWS Comprehend, provide powerful capabilities for assessing sentiment, relevance, and engagement metrics.
  - highlight: Frameworks like LangChain and other AI-driven platforms enable businesses to automate content evaluations, allowing outputs to meet predefined standards without extensive manual oversight.
  - highlight: Collecting data from user interactions-such as click-through rates, time spent on pages, and direct feedback through surveys-helps businesses identify areas for improvement.
- source body: 13040 chars

### `fr_314517e2-134a-4a29-b515-4938d02086df`
- url: /fr/blog/algolia/algolia-leaders-women-in-tech
- status: PASS  language: fr
- abstract: We asked our women leaders about their career paths, challenges they faced, advice they'd share with other women in tech, and what makes Algolia a great place to work. Adanech has been with Algolia for 3.5 years, and was the first woman on the Algolia exec team.
  - highlight: Bernadette joined Algolia in May 2020.
  - highlight: I'm definitely a CEO who came up through the GTM side of the business, predominantly in sales and sales leadership. But I also took rotational assignments to round out my experience, from running a big chunk of marketing to an IT leadership role.
  - highlight: On making legal and compliance an integral part of the business.
  - highlight: Kristie joined us in June 2019.
  - highlight: We are making huge progress looking for diverse candidates in the leadership ranks, and are doubling down on our D&I initiatives and our recruiting efforts.
- source body: 14316 chars

### `en_ab2f2c68-9cfb-4b50-98f5-835d07bef908_0_1`
- url: /blog/product/how-when-and-why-do-mobile-users-engage-with-search
- status: PASS  language: en
- abstract: With so many mobile phone users opting to web search on their devices, it's important that online-business execs understand how, when, and why consumers are using their phones to search. When someone does a mobile search, they're querying an online search engine using a mobile device that's connected to the Internet. That's distinctly different from doing a search on a desktop computer in terms of both the type of device and the typical parameters (how, when, and why users are looking for content).
  - highlight: In the second quarter of 2022, mobile devices generated just less than 59% of global website traffic, outrunning desktop (and tablet, such as iPad) traffic.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: How, when, and why do mobile users engage with search?
  - highlight: Published: February 13, 2023
  - highlight: And people love that: about 82% of mobile shoppers type "near me" in their search bars to find geographically relevant results.
  - highlight: When it comes to smartphone users, 60% have directly contacted a business using search results appearing on their mobile phone.
  - highlight: According to App Annie, it's an average of 4.8 hours - roughly a third of the time they're awake.
  - highlight: Fun fact: more than half (52%) of the phone checking people do occurs during work hours.
- source body: 15665 chars

### `de_61810251-184b-4914-a971-6520b7c4136e`
- url: /de/blog/ux/how-does-autocomplete-maximize-the-power-of-search
- status: PASS  language: de
- abstract: Autocomplete search suggestions functionality, also known as predictive search (and typeahead), is a software function in text-based applications that aims to automatically complete a word or phrase as you type it. The benefits of autocomplete - a better user experience, mobile-friendly search, and accurate search results for things users are super interested in - mean that people find their way to what they need in your online store.
  - highlight: Software engineer Kevin Gibbs brought the idea to Google and was pivotal in launching what he called Google Suggest (now Google Autocomplete; his utilization of technological advances such as Big Data and high-speed Internet created an eerily accurate and personalized predictive service.
  - highlight: For starters, search engine companies like Google have a blacklist, so certain words and phrases, such as those related to violence, hate speech, and copyright infringement, are omitted.
  - highlight: Autocomplete doesn't just pay attention to _what_ someone is searching for, it's cognizant of _where_ they're searching for it.
  - highlight: According to SlideShare, 80% of consumers are more likely to buy from a company that provides a personalized customer experience.
  - highlight: But cumulatively, says Google, it can save more than _200 years_ of typing per day.
  - highlight: Algolia provides best-in-class search and discovery technology for businesses, delivering personalized shopping experiences that can boost conversion rates 30%+.
- source body: 12544 chars

### `de_f7fc2c52-363c-42b0-8fc3-0de7735ed70d`
- url: /de/blog/ai/generative-ais-impact-on-the-ecommerce-industry
- status: PASS  language: de
- abstract: GenAI is having a transformative impact on ecommerce. GenAI can leverage personalization data from multiple sources to help deliver the shopping experience most relevant to the individual customer, and most likely to result in high AOV conversions. In addition, GenAI can enrich the customer experience with two-way communication in real time, and automate other ecommerce processes to improve efficiency and reduce costs.
  - highlight: In one recent Harvard Business Review study, 31% of the respondents said they were using GenAI within their ecommerce operations.
  - highlight: According to another HBR report, 69% of respondents using GenAI achieved improvements in speed and efficiency.
  - highlight: It's widely reported that GenAI - using personalized recommendations - can increase sales as much as 20%.
  - highlight: And according to one study, personalization increased average order value for 98% of the participants.
  - highlight: And they clearly increase engagement, as the growing adoption of chatbots demonstrates - 67% of consumers have used a chatbot within the last year.
  - highlight: Simply finding the individuals to build a GenAI team is difficult, with a current talent shortfall estimated at 250,000. Furthermore, this gap between supply and demand means that the available talent is expensive.
  - highlight: According to one study, 80% of retailers are either using GenAI or piloting projects, and 90% intend to increase their investment in GenAI in the coming fiscal year.
- source body: 25905 chars

### `de_e8887089-dd36-4ad8-a061-0ae471be3c8a`
- url: /de/blog/ecommerce/merchandising-strategy-best-practices-and-tactics-to-drive-more-sales
- status: PASS  language: de
- abstract: A merchandising strategy refers to the planning and execution of activities to increase your online store revenue and improve your customer satisfaction. Its facets could include upselling, cross-selling, promotions, sales, limited-time offers, and product recommendations.
  - highlight: With online shoppers, you have only 8 seconds to make an impression, according to Microsoft.
  - highlight: Techniques like the "racetrack" layout encourage shoppers to explore more of the store.
  - highlight: Optimizing your ecommerce site for mobile is essential. In fact, 58% of all multi-device purchases are made on mobile.
  - highlight: Not only that but 78% of shoppers are more likely to recommend your platform to friends, as well as repurchase, if you use personalization.
  - highlight: With research indicating that the average cart abandonment rate is 70.19%, you need to implement the right process so your shoppers don't become part of that statistic.
  - highlight: Research backs this up, suggesting that customer reviews - a form of "social proof" - impact more than 80% of purchases.
  - highlight: Algolia offers proven Search and Discovery technology to help you streamline your online merchandising battle plan.
- source body: 21261 chars

### `fr_439a7486-8c49-4fd1-9c40-e5446b3cbda7`
- url: /fr/blog/ecommerce/site-search-vs-chatgpt-the-future-of-b2b-ecommerce-unveiled
- status: PASS  language: fr
- abstract: Hosted by renowned industry experts, Brian Beck and Andy Hoar, this insightful webinar aimed to explore whether ChatGPT, the fastest-growing app ever, might potentially outperform traditional site search methods in the B2B eCommerce sector. It means finding the specific product an individual user is looking for, with all the B2B centered specifications, and that takes a contextual understanding that is missing from ChatGPT. Generative AI models like ChatGPT lack access to data sources like PIM, CDP, or even buyer history and behavioral data, and are therefore more focused on handling the singular query experience versus optimizing the experience and personalizing it across the customer journey as site search solutions can do.
  - highlight: For example, one Algolia customer, MSA Safety, sells to 4 different industries, so if you're looking for a safety helmet - you're going to want very different results if you work in construction than if you work in fire safety.
  - highlight: That's why Algolia is proud to be the only search provider on the market to incorporate both keyword and semantic search for each query powered by AI that can return the most relevant results under 20ms even when working on catalogs with tens of millions of product SKUs and various combinations.
  - highlight: Understanding these nuances requires access to private data which ChatGPT does not have.
  - highlight: This conversational agent would retrieve products and associated specifications, facets, and various attributes from their indices that are running on Algolia NeuralSearch as a way to further simplify and enhance the buying journey.
- source body: 12089 chars

### `fr_c51930af-1156-493a-837a-2b6911a45c26`
- url: /fr/blog/ecommerce/ai-and-personalization-grocery-survey
- status: PASS  language: fr
- abstract: In parallel, interest in AI in grocery is exploding, particularly among Millennials and Gen Zers, challenging grocers to provide value and tap into AI to provide more tailored, engaging and convenient experiences. To better understand consumer expectations for AI in grocery, we surveyed 1,000 U.S adults.
  - highlight: Roughly one-third (30%) of consumers say grocery bills are stressing them out this year, and it's changing what they buy.
  - highlight: Nearly half of consumers (46%) want grocery retailers to offer deal recommendations tailored to their current cart or past purchases.
  - highlight: Now it is possible to simply take a picture of that list, have a cart filled with products you prefer, and have it delivered.
  - highlight: 59% believe AI will make grocery shopping more convenient.
  - highlight: Yet, 50% don't trust AI agents to manage grocery shopping because they worry the agents will hallucinate and purchase the wrong items.
  - highlight: Only 44% of Millennials and 55% of Gen Z are confident in using an AI agent to reorder household staples, though younger demographics are usually the most pro-AI.
- source body: 10090 chars

### `fr_8f33e5c1-53db-45e3-a3ff-5245044d942c`
- url: /fr/blog/product/for-slas-theres-no-such-thing-as-100-uptime-only-100-transparency
- status: PASS  language: fr
- abstract: In recent years it's become fashionable for companies to include 100% uptime guarantees in their SLA - and, in some cases, even more than 100%, despite its mathematical impossibility. Premium: 99.999% uptime, each minute of downtime would make you eligible for 1,000 minutes of refund, up to a cumulative value of 600% of the monthly service billing over a year.
  - highlight: The market standard is typically 1 minute; however, 1 minute of downtime per month means 99.9977% uptime - so what exactly is 100% uptime then?
  - highlight: One SaaS provider on the market today promises 100% uptime, yet their SLA only promises any refunds or credits after 0.05% downtime per month, which is a little over 20 minutes!
  - highlight: Premium: we replicate your search on at least three different machines hosted by three different providers in three different data centers with three autonomous systems using at least two different Tier1 upstream providers.
  - highlight: Enterprise: 99.99% uptime, each minute of downtime would make you eligible for 100 minutes of refund, up to a cumulative value of 100% of the monthly service billing.
  - highlight: Our outage detection starts at 30 seconds (0.001% of a month) instead of 1 minute.
  - highlight: As you can see, with our Premium SLA, if our service is down 45 minutes, we refund you 100% of your monthly bill - it doesn't get much simpler than that.
  - highlight: Our setup has been extensively tested with outages of entire datacenters and networks and we've still been able to maintain 100% uptime.
- source body: 10728 chars

### `de_f499b4ed-6ea8-4b03-9b52-cb5ff467fbf0`
- url: /de/blog/ai/llms-changing-ecommerce
- status: PASS  language: de
- abstract: The short answer: LLMs work well for certain tasks but not for others, and their strengths make them potentially great team players for generating revenue in the online arena. The trick lies in not relying too much on an LLM but in putting it to work _in conjunction with_ a mature search solution.
  - highlight: In line with that sentiment, McKinsey is forecasting the potential economic impact of generative AI to range from $2.6 to $4.4 trillion globally.
  - highlight: The company has debuted a chatbot, Rufus, with an LLM trained on the product catalog and customer reviews, to answer user queries at various stages of the shopping journey.
  - highlight: So far, reviews for Rufus have been decidedly disappointing.
  - highlight: The problem with many current generative AI applications is that companies are using them to _replace existing, working technology_ instead of simply augmenting online shopping experiences.
  - highlight: GenAI can't provide traditional search results, as it's not designed to come up with comprehensive, accurate results from a limited dataset, such as a product catalog.
  - highlight: "AI hallucination is a phenomenon wherein a large language model (LLM) - often a generative AI chatbot or computer vision tool - perceives patterns or objects that are nonexistent or imperceptible to human observers, creating outputs that are nonsensical or altogether inaccurate," explains IBM.
  - highlight: Our brand new Generative Shopping Experiences are unleashing state-of-the-art solutions for product comparisons, reviews, buyers' guides, and query refinement.
- source body: 20434 chars

### `fr_9b1a527c-df09-47b4-8145-3d06b27e2be7`
- url: /fr/blog/engineering/why-you-should-capture-click-and-conversion-events-from-day-one
- status: PASS  language: fr
- abstract: When we track clicks and conversion events from day one in a flexible system like Algolia, we can then improve our business "holistically" - in other words, tracking analytics makes the business better all around. Either way, we'll need input data to train the AI on our product catalog, and the way we do this is to send click and conversion events to Algolia!
  - highlight: For example, Algolia Recommend can (as the name suggests) recommend products, content, or categories to users based on some previous data.
  - highlight: For example, Algolia lets you A/B test different index settings, but that only makes sense if you have a way to measure the results.
  - highlight: Algolia can handle the Frequently Bought Together section for us - by sharing at least 1,000 conversion events (checkouts, in our example) with multiple products over the last 30 days, we're then good to go.
  - highlight: But to truly reflect your users' behavior, you'll need event data - 10,000 clicks or conversions over the last 30 days is enough for Algolia to make accurate conclusions about what products generally relate to each other.
  - highlight: If you'd prefer to store your analytics data elsewhere, but want the benefits of Algolia's dashboard and AI-driven search, there are plugins for GTM and Segment available too.
- source body: 14468 chars

### `de_3cd39d15-8137-41df-b676-700e5d759615`
- url: /de/blog/engineering/geo-spatial-search-on-mobile
- status: PASS  language: de
- abstract: Geo-spatial search or geo-search is no longer a buzz word or a nice to have in your service or app. To sum it up, Firebase + GeoFire can be a very useful and quick solution to your geo-spatial search problem. In case you have geo-aware data in Firebase, you can sync it to Algolia to get these more advanced geo-search features.
  - highlight: According to Google's 2011 "The Mobile Movement Study", 77% of smartphone users use their smartphone for search.
  - highlight: Since I had some experience with Firebase, I learned that I could use GeoFire on top of it, which allows to store and query a set of keys based on their geographic location.
  - highlight: GeoFire will only store the ID of a message and its coordinates; you cannot store any other metadata.
  - highlight: After indexing your object and in order to search based on a location, all you need is to add a field _geoloc with given latitude and longitude.
  - highlight: Instead of using the latitude and longitude you can define a rectangle or a polygon.
  - highlight: By default, Algolia will expand the search radius around the specified latitude and longitude until approximately 1000 hits are found.
- source body: 15681 chars

### `fr_cc56e727-0901-4b65-a6b4-83a64241a1da`
- url: /fr/blog/ai/what-is-end-to-end-ai-search
- status: PASS  language: fr
- abstract: End-to-end AI search includes AI-powered query understanding, retrieval, and ranking. Algolia NeuralSearch sends each query through three phases to deliver the best results.
  - highlight: Historical data suggests that most companies will optimize their most popular queries, however, 50-70% of revenue is left on the table due to unoptimized long-tail.
  - highlight: Keyword search engines tend to provide better results for head terms, whereas AI vector search works well for less popular long tail queries.
  - highlight: Techniques such as HNSW (Hierarchical Navigable Small World), IVF (Inverted File), or PQ (Product Quantization, a technique to reduce the number of dimensions of a vector) are some of the most popular Approximate Nearest Neighbor (ANN) methods to find similarity between vectors.
  - highlight: At Algolia, we pioneered a new technique called neural hashing.
  - highlight: The binary vector is much smaller and faster to calculate than standard vectors, which allows us to run vector and keyword search simultaneously and at scale on commodity CPUs.
  - highlight: It took AirBnB a team of very talented data scientists and engineers two years to build an AI ranking solution!
- source body: 17276 chars

### `fr_7eb62076-1ae4-4280-8973-fb3591b873f2`
- url: /fr/blog/ai/building-recommendations-for-ecommerce-media-with-without-ai-1
- status: PASS  language: fr
- abstract: While filtering-based recommendations (as discussed below) are simple to implement and don't necessarily rely on complex algorithms, they have their limitations. Modern solutions based on machine learning offer a significant improvement. Algolia Recommend delivers high-performance AI-powered recommendations in an API.
  - highlight: Amazon is at the forefront of AI-powered recommender systems - recommendations account for 35% of their sales.
  - highlight: Without using any AI, you can make recommendations by using tags and sales history.
  - highlight: The richest data available to ML-based recommendation engines is user events like clicks and conversions.
  - highlight: If you choose to use Algolia, its Insights API will be your hub for collecting and sending user event data to your Application.
  - highlight: Collaborative filtering algorithms fall into a few categories - user-based, item-based, hybrid, and matrix factorization.
- source body: 18678 chars

## repaired (8)

### `de_2eb1dfdc-3641-4988-8189-b958bb02660f`
- url: /de/blog/product/what-is-an-api
- status: PASS  language: de
- abstract: API design dictates which information an API can share with clients and how this is done. REST (REpresentational State Transfer), SOAP (Simple Object Access Protocol), and RPC (Remote Procedure Call) are the commonly used API architectures.
  - highlight: A good API example is the Google Maps API.
  - highlight: As the name implies, these are produced to facilitate data transfer for internal company use only; they can't be accessed by third parties. However, some companies eventually take their internal APIs public.
  - highlight: Various data and services are combined in this type of API, which may reduce the number of API calls and overall complexity.
  - highlight: To make B2B needs easier to meet, authorized developers can access these types of APIs.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: Published: February 03, 2023
- source body: 14251 chars

### `de_5ed2c632-f0ea-4d47-9d4f-9bc71629d0c5`
- url: /de/blog/product/what-is-a-rest-api
- status: PASS  language: de
- abstract: The beauty of REST APIs (also known as REST _ful_ APIs; REST stands for representational state transfer), is their simple yet transformative technology. REST is a collection of rules that developers follow when creating APIs; a set of principles governing how different programs communicate.
  - highlight: One of the rules of REST is that you should get a piece of data (a resource) when you link to a particular URL.
  - highlight: A request consists of an endpoint (the URL you request for), a method, which defines the type of request sent to the server; headers, which represent the metadata; and data.
  - highlight: Did you know that Gmail, Twitter, and Instagram are all well known examples of REST APIs?
  - highlight: While there are other API architectures out there, including SOAP (Simple Object Access Protocol) and XML-RPC (remote procedure call), REST stands out.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: Published: September 15, 2022
  - highlight: A stateless transaction is an interaction-independent one, and REST is intended to be stateless.
- source body: 13341 chars

### `de_c941f136-412f-40d9-9ca8-8bfc15acaf5c_0_2`
- url: /de/blog/engineering/the-evolution-of-personalization
- status: PASS  language: de
- abstract: The industry reached new maturity by 2018 when Algolia introduced personalization that merged search queries with user behavior. The goal isn't just to predict what users want - it's to create interfaces that feel alive, responsive, and genuinely helpful.
  - highlight: When Amazon launched their recommendation system in 1998, they aimed to recreate this intimate bookstore experience at an unprecedented scale.
  - highlight: _Example of early uses of personalization on amazon.com in 1998_ Google's introduction of personalized search results in 2005 marked another milestone.
  - highlight: Netflix elevated personalization to new heights in 2011 by introducing contextual awareness.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: Slow decay works well for stable preferences within sessions, while fast decay suits applications where interests change rapidly.
- source body: 16405 chars

### `en_3c9ca2d0-f41f-4298-9b48-e30e226adaba_0_1`
- url: /blog/ux/dealing-with-choice-overload-when-designing-navigation-for-ecommerce
- status: PASS  language: en
- abstract: Your job is to get the user on the path they need to be, to the product/s they want, with as few possible activities/clicks as possible, giving just enough choices along the way. One option is to offer a guided shopping experience.
  - highlight: For example, if you're selling rugs, you should track what % of users in the rug category refine by size, pattern, material.
  - highlight: Let the user know as they are choosing, how many products will match their selections, as well as other possible attribute combinations.
  - highlight: For example, if you sell leggings, and you find most people first refine by sport, consider adding sport as a subcategory of leggings, as seen on Sweaty Betty (picture below).
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: Published: August 07, 2023
- source body: 13357 chars

### `en_8b590d9b-728d-4cad-abd5-47e992661fc0_0_2`
- url: /blog/ai/knowledge-graphs-and-ontologies-adding-knowledge-to-keyword-search
- status: PASS  language: en
- abstract: Ontologies and knowledge graphs took that a step forward by adding _topic_ matching, where items and documents that fall within the same topic or contain the same entities (not necessarily the same words) are also considered relevant to a query. A knowledge graph is a specialized data structure and query language that permits people, usually domain experts, to represent information in easy-to-understand knowledge bits.
  - highlight: The Google Knowledge Graph, which contains over 500 billion facts, is used in nearly one-third of all its monthly searches.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: This concept can be applied to the 100M+ items in the graph.
  - highlight: Note that complex questions like "What is the best city for drinking wine?" cannot be answered with a knowledge graph.
  - highlight: To improve recall without compromising on precision, LLMs like OpenAI's ChatGPT, while still in their early stages, have surpassed knowledge graphs.
  - highlight: Building a knowledge graph is expensive and often fails to reach the size needed to answer enough questions to have a positive return on investment (ROI).
- source body: 18264 chars

### `en_ab2f2c68-9cfb-4b50-98f5-835d07bef908_0_1`
- url: /blog/product/how-when-and-why-do-mobile-users-engage-with-search
- status: PASS  language: en
- abstract: With so many mobile phone users opting to web search on their devices, it's important that online-business execs understand how, when, and why consumers are using their phones to search. When someone does a mobile search, they're querying an online search engine using a mobile device that's connected to the Internet. That's distinctly different from doing a search on a desktop computer in terms of both the type of device and the typical parameters (how, when, and why users are looking for content).
  - highlight: In the second quarter of 2022, mobile devices generated just less than 59% of global website traffic, outrunning desktop (and tablet, such as iPad) traffic.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: How, when, and why do mobile users engage with search?
  - highlight: Published: February 13, 2023
  - highlight: And people love that: about 82% of mobile shoppers type "near me" in their search bars to find geographically relevant results.
  - highlight: When it comes to smartphone users, 60% have directly contacted a business using search results appearing on their mobile phone.
  - highlight: According to App Annie, it's an average of 4.8 hours - roughly a third of the time they're awake.
  - highlight: Fun fact: more than half (52%) of the phone checking people do occurs during work hours.
- source body: 15665 chars

### `fr_6a3e40d7-5f5c-4545-b7d1-a34907fa3b15`
- url: /fr/blog/engineering/enter-algolia-coding-contest
- status: PASS  language: fr
- abstract: The deadline for all submissions is Wednesday, May 5th, 11:59PM PST. Build a search interface using Algolia.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: Or an $800 Amazon giftcard.
  - highlight: On top of that, each participant is entitled to a 1-month coupon to use Algolia for free.
  - highlight: Important note: you can only submit _one_ project.
  - highlight: Build a project using both the Strapi and Algolia APIs.
  - highlight: If you're not familiar with Strapi, we offer you a broader option: build a project using the Algolia API, plus any other APIs or tools you'd like for this project.
  - highlight: Build an Algolia implementation using a pre-made Codesandbox.
- source body: 9178 chars

### `fr_cd8b0e2c-52ea-4c7f-868e-2ae3ebc1d930`
- url: /fr/blog/ecommerce/how-to-use-search-and-browse-features-to-win-customer-loyalty-in-the-sports-industry
- status: PASS  language: fr
- abstract: For sports & goods retailers, designing a highly engaging online shopping experience is the key to leveraging this once in a lifetime opportunity. With well-selected and configured tools, sporting goods retailers will be able to achieve improved search relevance, decreased bounce rate, increased revenues, sales, click-through-rate, and conversion rates.
  - highlight: Conversely, last year Nike hit its ecommerce goal 3 years early, due to the robust investment in ecommerce tools and platforms.
  - highlight: Adidas is projecting to double its ecommerce revenues through 2025, by investing more than one billion euros in digital technology, such as 3D design, and hiring more than 1000 "tech and digital talents" in 2021 alone (Bloomberg, March 2021).
  - highlight: For example, ecommerce sporting-goods supply store Decathlon Singapore has dynamic autocomplete search functionality that limits visual noise: it lets users preview items on the search results page as they type their queries.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: When customers on Arc'teryx's sporting goods website enter a query related to customer service and support, they are directed to a dedicated support page, eliminating the need to spend time browsing the website.
  - highlight: Up to 12% of users leave the site after an unsuccessful search.
  - highlight: Sports fashion retailer Mammut offers shoppers a Pinterest-like convenient and highly intuitive browsing experience, with an emphasis on the visual category presentation.
- source body: 12883 chars

## human_review (1)

### `fr_0c867cdb-3008-4916-b0eb-3b773a73627b`
- url: /fr/blog/ecommerce/what-are-marketplace-platforms-and-software
- status: None  language: None
- abstract: (none)
- reason: duplicate span: 'What are marketplace platforms and softw'
- source body: 15023 chars

## language_mismatch (33)

### `de_2eb1dfdc-3641-4988-8189-b958bb02660f`
- url: /de/blog/product/what-is-an-api
- status: PASS  language: de
- abstract: API design dictates which information an API can share with clients and how this is done. REST (REpresentational State Transfer), SOAP (Simple Object Access Protocol), and RPC (Remote Procedure Call) are the commonly used API architectures.
  - highlight: A good API example is the Google Maps API.
  - highlight: As the name implies, these are produced to facilitate data transfer for internal company use only; they can't be accessed by third parties. However, some companies eventually take their internal APIs public.
  - highlight: Various data and services are combined in this type of API, which may reduce the number of API calls and overall complexity.
  - highlight: To make B2B needs easier to meet, authorized developers can access these types of APIs.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: Published: February 03, 2023
- source body: 14251 chars

### `de_3cd39d15-8137-41df-b676-700e5d759615`
- url: /de/blog/engineering/geo-spatial-search-on-mobile
- status: PASS  language: de
- abstract: Geo-spatial search or geo-search is no longer a buzz word or a nice to have in your service or app. To sum it up, Firebase + GeoFire can be a very useful and quick solution to your geo-spatial search problem. In case you have geo-aware data in Firebase, you can sync it to Algolia to get these more advanced geo-search features.
  - highlight: According to Google's 2011 "The Mobile Movement Study", 77% of smartphone users use their smartphone for search.
  - highlight: Since I had some experience with Firebase, I learned that I could use GeoFire on top of it, which allows to store and query a set of keys based on their geographic location.
  - highlight: GeoFire will only store the ID of a message and its coordinates; you cannot store any other metadata.
  - highlight: After indexing your object and in order to search based on a location, all you need is to add a field _geoloc with given latitude and longitude.
  - highlight: Instead of using the latitude and longitude you can define a rectangle or a polygon.
  - highlight: By default, Algolia will expand the search radius around the specified latitude and longitude until approximately 1000 hits are found.
- source body: 15681 chars

### `de_4488e990-e34c-48de-93be-1f54177cc119`
- url: /de/blog/ecommerce/trending-products-the-benefits-of-showing-online-shoppers-whats-hot
- status: PASS  language: de
- abstract: Because when you sell online, highlighting top trending products on your website or in your mobile app is likely to be as big a win in terms of ROI as it is for your customers who need to continually buy cool things in order to boost their egos. Trending items complement other product-centric item-recommendation models by displaying popular items or top-selling products (or product attributes) on your home page, where shoppers can easily notice them and become intrigued.
  - highlight: Good news: by 2023, online shopping revenue in the U.S. is expected to go above 1 trillion, says Statista.
  - highlight: Did you know that in the fashion industry, for instance, mobile devices account for the majority (66%, according to SaleCycle) of online sales?
  - highlight: Our client Birchbox increased its revenue per session and average order value each by 10%.
  - highlight: Did you know 43% of website visitors head straight to the search box (Forrester) upon arrival?
  - highlight: Our trending items model looks for items in your product catalog that have seen a recent increase in popularity based on conversion events.
  - highlight: To establish the "trendiness" for each record in the index, we look at both the total number of conversion events for each item over the past few days and the change in number of conversion events over time.
- source body: 18536 chars

### `de_5ed2c632-f0ea-4d47-9d4f-9bc71629d0c5`
- url: /de/blog/product/what-is-a-rest-api
- status: PASS  language: de
- abstract: The beauty of REST APIs (also known as REST _ful_ APIs; REST stands for representational state transfer), is their simple yet transformative technology. REST is a collection of rules that developers follow when creating APIs; a set of principles governing how different programs communicate.
  - highlight: One of the rules of REST is that you should get a piece of data (a resource) when you link to a particular URL.
  - highlight: A request consists of an endpoint (the URL you request for), a method, which defines the type of request sent to the server; headers, which represent the metadata; and data.
  - highlight: Did you know that Gmail, Twitter, and Instagram are all well known examples of REST APIs?
  - highlight: While there are other API architectures out there, including SOAP (Simple Object Access Protocol) and XML-RPC (remote procedure call), REST stands out.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: Published: September 15, 2022
  - highlight: A stateless transaction is an interaction-independent one, and REST is intended to be stateless.
- source body: 13341 chars

### `de_61810251-184b-4914-a971-6520b7c4136e`
- url: /de/blog/ux/how-does-autocomplete-maximize-the-power-of-search
- status: PASS  language: de
- abstract: Autocomplete search suggestions functionality, also known as predictive search (and typeahead), is a software function in text-based applications that aims to automatically complete a word or phrase as you type it. The benefits of autocomplete - a better user experience, mobile-friendly search, and accurate search results for things users are super interested in - mean that people find their way to what they need in your online store.
  - highlight: Software engineer Kevin Gibbs brought the idea to Google and was pivotal in launching what he called Google Suggest (now Google Autocomplete; his utilization of technological advances such as Big Data and high-speed Internet created an eerily accurate and personalized predictive service.
  - highlight: For starters, search engine companies like Google have a blacklist, so certain words and phrases, such as those related to violence, hate speech, and copyright infringement, are omitted.
  - highlight: Autocomplete doesn't just pay attention to _what_ someone is searching for, it's cognizant of _where_ they're searching for it.
  - highlight: According to SlideShare, 80% of consumers are more likely to buy from a company that provides a personalized customer experience.
  - highlight: But cumulatively, says Google, it can save more than _200 years_ of typing per day.
  - highlight: Algolia provides best-in-class search and discovery technology for businesses, delivering personalized shopping experiences that can boost conversion rates 30%+.
- source body: 12544 chars

### `de_68145583-106d-479c-a9dc-7ba0464f4500`
- url: /de/blog/product/5-reasons-to-add-clicks-to-site-search-analytics-and-code-to-do-it
- status: PASS  language: de
- abstract: As you'll see below, the insights obtained by site search analytics and click and conversion data form the basis for more advanced and competitive search functionalities, which work to let you utilize your search tools for fun and profit. Together with conversion analytics, it feeds into and makes possible ML/AI-driven functionalities such as Personalization, A/B testing, and Dynamic Re-Ranking, all enabling you to produce a competitive consumer-grade search experience on a par with those of giants like Amazon, Google, and Netflix.
  - highlight: Implementing Click Analytics allows you to keep track of metrics, including the click-through rate (CTR), conversion rate, and no-click rate, all of which reveal user intent.
  - highlight: Dynamic Re-Ranking - a feature that adjusts the order of results based on recent clicks - is a striking example of how directly click analytics can impact your users' Search and Discovery experiences.
  - highlight: When you add user-specific information to your click and conversion events, you can leverage your analytics data to enable Personalization: a widely used feature that boosts products based on a user's personal preferences for a specific facet or category of items.
  - highlight: Algolia handles all the variant switching of an A/B test.
  - highlight: So you'll be glad to know that with Click Analytics, you need to take only one action: send user events to Algolia.
  - highlight: Note: We have versions of InstantSearch for vanilla JavaScript, React, Angular, Vue, iOS, and Android.
- source body: 22633 chars

### `de_979ff306-5d0f-4888-8b01-5156a6b1c2c6`
- url: /de/blog/engineering/real-demo-fake-css-api-client
- status: PASS  language: de
- abstract: On March 31st, we announced our CSS API Client, that replicated a search engine with only CSS. The final demo has some huge drawbacks that make it unusable in production (the massive filesize of the generated CSS being the main one), but it still has some nice features that I'd like to shed some light on in this blogpost.
  - highlight: Not wanting to do this task by hand, I wrote a Ruby script that generates the n-grams for any word, and outputs the CSS selectors to a new file.
  - highlight: I used Cloudinary to make all images round, resized and grayscale.
  - highlight: To handle the typos for this specific word, I had to generate 40 more n-grams, one for each variation of the word with one letter removed (except for the first and last one).
  - highlight: The trick I used was to generate a custom font that is a merge of Raleway Regular and Raleway Bold.
  - highlight: As soon as you start using flexbox-based display, you can apply an order: to any element to change its position in the display.
  - highlight: Still, the final file is 4Mb.
- source body: 21078 chars

### `de_a6de78c6-74c7-4ef6-bc31-d89abaf397be`
- url: /de/blog/product/introducing-ai-personalization
- status: PASS  language: de
- abstract: Algolia's AI Personalization will equip merchandisers and developers with the ability to present each online visitor with precisely tailored content, leveraging comprehensive insights from their behavior, preferences, feedback, and attributes - even in cases where no explicit information has been shared. After processing the user behavior data (events and records), AI Personalization is generating user profiles that consist of affinities - attributes of products that each and every individual user has engaged with throughout multiple touchpoints (search, browse, discovery, etc.).
  - highlight: This is where AI personalization excels, as it automatically adjusts event and facet weights, optimizing user profiles to boost business outcomes while maintaining consumer satisfaction.
  - highlight: These user profiles and their affinities are then applied at query time to re-rank results according to those preferences, enhancing relevance and ultimately improving key performance indicators (conversion rate, average order value, or revenue).
  - highlight: Use ruleContexts to create rules to promote products based on segmented end-users, such as "new" or "returning," "mobile" or "desktop," "loyal" or "inactive."
  - highlight: Exporting Algolia-enriched user profiles into 3rd party platforms to power custom/internal workflows can easily be accomplished with the affinity parameter /users?affinity={affinity}.
  - highlight: AI Personalization is available starting today in public beta on high-availability infrastructure around the world.
  - highlight: It's deployed through a single API alongside our extensive libraries of popular coding languages and free community-supported connectors; or you can leverage it through our Merchandising Studio and powerful dashboard.
- source body: 13220 chars

### `de_a71cb347-be66-4d1d-a924-88bbddc68610`
- url: /de/blog/ecommerce/15-best-practices-for-ecommerce-on-site-search
- status: PASS  language: de
- abstract: Improving ecommerce search can have a significant business impact on the bottom line. But to gain this benefit requires careful planning, leveraging a modern ecommerce site search software, and maintaining an ongoing commitment to best practices. In this blog, we're going to share 15 best practices and examples for increasing conversions.
  - highlight: Consumers who use search are 2.4 times more likely to buy, and whether they buy are not is clearly influenced by the quality of the search experience.
  - highlight: Somewhere between 20-30% of search queries can contain a misspelling!
  - highlight: Studies show that one-third of all searches contain 4+ or more keywords.
  - highlight: BigCommerce found that personalization can lower bounce rates by as much as 20-30%.
  - highlight: To cite just one example, Algolia client Huckberry realized a 9.4% increase in website revenue when it adopted personalization.
  - highlight: Algolia offers a rich, AI-driven feature set including an unique hybrid search approach which combines the sophistication and high accuracy of vector technology with the speed of keyword search.
- source body: 38583 chars

### `de_c941f136-412f-40d9-9ca8-8bfc15acaf5c_0_2`
- url: /de/blog/engineering/the-evolution-of-personalization
- status: PASS  language: de
- abstract: The industry reached new maturity by 2018 when Algolia introduced personalization that merged search queries with user behavior. The goal isn't just to predict what users want - it's to create interfaces that feel alive, responsive, and genuinely helpful.
  - highlight: When Amazon launched their recommendation system in 1998, they aimed to recreate this intimate bookstore experience at an unprecedented scale.
  - highlight: _Example of early uses of personalization on amazon.com in 1998_ Google's introduction of personalized search results in 2005 marked another milestone.
  - highlight: Netflix elevated personalization to new heights in 2011 by introducing contextual awareness.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: Slow decay works well for stable preferences within sessions, while fast decay suits applications where interests change rapidly.
- source body: 16405 chars

### `de_e04119c3-7049-40b2-8676-7eb9ef2d1f9a`
- url: /de/blog/product/algolias-top-10-tips-to-achieve-greatly-relevant-search-results
- status: PASS  language: de
- abstract: Relevance is a well understood concept in search engines, but is pretty complex to measure, as a high degree of subjectivity is implicit in the notion of relevance. In fact, we've seen time and again that too many people spend too much time trying to control their relevance. We hope this list of advice will be useful to help you get a better search functionality on your website or app.
  - highlight: For example you should be able to find a record that contains "iphone" for the query "i-phone" and "i phone" or find a record containing "hi-speed usb" with a query "hispeed usb".
  - highlight: All these cases are automatically handled for you by the Algolia engine.
  - highlight: The most popular open source stemmer is Snowball and is based on a set of rules per language.
  - highlight: Most phonetic algorithms are based or derived of the Soundex algorithm and only work with English language.
  - highlight: From our experience, the addition of business data makes a big difference if the textual relevance is good.
- source body: 15606 chars

### `de_e1028147-1e4c-4fe6-9e08-3713b851e1ce`
- url: /de/blog/ai/why-chatgpt-wont-replace-search-engines-any-time-soon
- status: PASS  language: de
- abstract: The lack of real danger to them has to do with search relevance and user experience in chat-based environments. I've learned what works and what doesn't, and while I'm long on LLMs (large language models), I'm not long on replacing the existing search paradigm. But I do think that the lack of context and multiple choices is inescapable within a pure chat context.
  - highlight: ChatGPT responses are, however, heavily dependent on the prompt (i.e., query) formulation.
  - highlight: Search must understand searchers even with misspellings, or else the experience is a step back.
  - highlight: At Algolia, we take two approaches: one is a straightforward edit distance between text; the other is via our upcoming AI Search that matches on concepts and takes into account contextual clues to better match the correct spelling even when the edit distance is large.
  - highlight: This blog post claims that the number one result on a Google search is clicked 28% of the time.
  - highlight: Chatbot natural language understanding (NLU) can sometimes have a high failure rate (we've seen customers approaching 50% failure) and search seems like a natural fallback.
  - highlight: In these situations, it is _so_ important for searchers to be able to see options, filter down with a click, and generally get deep into a "discovery phase." This is not what chat is suited for.
  - highlight: There are other hurdles: legal (Australia has a law requiring payment from Google and Facebook for news; what will they think when the news is automatically summarized without sources?), cost, and speed immediately come to mind.
- source body: 13370 chars

### `de_e79c2fe6-acaa-4fa9-98d6-bdd0db2513ad`
- url: /de/blog/product/leveraging-adobe-launch-events-in-algolia-for-personalization
- status: PASS  language: de
- abstract: With our partner Adobe, we have focused on bringing in event data from Adobe Launch into Algolia to understand what behaviors and actions customers have taken both online and offline. We built an Algolia Insights extension for Adobe Launch, which provides two pre-packaged Algolia Insights events ('click after search' and 'convert after search') wrapped in an Adobe Launch extension. When one of these user events takes place on the page, Launch will send the events and appropriate metadata back to Algolia, and our search engine will use the information to re-rank products in a way that reflects trends and personal affinities.
  - highlight: Adobe Launch is a tag manager and distribution container, allowing digital teams to collect user behaviors on their web properties and to leverage those events in their workflows.
  - highlight: Launch adds a Javascript onto a page as the customer browses the site.
  - highlight: These two events - 'click after search' and 'convert after search' - are created as an "Adobe Action".
  - highlight: These actions require inputs such as query ID, product ID, position, and user ID, which we can get from the search results.
  - highlight: Above, you can see an example of how we might use specific events to define the search personalization strategy within Algolia.
- source body: 9922 chars

### `de_e8887089-dd36-4ad8-a061-0ae471be3c8a`
- url: /de/blog/ecommerce/merchandising-strategy-best-practices-and-tactics-to-drive-more-sales
- status: PASS  language: de
- abstract: A merchandising strategy refers to the planning and execution of activities to increase your online store revenue and improve your customer satisfaction. Its facets could include upselling, cross-selling, promotions, sales, limited-time offers, and product recommendations.
  - highlight: With online shoppers, you have only 8 seconds to make an impression, according to Microsoft.
  - highlight: Techniques like the "racetrack" layout encourage shoppers to explore more of the store.
  - highlight: Optimizing your ecommerce site for mobile is essential. In fact, 58% of all multi-device purchases are made on mobile.
  - highlight: Not only that but 78% of shoppers are more likely to recommend your platform to friends, as well as repurchase, if you use personalization.
  - highlight: With research indicating that the average cart abandonment rate is 70.19%, you need to implement the right process so your shoppers don't become part of that statistic.
  - highlight: Research backs this up, suggesting that customer reviews - a form of "social proof" - impact more than 80% of purchases.
  - highlight: Algolia offers proven Search and Discovery technology to help you streamline your online merchandising battle plan.
- source body: 21261 chars

### `de_f499b4ed-6ea8-4b03-9b52-cb5ff467fbf0`
- url: /de/blog/ai/llms-changing-ecommerce
- status: PASS  language: de
- abstract: The short answer: LLMs work well for certain tasks but not for others, and their strengths make them potentially great team players for generating revenue in the online arena. The trick lies in not relying too much on an LLM but in putting it to work _in conjunction with_ a mature search solution.
  - highlight: In line with that sentiment, McKinsey is forecasting the potential economic impact of generative AI to range from $2.6 to $4.4 trillion globally.
  - highlight: The company has debuted a chatbot, Rufus, with an LLM trained on the product catalog and customer reviews, to answer user queries at various stages of the shopping journey.
  - highlight: So far, reviews for Rufus have been decidedly disappointing.
  - highlight: The problem with many current generative AI applications is that companies are using them to _replace existing, working technology_ instead of simply augmenting online shopping experiences.
  - highlight: GenAI can't provide traditional search results, as it's not designed to come up with comprehensive, accurate results from a limited dataset, such as a product catalog.
  - highlight: "AI hallucination is a phenomenon wherein a large language model (LLM) - often a generative AI chatbot or computer vision tool - perceives patterns or objects that are nonexistent or imperceptible to human observers, creating outputs that are nonsensical or altogether inaccurate," explains IBM.
  - highlight: Our brand new Generative Shopping Experiences are unleashing state-of-the-art solutions for product comparisons, reviews, buyers' guides, and query refinement.
- source body: 20434 chars

### `de_f55b4f45-2c33-42a7-934e-486ea8d256a7`
- url: /de/blog/ai/experience-essential-tips-for-evaluating-genai-content-quality/essential-tips-for-evaluating-genai-content-quality-1
- status: PASS  language: de
- abstract: Evaluating and maintaining high standards for genAI content is not just a technical task but a strategic necessity that directly impacts user satisfaction, engagement, and business outcomes. By understanding the importance of content evaluation, leveraging prompt engineering, and employing continuous monitoring, businesses can keep their genAI outputs relevant, accurate, and engaging.
  - highlight: Using readability tools such as the Flesch-Kincaid score helps assess the complexity of content, adjusting language and sentence structure to match the audience's reading level.
  - highlight: Tools like the Retrieval-Augmented Generation Assessment System (RAGAS) help measure how well AI-generated content aligns with user queries, breaking down responses to verify their accuracy and contextual relevance.
  - highlight: Real-time analytics platforms, such as Google Cloud's Natural Language API or AWS Comprehend, provide powerful capabilities for assessing sentiment, relevance, and engagement metrics.
  - highlight: Frameworks like LangChain and other AI-driven platforms enable businesses to automate content evaluations, allowing outputs to meet predefined standards without extensive manual oversight.
  - highlight: Collecting data from user interactions-such as click-through rates, time spent on pages, and direct feedback through surveys-helps businesses identify areas for improvement.
- source body: 13040 chars

### `de_f7fc2c52-363c-42b0-8fc3-0de7735ed70d`
- url: /de/blog/ai/generative-ais-impact-on-the-ecommerce-industry
- status: PASS  language: de
- abstract: GenAI is having a transformative impact on ecommerce. GenAI can leverage personalization data from multiple sources to help deliver the shopping experience most relevant to the individual customer, and most likely to result in high AOV conversions. In addition, GenAI can enrich the customer experience with two-way communication in real time, and automate other ecommerce processes to improve efficiency and reduce costs.
  - highlight: In one recent Harvard Business Review study, 31% of the respondents said they were using GenAI within their ecommerce operations.
  - highlight: According to another HBR report, 69% of respondents using GenAI achieved improvements in speed and efficiency.
  - highlight: It's widely reported that GenAI - using personalized recommendations - can increase sales as much as 20%.
  - highlight: And according to one study, personalization increased average order value for 98% of the participants.
  - highlight: And they clearly increase engagement, as the growing adoption of chatbots demonstrates - 67% of consumers have used a chatbot within the last year.
  - highlight: Simply finding the individuals to build a GenAI team is difficult, with a current talent shortfall estimated at 250,000. Furthermore, this gap between supply and demand means that the available talent is expensive.
  - highlight: According to one study, 80% of retailers are either using GenAI or piloting projects, and 90% intend to increase their investment in GenAI in the coming fiscal year.
- source body: 25905 chars

### `fr_0c867cdb-3008-4916-b0eb-3b773a73627b`
- url: /fr/blog/ecommerce/what-are-marketplace-platforms-and-software
- status: QUARANTINED_BY_GATE  language: fr
- abstract: (none)
- source body: 15023 chars

### `fr_29980523-275d-4a5a-a1a9-d274d160b54d`
- url: /fr/blog/ecommerce/search-banners
- status: PASS  language: fr
- abstract: Think of a search banner as that eye-catching visual element that appears alongside your search results. Earlier this year, Algolia introduced a convenient built-in banner solution to simplify the process of adding banners to your search results. When you require more intricate data structures, dynamic content, or advanced layouts, custom banners are the answer.
  - highlight: A rule with the new Banner consequence: Rules are the core of Algolia's search customization, and the new Banner consequence allows you to easily trigger the display of a banner based on specific conditions.
  - highlight: Overriding CSS classes: Algolia provides CSS classes for the banner root, banner image, and banner link, allowing you to apply your own styles and branding.
  - highlight: The banner data is restricted to an image URL, alt text, and target URL, which might not be sufficient for more complex scenarios.
  - highlight: You can leverage the manual rules editor to return custom data (in JSON format) along with your search results, providing greater flexibility and control.
- source body: 10375 chars

### `fr_314517e2-134a-4a29-b515-4938d02086df`
- url: /fr/blog/algolia/algolia-leaders-women-in-tech
- status: PASS  language: fr
- abstract: We asked our women leaders about their career paths, challenges they faced, advice they'd share with other women in tech, and what makes Algolia a great place to work. Adanech has been with Algolia for 3.5 years, and was the first woman on the Algolia exec team.
  - highlight: Bernadette joined Algolia in May 2020.
  - highlight: I'm definitely a CEO who came up through the GTM side of the business, predominantly in sales and sales leadership. But I also took rotational assignments to round out my experience, from running a big chunk of marketing to an IT leadership role.
  - highlight: On making legal and compliance an integral part of the business.
  - highlight: Kristie joined us in June 2019.
  - highlight: We are making huge progress looking for diverse candidates in the leadership ranks, and are doubling down on our D&I initiatives and our recruiting efforts.
- source body: 14316 chars

### `fr_3415f916-e887-4342-aff2-ce8e7a24e491`
- url: /fr/blog/engineering/how-we-reduced-boilerplate-and-handled-asynchronous-actions-with-redux
- status: PASS  language: fr
- abstract: So far our experience has been very positive; it was _so good_ that we eventually decided to introduce React onto our dashboard, along with Redux to handle _shared state_ across components. After a few iterations, we ended up with _redux-updeep_, a strongly opinionated createReducer implementation which assumes that the majority of the actions will result in deep updates of the reducer's state. So we decided to create one, the redux-magic-async-middleware, and we've just open sourced it!
  - highlight: There's nothing particularly controversial here, with the exception of one convention we've chosen to impose: To collocate Redux action creators and reducers in the same files, following the Ducks proposal.
  - highlight: We're pretty happy with our current set up, so we thought that we would share it with the world. In fact, we've just open sourced it!
  - highlight: The redux-thunk middleware is available but enforces no rules: it simply enables you to dispatch multiple actions from a single action creator.
  - highlight: If you have as many simultaneous asynchronous actions as we do, and want to handle them all in the same way (e.g. how to keep track of the pending state, how to handle errors), it rapidly becomes a tedious task.
  - highlight: In combination with this, we have created the eventual-values library, very much inspired by another eventual values library.
  - highlight: We're still experimenting with those concepts and tools, and are gradually introducing flow typing in our codebase.
- source body: 13869 chars

### `fr_439a7486-8c49-4fd1-9c40-e5446b3cbda7`
- url: /fr/blog/ecommerce/site-search-vs-chatgpt-the-future-of-b2b-ecommerce-unveiled
- status: PASS  language: fr
- abstract: Hosted by renowned industry experts, Brian Beck and Andy Hoar, this insightful webinar aimed to explore whether ChatGPT, the fastest-growing app ever, might potentially outperform traditional site search methods in the B2B eCommerce sector. It means finding the specific product an individual user is looking for, with all the B2B centered specifications, and that takes a contextual understanding that is missing from ChatGPT. Generative AI models like ChatGPT lack access to data sources like PIM, CDP, or even buyer history and behavioral data, and are therefore more focused on handling the singular query experience versus optimizing the experience and personalizing it across the customer journey as site search solutions can do.
  - highlight: For example, one Algolia customer, MSA Safety, sells to 4 different industries, so if you're looking for a safety helmet - you're going to want very different results if you work in construction than if you work in fire safety.
  - highlight: That's why Algolia is proud to be the only search provider on the market to incorporate both keyword and semantic search for each query powered by AI that can return the most relevant results under 20ms even when working on catalogs with tens of millions of product SKUs and various combinations.
  - highlight: Understanding these nuances requires access to private data which ChatGPT does not have.
  - highlight: This conversational agent would retrieve products and associated specifications, facets, and various attributes from their indices that are running on Algolia NeuralSearch as a way to further simplify and enhance the buying journey.
- source body: 12089 chars

### `fr_6a3e40d7-5f5c-4545-b7d1-a34907fa3b15`
- url: /fr/blog/engineering/enter-algolia-coding-contest
- status: PASS  language: fr
- abstract: The deadline for all submissions is Wednesday, May 5th, 11:59PM PST. Build a search interface using Algolia.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: Or an $800 Amazon giftcard.
  - highlight: On top of that, each participant is entitled to a 1-month coupon to use Algolia for free.
  - highlight: Important note: you can only submit _one_ project.
  - highlight: Build a project using both the Strapi and Algolia APIs.
  - highlight: If you're not familiar with Strapi, we offer you a broader option: build a project using the Algolia API, plus any other APIs or tools you'd like for this project.
  - highlight: Build an Algolia implementation using a pre-made Codesandbox.
- source body: 9178 chars

### `fr_6e10d8b9-89fc-45d7-983d-8a5ede03872f`
- url: /fr/blog/product/transforming-your-algolia-experience-with-data-transformation
- status: PASS  language: fr
- abstract: The new Data Transformation feature solves these issues and helps you get the most out of your data to fuel Algolia's AI power. Transform, clean, and manipulate data during ingestion with built-in tooling that makes data ingestion easy.
  - highlight: Transformations can be done at a record level and both before and after indexing.
  - highlight: To me, the coolest capability is now you can convert a flat list of categories into a hierarchical structure.
  - highlight: The editor comes with several pre-built transformation helper functions for common use cases.
  - highlight: The code editor seen below comes with autocomplete, sampling, and debugging capabilities and includes options to write and maintain custom transformation functions-your own magic.
  - highlight: Algolia makes it easy for you to utilize transformations for Data Connector and API Client Traffic.
- source body: 8172 chars

### `fr_7eb62076-1ae4-4280-8973-fb3591b873f2`
- url: /fr/blog/ai/building-recommendations-for-ecommerce-media-with-without-ai-1
- status: PASS  language: fr
- abstract: While filtering-based recommendations (as discussed below) are simple to implement and don't necessarily rely on complex algorithms, they have their limitations. Modern solutions based on machine learning offer a significant improvement. Algolia Recommend delivers high-performance AI-powered recommendations in an API.
  - highlight: Amazon is at the forefront of AI-powered recommender systems - recommendations account for 35% of their sales.
  - highlight: Without using any AI, you can make recommendations by using tags and sales history.
  - highlight: The richest data available to ML-based recommendation engines is user events like clicks and conversions.
  - highlight: If you choose to use Algolia, its Insights API will be your hub for collecting and sending user event data to your Application.
  - highlight: Collaborative filtering algorithms fall into a few categories - user-based, item-based, hybrid, and matrix factorization.
- source body: 18678 chars

### `fr_7fc0f629-2a0d-423a-a197-67444bfc1dfb`
- url: /fr/blog/ux/the-knowledge-management-process-4-steps-to-corporate-success
- status: PASS  language: fr
- abstract: The knowledge management process comprises four steps that can be implemented by management initiatives. An effective knowledge management process makes your company information easily accessible, sidestepping the need to plow through multiple data silos in search of key info.
  - highlight: Explicit knowledge: information that can be documented and shared.
  - highlight: Implicit knowledge: information that is learned.
  - highlight: Tacit knowledge: information that might be difficult to formally relay to another person.
  - highlight: WordPress is one often-used content management system for building a knowledge base, and there are many other good options on the market.
  - highlight: Sharing content by way of collaboration tools (e.g., Slack) can boost its dissemination as reference material.
  - highlight: As successful knowledge management solutions go, the Algolia search tool is worth a look; it can optimize your knowledge base for first-rate knowledge discovery.
- source body: 13004 chars

### `fr_8f33e5c1-53db-45e3-a3ff-5245044d942c`
- url: /fr/blog/product/for-slas-theres-no-such-thing-as-100-uptime-only-100-transparency
- status: PASS  language: fr
- abstract: In recent years it's become fashionable for companies to include 100% uptime guarantees in their SLA - and, in some cases, even more than 100%, despite its mathematical impossibility. Premium: 99.999% uptime, each minute of downtime would make you eligible for 1,000 minutes of refund, up to a cumulative value of 600% of the monthly service billing over a year.
  - highlight: The market standard is typically 1 minute; however, 1 minute of downtime per month means 99.9977% uptime - so what exactly is 100% uptime then?
  - highlight: One SaaS provider on the market today promises 100% uptime, yet their SLA only promises any refunds or credits after 0.05% downtime per month, which is a little over 20 minutes!
  - highlight: Premium: we replicate your search on at least three different machines hosted by three different providers in three different data centers with three autonomous systems using at least two different Tier1 upstream providers.
  - highlight: Enterprise: 99.99% uptime, each minute of downtime would make you eligible for 100 minutes of refund, up to a cumulative value of 100% of the monthly service billing.
  - highlight: Our outage detection starts at 30 seconds (0.001% of a month) instead of 1 minute.
  - highlight: As you can see, with our Premium SLA, if our service is down 45 minutes, we refund you 100% of your monthly bill - it doesn't get much simpler than that.
  - highlight: Our setup has been extensively tested with outages of entire datacenters and networks and we've still been able to maintain 100% uptime.
- source body: 10728 chars

### `fr_9685f45f-69bd-4809-bd3e-bc9e4cca244f`
- url: /fr/blog/ai/what-is-cognitive-search-and-what-could-it-mean-for-your-business
- status: PASS  language: fr
- abstract: Forrester describes cognitive search as "a new generation of enterprise search solutions that employ AI technologies such as natural language processing and machine learning to ingest, understand, organize, and query digital content from multiple data sources." The improved relevance and efficiency, and the time savings as a result, lead to enterprise benefits such as a higher conversion rate, a more loyal customer base, a more productive sales force, and higher revenue.
  - highlight: It uses natural language processing (NLP) and machine learning to make sense of and process product specifications, descriptions, and images in a database.
  - highlight: Unlike keyword search, cognitive search crawls unstructured data and structured data, recognizes patterns and meaning, and generates high-quality search results from all the sources.
  - highlight: Did you know that according to McKinsey, employees spend roughly 19% of their work day searching for information?
  - highlight: And with 88% of online customers saying they won't return to a website where they've had an unpleasant experience, companies' producing seamless user experiences is vital.
  - highlight: According to MIT, 80-90% of data is unstructured: in a format that's not easily searchable, for example, text and social media posts.
  - highlight: Recognized by IDC, Gartner, Forrester, and Paradigm B2B, Algolia helps enterprises turn search into a growth engine for AI-native experiences.
- source body: 15596 chars

### `fr_9b1a527c-df09-47b4-8145-3d06b27e2be7`
- url: /fr/blog/engineering/why-you-should-capture-click-and-conversion-events-from-day-one
- status: PASS  language: fr
- abstract: When we track clicks and conversion events from day one in a flexible system like Algolia, we can then improve our business "holistically" - in other words, tracking analytics makes the business better all around. Either way, we'll need input data to train the AI on our product catalog, and the way we do this is to send click and conversion events to Algolia!
  - highlight: For example, Algolia Recommend can (as the name suggests) recommend products, content, or categories to users based on some previous data.
  - highlight: For example, Algolia lets you A/B test different index settings, but that only makes sense if you have a way to measure the results.
  - highlight: Algolia can handle the Frequently Bought Together section for us - by sharing at least 1,000 conversion events (checkouts, in our example) with multiple products over the last 30 days, we're then good to go.
  - highlight: But to truly reflect your users' behavior, you'll need event data - 10,000 clicks or conversions over the last 30 days is enough for Algolia to make accurate conclusions about what products generally relate to each other.
  - highlight: If you'd prefer to store your analytics data elsewhere, but want the benefits of Algolia's dashboard and AI-driven search, there are plugins for GTM and Segment available too.
- source body: 14468 chars

### `fr_c51930af-1156-493a-837a-2b6911a45c26`
- url: /fr/blog/ecommerce/ai-and-personalization-grocery-survey
- status: PASS  language: fr
- abstract: In parallel, interest in AI in grocery is exploding, particularly among Millennials and Gen Zers, challenging grocers to provide value and tap into AI to provide more tailored, engaging and convenient experiences. To better understand consumer expectations for AI in grocery, we surveyed 1,000 U.S adults.
  - highlight: Roughly one-third (30%) of consumers say grocery bills are stressing them out this year, and it's changing what they buy.
  - highlight: Nearly half of consumers (46%) want grocery retailers to offer deal recommendations tailored to their current cart or past purchases.
  - highlight: Now it is possible to simply take a picture of that list, have a cart filled with products you prefer, and have it delivered.
  - highlight: 59% believe AI will make grocery shopping more convenient.
  - highlight: Yet, 50% don't trust AI agents to manage grocery shopping because they worry the agents will hallucinate and purchase the wrong items.
  - highlight: Only 44% of Millennials and 55% of Gen Z are confident in using an AI agent to reorder household staples, though younger demographics are usually the most pro-AI.
- source body: 10090 chars

### `fr_cc56e727-0901-4b65-a6b4-83a64241a1da`
- url: /fr/blog/ai/what-is-end-to-end-ai-search
- status: PASS  language: fr
- abstract: End-to-end AI search includes AI-powered query understanding, retrieval, and ranking. Algolia NeuralSearch sends each query through three phases to deliver the best results.
  - highlight: Historical data suggests that most companies will optimize their most popular queries, however, 50-70% of revenue is left on the table due to unoptimized long-tail.
  - highlight: Keyword search engines tend to provide better results for head terms, whereas AI vector search works well for less popular long tail queries.
  - highlight: Techniques such as HNSW (Hierarchical Navigable Small World), IVF (Inverted File), or PQ (Product Quantization, a technique to reduce the number of dimensions of a vector) are some of the most popular Approximate Nearest Neighbor (ANN) methods to find similarity between vectors.
  - highlight: At Algolia, we pioneered a new technique called neural hashing.
  - highlight: The binary vector is much smaller and faster to calculate than standard vectors, which allows us to run vector and keyword search simultaneously and at scale on commodity CPUs.
  - highlight: It took AirBnB a team of very talented data scientists and engineers two years to build an AI ranking solution!
- source body: 17276 chars

### `fr_cd8b0e2c-52ea-4c7f-868e-2ae3ebc1d930`
- url: /fr/blog/ecommerce/how-to-use-search-and-browse-features-to-win-customer-loyalty-in-the-sports-industry
- status: PASS  language: fr
- abstract: For sports & goods retailers, designing a highly engaging online shopping experience is the key to leveraging this once in a lifetime opportunity. With well-selected and configured tools, sporting goods retailers will be able to achieve improved search relevance, decreased bounce rate, increased revenues, sales, click-through-rate, and conversion rates.
  - highlight: Conversely, last year Nike hit its ecommerce goal 3 years early, due to the robust investment in ecommerce tools and platforms.
  - highlight: Adidas is projecting to double its ecommerce revenues through 2025, by investing more than one billion euros in digital technology, such as 3D design, and hiring more than 1000 "tech and digital talents" in 2021 alone (Bloomberg, March 2021).
  - highlight: For example, ecommerce sporting-goods supply store Decathlon Singapore has dynamic autocomplete search functionality that limits visual noise: it lets users preview items on the search results page as they type their queries.
  - highlight: ✨ How will Algolia improve our search experience and conversions? ✨ How do I integrate Algolia search into my app? ✨ Can Algolia help shoppers find products faster and increase sales? ✨ Will Algolia scale with our traffic and data size?
  - highlight: When customers on Arc'teryx's sporting goods website enter a query related to customer service and support, they are directed to a dedicated support page, eliminating the need to spend time browsing the website.
  - highlight: Up to 12% of users leave the site after an unsuccessful search.
  - highlight: Sports fashion retailer Mammut offers shoppers a Pinterest-like convenient and highly intuitive browsing experience, with an emphasis on the visual category presentation.
- source body: 12883 chars

### `fr_dffb4cae-856e-4a95-86b0-fd186bc9dce9`
- url: /fr/blog/engineering/feature-spotlight-trends-models-in-recommend
- status: PASS  language: fr
- abstract: Today, we're putting a spotlight on Recommend's new Trends models. _Trends_ models are similarly powered by collaborative-filtering, but are different in that they aren't restricted to recommendations based on a single product. Instead, they look for product trends across the entire catalog, or within a particular facet/category of your catalog.
  - highlight: Trending items - The most popular items either for a specific facet value or across the entire catalog.
  - highlight: Trending facet values - The most popular values for a specific facet (e.g. "sweaters" as a value for "category").
  - highlight: In order to use trends, you'll need to train the model with at least 500 conversion events spread out over at least three days.
  - highlight: Both models, once trained, can provide up to 30 recommendations, either globally or within a specified facet.
  - highlight: Training typically takes a few hours to complete.
- source body: 14405 chars
