# BrowserBud Chrome Extension

This is the first multimodal extension slice for BrowserBud.

## What it does

- exposes extension availability to `browserbud.com` and local BrowserBud dev hosts
- collects browser-native page context from the active tab
- sends current URL, title, headings, forms, nav links, breadcrumbs, and visible anchors into the BrowserBud app
- supports multimodal use with screen-share plus extension context together

## Load it unpacked

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select the `/Users/miguel/Browserbud/extension` folder
5. Reload the BrowserBud app tab

## Current limitations

- no browser automation yet
- no side panel yet
- no packaged production build yet
- content extraction is intentionally shallow and conservative in this first pass
