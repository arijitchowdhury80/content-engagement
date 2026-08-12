To: arijit.chowdhury@algolia.com
Cc: arijit.chowdhury@algolia.com, [Jon Silvers email needed]
Subject: 104 stale Blog URLs still indexed but serving Page Not Found

Hi Arijit and Jon,

While working through the Blog category in the Algolia index, we found 104 Blog records whose URLs no longer resolve to real blog pages.

In simple terms: these records still exist as qualified records in the Algolia index, but when you open the corresponding URL on algolia.com, the page returns Page Not Found / 404-style content. That means the index is still carrying searchable Blog records for pages that no longer exist on the website.

Summary:
- 104 Blog URLs are affected
- 0 of these URLs currently resolve to a live blog article
- 66 redirect but still serve Page Not Found content
- 38 return HTTP 404 directly
- These represent 38 unique article paths after removing /de and /fr locale variants

Recommendation: remove these stale Blog records from the searchable index, or map them to replacement canonical URLs if content owners can provide replacements.

URLs:
1. https://www.algolia.com/blog/ai/change-slug
2. https://www.algolia.com/blog/ai/top-examples-of-some-of-the-best-large-language-models-out-there
3. https://www.algolia.com/blog/customers/algolia-search-improving-trading-card-experience
4. https://www.algolia.com/blog/customers/best-practices-for-ecommerce-personalization
5. https://www.algolia.com/blog/customers/best-ways-to-leverage-ai-to-optimize-a-user-conversion
6. https://www.algolia.com/blog/customers/bringing-algolia-s-faceting-experience-to-mobile-the-evolution-of-appapp
7. https://www.algolia.com/blog/customers/building-a-better-istyles-shopping-experience-with-algolia-search
8. https://www.algolia.com/blog/customers/building-a-video-discovery-platform-with-algolia-unreel-co
9. https://www.algolia.com/blog/customers/collaborative-3d-printing-made-possible-by-pinshape-search-powered-by-algolia
10. https://www.algolia.com/blog/customers/concertwith-me-s-competitive-edge-a-revamped-search-ux-with-algolia
11. https://www.algolia.com/blog/customers/gymsharks-journey-to-mach-the-practical-case-for-search-and-navigation
12. https://www.algolia.com/blog/customers/hacker-news-search-6-5-million-articles-and-comments-at-your-fingertips
13. https://www.algolia.com/blog/customers/how-abacus-leverages-algolia-for-realtime-expense-reporting
14. https://www.algolia.com/blog/customers/how-algolia-helped-improve-ux
15. https://www.algolia.com/blog/customers/how-algolia-increased-tradepub-com-s-search-conversions-by-70
16. https://www.algolia.com/blog/customers/how-algolia-is-powering-up-prodpad-s-help-center
17. https://www.algolia.com/blog/customers/how-algolia-keeps-all-your-data-safe-but-searchable-on-solid
18. https://www.algolia.com/blog/customers/how-beyond-retro-improved-its-ecommerce-site-with-algolia-s-magento-plugin
19. https://www.algolia.com/blog/customers/how-swedol-created-a-better-digital-b2b-experience
20. https://www.algolia.com/blog/customers/how-to-boost-online-sales-with-category-merchandising
21. https://www.algolia.com/blog/customers/how-to-increase-online-sales-with-search-merchandising
22. https://www.algolia.com/blog/customers/inside-growthhackers-com-s-implementation-of-algolia
23. https://www.algolia.com/blog/customers/jadopado-delivers-instasearch-for-mobile-and-web-powered-by-algolia
24. https://www.algolia.com/blog/customers/maison-kitsun-the-best-of-both-worlds-a-use-case-featuring-hyv-themes-for-adobe-commerce-x-algolia-search
25. https://www.algolia.com/blog/customers/manomanos-make-or-buy-decision-grid
26. https://www.algolia.com/blog/customers/quadrant-io-solves-the-frustration-of-economic-data-search-with-algolia
27. https://www.algolia.com/blog/customers/search-infrastructure-products-inflect
28. https://www.algolia.com/blog/customers/sharypic-benefits-from-algolia-search
29. https://www.algolia.com/blog/ecommerce/digital-expert-series-otrium
30. https://www.algolia.com/blog/ecommerce/how-to-satisfy-user-intent-when-considering-search-vs-browse-1
31. https://www.algolia.com/blog/ecommerce/leveraging-advanced-search-and-discovery-with-b2b-composable-commerce-1
32. https://www.algolia.com/blog/engineering/managing-11-sdks-from-one-openapi-spec
33. https://www.algolia.com/blog/engineering/part-4-supercharging-search-for-ecommerce-solutions-with-algolia-and-mongodb-frontend-implementation-and-conclusion
34. https://www.algolia.com/blog/product/algolia-s-top-10-tips-to-achieve-highly-relevant-search-results
35. https://www.algolia.com/blog/product/feature-spotlight-query-rules-1
36. https://www.algolia.com/blog/product/help-yourself-avoid-these-7-mistakes-and-rock-your-self-serve-customer-service
37. https://www.algolia.com/blog/product/how-to-use-site-search-to-avoid-no-results-pages
38. https://www.algolia.com/blog/product/what-are-synonyms-as-they-apply-to-search-part-1
39. https://www.algolia.com/de/blog/ai/change-slug
40. https://www.algolia.com/de/blog/customers/algolia-search-improving-trading-card-experience
41. https://www.algolia.com/de/blog/customers/best-practices-for-ecommerce-personalization
42. https://www.algolia.com/de/blog/customers/best-ways-to-leverage-ai-to-optimize-a-user-conversion
43. https://www.algolia.com/de/blog/customers/bringing-algolia-s-faceting-experience-to-mobile-the-evolution-of-appapp
44. https://www.algolia.com/de/blog/customers/building-a-better-istyles-shopping-experience-with-algolia-search
45. https://www.algolia.com/de/blog/customers/building-a-video-discovery-platform-with-algolia-unreel-co
46. https://www.algolia.com/de/blog/customers/collaborative-3d-printing-made-possible-by-pinshape-search-powered-by-algolia
47. https://www.algolia.com/de/blog/customers/concertwith-me-s-competitive-edge-a-revamped-search-ux-with-algolia
48. https://www.algolia.com/de/blog/customers/gymsharks-journey-to-mach-the-practical-case-for-search-and-navigation
49. https://www.algolia.com/de/blog/customers/hacker-news-search-6-5-million-articles-and-comments-at-your-fingertips
50. https://www.algolia.com/de/blog/customers/how-abacus-leverages-algolia-for-realtime-expense-reporting
51. https://www.algolia.com/de/blog/customers/how-algolia-helped-improve-ux
52. https://www.algolia.com/de/blog/customers/how-algolia-increased-tradepub-com-s-search-conversions-by-70
53. https://www.algolia.com/de/blog/customers/how-algolia-is-powering-up-prodpad-s-help-center
54. https://www.algolia.com/de/blog/customers/how-algolia-keeps-all-your-data-safe-but-searchable-on-solid
55. https://www.algolia.com/de/blog/customers/how-beyond-retro-improved-its-ecommerce-site-with-algolia-s-magento-plugin
56. https://www.algolia.com/de/blog/customers/how-swedol-created-a-better-digital-b2b-experience
57. https://www.algolia.com/de/blog/customers/how-to-boost-online-sales-with-category-merchandising
58. https://www.algolia.com/de/blog/customers/how-to-increase-online-sales-with-search-merchandising
59. https://www.algolia.com/de/blog/customers/inside-growthhackers-com-s-implementation-of-algolia
60. https://www.algolia.com/de/blog/customers/jadopado-delivers-instasearch-for-mobile-and-web-powered-by-algolia
61. https://www.algolia.com/de/blog/customers/maison-kitsun-the-best-of-both-worlds-a-use-case-featuring-hyv-themes-for-adobe-commerce-x-algolia-search
62. https://www.algolia.com/de/blog/customers/manomanos-make-or-buy-decision-grid
63. https://www.algolia.com/de/blog/customers/quadrant-io-solves-the-frustration-of-economic-data-search-with-algolia
64. https://www.algolia.com/de/blog/customers/search-infrastructure-products-inflect
65. https://www.algolia.com/de/blog/customers/sharypic-benefits-from-algolia-search
66. https://www.algolia.com/de/blog/ecommerce/digital-expert-series-otrium
67. https://www.algolia.com/de/blog/ecommerce/how-to-satisfy-user-intent-when-considering-search-vs-browse-1
68. https://www.algolia.com/de/blog/ecommerce/leveraging-advanced-search-and-discovery-with-b2b-composable-commerce-1
69. https://www.algolia.com/de/blog/engineering/managing-11-sdks-from-one-openapi-spec
70. https://www.algolia.com/de/blog/product/feature-spotlight-query-rules-1
71. https://www.algolia.com/de/blog/product/help-yourself-avoid-these-7-mistakes-and-rock-your-self-serve-customer-service
72. https://www.algolia.com/fr/blog/ai/change-slug
73. https://www.algolia.com/fr/blog/customers/algolia-search-improving-trading-card-experience
74. https://www.algolia.com/fr/blog/customers/best-practices-for-ecommerce-personalization
75. https://www.algolia.com/fr/blog/customers/best-ways-to-leverage-ai-to-optimize-a-user-conversion
76. https://www.algolia.com/fr/blog/customers/bringing-algolia-s-faceting-experience-to-mobile-the-evolution-of-appapp
77. https://www.algolia.com/fr/blog/customers/building-a-better-istyles-shopping-experience-with-algolia-search
78. https://www.algolia.com/fr/blog/customers/building-a-video-discovery-platform-with-algolia-unreel-co
79. https://www.algolia.com/fr/blog/customers/collaborative-3d-printing-made-possible-by-pinshape-search-powered-by-algolia
80. https://www.algolia.com/fr/blog/customers/concertwith-me-s-competitive-edge-a-revamped-search-ux-with-algolia
81. https://www.algolia.com/fr/blog/customers/gymsharks-journey-to-mach-the-practical-case-for-search-and-navigation
82. https://www.algolia.com/fr/blog/customers/hacker-news-search-6-5-million-articles-and-comments-at-your-fingertips
83. https://www.algolia.com/fr/blog/customers/how-abacus-leverages-algolia-for-realtime-expense-reporting
84. https://www.algolia.com/fr/blog/customers/how-algolia-helped-improve-ux
85. https://www.algolia.com/fr/blog/customers/how-algolia-increased-tradepub-com-s-search-conversions-by-70
86. https://www.algolia.com/fr/blog/customers/how-algolia-is-powering-up-prodpad-s-help-center
87. https://www.algolia.com/fr/blog/customers/how-algolia-keeps-all-your-data-safe-but-searchable-on-solid
88. https://www.algolia.com/fr/blog/customers/how-beyond-retro-improved-its-ecommerce-site-with-algolia-s-magento-plugin
89. https://www.algolia.com/fr/blog/customers/how-swedol-created-a-better-digital-b2b-experience
90. https://www.algolia.com/fr/blog/customers/how-to-boost-online-sales-with-category-merchandising
91. https://www.algolia.com/fr/blog/customers/how-to-increase-online-sales-with-search-merchandising
92. https://www.algolia.com/fr/blog/customers/inside-growthhackers-com-s-implementation-of-algolia
93. https://www.algolia.com/fr/blog/customers/jadopado-delivers-instasearch-for-mobile-and-web-powered-by-algolia
94. https://www.algolia.com/fr/blog/customers/maison-kitsun-the-best-of-both-worlds-a-use-case-featuring-hyv-themes-for-adobe-commerce-x-algolia-search
95. https://www.algolia.com/fr/blog/customers/manomanos-make-or-buy-decision-grid
96. https://www.algolia.com/fr/blog/customers/quadrant-io-solves-the-frustration-of-economic-data-search-with-algolia
97. https://www.algolia.com/fr/blog/customers/search-infrastructure-products-inflect
98. https://www.algolia.com/fr/blog/customers/sharypic-benefits-from-algolia-search
99. https://www.algolia.com/fr/blog/ecommerce/digital-expert-series-otrium
100. https://www.algolia.com/fr/blog/ecommerce/how-to-satisfy-user-intent-when-considering-search-vs-browse-1
101. https://www.algolia.com/fr/blog/ecommerce/leveraging-advanced-search-and-discovery-with-b2b-composable-commerce-1
102. https://www.algolia.com/fr/blog/engineering/managing-11-sdks-from-one-openapi-spec
103. https://www.algolia.com/fr/blog/product/feature-spotlight-query-rules-1
104. https://www.algolia.com/fr/blog/product/help-yourself-avoid-these-7-mistakes-and-rock-your-self-serve-customer-service

Evidence file: docs/70-enrichment/reports/blog-dead-pages-scout-recheck-20260810.json

Thanks,
Arijit
