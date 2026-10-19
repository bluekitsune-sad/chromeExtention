# AGENTS.md — Build Instructions for the Chat Exporter Extension

Instructions for any AI agent (or human) implementing the extension defined in
`chat-exporter/PRD.md`. Follow these literally.

## Context

- Extension folder: `chat-exporter/` (repo root holds the docs index only).
- `PRD.md` is the source of truth for behavior and the JSON schema.
- Check `TODO.md`; work top-down; mark items done as you complete them.
- Tests: `node test\organize.test.js` (run from inside `chat-exporter/`).

## Hard rules

1. **Never store media.** No image/gif/video bytes, URLs, or base64. An
   attachment becomes the placeholder `"img"`, `"gif"`, or `"vid"` — that's it.
   The extension must not issue any media network request (verify: no `fetch`
   of twimg assets anywhere).
2. **Read-only DOM.** Never `remove()`, `append`, `innerHTML`, focus, click,
   or keypress into the X page. Only `scrollTop` manipulation (and only during
   history loading), restoring the original scroll position afterwards.
3. **Minimal permissions.** MV3: `host_permissions: ["https://x.com/*"]` plus
   `permissions: ["scripting"]` — the popup injects the content scripts on
   demand when a tab predates an extension reload (stale-tab fix). The
   content script MUST keep its `__CE_CONTENT_LOADED__` guard so re-injection
   can never double-register listeners. Downloads happen in the popup via
   blob + `<a download>` — never the `downloads` API. No `storage`, no
   `tabs`, no background worker.
4. **`organize.js` stays pure and DOM-free.** It must load and run in Node
   without stubs beyond `globalThis`. Every schema rule (dedupe, sort,
   undated-last, caption rule, participants, stats) lives there and is
   covered by `test/organize.test.js` — keep it green, extend when rules grow.
5. **Ordered selector candidates.** All DOM selectors live in `recorded
   probe lists` in `extract.js` (arrays, first match wins). Never scatter
   `querySelector` calls through `content.js`. Record match counts for
   `diagnostics.probes`.
6. **Fail-soft, report honestly.** Zero entries → abort with an error surfaced
   in the popup (download nothing). Partial fields → export proceeds with
   `null` values; never invent data (unknown sender is `null`, not a guess).
7. **Deterministic output.** Same conversation state ⇒ byte-identical JSON
   except `exportedAt`. Only `organize.js` may order/derive the document.
8. **Abort cleanly.** Port disconnect (popup closed) or conversation change
   must stop all work within one scroll round; no orphan timers.
9. **No dependencies, no build step, no remote code.** Plain scripts loaded in
   manifest order; shared namespace `globalThis.CE`.
10. **Debug logging** only when `localStorage.CE_DEBUG === "1"` (in the
    content-script context). Exception: the one-shot `console.error` of the
    DOM report when zero message entries are found — that report is the
    primary support diagnostic for selector breakage.

## Conventions

- Files: `manifest.json`, `content.js`, `extract.js`, `organize.js`,
  `popup.html`, `popup.js`, `popup.css`, `icons/`, `test/`.
- `const` by default; camelCase; no classes needed.
- Manifest `content_scripts` order: `organize.js`, `extract.js`, `content.js`.
- Popup is a plain script (no modules — keep consistent with the sibling
  extension).
- Settings: **none in v1** — the export is stateless on purpose.

## Selector notes (from PRD §6 — keep in sync)

- Entries: `div[data-testid="messageEntry"]` first, then `[data-testid="message"]`
  — and finally **runtime discovery**: scope to the pane with the most
  `time[datetime]`, take each timestamp's topmost single-message
  `data-testid` ancestor, use the most frequent key (PRD §6). This is the
  path that handles X's newer `/i/chat` layout.
- Timestamp: `time[datetime]` inside entry.
- Text: `[data-testid="tweetText"]` / `[data-testid="messageText"]`, else
  cleaned `innerText` minus the `<time>` string.
- Media: `video` → vid; gif marker → gif; content `img` → img.
  **Filters:** skip `profile_images` srcs and emoji imgs (src `emoji|twemoji`
  or rendered size ≤ 48 px) — they are text, not attachments.

If probes stop matching, fix the candidate list — do not guess new selectors
inline, and add the failing case to `TODO.md`'s manual QA list.

## Definition of done (per task)

- `node --check` clean for every touched JS file.
- `node test\organize.test.js` green.
- Export on a real chat verified manually when DOM behavior is involved.
- `TODO.md` updated in the same commit.

## Do not

- Touch `x-feed-filter/` (sibling extension; separate lifecycle).
- Add auto-export, background scraping, or multi-conversation crawling in v1.
- Add analytics, telemetry, or any external endpoint.
- "Optimize" away the abort checks or the pure-logic tests.
