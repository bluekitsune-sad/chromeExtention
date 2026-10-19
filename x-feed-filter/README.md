# X Feed Filter

Chrome extension (Manifest V3) that hides posts from your X feed by:

- **Location** — authors whose *profile location* matches (e.g. "Karachi")
- **Followers** — authors inside a follower-count range (e.g. < 100 followers)
- **Following** — authors inside a following-count range (e.g. > 2000 following)
- **Account** — specific handles
- **Keyword** — post text containing a word/phrase

No accounts, no external servers, no analytics. All data stays in
`chrome.storage` on your machine; profile lookups use your own logged-in
session against `x.com` only.

## Install (development / unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `x-feed-filter/` folder
4. Open or reload `https://x.com/home`

## Use

Click the extension icon:

- **Enabled** — master switch. **Pause** — temporarily stop filtering.
- **Locations to hide** — add one substring per entry; match mode is
  `contains` (default) or `equals`.
- **Follower / Following count** — tick *Filter*, enter `min` and/or `max`
  (leave blank for an open end). Posts by authors **inside** the range are
  hidden. Example: hide accounts with fewer than 100 followers →
  `min 0`, `max 99`.
- **Accounts / Keywords** — add entries; ✕ removes.
- **Clear profile cache** — forces fresh profile fetches.
- **Hidden** — posts hidden this browser session.

Changes save immediately and apply to open X tabs without a reload.

## How location works

X posts don't carry a location field, so the extension resolves the post
author's handle, then reads the **profile location** once per author:

```
new post → extract @handle → cache lookup
             │ HIT  → location/followers/following already known (0 requests)
             └ MISS → fetch https://x.com/<handle> once (max 1 at a time,
                       ~300 ms gap) → parse embedded JSON → cache 7 days
```

Authors with no profile location are **not** hidden by location rules
(fail open). Failed fetches are negative-cached for 1 hour so scrolling
never hammers the site.

## Architecture

```
x-feed-filter/
├── manifest.json      MV3 manifest (storage + x.com only)
├── settings.js        settings load/save + defaults (shared w/ popup)
├── profile-cache.js   ALL profile fetching + persistent cache (LRU 2000)
├── filter.js          pure rule engine — no DOM/network/storage
├── analyzer.js        extracts handle/text from a feed <article>
├── content.js         MutationObserver → pipeline → hide class
├── styles.css         collapse-to-zero-height hiding (never node removal)
└── popup.*            settings UI
```

Pipeline: `observe → extract → quick rules (account/keyword, no network) →
profile cache lookup → profile rules (location/followers/following) → hide`.

Every rule is a pure function `(postContext, settings) => ruleName | null`.
Adding a rule type = one function + one registry entry + one settings key +
one popup section (see `AGENTS.md`).

## Docs

- `PRD.md` — product requirements and design decisions
- `AGENTS.md` — build rules for anyone/any agent extending it
- `TODO.md` — task checklist and status

## Tests

Pure logic is covered by a dependency-free Node test:

```
node test/filter.test.js
```

## Load-unpacked caveats

- Reloading after edits: `chrome://extensions` → refresh icon on the card.
- X changes its DOM periodically; selectors live in `analyzer.js`
  (`data-testid` based) — if hiding stops working, check there first.
