import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = new URL("./", import.meta.url);
const source = await readFile(new URL("index.html", root), "utf8");
const css = await readFile(new URL("styles.css", root), "utf8");
const app = await readFile(new URL("app.js", root), "utf8");
const guide = await readFile(new URL("content-engagement-demo-uat-test-cases.md", root));
const blueLogo = await readFile(new URL("assets/Algolia-logo-blue.svg", root));
const whiteLogo = await readFile(new URL("assets/Algolia-logo-white.svg", root));

const evidenceImages = [
  ["T1", "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/T1/01-answer.png"],
  ["T2", "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/T2/02-answer.png"],
  ["B1", "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/B1/03-answer.png"],
  ["B2", "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/B2/04-answer.png"],
  ["C1", "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/C1/05-answer.png"],
  ["C2", "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/C2/06-answer.png"],
  ["S1", "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/S1-retry/07-answer.png"],
  ["S2", "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/S2/08-answer.png"],
];

const dataUri = (mime, bytes) => `data:${mime};base64,${bytes.toString("base64")}`;
const run = promisify(execFile);

let standalone = source
  .replace(/^\s*<link rel="preconnect"[^>]+>\s*$/gm, "")
  .replace(/^\s*<link href="https:\/\/fonts\.googleapis\.com[^>]+>\s*$/gm, "")
  .replace(
    /\s*<link rel="stylesheet" href="styles\.css\?[^>]+>/,
    `\n    <style>${css}</style>`,
  )
  .replace(
    'src="assets/Algolia-logo-white.svg"',
    `src="${dataUri("image/svg+xml", whiteLogo)}"`,
  )
  .replace(
    'src="assets/Algolia-logo-blue.svg"',
    `src="${dataUri("image/svg+xml", blueLogo)}"`,
  )
  .replace(
    'href="content-engagement-demo-uat-test-cases.md"',
    `href="${dataUri("text/markdown", guide)}"`,
  )
  .replace(/\s*<script src="app\.js\?[^>]+><\/script>/, `\n    <script>${app}</script>`);

const thumbnailDir = await mkdtemp(join(tmpdir(), "team-uat-thumbnails-"));
try {
  for (const [index, [label, path]] of evidenceImages.entries()) {
    const sourcePath = fileURLToPath(new URL(path, root));
    const cropPath = join(thumbnailDir, `${index + 1}-crop.png`);
    const previewPath = join(thumbnailDir, `${index + 1}-preview.png`);
    await run("/usr/bin/sips", [
      "--cropToHeightWidth", "1000", "1440",
      "--cropOffset", "0", "0",
      sourcePath,
      "--out", cropPath,
    ]);
    await run("/usr/bin/sips", ["-Z", "720", cropPath, "--out", previewPath]);
    const preview = dataUri("image/png", await readFile(previewPath));
    standalone = standalone
      .replaceAll(`src="${path}"`, `src="${preview}"`)
      .replaceAll(
        `href="${path}"`,
        `href="${preview}" aria-label="Open embedded ${label} evidence preview"`,
      );
  }
} finally {
  await rm(thumbnailDir, { recursive: true, force: true });
}

await writeFile(new URL("content-engagement-team-uat.html", root), standalone);
console.log(`Built content-engagement-team-uat.html (${Buffer.byteLength(standalone)} bytes)`);
