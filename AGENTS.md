# BrowserBud — repository guide for agents

## What this project is

BrowserBud (https://browserbud.com) is a screen-aware AI companion for desktop browsers. The user shares a tab or screen, brings their own Gemini API key, and the app answers questions about what is on screen, saves notes/context, and produces an activity log and session recap. Currently in alpha.

## Stack

- Vite + React 19 + TypeScript SPA (`src/`), styled with Tailwind CSS v4
- Static marketing/editorial pages served from `public/` (plain HTML + `public/editorial.css`)
- Express/Node analytics backend (`server/`), Vercel serverless functions (`api/`)
- Chrome extension companion (`extension/`)
- Deployed on Vercel (`vercel.json`: clean URLs, SPA rewrites for `/app` and `/product`)

## Project structure

- `index.html`, `src/main.tsx` — SPA entry; routes `/` (Landing) vs `/app` (App)
- `src/Landing.tsx` — landing page component
- `src/App.tsx` — the BrowserBud app (Gemini Live integration)
- `public/` — static assets and standalone marketing pages (ground truth for served files)
- `server/` — analytics API (Express), `api/analytics/` — Vercel functions
- `tests/` — node:test suites (run with tsx)
- `scripts/` — live probe / smoke-test scripts

## Commands

- `npm run dev` — Vite dev server (port 3010)
- `npm run dev:api` — analytics API dev server
- `npm run build` — production build
- `npm run lint` — `tsc --noEmit`
- `npm run test:live-utils` — unit tests for app logic and marketing pages
- `npm run test:analytics` — analytics backend tests

## Conventions and guardrails for agents

- Do not modify above-the-fold content (hero, headline, subhead, primary CTA, nav) on the landing page or the visible copy of marketing pages unless explicitly asked.
- Static marketing pages must keep their canonical link tags, JSON-LD blocks, and `href="/app?utm_source=..."` CTA links intact; `tests/marketingPages.test.ts` enforces this.
- The comparison page (`public/vs/screenhelp.html`) must stay neutral — no "beats/superior/guaranteed" language (enforced by tests).
- User data (Gemini API key, personas, notes, logs) is stored locally on the user's device; never exfiltrate or manage it on the user's behalf.
- Destructive actions in the app are marked with `data-agent-danger` in the DOM.
- See also the site-level guidance served at https://browserbud.com/agents.md and the manifests under `public/.well-known/`.

## Contact

msanchezgrice@gmail.com (include "BrowserBud" in the subject line)
