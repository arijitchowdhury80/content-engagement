#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'local-sites', 'algolia-com-parity', 'scout-captures');
const rawDir = join(outDir, 'raw');
const routeFile = join(outDir, 'routes.json');

const routes = [
  {
    path: '/',
    url: 'https://www.algolia.com/',
    group: 'home',
    label: 'Home',
  },
  {
    path: '/products/ai-search',
    url: 'https://www.algolia.com/products/ai-search/',
    group: 'product',
    label: 'AI Search',
  },
  {
    path: '/products/ai-recommendations',
    url: 'https://www.algolia.com/products/ai-recommendations/',
    group: 'product',
    label: 'AI Recommendations',
  },
  {
    path: '/products/features/personalization',
    url: 'https://www.algolia.com/products/features/personalization/',
    group: 'product',
    label: 'Personalization',
  },
  {
    path: '/solutions/ecommerce',
    url: 'https://www.algolia.com/solutions/ecommerce/',
    group: 'solution',
    label: 'Commerce',
  },
  {
    path: '/solutions/marketplace',
    url: 'https://www.algolia.com/solutions/marketplace/',
    group: 'solution',
    label: 'Marketplace',
  },
  {
    path: '/solutions/financial-services',
    url: 'https://www.algolia.com/solutions/financial-services/',
    group: 'solution',
    label: 'Financial Services',
  },
  {
    path: '/developers',
    url: 'https://www.algolia.com/developers/',
    group: 'developer',
    label: 'Developers',
  },
  {
    path: '/doc/guides/building-search-ui/what-is-instantsearch/js/',
    url: 'https://www.algolia.com/doc/guides/building-search-ui/what-is-instantsearch/js/',
    group: 'documentation',
    label: 'InstantSearch Docs',
  },
  {
    path: '/pricing',
    url: 'https://www.algolia.com/pricing/',
    group: 'pricing',
    label: 'Pricing',
  },
  {
    path: '/customers',
    url: 'https://www.algolia.com/customers/',
    group: 'customer_story',
    label: 'Customers',
  },
  {
    path: '/customers/end-clothing',
    url: 'https://www.algolia.com/customers/end-clothing/',
    group: 'customer_story',
    label: 'END. Clothing',
  },
];

function parseDotEnv(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    env[key] = rest.join('=').replace(/^["']|["']$/g, '');
  }
  return env;
}

function parseScoutJson(stdout) {
  const marker = '{\n  "success"';
  const start = stdout.indexOf(marker);
  if (start === -1) throw new Error('Scout output did not include a JSON payload');
  return JSON.parse(stdout.slice(start));
}

function slugFor(path) {
  return path === '/' ? 'home' : path.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-');
}

function textFromMarkdown(markdown) {
  return String(markdown || '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '')
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function headingsFromMarkdown(markdown) {
  return String(markdown || '')
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,3}\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function excerpt(markdown) {
  const text = textFromMarkdown(markdown);
  return text.length > 900 ? `${text.slice(0, 900).trim()}...` : text;
}

async function main() {
  await mkdir(rawDir, { recursive: true });
  let dotEnv = {};
  try {
    dotEnv = parseDotEnv(await readFile(join(root, '.env.local'), 'utf8'));
  } catch {
    dotEnv = {};
  }

  const pages = {};
  for (const route of routes) {
    const slug = slugFor(route.path);
    process.stderr.write(`Scout fetching ${route.url}\n`);
    const proc = spawnSync('scout', ['scrape', route.url, '--js', '--timeout', '45000'], {
      cwd: root,
      env: { ...process.env, ...dotEnv },
      encoding: 'utf8',
      maxBuffer: 80 * 1024 * 1024,
    });
    if (proc.status !== 0) {
      throw new Error(`Scout failed for ${route.url}: ${proc.stderr || proc.stdout}`);
    }
    const payload = parseScoutJson(proc.stdout);
    await writeFile(join(rawDir, `${slug}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    pages[route.path] = {
      ...route,
      slug,
      success: payload.success,
      statusCode: payload.status_code,
      requestedUrl: route.url,
      servedUrl: payload.url,
      title:
        payload.metadata?.title ||
        headingsFromMarkdown(payload.markdown)[0] ||
        route.label,
      description:
        payload.metadata?.description ||
        excerpt(payload.markdown),
      headings: headingsFromMarkdown(payload.markdown),
      excerpt: excerpt(payload.markdown),
      links: Array.isArray(payload.links) ? payload.links.slice(0, 60) : [],
    };
  }

  await writeFile(
    routeFile,
    `${JSON.stringify(
      {
        schema: 'AlgoliaLocalParityScoutRoutes.v1',
        generatedAt: new Date().toISOString(),
        pages,
      },
      null,
      2
    )}\n`
  );
  console.log(JSON.stringify({ pass: true, count: routes.length, routeFile }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
