import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Scenario coverage:
// - every journey category has a usable local page fixture
// - AI Search is the exact Product -> Documentation source
// - the documentation destination is same-origin and route-scoped to AI Search

const manifest = JSON.parse(
  await readFile('local-sites/algolia-com-parity/scout-captures/routes.json', 'utf8')
);
const localFixture = await readFile('local-sites/algolia-com-parity/index.html', 'utf8');

test('local parity fixtures cover every journey destination with usable content', () => {
  const pages = Object.values(manifest.pages || {});
  const groups = new Set(pages.map((page) => page.group));

  for (const group of [
    'product',
    'solution',
    'documentation',
    'customer_story',
    'pricing',
    'developer',
    'resource',
  ]) {
    assert.ok(groups.has(group), `missing local parity fixture for ${group}`);
  }

  const usableCustomerStory = pages.find(
    (page) => page.group === 'customer_story' && page.path !== '/customers'
  );
  assert.ok(usableCustomerStory, 'missing a customer-story detail fixture');
  assert.notEqual(usableCustomerStory.title, 'Page not found');
  assert.ok(usableCustomerStory.headings?.length > 1, 'customer-story fixture has no usable content');

  const productDocsSource = manifest.pages?.['/products/ai-search'];
  assert.ok(productDocsSource, 'missing exact AI Search -> Documentation source fixture');
  assert.notEqual(productDocsSource.title, 'Page not found');

  const instantSearchDocs = manifest.pages?.['/doc/guides/building-search-ui/what-is-instantsearch/js/'];
  assert.ok(instantSearchDocs, 'missing exact same-origin InstantSearch documentation fixture');
  assert.notEqual(instantSearchDocs.title, 'Page not found');
});

test('local parity exposes the same-origin documentation CTA from AI Search', () => {
  const mapping = localFixture.match(
    /const sameOriginDocsBySource = Object\.freeze\(\{([\s\S]*?)\}\);/
  )?.[1];
  assert.ok(mapping, 'missing route-scoped same-origin documentation mapping');
  assert.match(
    mapping,
    /"\/products\/ai-search": "\/doc\/guides\/building-search-ui\/what-is-instantsearch\/js\/"/
  );
  assert.doesNotMatch(mapping, /ui-component-libraries/);
  assert.match(localFixture, /id="product-docs-cta"/);
});
