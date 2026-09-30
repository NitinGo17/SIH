// Static site exporter — renders every page through the REAL server pipeline
// (same templates + same page registry as the SSR routes) and writes plain
// HTML files to <repo>/site/, next to server/, with relative asset paths.
//
// The output can be hosted on any static host (GitHub Pages, Netlify, S3…):
//   cd server && npm run export:static
//
// The static build is a PREVIEW of the UI: interactive features that need the
// backend (login, chat, checklists) are absent by design — the JS islands
// call /api/* and fail silently when the backend is not there.
import path from 'node:path';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PAGES, render } from '../routes/pages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(here, '..');
const SITE_DIR = path.join(SERVER_DIR, '..', 'site');

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

const SITE_README = `# site/ — static HTML preview of ManakAI

This folder is **generated** — do not edit these files by hand.
Regenerate after changing templates or page routes:

    cd server && npm run export:static

Every page is rendered through the exact same server pipeline as production
(\`server/templates\` + \`server/routes/pages.js\`) with placeholder data, then
written as plain HTML with relative asset paths.

## What it is for

Host this folder on any static host (GitHub Pages, Netlify, S3, nginx) to put
the ManakAI website — home page, login/register screens, and all app layouts
— online without running the backend.

## What it is NOT

A UI preview only. Anything that needs the backend — real login, the AI
consultation, checklists, tasks, lab search — is absent by design: the JS
islands call /api/* and fail silently when the backend is not there. No
compliance data is hardcoded in these pages.
`;

async function main() {
  await rm(SITE_DIR, { recursive: true, force: true });
  await mkdir(SITE_DIR, { recursive: true });

  let failed = 0;
  for (const page of PAGES) {
    const file = FILE_NAMES[page.route];
    if (!file) throw new Error(`No static file name mapped for route ${page.route}`);
    try {
      const html = rewriteHtml(render(page));
      await writeFile(path.join(SITE_DIR, file), html);
      console.log(`ok  ${file}  (${page.url})`);
    } catch (err) {
      console.error(`FAIL ${page.url}: ${err.message}`);
      failed += 1;
    }
  }

  // assets: css, js, icon sprite, service worker
  await cp(path.join(SERVER_DIR, 'public', 'css'), path.join(SITE_DIR, 'css'), { recursive: true });
  await cp(path.join(SERVER_DIR, 'public', 'js'), path.join(SITE_DIR, 'js'), { recursive: true });
  await cp(path.join(SERVER_DIR, 'public', 'icons.svg'), path.join(SITE_DIR, 'icons.svg'));
  await cp(path.join(SERVER_DIR, 'public', 'sw.js'), path.join(SITE_DIR, 'sw.js'));
  console.log('ok  assets (css, js, icons.svg, sw.js)');

  await writeFile(path.join(SITE_DIR, 'README.md'), SITE_README);
  console.log('ok  README.md');

  if (failed > 0) {
    console.error(`${failed} page(s) failed to render`);
    process.exit(1);
  }
  console.log(`\nStatic site written to ${SITE_DIR}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
