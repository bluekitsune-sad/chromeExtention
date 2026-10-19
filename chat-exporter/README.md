# Chat Exporter (X DMs → JSON)

Chrome extension (Manifest V3) that saves the **currently open X DM
conversation** as one clean, sorted JSON file.

- **Media are never stored** — an image message contains the literal `"img"`,
  a GIF `"gif"`, a video `"vid"`.
- **Sorted & organized** — deduplicated, chronological, with conversation
  metadata, participants, stats, and diagnostics.
- **Local only** — no external services, no telemetry, no extra permissions
  (host access to `x.com` only). Nothing is stored between exports.

## Install (development / unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this `chat-exporter/` folder
3. Open `https://x.com/i/chat` (X's chat section) and a conversation

## Use

1. Open the conversation you want to archive.
2. Click the extension icon → **Export this conversation**.
3. Watch the progress ("Loading history… 800 messages") — the extension
   scrolls the thread to load older messages first.
4. A file downloads: `x-dm_<name>_<date>.json`.

## Output format

```json
{
  "schema": "x-dm-export/1",
  "exportedAt": "2026-10-19T14:03:11.000Z",
  "source": "https://x.com/messages/123",
  "conversation": { "id": "1234567890", "title": "Alice (@alice)", "participants": ["@alice", "@bob"], "kind": "1:1" },
  "stats": { "messageCount": 842, "first": "…", "last": "…" },
  "diagnostics": { "probes": { "entries": 842, "images": 31 }, "undatedMessages": 0, "duplicatesRemoved": 3 },
  "messages": [
    { "id": "m1", "sender": "@bob", "timestamp": "2026-01-01T09:00:00.000Z",
      "type": "text", "text": "hey", "caption": null, "media": [], "replyTo": null },
    { "id": "m2", "sender": "@alice", "timestamp": "2026-01-02T09:30:00.000Z",
      "type": "image", "text": "img", "caption": null, "media": ["img"], "replyTo": null }
  ]
}
```

Rules (full spec in `PRD.md`):

- Media-only message → `text` is the placeholder; media + caption →
  placeholder in `text`, the words preserved in `caption`.
- Multiple media in one message → `"img + vid"`.
- Sorted oldest → newest; messages without timestamps go last.
- `conversation.id` comes from the URL (`https://x.com/i/chat/<id>`); the
  filename falls back to it when the title can't be read.
- Re-exporting an unchanged chat yields identical JSON (except `exportedAt`).

## Debugging

If an export finds nothing or senders are `null`:

0. **"Content script isn't active" / "couldn't attach"** — the popup now
   attaches itself on demand, but the `scripting` permission is new: click
   ⟳ reload on the extension in `chrome://extensions` once, then export
   again (no tab reload needed anymore).

1. Set `localStorage.CE_DEBUG = "1"` in the x.com console → `[CE]` logs.
2. Check the export's `diagnostics.probes` — `entries` is how many message
   nodes the selector probe found.
3. X changes its DOM regularly — the ordered candidate selectors live at the
   top of `extract.js`; that's the first place to update.

## Tests

```
node test\organize.test.js
```

29 dependency-free tests covering classification, dedupe, sorting, the
document schema, conversation-id parsing, and filenames.

## Docs

- `PRD.md` — requirements, schema, selector strategy
- `AGENTS.md` — build rules for humans/agents
- `TODO.md` — status and remaining manual QA
