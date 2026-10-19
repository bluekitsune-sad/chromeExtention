# TODO — Chat Exporter (X DMs → JSON)

Work top-down; check off as done. Specs in `PRD.md`, rules in `AGENTS.md`.

**Status (2026-10-19): M1–M5 code-complete (targets `https://x.com/i/chat`, conversation id captured from URL).
Automated checks: 29/29 unit tests, all JS syntax-clean.
Bugfix: popup now pings the content script first — stale tabs (loaded before
the extension was reloaded) get "reload the extension, then this tab" instead
of "connection lost".
Remaining: M6 manual QA in a logged-in Chrome session.**

## M1 — Scaffold — ✅
- [x] `chat-exporter/` folder + docs (PRD/TODO/AGENTS)
- [x] `manifest.json` (MV3, host `x.com`, content script on `/messages*`, popup only)
- [x] Icons (16/48/128)
- [ ] **Manual:** load unpacked, icon opens popup on `x.com/messages`

## M2 — Pure organize core — ✅
- [x] `organize.js`: media classification (img/gif/vid → type, text, media[])
- [x] `organize.js`: caption rule (media+words → placeholder in text, words in caption)
- [x] `organize.js`: dedupe (id, else composite) — first occurrence wins
- [x] `organize.js`: stable sort, undated messages last
- [x] `organize.js`: document builder (schema/stats/diagnostics/participants)
- [x] `organize.js`: filename sanitizer
- [x] `test/organize.test.js` — covers all rules incl. multi-media `img + vid`

## M3 — DOM extraction — ✅
- [x] `extract.js`: ordered selector candidates per touchpoint (PRD §6)
- [x] entry probe + thread container discovery (nearest scrollable ancestor)
- [x] text extraction (dedicated node → cleaned innerText fallback, minus `<time>`)
- [x] timestamp from `time[datetime]`
- [x] sender from profile link (excluding `/i/`, `/intent/`, `/messages`)
- [x] media classification with avatar + emoji filters
- [x] probe counts recorded for `diagnostics.probes`

## M4 — Orchestration — ✅
- [x] `content.js`: port-based export request from popup
- [x] history loading loop (scroll-to-top, stable×3, caps: 600 rounds / 50k entries / 10 min)
- [x] progress messages each round + abort on port disconnect
- [x] scroll position restored after export
- [x] extract → organize → respond `{ok, doc}` / `{ok:false, error}`
- [x] `CE_DEBUG` gated logging

## M5 — Popup — ✅
- [x] Export button + conversation status line
- [x] live progress ("loading history… 1200 messages")
- [x] blob download `x-dm_<sanitized>_<YYYY-MM-DD>.json`
- [x] summary after export (count, date range)
- [x] error display (no entries found, aborted, wrong tab, stale-tab ping)
- [x] auto-detects wrong tab (disabled button + hint)

## M6 — QA & docs
- [x] Automated: `node --check` all JS; `node test\organize.test.js`
- [x] README with load-unpacked steps
- [ ] **Manual (logged-in Chrome — open chats via `https://x.com/i/chat`):**
  - [ ] `/i/chat/<id>` conversation opens → popup shows "Ready", id present in exported `conversation.id`
  - [ ] 1:1 chat export: correct sender attribution, chronological order
  - [ ] image message → `"img"`; GIF → `"gif"`; video → `"vid"`; no media in Network tab from extension
  - [ ] media + caption message → placeholder in `text`, words in `caption`
  - [ ] group DM: participants list, senders differ per message
  - [ ] long history: loading progress appears, completes, no duplicates on re-export
  - [ ] abort cases: close popup mid-export; navigate away mid-export
  - [ ] emoji-only message stays `text`, avatars don't count as `img`

## v2 (backlog)
- [ ] Export all conversations (batch mode)
- [ ] Reply-to extraction when X exposes it
- [ ] CSV export alongside JSON
- [ ] Include own handle detection for `participants` completeness
