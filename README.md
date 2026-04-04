<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/d7535ede-66c7-497e-a169-bbca14050599

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. (Optional, local dev only) Set `GEMINI_API_KEY` in `.env.local` if you want the BYO key field to prefill automatically on your machine
3. (Optional) Set `GEMINI_LIVE_MODEL` in `.env.local` if you want to override the default live model (`gemini-3.1-flash-live-preview`)
4. Run the app:
   `npm run dev`
5. Open BrowserBud and confirm your Gemini key is present in the BYO key field before starting a session

## Local Analytics API

Browserbud now supports a local-first analytics companion backed by SQLite.

1. Start the analytics API:
   `npm run dev:api`
2. Start the app in a second terminal:
   `npm run dev`

By default the UI posts analytics events to `http://127.0.0.1:3011/api/analytics` when BrowserBud is running locally.
In production, the app prefers same-origin `/api/analytics` routes.
Set `BROWSERBUD_LOCAL_API_URL` if you want a different analytics endpoint in either environment.
