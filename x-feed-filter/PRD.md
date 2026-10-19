#GITHUB_LINK="https://github.com/bluekitsune-sad/chromeExtention.git"


# PRD — X Feed Filter (Chrome Extension)

**Version:** 1.0
**Status:** Draft
**Platform:** Google Chrome (Manifest V3), target site: `https://x.com/*`

---

## 1. Overview

A Chrome extension that hides posts from the user's X (Twitter) feed based on
user-defined rules. Filtering is **data-driven** — every rule type lives in a
generic filter engine, so new rule types can be added without rewriting the
extension.

### Rule types (v1)

| Rule       | Hides a post when…                                                     |
|------------|------------------------------------------------------------------------|
| Location   | The post author's **profile location** matches a blocked location, **or** (allowlist mode) does *not* match the allowed locations |
| Followers  | The post author's **follower count** is inside a configured range       |
| Following  | The post author's **following count** is inside a configured range      |
| Account    | The post author's **handle** is on the blocked list                     |
| Keyword    | The post **text** contains a blocked keyword/phrase                     |

### Non-goals (v1)

- Content-based location *inference* from post text (unreliable).
- Post geotags / place tags as the primary location signal (separate feature later).
- Hiding replies in detail threads (feed + profile timelines only in v1).
- Publishing to the Chrome Web Store (load unpacked during development).

---

## 2. Problem & Goals

X's feed has no native filtering by author attributes. Users want to:

1. Hide posts from people whose **profile says a specific location** (e.g. "Karachi").
2. Hide posts from accounts with too **few or too many followers/following**
   (spam/bot signals, or conversely large accounts).
3. Combine the above with keyword and account blocklists.

**Goals**

- G1: Filter new feed posts in real time with no visible flash of hidden content.
- G2: Never fetch profile data more than once per author (cached).
- G3: Zero hardcoded filter values — all rules come from storage.
- G4: Adding a new rule type = adding one module + one settings section.

**Success criteria**

- Hidden posts removed within ~500 ms of appearing in DOM.
- < 1 profile API request per unique author, ever (persistent cache).
- No feed breakage: no console errors, no infinite loops, feed scroll unaffected.

---

## 3. User Stories

- **US1:** As a user, I add "Karachi" to blocked locations, so posts by authors
  whose profile location contains "Karachi" disappear from my feed.
- **US2:** As a user, I set *hide if followers < 100*, so bot/throwaway accounts
  don't show up.
- **US3:** As a user, I set *hide if following > 2000*, so follow-spam accounts
  are filtered out.
- **US4:** As a user, I block keywords, so posts containing them are hidden
  regardless of author.
- **US5:** As a user, I toggle a rule off (or pause the extension entirely) and
  hidden posts reappear after the next feed refresh.
- **US6:** As a user, I can see a small badge/counter of how many posts were
  hidden this session.

---

## 4. Architecture

```
chrome-extension/
│
├── manifest.json          MV3 manifest, storage permission, x.com content script
├── content.js             DOM watcher: detects new posts, orchestrates pipeline
├── analyzer.js            Extracts handle, text, and (on demand) profile data
├── profile-cache.js       Fetch + persistent cache of profile location/followers
├── filter.js              Generic rule engine: matchesLocation, matchesFollowers, …
├── settings.js            Loads/saves settings, provides defaults
├── popup.html / popup.js / popup.css   Settings UI
├── styles.css             "hidden" state styles (never use display:none hacks
│                          that break X's virtualized list — see §7)
└── icons/
```

### 4.1 Data flow

```
MutationObserver fires
  → content.js finds new <article> post nodes
  → analyzer.js extracts:
        handle        (from link containing /status/)
        post text     (from [data-testid="tweetText"])
        author key    (handle, lowercased)
  → filter.js quick pass (keyword + account rules — no network needed)
  → profile-cache.js lookup (author key)
        HIT  → location, followers_count, following_count
        MISS → fetch profile once, persist to chrome.storage.local
  → filter.js full pass (location + follower range + following range)
  → match → hide node
```

### 4.2 Settings schema (chrome.storage.sync)

```json
{
  "enabled": true,
  "paused": false,
  "locations": ["Karachi", "Lahore"],
  "locationMatch": "contains",
  "locationMode": "hide",
  "accounts": ["@someone"],
  "keywords": ["giveaway"],
  "followers": { "min": null, "max": null },
  "following": { "min": null, "max": null },
  "caseSensitive": false
}
```

- `null` = unbounded side of the range.
- Range semantics: hide the post if `min <= value <= max` **and** at least one
  bound is non-null. If both bounds are null the rule is inactive.
- Profile cache lives separately in `chrome.storage.local`
  (key: `profile:<handle>` → `{ location, followers, following, fetchedAt }`),
  TTL 7 days.

### 4.3 Generic rule contract

Every rule is a pure function:

```js
// returns true → hide the post
function rule(postContext, settings) -> boolean
```

`postContext = { handle, text, location, followers, following }`

`filter.js` iterates a registered array of rules. A new rule type = append to
the array + add a settings key + add a popup section. **No changes to
content.js.**

---

## 5. Location resolution (the hard part)

Posts carry no reliable location field. v1 uses **profile location**:

1. Resolve author handle from the post.
2. Look up cached profile: `GET https://x.com/<handle>` fetched via
   `fetch()` from the content script (same-origin, uses the logged-in session).
3. Parse the location from the profile page's embedded JSON
   (`__INITIAL_STATE` / GraphQL user result → `location` field) — prefer this
   over DOM scraping; fall back to `[data-testid="UserLocation"]` if absent.
4. Store in cache, feed into rule.

**Rules for v1:**

- Never fetch the same handle twice (negative-cache failures for 1 hour so a
  missing location isn't re-requested on every scroll).
- Fetch at most **1 concurrent profile request**, small delay (~300 ms)
  between requests to avoid rate limiting.
- Authors with **no profile location** → treated as `""` → match only if the
  user's rule is explicitly empty-string matching (default: no match, post stays).
  A **failed fetch** is `null` → always fail open.
- Matching is substring, case-insensitive by default
  (`"Karachi, Pakistan"` matches rule `"karachi"`).

**Location modes** (`locationMode` setting):

- `"hide"` (default, blocklist): hide posts whose profile location matches a
  listed location.
- `"only"` (allowlist): hide posts whose author's profile location is known
  but **not** in the list — i.e. *only show users from the listed locations*.
  Authors with no location set are hidden (they aren't from a listed place);
  authors whose profile **failed to load** stay visible (fail open).

**Actual payload format (discovered 2026-10):** x.com profile pages embed
React-streamed data with **unquoted keys** (`core:{screen_name:"handle"}`,
`followers:123,following:45,location:"Karachi"`), not strict JSON. The parser
handles both unquoted (RSC) and quoted (legacy JSON) forms by anchoring on the
handle's `screen_name` and taking the *nearest* field match. Validated against
5 captured real pages (`test/parse-sample.validation.js`). Secondary fallback:
v1.1 `users/show.json` with the web client's public bearer + session `ct0`.
All profile lookups surface their status in the popup's **Diagnostics** panel
(cached count, per-author location, failures with error text).

### Alternatives considered

- **B. Post-level geotag** — precise but only a tiny fraction of posts have it.
  Deferred to v2 as an *additional* rule.
- **C. Content inference** — unreliable, false positives. Rejected.

---

## 6. Follower / Following filtering

Same cache path as location (one profile fetch serves all rules):

- `followers_count` and `following_count` come from the same profile payload.
- UI: two rows in the popup, each with *min* and *max* number inputs and an
  enable checkbox.
- Interpretation: **hide** accounts whose counts fall inside `[min, max]`.
  Example: `followers: { min: 0, max: 99 }` → hides accounts with < 100 followers.
- `followers: { min: null, max: null }` → rule disabled.

---

## 7. Non-functional requirements

| Area        | Requirement |
|-------------|-------------|
| Performance | Observer-driven, no polling timers; process new nodes in < 10 ms excluding network |
| Feed safety | X virtualizes its list — hidden posts are removed via a dedicated class that sets the post container height to 0 and `visibility: hidden`, **never** `element.remove()` (removing nodes confuses X's list recycling). Verify scrolling behavior manually. |
| SPA support | Re-run setup on X's client-side navigations (history pushState hook + observer on main) |
| Storage      | Settings in `storage.sync` (≤ 100 KB), profile cache in `storage.local` |
| Privacy      | No external servers. Profile fetches go to x.com only, using the user's own session |
| Errors       | All rules fail open (post stays visible) on any exception; errors logged once per rule |
| Console      | Silent in production; `XFF_DEBUG` flag gates verbose logging |

---

## 8. Edge cases

- Author handle not extractable (quote tweets, retweets) → analyze the
  **original** tweet author for retweets; quote-tweet wrapper uses outer author.
- Deleted/protected profiles mid-session → negative cache, keep last known data.
- Post edited → re-run analysis on the node.
- Location contains unicode/RTL text → substring match must be unicode-safe.
- Popup opened with invalid numeric input → clamp / ignore, show inline error.
- Cache growth → cap at 2,000 entries, LRU eviction.

---

## 9. Future (v2+)

- Post geotag rule (`Filter by post place`).
- Whitelist that overrides all rules (e.g. always show followed accounts).
- Per-rule enable toggles + "why was this hidden?" debug tooltip.
- Export/import settings as JSON.

---

## 10. Milestones

| M  | Deliverable |
|----|-------------|
| M1 | Scaffold + manifest + empty popup loads on x.com |
| M2 | Feed watcher detects new posts, hides by keyword/account (no network) |
| M3 | Profile cache + location rule |
| M4 | Follower/following range rules |
| M5 | Full popup settings UI + pause toggle |
| M6 | QA pass against §7/§8, README with load-unpacked instructions |
