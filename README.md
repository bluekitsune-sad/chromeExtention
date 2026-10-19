# Chrome Extensions Monorepo

Home for multiple Chrome extensions (Manifest V3). Each extension lives in its
own folder with its own docs (`PRD.md`, `TODO.md`, `AGENTS.md`, `README.md`)
and can be loaded independently via `chrome://extensions` → Load unpacked.

## Extensions

| Folder | Extension | What it does |
|---|---|---|
| [`x-feed-filter/`](x-feed-filter/) | **X Feed Filter** | Hides posts from your X feed by author location, follower/following count, account, or keyword. |
| [`chat-exporter/`](chat-exporter/) | **Chat Exporter** | Extracts an X (Twitter) DM conversation and saves it as clean, sorted JSON — media become `img`/`gif`/`vid` placeholders, never files. |

## Quick start

1. Pick an extension folder.
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the folder.
3. Follow that extension's `README.md`.

## Conventions

- One folder per extension; no shared code between extensions (keep them independently loadable).
- Docs live **inside** the extension folder: `PRD.md` (what/why), `TODO.md` (status), `AGENTS.md` (build rules for humans/agents).
- No build steps, no bundlers, no runtime dependencies.
- Tests are dependency-free Node scripts: `node test/<name>.test.js` from inside the extension folder.

## Repository layout

```
.
├── README.md            ← this index (root holds docs only)
├── x-feed-filter/
│   ├── PRD.md · TODO.md · AGENTS.md · README.md
│   ├── manifest.json … extension code …
│   └── test/
└── chat-exporter/
    ├── PRD.md · TODO.md · AGENTS.md · README.md
    ├── manifest.json … extension code …
    └── test/
```
