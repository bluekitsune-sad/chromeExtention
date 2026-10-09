// filter.js — generic rule engine. Rules are pure functions:
//   (postContext, settings) => ruleName | null
// No DOM access, no network, no storage inside this file (AGENTS.md hard rule 6).
(function () {
  "use strict";

  // postContext = { handle, text, location, followers, following }
  // Returns the name of the first matching rule, or null → keep the post.

  function norm(str, settings) {
    if (typeof str !== "string") return "";
    return settings && settings.caseSensitive ? str : str.toLowerCase();
  }

  function normHandle(handle) {
    if (typeof handle !== "string") return "";
    return handle.replace(/^@+/, "").trim().toLowerCase();
  }

  // --- rules that need no network -----------------------------------------

  function matchesAccount(post, settings) {
    const list = settings.accounts || [];
    if (!list.length || !post.handle) return false;
    const mine = normHandle(post.handle);
    return list.some((a) => normHandle(a) !== "" && normHandle(a) === mine);
  }

  function matchesKeyword(post, settings) {
    const list = settings.keywords || [];
    if (!list.length || !post.text) return false;
    const text = norm(post.text, settings);
    return list.some((k) => {
      const kw = typeof k === "string" ? k.trim() : "";
      if (!kw) return false;
      return text.includes(norm(kw, settings));
    });
  }

  // --- rules that need cached profile data --------------------------------

  function matchesLocation(post, settings) {
    const list = settings.locations || [];
    if (!list.length) return false;
    // post.location === null  → unknown (fetch failed / no data) → fail open
    // post.location === ""    → profile parsed, author states no location
    if (typeof post.location !== "string") return false;
    const exact = settings.locationMatch === "equals";
    const loc = norm(post.location, settings);
    const listed = list.some((l) => {
      const rule = typeof l === "string" ? l.trim() : "";
      if (!rule) return false;
      const r = norm(rule, settings);
      return exact ? loc === r : loc.includes(r);
    });
    // "hide"  → hide when the location matches the list (blocklist)
    // "only"  → hide when the author's location is known but NOT listed
    //           (allowlist: only show users from the listed locations)
    //           authors with an empty profile location are also hidden,
    //           since they are not from a listed location.
    if (settings.locationMode === "only") return !listed;
    return listed; // default: "hide"
  }

  function rangeActive(range) {
    if (!range || typeof range !== "object") return false;
    return range.min !== null && range.min !== undefined ||
           range.max !== null && range.max !== undefined;
  }

  function inRange(value, range) {
    if (value === null || value === undefined || typeof value !== "number" || Number.isNaN(value)) {
      return false; // unknown value → fail open
    }
    const min = range.min === null || range.min === undefined ? -Infinity : Number(range.min);
    const max = range.max === null || range.max === undefined ? Infinity : Number(range.max);
    if (Number.isNaN(min) || Number.isNaN(max)) return false;
    return value >= min && value <= max;
  }

  function matchesFollowers(post, settings) {
    if (!rangeActive(settings.followers)) return false;
    return inRange(post.followers, settings.followers);
  }

  function matchesFollowing(post, settings) {
    if (!rangeActive(settings.following)) return false;
    return inRange(post.following, settings.following);
  }

  // --- registry ------------------------------------------------------------

  // Quick rules run before any profile lookup; profile rules after.
  const QUICK_RULES = [
    { name: "account", fn: matchesAccount },
    { name: "keyword", fn: matchesKeyword }
  ];

  const PROFILE_RULES = [
    { name: "location", fn: matchesLocation },
    { name: "followers", fn: matchesFollowers },
    { name: "following", fn: matchesFollowing }
  ];

  function matchFirst(rules, post, settings) {
    for (const rule of rules) {
      let hit = false;
      try {
        hit = rule.fn(post, settings);
      } catch (e) {
        XFF.settings.debug("rule failed open:", rule.name, e); // fail open
        hit = false;
      }
      if (hit) return rule.name;
    }
    return null;
  }

  function matchQuick(post, settings) {
    return matchFirst(QUICK_RULES, post, settings);
  }

  function matchProfile(post, settings) {
    return matchFirst(PROFILE_RULES, post, settings);
  }

  // Full pass (used by tests / when profile data already present).
  function shouldHide(post, settings) {
    return matchQuick(post, settings) || matchProfile(post, settings);
  }

  globalThis.XFF = globalThis.XFF || {};
  globalThis.XFF.filter = {
    matchesAccount,
    matchesKeyword,
    matchesLocation,
    matchesFollowers,
    matchesFollowing,
    rangeActive,
    inRange,
    QUICK_RULES,
    PROFILE_RULES,
    matchQuick,
    matchProfile,
    shouldHide
  };
})();
