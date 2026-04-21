# Highlighter — a Brave / Chromium extension

A lightweight browser extension that lets you highlight any text on any webpage. Highlights are saved locally and restored automatically the next time you visit the page.

## Features

- Select text → a small color picker pops up (Yellow, Green, Pink, Blue, Orange).
- Keyboard shortcut: `Alt+H` highlights the current selection in yellow.
- Right-click context menu: **Highlight selection** and **Clear highlights on this page**.
- Click an existing highlight to change its color or remove it.
- Toolbar popup lists all highlights on the current page; click to scroll to one, `×` to remove, **Clear all** to wipe the page.
- Highlights persist across page reloads, tab closes, and browser restarts, and **sync across your signed-in Brave / Chrome browsers** via `chrome.storage.sync`.
- Works across element boundaries (bold text, links, line breaks).
- Re-applies automatically on single-page apps and dynamically loaded content via a MutationObserver.

## Install in Brave (unpacked)

1. Open Brave and go to `brave://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select the `highlighter/` folder from this repo.
5. Pin the extension to the toolbar if you like.

The same steps work in Chrome, Edge, Vivaldi, Arc, or any other Chromium-based browser (`chrome://extensions`, `edge://extensions`, etc.).

### Stable extension ID across devices

The extension ships with a pinned public key in `manifest.json` (the `"key"` field). Because the extension ID is derived from that key, loading the same unpacked folder on every machine produces the same ID:

```
hdelfioecdepjbnigcjpjglpdemdjfnc
```

This matters because `chrome.storage.sync` is scoped to the extension ID. Without a pinned key, an unpacked install on device A and one on device B get different random IDs and their synced highlights never find each other. With the pinned key, both installs are the same "app" from the browser's perspective, and Brave Sync / Chrome Sync delivers storage between them.

The matching **private** key is in `highlighter.pem` at the repo root. Keep it secret — it is only needed if you want to later repackage the extension as a `.crx` or publish to the Web Store. The `.gitignore` excludes it from version control. If it ever leaks, generate a new keypair and replace both the `"key"` field and `highlighter.pem`; all existing synced highlights keyed to the old ID will stop being visible (they still live in sync storage under the old ID, just orphaned).

## Usage

- **Highlight**: select any text → click a color swatch in the popover, or press `Alt+H` for yellow.
- **Change color / remove a highlight**: click directly on the highlighted text → use the swatches to recolor or the **Remove** button.
- **See everything on a page**: click the extension's toolbar icon. Click any item to jump to it.
- **Wipe the page**: use **Clear all** in the popup, or right-click → *Clear highlights on this page*.

## How persistence works

Each highlight is stored as a small record:

```json
{
  "id": "h_lfz3…",
  "text": "the selected text",
  "prefix": "up to 48 chars of context before",
  "suffix": "up to 48 chars of context after",
  "color": "#fff176",
  "createdAt": 1718033142123
}
```

Storage is keyed by a normalized version of the page URL (the fragment and common tracking params like `utm_*`, `fbclid`, `gclid` are stripped so minor URL variations still match).

On page load, the extension walks the page's text, finds the stored `text` with matching surrounding context, and re-wraps it with a colored `<span>`. This is resilient to DOM changes that don't alter the underlying text (ads, SPA re-renders, etc.).

### Sync

Highlights are written to `chrome.storage.sync`, which Brave / Chrome sync across every browser signed into the same account (subject to sync being enabled for "Extensions" in your browser's sync settings).

A `chrome.storage.onChanged` listener in the content script applies remote changes live — if you highlight something on laptop A, open the same page on laptop B a few seconds later and the new highlights appear without a reload. Removals and color changes propagate the same way.

**Quota handling.** Sync storage is capped at ~8 KB per key and ~100 KB total. Each page URL is one key, so a page with a large number of long highlights may exceed 8 KB. When that happens the extension automatically falls back to `chrome.storage.local` for that page only — the highlights stay on that device but everything keeps working. A warning is logged to the page's DevTools console. When future edits bring that page back under the quota, it's promoted back to sync automatically.

## File layout

```
highlighter/
  manifest.json    # MV3 manifest
  background.js    # context menu + keyboard command
  content.js      # selection, wrapping, persistence, restoration
  content.css     # highlight + tooltip styling
  popup.html      # toolbar popup
  popup.css
  popup.js
```

## Notes / limitations

- Sync requires that you're signed into Brave/Chrome and have "Extensions" enabled in sync settings. Without that, `chrome.storage.sync` still works as a per-profile local store.
- Does not run inside iframes (set `all_frames: true` in `manifest.json` if you need that).
- Selections that span across fully different page regions (e.g. picked up across injected ads) will still highlight fine, but restoration relies on the text being stable across visits.
- No icons are bundled; Brave/Chrome will use a default puzzle-piece icon. Drop 16/32/48/128 PNGs into the folder and reference them under `"icons"` and `"action.default_icon"` in the manifest if you want custom ones.
