// settings.js — loads/saves extension settings from chrome.storage.sync.
// Works both in content scripts and in the popup (loaded before popup.js).
// Schema is exactly PRD.md §4.2 — add keys, never rename existing ones.
(function () {
  "use strict";

  const DEFAULTS = {
    enabled: true,
    paused: false,
    locations: [],
    locationMatch: "contains", // "contains" | "equals"
    locationMode: "hide", // "hide" = blocklist | "only" = allowlist (only show listed)
    accounts: [],
    keywords: [],
    followers: { min: null, max: null },
    following: { min: null, max: null },
    caseSensitive: false
  };

  let cache = clone(DEFAULTS);
  let loadedOnce = false;

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function debug(...args) {
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("XFF_DEBUG") === "1") {
        console.log("[XFF]", ...args);
      }
    } catch (_) {
      /* ignore */
    }
  }

  // Merge incoming over base. Top-level objects (followers/following) are
  // replaced whole if provided, shallow-merged otherwise.
  function merge(base, incoming) {
    const out = clone(base);
    if (!incoming || typeof incoming !== "object") return out;
    for (const key of Object.keys(DEFAULTS)) {
      if (!(key in incoming)) continue;
      const val = incoming[key];
      if (val === undefined) continue;
      if (
        val !== null &&
        typeof val === "object" &&
        !Array.isArray(val) &&
        typeof out[key] === "object" &&
        out[key] !== null &&
        !Array.isArray(out[key])
      ) {
        out[key] = Object.assign({}, out[key], val);
      } else {
        out[key] = val;
      }
    }
    return out;
  }

  async function load() {
    const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
    cache = merge(DEFAULTS, stored);
    loadedOnce = true;
    debug("settings loaded", cache);
    return cache;
  }

  // Returns the cached settings. Synchronous — call load() once at startup.
  function get() {
    return cache;
  }

  // Persist a partial update, update the cache, and notify other contexts.
  async function save(partial) {
    cache = merge(cache, partial);
    const toStore = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (key in partial) toStore[key] = cache[key];
    }
    await chrome.storage.sync.set(toStore);
    debug("settings saved", toStore);
    return cache;
  }

  // Keep the in-memory cache fresh when the popup (or another tab) edits.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const partial = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (key in changes) partial[key] = changes[key].newValue;
    }
    cache = merge(cache, partial);
    debug("settings changed externally", changes);
    if (typeof globalThis.XFF.onSettingsChanged === "function") {
      try {
        globalThis.XFF.onSettingsChanged(cache);
      } catch (e) {
        debug("onSettingsChanged error", e);
      }
    }
  });

  globalThis.XFF = globalThis.XFF || {};
  globalThis.XFF.settings = { DEFAULTS, load, get, save, debug };
})();
