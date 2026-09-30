// Static site exporter — renders every page through the REAL server pipeline
// (same templates + same page registry as the SSR routes) and writes plain
// HTML files with relative asset paths.
//
// Output layout is a classic static website at the REPO ROOT (outside
// server/): index.html, login.html, ... + css/ + js/ + icons.svg + sw.js —
// ready for "GitHub Pages → deploy from branch (root)" with zero config:
//
//   cd server && npm run export:static
//
// The static build is a PREVIEW of the UI: interactive features that need the
// backend (login, chat, checklists) are absent by design — the JS islands
// call /api/* and fail silently when the backend is not there.
import path from 'node:path';
import { cp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PAGES, render } from '../routes/pages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(here, '..');
const ROOT_DIR = path.join(SERVER_DIR, '..');

// route -> static file name for the flat output directory
const FILE_NAMES = {
  '/': 'index.html',
  '/login': 'login.html',
  '/register': 'register.html',
  '/dashboard': 'dashboard.html',
  '/profile': 'profile.html',
  '/products': 'products.html',
  '/offline': 'offline.html',
  '/journey/start': 'journey-start.html',
  '/journey/:id/checklist': 'checklist.html',
  '/journey/:id/task/:taskId/assist': 'task-assist.html',
  '/journey/:id/task/:taskId': 'task-detail.html',
  '/journey/:id/testing': 'testing.html',
  '/journey/:id/summary': 'summary.html',
  '/journey/:id/history': 'history.html',
};

// Absolute URL -> static-relative URL, for a flat output directory.
const ROUTE_MAP = [
  [/^\/$/, 'index.html'],
  [/^\/(login|register|dashboard|profile|products|offline)$/, '$1.html'],
  [/^\/journey\/start$/, 'journey-start.html'],
  [/^\/journey\/[^/]+\/checklist$/, 'checklist.html'],
  [/^\/journey\/[^/]+\/task\/[^/]+\/assist$/, 'task-assist.html'],
  [/^\/journey\/[^/]+\/task\/[^/]+$/, 'task-detail.html'],
  [/^\/journey\/[^/]+\/testing$/, 'testing.html'],
  [/^\/journey\/[^/]+\/summary$/, 'summary.html'],
  [/^\/journey\/[^/]+\/history$/, 'history.html'],
  [/^\/(css|js)\/(.*)$/, '$1/$2'],
  [/^\/icons\.svg(.*)$/, 'icons.svg$1'],
];

function rewriteUrl(url) {
  if (!url.startsWith('/')) return url;
  for (const [re, out] of ROUTE_MAP) {
    if (re.test(url)) return url.replace(re, out);
  }
  // forms/actions and any unknown server route have no static equivalent
  return '#';
}

function rewriteHtml(html) {
  return html.replace(/(href|src|action)="([^"]*)"/g, (m, attr, url) => `${attr}="${rewriteUrl(url)}"`);
}

// Generated files we own at the repo root (never touched: README.md, docs/,
// server/, .github/, docker-compose.yml, ...)
const GENERATED_HTML = Object.values(FILE_NAMES);

async function cleanGenerated() {
  for (const file of GENERATED_HTML) {
    const p = path.join(ROOT_DIR, file);
    if (existsSync(p)) await unlink(p);
  }
  await rm(path.join(ROOT_DIR, 'css'), { recursive: true, force: true });
  await rm(path.join(ROOT_DIR, 'js'), { recursive: true, force: true });
  await rm(path.join(ROOT_DIR, 'icons.svg'), { force: true });
  await rm(path.join(ROOT_DIR, 'sw.js'), { force: true });
}

async function main() {
  await cleanGenerated();

  let failed = 0;
  for (const page of PAGES) {
    const file = FILE_NAMES[page.route];
    if (!file) throw new Error(`No static file name mapped for route ${page.route}`);
    try {
      const html = rewriteHtml(render(page));
      await writeFile(path.join(ROOT_DIR, file), html);
      console.log(`ok  ${file}  (${page.url})`);
    } catch (err) {
      console.error(`FAIL ${page.url}: ${err.message}`);
      failed += 1;
    }
  }

  // assets: css/, js/ folders + icon sprite + service worker, at repo root
  await cp(path.join(SERVER_DIR, 'public', 'css'), path.join(ROOT_DIR, 'css'), { recursive: true });
  await cp(path.join(SERVER_DIR, 'public', 'js'), path.join(ROOT_DIR, 'js'), { recursive: true });
  await cp(path.join(SERVER_DIR, 'public', 'icons.svg'), path.join(ROOT_DIR, 'icons.svg'));
  await cp(path.join(SERVER_DIR, 'public', 'sw.js'), path.join(ROOT_DIR, 'sw.js'));
  console.log('ok  css/ js/ icons.svg sw.js');

  if (failed > 0) {
    console.error(`${failed} page(s) failed to render`);
    process.exit(1);
  }
  console.log(`\nStatic website written to repo root: ${ROOT_DIR}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
