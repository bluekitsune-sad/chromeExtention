// profile-cache.js — fetch + persist author profile data (location, followers,
// following). ALL network access to profiles goes through this file
// (AGENTS.md hard rule 4).
//
// Strategy:
//   getProfile(handle)
//     → cache HIT (fresh)  : return immediately, zero network
//     → cache MISS         : queue a fetch (max 1 in flight, ~300 ms gap),
//                            parse embedded JSON in the profile HTML,
//                            persist to chrome.storage.local
//     → fetch/parse fail   : negative-cache for 1 hour (no hammering)
//
// Cache key:  "profile:<handle>"
// Value:      { location, followers, following, fetchedAt, ok }
// TTL:        7 days success / 1 hour failure. LRU cap: 2,000 entries.
(function () {
  "use strict";

  const PREFIX = "profile:";
  const INDEX_KEY = "xff:profile-index"; // { "<key>": fetchedAt }
  const MAX_ENTRIES = 2000;
  const TTL_OK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const TTL_FAIL_MS = 60 * 60 * 1000; // 1 hour
  const FETCH_GAP_MS = 300;
  const FETCH_TIMEOUT_MS = 10000;

  function debug(...args) {
    if (globalThis.XFF && XFF.settings) XFF.settings.debug(...args);
  }

  function cacheKey(handle) {
    return PREFIX + String(handle || "").replace(/^@+/, "").toLowerCase();
  }

  function fresh(entry) {
    if (!entry || typeof entry !== "object" || !entry.fetchedAt) return false;
    const ttl = entry.ok ? TTL_OK_MS : TTL_FAIL_MS;
    return Date.now() - entry.fetchedAt < ttl;
  }

  // ---------------------------------------------------------------- parsing

  function unescapeJsonStr(s) {
    try {
      return JSON.parse('"' + s + '"');
    } catch (_) {
      return s;
    }
  }

  // Recursively search parsed JSON for a user object with a matching
  // screen_name. Handles X's GraphQL nesting: user.result.core.screen_name +
  // user.result.legacy.{location,followers_count,following_count}.
  function findUserObject(node, handle, depth) {
    if (!node || typeof node !== "object" || depth > 40) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findUserObject(item, handle, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const screen =
      typeof node.screen_name === "string"
        ? node.screen_name
        : node.core && typeof node.core.screen_name === "string"
          ? node.core.screen_name
          : null;
    if (screen && screen.toLowerCase() === handle) return node;
    for (const key of Object.keys(node)) {
      const found = findUserObject(node[key], handle, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function pickFields(user) {
    if (!user) return null;
    const legacy = user.legacy && typeof user.legacy === "object" ? user.legacy : {};
    const rawLoc =
      typeof user.location === "string"
        ? user.location
        : typeof legacy.location === "string"
          ? legacy.location
          : null;
    const followers =
      typeof user.followers_count === "number"
        ? user.followers_count
        : typeof legacy.followers_count === "number"
          ? legacy.followers_count
          : null;
    const following =
      typeof user.following_count === "number"
        ? user.following_count
        : typeof legacy.following_count === "number"
          ? legacy.following_count
          : null;
    if (rawLoc === null && followers === null && following === null) return null;
    return {
      location: rawLoc !== null ? unescapeJsonStr(rawLoc) : "",
      followers: followers !== null ? Number(followers) : null,
      following: following !== null ? Number(following) : null
    };
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Extract user fields from the raw HTML. X serves React streamed data
  // (RSC) with UNQUOTED keys and !$ booleans, e.g.:
  //   core:$R[25]={name:"Elon Musk",screen_name:"elonmusk"}
  //   ...followers:241524621,following:1419,location:"",name:"Elon Musk"...
  // Older/JSON surfaces use quoted keys ("location":"...","followers_count":N).
  // Both are handled: locate every mention of this handle's screen_name
  // (anchor), then take the NEAREST field match to any anchor within
  // MAX_DIST chars. Handles are matched case-insensitively.
  // Validated against real captured pages — see test/parse-sample.validation.js.
  // Fields belong to a SPECIFIC user object, not merely "near the handle":
  // the payload puts the display name inside the same object as screen_name
  // (core:{name:"X",screen_name:"y"}) and repeats that name in the user's
  // flattened data block (…followers:4000,location:"Karachi",name:"X").
  // So: read the name adjacent to our handle, then collect fields only from
  // tight windows centered on THAT name. Nearby recommendation/notification
  // users (different names) can never contaminate the result.
  // location: null = not found (unknown) / "" = profile genuinely has none.
  const NAME_NEAR = 300; // chars — name shares the core object with screen_name
  const BLOCK = 700; // chars — half-window around the name for field pickup
  const MAX_DIST = 12000; // wide tier for hoisted/loose payload layouts

  const FIELD_RES = {
    location: /(?:"location"|(?<![\w])location)\s*:\s*"((?:[^"\\]|\\.)*)"/g,
    followers:
      /(?:"(?:followers_count|followers)"|(?<![\w])(?:followers_count|followers))\s*:\s*(\d+)/g,
    following:
      /(?:"(?:following_count|following)"|(?<![\w])(?:following_count|following))\s*:\s*(\d+)/g
  };

  let html = ""; // set in rscExtract (helpers read the closure var)

  // nearest match to ANY of the given centers, within `half` chars
  function nearestToCenters(re, centers, half) {
    let best = null;
    for (const center of centers) {
      const start = Math.max(0, center - half);
      const slice = html.slice(start, Math.min(html.length, center + half));
      for (const m of slice.matchAll(new RegExp(re.source, "g"))) {
        const d = Math.abs(start + m.index - center);
        if (!best || d < best.dist) best = { value: m[1], dist: d };
      }
    }
    return best;
  }

  // Tiered field lookup — strict first, wide only if strict found nothing:
  //   T1: ±700 chars around OUR display-name blocks (same user object)
  //   T2: ±MAX_DIST around OUR display-name blocks (hoisted/loose layouts)
  //   T3: ±1500 around the handle anchor (no name known at all)
  // Each field resolves independently. Wrong data is worse than no data —
  // anything still missing stays null and fails open.
  function pickField(re, nameCenters) {
    if (nameCenters.length) {
      return (
        nearestToCenters(re, nameCenters, BLOCK) ||
        nearestToCenters(re, nameCenters, MAX_DIST) ||
        null
      );
    }
    return nearestToCenters(re, anchorCentersGlobal, 1500);
  }
  let anchorCentersGlobal = [];

  function rscExtract(pageHtml, handle) {
    try {
      html = pageHtml;
      const h = escapeRe(handle);
      const anchors = [];
      for (const re of [
        new RegExp("screen_name\\s*:\\s*\"" + h + "\"", "gi"),
        new RegExp("\"screen_name\"\\s*:\\s*\"" + h + "\"", "gi")
      ]) {
        let m;
        while ((m = re.exec(html)) !== null) anchors.push(m.index);
      }
      if (!anchors.length) return null; // shell / login wall → unparseable
      anchorCentersGlobal = anchors;

      // Display-name candidates for OUR user:
      //  a) `name:"X"` sitting beside a screen_name mention (core object)
      //  b) the page <title>:  "Imran Khan (@ImranKhanPTI) / X"
      const displayNames = new Set();
      const nameRe = /(?:"name"|(?<![\w])name)\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      for (const a of anchors) {
        for (const m of html.matchAll(nameRe)) {
          if (Math.abs(m.index - a) <= NAME_NEAR) {
            displayNames.add(unescapeJsonStr(m[1]));
            break;
          }
        }
      }
      const titleM = /<title[^>]*>([^@(]+?)\s*\(@/.exec(html);
      if (titleM) displayNames.add(titleM[1].trim());

      // every position in the payload carrying one of OUR names
      const nameCenters = [];
      for (const name of displayNames) {
        if (!name) continue;
        const nEsc = escapeRe(name);
        for (const re of [
          new RegExp("name\\s*:\\s*\"" + nEsc + "\"", "gi"),
          new RegExp("\"name\"\\s*:\\s*\"" + nEsc + "\"", "gi")
        ]) {
          let m;
          while ((m = re.exec(html)) !== null) nameCenters.push(m.index);
        }
      }

      const locM = pickField(FIELD_RES.location, nameCenters);
      const folM = pickField(FIELD_RES.followers, nameCenters);
      const ingM = pickField(FIELD_RES.following, nameCenters);
      if (!locM && !folM && !ingM) return null;
      return {
        location: locM ? unescapeJsonStr(locM.value) : null, // null = unknown
        followers: folM ? Number(folM.value) : null,
        following: ingM ? Number(ingM.value) : null
      };
    } catch (e) {
      debug("rscExtract failed", e);
      return null;
    }
  }

  function parseProfileHtml(html, handle) {
    if (!html || typeof html !== "string") return null;
    // 1) JSON <script> blobs (embedded GraphQL/Next data)
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const scripts = doc.querySelectorAll("script");
      for (const s of scripts) {
        const type = (s.getAttribute("type") || "").toLowerCase();
        if (type && type !== "application/json") continue;
        const text = s.textContent;
        if (!text || text.length < 20 || text.trim()[0] !== "{" && text.trim()[0] !== "[") continue;
        try {
          const json = JSON.parse(text);
          const user = findUserObject(json, handle.toLowerCase(), 0);
          const fields = pickFields(user);
          if (fields) return fields;
        } catch (_) {
          /* not JSON, skip */
        }
      }
    } catch (e) {
      debug("script scan failed", e);
    }
    // 2) RSC / raw HTML heuristic fallback (unquoted + quoted key formats)
    return rscExtract(html, handle);
  }

  // ------------------------------------------------------------- about probe
  // Diagnostic for X's "About this account" section (shown when you open a
  // profile): it reveals where an account is BASED (inferred from IP/signals
  // — NOT the self-declared `location` field), whether it used
  // country-specific app stores, join month/year and username changes.
  // Before writing any rule for it we must see where the data lives.
  // The probe answers two questions (Test fetch output):
  //  1) do the section's visible labels appear in the fetched profile HTML?
  //     yes → data is embedded in the payload we already fetch;
  //     no  → it arrives via a separate XHR → endpoint discovery needed.
  //  2) which payload keys sit near THIS user's screen_name anchors?
  //     → unknown fields (country/device/…) become visible for extraction.
  // Pure string work: no DOM, no fetch, no hardcoded filter values
  // (keywords are diagnostics, not rule values — AGENTS hard rule 1).
  const ABOUT_KEYWORDS = [
    "about this account",
    "based in",
    "account is based",
    "app store",
    "google play",
    "country or region",
    "may have used",
    "proxy",
    "vpn",
    "logged in",
    "device",
    "username change",
    "changed their username",
    "joined",
    "inferred"
  ];

  function cleanExcerpt(s, at, len) {
    const start = Math.max(0, at - 80);
    const end = Math.min(s.length, at + len + 80);
    return s.slice(start, end).replace(/\s+/g, " ").trim();
  }

  function probeAbout(pageHtml, handle) {
    const out = { htmlBytes: 0, anchors: 0, keywords: [], keys: [] };
    try {
      if (!pageHtml || typeof pageHtml !== "string") return out;
      out.htmlBytes = pageHtml.length;

      // 1) visible-label hits (case-insensitive; ≤3 excerpts, ≤999 counted)
      const lower = pageHtml.toLowerCase();
      for (const kw of ABOUT_KEYWORDS) {
        let at = lower.indexOf(kw);
        if (at === -1) continue;
        let count = 0;
        const excerpts = [];
        while (at !== -1 && count < 3) {
          count += 1;
          excerpts.push(cleanExcerpt(pageHtml, at, kw.length));
          at = lower.indexOf(kw, at + kw.length);
        }
        while (at !== -1 && count < 999) {
          count += 1;
          at = lower.indexOf(kw, at + kw.length);
        }
        out.keywords.push({ kw, count, excerpts });
      }

      // 2) payload keys within ±1500 chars of THIS user's screen_name anchors
      const h = escapeRe(String(handle || "").replace(/^@+/, ""));
      if (h) {
        const anchors = [];
        for (const re of [
          new RegExp("screen_name\\s*:\\s*\"" + h + "\"", "gi"),
          new RegExp("\"screen_name\"\\s*:\\s*\"" + h + "\"", "gi")
        ]) {
          let m;
          while ((m = re.exec(pageHtml)) !== null) anchors.push(m.index);
        }
        out.anchors = anchors.length;
        const keys = new Set();
        const keyRe =
          /(?:"([A-Za-z_][A-Za-z0-9_]{1,50})"|([A-Za-z_][A-Za-z0-9_]{1,50}))\s*:\s*(?:"|\d|true|false|null|\[|\{)/g;
        for (const at of anchors) {
          const slice = pageHtml.slice(Math.max(0, at - 1500), at + 1500);
          for (const k of slice.matchAll(keyRe)) keys.add(k[1] || k[2]);
        }
        out.keys = [...keys].sort().slice(0, 120);
      }
    } catch (e) {
      debug("probeAbout failed", e);
    }
    return out;
  }

  // ------------------------------------------------------------- fetching

  let queue = [];
  let inFlight = false;

  function enqueue(task) {
    queue.push(task);
    pump();
  }

  function pump() {
    if (inFlight || queue.length === 0) return;
    inFlight = true;
    const task = queue.shift();
    task()
      .catch((e) => debug("queued task error", e))
      .finally(() => {
        setTimeout(() => {
          inFlight = false;
          pump();
        }, FETCH_GAP_MS);
      });
  }

  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Single source: the profile page's embedded payload (RSC / JSON).
  // NOTE: the old v1.1 users/show.json fallback was REMOVED — it returns
  // HTTP 404 on X today (verified 2026-10-10 from the user's browser).
  async function fetchProfile(handle) {
    const url = "https://x.com/" + encodeURIComponent(handle);
    const res = await fetchWithTimeout(url, {
      credentials: "include",
      redirect: "follow",
      headers: { accept: "text/html" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (res.redirected && /\/(login|i\/flow)/.test(res.url)) {
      throw new Error("redirected to login (session issue)");
    }
    const pageHtml = await res.text();
    if (!pageHtml || pageHtml.length < 5000) {
      throw new Error(
        "tiny response (" + (pageHtml ? pageHtml.length : 0) + " bytes) — likely rate limited"
      );
    }
    const fields = parseProfileHtml(pageHtml, handle);
    if (!fields) {
      throw new Error(
        "unparseable payload (" + pageHtml.length + " bytes, no user data for @" + handle + ")"
      );
    }
    return { ...fields, ok: true, source: "html" };
  }

  // ---------------------------------------------------------------- index

  async function readIndex() {
    const got = await chrome.storage.local.get(INDEX_KEY);
    return got[INDEX_KEY] && typeof got[INDEX_KEY] === "object" ? got[INDEX_KEY] : {};
  }

  async function writeEntry(key, entry) {
    const index = await readIndex();
    index[key] = entry.fetchedAt;
    const keys = Object.keys(index);
    if (keys.length > MAX_ENTRIES) {
      // LRU: evict oldest ~100 entries
      keys.sort((a, b) => index[a] - index[b]);
      const evict = keys.slice(0, keys.length - MAX_ENTRIES);
      await chrome.storage.local.remove(evict);
      for (const k of evict) delete index[k];
    }
    await chrome.storage.local.set({ [key]: entry, [INDEX_KEY]: index });
  }

  // ---------------------------------------------------------------- public

  const pending = new Map(); // handle → Promise<profile|null>

  // Returns { location, followers, following } or null (unknown / failed).
  // Never rejects — fail open (AGENTS.md hard rule 2).
  function getProfile(handleRaw) {
    const handle = String(handleRaw || "").replace(/^@+/, "").toLowerCase();
    if (!handle || !/^[\w-]{1,20}$/.test(handle)) return Promise.resolve(null);
    if (pending.has(handle)) return pending.get(handle);

    const key = cacheKey(handle);
    const promise = (async () => {
      try {
        const got = await chrome.storage.local.get(key);
        const entry = got[key];
        if (fresh(entry)) {
          if (!entry.ok) return null; // negative-cached failure
          return {
            location: typeof entry.location === "string" ? entry.location : null,
            followers: typeof entry.followers === "number" ? entry.followers : null,
            following: typeof entry.following === "number" ? entry.following : null
          };
        }
        // MISS → fetch (serialized via queue)
        const result = await new Promise((resolve) => {
          enqueue(async () => {
            try {
              const fields = await fetchProfile(handle);
              await writeEntry(key, { ...fields, fetchedAt: Date.now() });
              debug("profile @" + handle + " →", fields);
              resolve(fields);
            } catch (e) {
              debug("profile fetch failed for @" + handle, e && e.message);
              await writeEntry(key, {
                location: "",
                followers: null,
                following: null,
                fetchedAt: Date.now(),
                ok: false,
                error: String((e && e.message) || e)
              }).catch(() => {});
              resolve(null);
            }
          });
        });
        if (!result) return null;
        return {
          location: typeof result.location === "string" ? result.location : null, // null = unknown → fail open
          followers: typeof result.followers === "number" ? result.followers : null,
          following: typeof result.following === "number" ? result.following : null
        };
      } catch (e) {
        debug("getProfile failed for @" + handle, e);
        return null;
      } finally {
        pending.delete(handle);
      }
    })();

    pending.set(handle, promise);
    return promise;
  }

  async function clearAll() {
    const index = await readIndex();
    const keys = Object.keys(index);
    await chrome.storage.local.remove([...keys, INDEX_KEY]);
  }

  globalThis.XFF = globalThis.XFF || {};
  globalThis.XFF.profileCache = { getProfile, clearAll, parseProfileHtml, cacheKey, probeAbout };
})();
