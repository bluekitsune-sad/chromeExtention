# TODO — X Feed Filter Extension

Work top-down. Check off items as they're completed. Details in `PRD.md`,
build rules in `AGENTS.md`.

**Status (2026-10-20): M1–M5 code-complete + round-2 fixes shipped.
Round 3 (About-section filtering): recon probe shipped — blocked on the user's
Test-fetch output to confirm where X's About data lives (see Round 3 section).
Automated checks: 34/34 unit tests, 5/5 real-page parser validations, all JS syntax-clean.
Remaining: M6 manual QA in Chrome.**

## M1 — Scaffold — ✅ code complete
- [x] Create `x-feed-filter/` folder structure (manifest, js, popup, styles, icons)
- [x] Write `manifest.json` (MV3, `storage` perm, `https://x.com/*` host, content script, popup)
- [x] Generate icons (16/48/128 PNG)
- [x] `popup.html` opens from the toolbar (full settings UI)
- [ ] **Manual:** load unpacked in Chrome, confirm no errors on `x.com`

## M2 — Feed watcher + rules that need no network — ✅
- [x] `settings.js`: load/save settings from `chrome.storage.sync` + defaults (PRD §4.2)
- [x] `content.js`: MutationObserver on feed, detect new `article[data-testid="tweet"]`
- [x] Hook X client-side navigation (pushState/replaceState/popstate) so observer survives SPA routes
- [x] `analyzer.js`: extract handle, post text, author key from a post node
- [x] `styles.css`: hide class (height 0 + visibility hidden), never `remove()` (incl. `role=listItem` wrapper via `:has`)
- [x] `filter.js`: rule registry + `matchesAccount` rule
- [x] `filter.js`: `matchesKeyword` rule (case-insensitive substring by default)
- [x] Wire pipeline: observe → analyze → quick rules → hide (per-node recheck after async)

## M3 — Profile cache + location rule — ✅
- [x] `profile-cache.js`: persistent cache in `chrome.storage.local` (`profile:<handle>`, TTL 7 days)
- [x] Serialize fetches: 1 in-flight max, ~300 ms delay, negative-cache failures 1 h
- [x] Parse profile location from embedded JSON (`DOMParser` script scan → `findUserObject`)
      — *deviation from PRD:* no `[data-testid="UserLocation"]` DOM fallback needed; profile
      HTML is fetched, not rendered, so the fallback is a windowed HTML regex instead
- [x] Extract `followers_count` / `following_count` in the same parse (for M4)
- [x] `filter.js`: `matchesLocation` ("contains" | "equals", case-insensitive by default)
- [x] Handle missing location → fail open
- [x] LRU cap at 2,000 cache entries (`xff:profile-index`)

## M4 — Follower / following range rules — ✅
- [x] `filter.js`: `matchesFollowers` range rule (`min`/`max`, null = unbounded, both null = inactive)
- [x] `filter.js`: `matchesFollowing` range rule (same semantics)
- [x] One profile fetch satisfies location + both range rules (single `getProfile()` in pipeline)

## M5 — Popup settings UI — ✅
- [x] Locations list: add / remove / list + match-mode select
- [x] Followers: enable checkbox + min/max number inputs
- [x] Following: enable checkbox + min/max number inputs
- [x] Accounts list + keywords list editors (Enter key adds)
- [x] Master enable + pause toggle
- [x] Hidden-posts session counter (footer; badge skipped — optional)
- [x] Validate numeric inputs (≥0, min ≤ max, inline error, at least one bound)
- [x] Case-sensitivity toggle, clear-profile-cache button, auto-save with status line

## Round 2 (2026-10-10): bugfix + requested features — ✅
- [x] **Root cause of `Hidden: 0` fixed** — x.com profile pages embed React-streamed (RSC)
      data with UNQUOTED keys (`location:"Karachi"`, `followers:123`); the v1 parser only
      understood strict JSON (`"location":"..."`) → every lookup failed → negative-cached
      1 h → nothing hidden. Rewrote parser: nearest-anchor extraction, RSC + quoted-JSON,
      case-insensitive handle anchors. Validated on 5 captured real profiles
      (`test/parse-sample.validation.js`: ImranKhanPTI, narendramodi, Karachi, samaaTV, elonmusk)
- [x] Secondary fetch source when HTML parse fails: v1.1 `users/show.json` using the web
      client's public bearer + session `ct0` csrf token
- [x] **Location mode setting** `locationMode`: `hide` (blocklist) / `only`
      (allowlist — only show users from the listed locations; unknown-profile fails open)
- [x] **Typo-proof location presets** (`locations-data.js`, ~250 cities/countries incl.
      full Pakistan coverage) wired as `<datalist>` autocomplete on the location input
- [x] **Diagnostics panel** in popup: authors cached, their location/follower data,
      failed lookups with error text + retry hint
- [x] Debug logs for every profile fetch result and missing-profile fail-open
- [x] Tests extended: 30/30 unit (incl. 7 allowlist-mode cases) + parser validation suite

## Round 3 (2026-10-20): About-section filtering — recon first ✅ probe shipped

Feature request: filter by the profile's **"About this account"** section —
where the account is *based* (X-inferred country — NOT the self-declared
`location` we already filter) and the **country-specific app store** it uses,
plus join/username-change metadata. Data source must be confirmed before any
rule is written (PRD §9).

- [x] `probeAbout()` in `profile-cache.js` (pure): visible-label scan
      (`about this account`, `based in`, `app store`, `proxy`, `vpn`,
      `joined`, …) + generic payload-key inventory within ±1500 chars of the
      author's `screen_name` anchors — unknown fields become visible, no
      key allowlist
- [x] Popup **Test fetch** shows an `ABOUT PROBE` block: anchors, keys near
      the handle, label hits with excerpts — and an inline diagnosis:
      `label hits: (none …)` ⇒ section data arrives via a separate XHR
- [x] +4 unit tests (labels+keys, case-insensitive counts/excerpt cap,
      quoted+unquoted anchors, garbage fail-open) → 34 assertions-groups
- [ ] **⚠ User recon (blocks the rest):** reload the extension → popup →
      Test fetch on a handle whose profile *shows the About section* →
      paste the `ABOUT PROBE` block **and** the section's exact visible
      wording (e.g. "Based in Pakistan · App Store · Joined Mar 2014"),
      noting whether it's visible inline or only behind a ⋯-menu modal
- [ ] Decide source from that output: embedded payload (→ extend
      `rscExtract`/`pickFields`) vs separate XHR (→ DevTools Network capture
      when opening the About panel)
- [ ] Extract new fields (`baseCountry`, `appStore`, …) through the existing
      cache — one fetch per author unchanged
- [ ] Rules per AGENTS checklist: pure `about*` rules in `filter.js`,
      `RULES` registration, settings keys + defaults, popup UI section, PRD
      rule-table row (hide/only modes mirroring `locationMode`)
- [ ] Tests for the new rules; full suite green

## M6 — QA & docs
- [x] Automated: `node --check` all 6 JS files, `JSON.parse` manifest — pass
- [x] Automated: `node test/filter.test.js` — 23/23 pass (all 5 rule types, precedence, fail-open, HTML parser)
- [x] README: load-unpacked install steps + architecture + how location works
- [ ] **Manual (requires logged-in Chrome session):**
  - [ ] Scroll `x.com/home` 5+ min — no errors, no flash of hidden posts, no scroll breakage
  - [ ] SPA navigation (Home → Profile → Notifications → Home) keeps filtering
  - [ ] Quote tweets / retweets analyze the right author
  - [ ] Authors with no profile location stay visible (fail open)
  - [ ] Fresh cache + long scroll → no 429s / rate lockouts
  - [ ] Enabled off / Pause on → all posts visible
  - [ ] Settings survive browser restart; popup changes apply to open tabs

## v2 (backlog, not now)
- [ ] Post geotag ("post place") rule
- [ ] Whitelist that overrides all rules
- [ ] "Why was this hidden?" debug tooltip
- [ ] Settings export/import JSON
