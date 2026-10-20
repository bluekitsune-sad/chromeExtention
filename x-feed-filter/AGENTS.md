# AGENTS.md — Build Instructions for the X Feed Filter Extension

Instructions for any AI agent (or human) implementing the extension defined in
`PRD.md`. Follow these rules literally; they exist to keep the codebase
extensible and safe to run against a live X session.

## Context

- Working directory: `C:\Users\DC\Downloads\saad\hehe`
- Read `PRD.md` before writing code — it is the source of truth for behavior.
- Check `TODO.md` and work top-down; mark items done as you complete them.

## Hard rules

1. **No hardcoded filters.** Never write `if (location === "Karachi")`.
   Every rule value comes from `chrome.storage` via `settings.js`.
2. **Fail open.** If any analysis or fetch throws, leave the post visible and
   log once. Never hide a post on an error path.
3. **Never `element.remove()`** X feed nodes. Hide via the class defined in
   `styles.css` (height 0 + visibility hidden) so X's virtualized list stays
   consistent.
4. **One profile fetch per author, ever.** All network access to profiles
   goes through `profile-cache.js`. Rules must never fetch directly.
5. **Serialize network requests.** Max 1 in-flight profile request, ~300 ms
   gap between requests, negative-cache failures for 1 hour.
6. **Rules are pure functions** with the signature
   `(postContext, settings) => boolean`. No DOM access, no network, no
   storage inside rule modules.
7. **Manifest V3 only.** No remote code, no eval, minimal permissions:
   `storage` + host permission `https://x.com/*`.
8. **Debug logging** only when `localStorage.XFF_DEBUG === "1"`.

## Conventions

- Plain JS files loaded in order via the manifest `content_scripts` array:
  `settings.js`, `profile-cache.js`, `filter.js`, `analyzer.js`, `content.js`.
- No build step, no bundler, no dependencies in v1.
- camelCase functions, `const` by default, ES modules only inside the popup
  (`type: "module"`), content scripts use plain scripts to avoid bundling.
- Settings schema is exactly as in PRD §4.2 — add keys, never rename existing ones.
- Each new rule type:
  1. pure function in `filter.js` (or its own file),
  2. registered in the `RULES` array,
  3. settings key + default,
  4. popup UI section,
  5. PRD row in the rule table.

## Selectors (defensive)

Prefer test IDs over classes; X's class hashes change often:

- Post node: `article[data-testid="tweet"]`
- Post text: `[data-testid="tweetText"]`
- Author link: `a[href^="/"][href*="/status/"]` → handle from the path segment
  before `/status/`
- User location is NOT in the feed DOM. Source of truth: the author's profile
  page embedded payload, fetched via `profile-cache.js`.
- That payload is React-streamed data with **unquoted keys**
  (`screen_name:"handle"`, `location:"Karachi"`, `followers:123`) — the parser
  in `profile-cache.js` handles both RSC and quoted-JSON forms. Any change to
  it MUST keep `node test/parse-sample.validation.js` green (validated against
  real captured x.com pages).
- About-section fields (inferred base country, app store, …): source is
  **unconfirmed** — run the `probeAbout` output (popup → Test fetch →
  `ABOUT PROBE`) and follow TODO "Round 3" before parsing anything new.
  Never guess field names, and keep `probeAbout` diagnostics-only (not rule
  values).

If a selector stops matching, fail open and log — do not guess wildly.

## Definition of done (per task)

- Works on `https://x.com/home` with real feed scrolling (test manually).
- No console errors outside the debug flag.
- New settings persist across reloads.
- `TODO.md` updated.

## Do not

- Do not publish to the Chrome Web Store.
- Do not add analytics, external endpoints, or telemetry.
- Do not "optimize" by removing the cache or request throttling.
- Do not rewrite working modules wholesale when adding a feature — extend.
