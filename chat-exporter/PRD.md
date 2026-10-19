# PRD — Chat Exporter (X DMs → JSON)

**Version:** 1.0
**Status:** Draft → in development
**Platform:** Google Chrome (Manifest V3), target site: `https://x.com/i/chat*`
(DM home is `https://x.com/i/chat`; opening a DM adds its conversation id to
the path — `/i/chat/<id>`. Legacy `/messages*` URLs are still matched.)
**Repo convention:** lives in `chat-exporter/`; root holds docs index only (see root `README.md`).

---

## 1. Overview

A Chrome extension that extracts the **currently open X (Twitter) DM
conversation** and saves it as a single, clean **JSON file** — sorted,
deduplicated, and organized with conversation metadata.

**Core promise:** the export contains *text and structure, never media files*.
An image message stores the literal string `"img"`, a GIF stores `"gif"`, a
video stores `"vid"` — no image/video bytes are ever fetched or saved.

### Non-goals (v1)

- Exporting media files or thumbnails (explicitly rejected by requirements).
- Bulk-exporting *all* conversations (one conversation per export, v1).
- Other platforms (WhatsApp/Telegram/etc. — future extensions get their own folder).
- Publishing to the Chrome Web Store.
- Editing/answering messages — read-only.

---

## 2. Problem & Goals

X provides no way to archive your DMs. Users want a portable backup they can
read, diff, search, or feed into other tools.

**Goals**

- G1: One click on an open conversation → a downloaded `.json` file.
- G2: Full history: auto-load older messages before extraction (bounded, safe).
- G3: Deterministic output: chronological sort, stable dedupe, defined schema.
- G4: Media never inflate the file: placeholders `img` / `gif` / `vid` only.
- G5: Works without any network access beyond the page the user is on — no
  external services, no telemetry, everything local.

**Success criteria**

- Export of a 1,000-message chat completes < 60 s (excluding slow loading).
- Re-exporting the same unchanged chat yields byte-identical JSON
  (except `exportedAt`).
- No media request is issued by the extension (verify in DevTools Network).
- Never crashes or mutates the X page (read-only DOM inspection).

---

## 3. User stories

- **US1:** Open a conversation, click the extension → download
  `x-dm_<name>_<date>.json` containing every message oldest → newest.
- **US2:** Send an image, export → that message reads `"text": "img"` — the
  file contains no image data.
- **US3:** GIF → `"gif"`, video → `"vid"`, same rule.
- **US4:** A message with media **and** a caption → placeholder in `text`,
  original words preserved in `caption` (words are text, not media).
- **US5:** Progress is visible while older history loads ("loaded 800 …"),
  and the export aborts safely if I navigate away or close the popup.
- **US6:** Re-export after receiving new messages → file contains everything,
  in order, no duplicates.

---

## 4. JSON schema (Balanced detail level)

### Document

```json
{
  "schema": "x-dm-export/1",
  "exportedAt": "2026-10-19T14:03:11.000Z",
  "source": "https://x.com/messages/1234567890",
  "conversation": {
    "id": "from the URL path /i/chat/<id> — or null",
    "title": "Alice (@alice) or null",
    "participants": ["@alice", "@bob"],
    "kind": "1:1 | group | unknown (group = 3+ unique participants — own-handle detection is a v2 item)"
  },
  "stats": {
    "messageCount": 842,
    "first": "2024-01-05T09:12:00.000Z or null",
    "last":  "2026-10-19T13:58:00.000Z or null"
  },
  "diagnostics": {
    "probes": { "entries": 842, "photos": 31, "videos": 4, "gifs": 2 },
    "undatedMessages": 0,
    "duplicatesRemoved": 3
  },
  "messages": [ /* Message, sorted ascending */ ]
}
```

### Message

```json
{
  "id": "string or null",
  "sender": "@handle or null",
  "timestamp": "ISO-8601 or null",
  "type": "text | image | gif | video | mixed",
  "text": "hello there",
  "caption": null,
  "media": [],
  "replyTo": null
}
```

| Field | Rule |
|---|---|
| `text` | Message text as-is. **Media-only messages: the literal placeholder** `"img"`, `"gif"`, or `"vid"`. Multiple media in one message → placeholders joined: `"img + vid"`. |
| `caption` | Original text when the message has **both** media and words; otherwise `null` (and `text` is then the placeholder). |
| `media` | Array of placeholders only: `["img"]`, `["gif"]`, `["vid"]`. Never URLs, never bytes. |
| `type` | Derived: `text` / `image` / `gif` / `video` / `mixed` (media + text). |
| `sender` | Best-effort from avatar/profile link inside the entry; `null` when X's DOM doesn't expose it (kept honest rather than guessed). |
| `id` | From any DOM id/data attribute on the entry when present; else `null` (dedupe then falls back to composite key). |
| `replyTo` | Reserved key for schema stability; `null` in v1 (DMs rarely expose reply refs in DOM). |

### Sorting & organization rules (deterministic)

1. Deduplicate: by `id` when both have one; else by composite
   `(sender, timestamp, text, media)` — first occurrence wins.
2. Sort ascending by `timestamp` (**stable** — equal timestamps keep DOM order).
3. Messages with `timestamp: null` go **after** all dated ones, keeping their
   relative order.
4. `stats.first` / `stats.last` computed from the sorted array (ignoring nulls).
5. `conversation.participants` = unique non-null senders, sorted; union with
   the handle parsed from the conversation title when available.

---

## 5. Architecture

```
chat-exporter/
├── manifest.json      MV3 — host x.com, scripting; content script on /i/chat* + on-demand inject
├── popup.html/css/js  Export button, progress, summary, download trigger
├── content.js         Orchestrator: probe → load history → extract → organize
├── extract.js         DOM → raw message objects (thin; ordered selector lists)
├── organize.js        PURE: classify media, dedupe, sort, build document
└── styles.css         (none in v1 — extension renders nothing in the page)
```

### Data flow

```
popup [Export] ──port──▶ content.js
                           │
                           ├─ probe(): discover thread container + entries
                           │    (ordered candidate selectors; first hit wins;
                           │     counts recorded into diagnostics.probes)
                           ├─ loadHistory(): scroll thread to top in a loop
                           │    (stop: entry count stable ×3 | caps hit)
                           ├─ extract(): every entry → raw message
                           │    ├─ text  (dedicated text node if found,
                           │    │         else cleaned innerText minus <time>)
                           │    ├─ media (video→vid, gif marker→gif,
                           │    │         content img→img; avatars/emoji skipped)
                           │    ├─ time  (time[datetime] → ISO)
                           │    └─ sender (profile link inside entry)
                           ├─ organize(): dedupe → sort → document  (pure)
                           └──── port: {progress…} ──▶ popup status
                                     {ok, doc}     ──▶ popup builds Blob,
                                                       <a download> click,
                                                       file saved locally
```

Download happens in the **popup** (blob anchor) — no `downloads` permission
needed and it ties to the button's user gesture.

### Manifest permissions

Permissions: `host_permissions: ["https://x.com/*"]` plus
`permissions: ["scripting"]` — the popup injects the content scripts on
demand (chrome.scripting) when the active tab predates an extension reload,
so stale tabs never break exports. No `storage`, no `downloads`,
no `tabs`, no background worker. Content script matches `https://x.com/i/chat*`
and legacy `https://x.com/messages*`. The conversation id is read from the
URL path (`/i/chat/<id>`).

---

## 6. Selector strategy (defensive — X's DOM changes)

Every DOM touchpoint is an **ordered candidate list**; the first selector that
matches wins, and match counts feed `diagnostics.probes`:

| Touchpoint | Candidates (in order) |
|---|---|
| Message entry | `div[data-testid="messageEntry"]`, `[data-testid="message"]`, `[role="listitem"] [role="listitem"]`-scoped fallback, then **runtime discovery** (below) |
| Thread container | nearest scrollable ancestor of the first entry (`overflow-y` auto/scroll + `scrollHeight > clientHeight`) |
| Timestamp | `time[datetime]` inside entry |
| Sender | `a[href^="/"][role="link"]` inside entry → handle from path (excluding `/i/`, `/intent/`, `/messages`) |
| Text | `[data-testid="tweetText"]`, `[data-testid="messageText"]`, else cleaned `innerText` |
| Photo | `img` in entry whose src is **not** profile/emoji (see filters) |
| Video | `video` element, `[data-testid="videoPlayer"]` |
| GIF | `[data-testid="gif"]`, img alt/src/class containing `gif` |
| Title | thread header: `header [data-testid="userLink"]`, then `header` text fallback |

**Media filters (critical for correct placeholders):**

- Avatar: `img` whose src contains `profile_images`, or inside `a[href]`
  that resolves to a profile path → ignored.
- Emoji: `img` with src matching `emoji|twemoji`, or rendered size ≤ 48 px
  → ignored (part of `text`, not `media`).
- Everything else content-sized counts as an attachment.

**Runtime discovery fallback (DOM-change insurance).** When every fixed
candidate misses, `extract.js` derives the entry selector from the live page:
scope to the container holding the most `time[datetime]` nodes (the
conversation pane, not the sidebar), then for each timestamp take its
**topmost single-message ancestor carrying a `data-testid`** — that's the
message row — and use the most frequent such key (secondary keys, e.g. a
separate row testid for own messages, are included when ≥60 % as frequent).
Selectors are cached on success and re-queried per call (safe under
virtualization). This adapts to `/i/chat` layouts the fixed lists never saw.

If probes **and** discovery find zero entries → export fails with an error
carrying a one-line **DOM report** (landmark counts, the page's top-15
`data-testid` vocabulary, ancestor chains of the first timestamps, URL) —
one pasted error is enough to retune the selector lists. Nothing is
downloaded, page untouched. If only some fields fail → export proceeds with
`null`s (fail-soft: a partial archive beats none, and diagnostics say where).

---

## 7. History loading (getting the *whole* chat)

X loads DM history lazily. Before extracting:

1. Find thread container (table above).
2. Loop: `container.scrollTop = 0` → wait ~700 ms → count entries.
3. Stop when count is unchanged for **3 consecutive rounds**, or caps hit:
   `MAX_ROUNDS = 600`, `MAX_ENTRIES = 50 000`, hard timeout 10 min.
4. Progress (`loaded N messages`) reported over the port each round.
5. Abort immediately if the popup disconnects or the user navigates away.

Read-only: never clicks, never keys, never writes into the page.

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Safety | 100% read-only DOM. Never `element.remove()`, never focus stealing, never auto-scroll *after* export (restores original scroll position). |
| Privacy | Zero network beyond the current page. No media fetches. Nothing stored (no `storage` permission). |
| Determinism | Pure `organize.js`; same input ⇒ same output (tests enforce). |
| Performance | Extraction of 5k entries < 300 ms; scrolling is I/O-bound and progress-reported. |
| Failure | Any probe/parse exception → error surfaced in popup; partial data never silently discarded. |
| Console | Silent unless `localStorage.CE_DEBUG = "1"`. |

---

## 9. Edge cases

- Group DMs with many senders → participants list from unique senders.
- Deleted messages (DOM gone) → impossible to recover; not a defect.
- Media-only messages with no timestamp visible → `timestamp: null` (sorted last).
- Very long media names / unicode chat titles → filename sanitized
  `[a-z0-9-_]` only, collapsed dashes, max 60 chars, fallback `conversation`.
- User closes popup mid-export → port disconnects → abort cleanly.
- Navigating to another conversation mid-export → entry probes change → abort with message.
- Stickers (if any) → treated as images (`img`) unless a gif marker exists.
- Message containing only an emoji → `text`, never `img`.

---

## 10. Milestones

| M | Deliverable |
|---|---|
| M1 | Folder + docs (PRD/TODO/AGENTS) + manifest + empty popup loads on x.com/messages |
| M2 | `organize.js` pure core (classify/dedupe/sort/document) + Node tests green |
| M3 | `extract.js` probe + parse pipeline (entries, text, time, sender, media) |
| M4 | `content.js` history loading + port progress + export orchestration |
| M5 | Popup: button, progress UI, blob download, summary, errors |
| M6 | QA pass + README + docs status update + push |
