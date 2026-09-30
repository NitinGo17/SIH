# site/ — static HTML preview of ManakAI

This folder is **generated** — do not edit these files by hand.
Regenerate after changing templates or page routes:

    cd server && npm run export:static

Every page is rendered through the exact same server pipeline as production
(`server/templates` + `server/routes/pages.js`) with placeholder data, then
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
