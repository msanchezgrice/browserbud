# BrowserBud — guidance for AI agents

## What this product is

BrowserBud is a screen-aware AI companion for desktop browsers. A user shares a tab or their screen, provides their own Gemini API key inside the app, and BrowserBud answers questions about what is on screen, saves notes and context, and produces a structured activity log and session recap. It is currently in alpha (BYO Gemini key) and works in desktop browsers only.

## Key routes

- `/` — landing page (product overview, features, how it works)
- `/app` — the BrowserBud app (requires the user's own Gemini API key plus screen/microphone permissions granted by the user)
- `/workflows/screen-aware-notes`, `/workflows/research-session-recap`, `/workflows/ask-questions-about-current-page` — workflow guides
- `/vs/screenhelp` — neutral comparison page
- `/resources` and `/resources/*` — editorial guides about browser AI, privacy, and accessibility
- `/about`, `/contact`, `/privacy`, `/terms` — company and legal pages
- `/llms.txt` — machine-readable site summary
- `/.well-known/agent-card.json`, `/.well-known/ai-agent.json` — agent manifests and guardrails

## How agents should interact

Allowed without restrictions:

- Read and cite any public page listed above.
- Follow links and summarize content for the user.

Requires explicit user initiation (never do these autonomously):

- Do not enter, paste, or manage API keys on the user's behalf. The Gemini API key belongs to the user and stays on their device.
- Do not start or stop a screen-sharing or microphone session; those require the user's own browser permission prompts and intent.
- Do not delete saved personas, notes, activity logs, or other locally stored data. Elements that perform destructive actions are marked with `data-agent-danger` in the DOM.
- Do not create accounts or attempt purchases; there is no signup or checkout flow on this site.

## Machine-readable affordances

- Primary call-to-action elements carry `data-testid` and `data-agent-action` attributes.
- Destructive actions carry `data-agent-danger` (and `data-agent-confirm` where a confirmation step exists).
- Structured data (Organization, WebSite, Article, and FAQ/Comparison markup where applicable) is available as JSON-LD in each page's `<head>`.

## Contact

Questions or corrections: email msanchezgrice@gmail.com with "BrowserBud" in the subject line, or see https://browserbud.com/contact.
