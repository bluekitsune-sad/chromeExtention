// test/filter.test.js — dependency-free unit tests for the pure rule engine
// (filter.js) and the profile HTML parser (profile-cache.js fallback path).
// Run:  node test/filter.test.js
"use strict";
const assert = require("node:assert");

// Minimal stub so filter.js's fail-open logger works outside the browser.
globalThis.XFF = { settings: { debug: () => {} } };
require("../x-feed-filter/filter.js");
require("../x-feed-filter/profile-cache.js");

const { filter, profileCache } = globalThis.XFF;

const base = {
  enabled: true,
  paused: false,
  locations: [],
  locationMatch: "contains",
  accounts: [],
  keywords: [],
  followers: { min: null, max: null },
  following: { min: null, max: null },
  caseSensitive: false
};

const post = (over = {}) => ({
  handle: "someone",
  text: "Had an amazing day!",
  location: null,
  followers: null,
  following: null,
  ...over
});

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok  " + name);
  } catch (e) {
    console.error("  FAIL " + name + " → " + e.message);
    process.exitCode = 1;
  }
}

console.log("keyword rules");
t("matches keyword case-insensitively", () => {
  const s = { ...base, keywords: ["AMAZING"] };
  assert.strictEqual(filter.shouldHide(post(), s), "keyword");
});
t("no keyword list → no match", () => {
  assert.strictEqual(filter.shouldHide(post(), base), null);
});
t("caseSensitive honors case", () => {
  const s = { ...base, keywords: ["AMAZING"], caseSensitive: true };
  assert.strictEqual(filter.shouldHide(post(), s), null);
});
t("whitespace-only keyword ignored", () => {
  const s = { ...base, keywords: ["   "] };
  assert.strictEqual(filter.shouldHide(post(), s), null);
});

console.log("account rules");
t("matches @handle form", () => {
  const s = { ...base, accounts: ["@SOMEONE"] };
  assert.strictEqual(filter.shouldHide(post(), s), "account");
});
t("matches bare handle form", () => {
  const s = { ...base, accounts: ["someone"] };
  assert.strictEqual(filter.shouldHide(post(), s), "account");
});
t("different handle → no match", () => {
  const s = { ...base, accounts: ["@other"] };
  assert.strictEqual(filter.shouldHide(post(), s), null);
});

console.log("location rules");
t("substring match, case-insensitive", () => {
  const s = { ...base, locations: ["karachi"] };
  assert.strictEqual(filter.shouldHide(post({ location: "Karachi, Pakistan" }), s), "location");
});
t("equals mode requires full match", () => {
  const s = { ...base, locations: ["Karachi"], locationMatch: "equals" };
  assert.strictEqual(filter.shouldHide(post({ location: "Karachi, Pakistan" }), s), null);
  assert.strictEqual(filter.shouldHide(post({ location: "Karachi" }), s), "location");
});
t("missing profile location fails open", () => {
  const s = { ...base, locations: ["Karachi"] };
  assert.strictEqual(filter.shouldHide(post({ location: null }), s), null);
  assert.strictEqual(filter.shouldHide(post({ location: "" }), s), null);
});
t("no locations configured → inactive", () => {
  assert.strictEqual(filter.shouldHide(post({ location: "Karachi" }), base), null);
});

console.log("followers range rules");
t("hides when count inside range", () => {
  const s = { ...base, followers: { min: 0, max: 99 } };
  assert.strictEqual(filter.shouldHide(post({ followers: 12 }), s), "followers");
  assert.strictEqual(filter.shouldHide(post({ followers: 99 }), s), "followers");
});
t("keeps when count outside range", () => {
  const s = { ...base, followers: { min: 0, max: 99 } };
  assert.strictEqual(filter.shouldHide(post({ followers: 100 }), s), null);
});
t("open-ended max only", () => {
  const s = { ...base, followers: { min: 100000, max: null } };
  assert.strictEqual(filter.shouldHide(post({ followers: 250000 }), s), "followers");
  assert.strictEqual(filter.shouldHide(post({ followers: 99999 }), s), null);
});
t("open-ended min only", () => {
  const s = { ...base, followers: { min: null, max: 50 } };
  assert.strictEqual(filter.shouldHide(post({ followers: 3 }), s), "followers");
  assert.strictEqual(filter.shouldHide(post({ followers: 51 }), s), null);
});
t("both null → rule inactive", () => {
  const s = { ...base, followers: { min: null, max: null } };
  assert.strictEqual(filter.shouldHide(post({ followers: 0 }), s), null);
});
t("unknown follower count fails open", () => {
  const s = { ...base, followers: { min: 0, max: 99 } };
  assert.strictEqual(filter.shouldHide(post({ followers: null }), s), null);
});
t("boundaries inclusive", () => {
  const s = { ...base, followers: { min: 100, max: 200 } };
  assert.strictEqual(filter.shouldHide(post({ followers: 100 }), s), "followers");
  assert.strictEqual(filter.shouldHide(post({ followers: 200 }), s), "followers");
  assert.strictEqual(filter.shouldHide(post({ followers: 99 }), s), null);
});

console.log("following range rules");
t("hides follow-spam accounts", () => {
  const s = { ...base, following: { min: 2001, max: null } };
  assert.strictEqual(filter.shouldHide(post({ following: 5000 }), s), "following");
  assert.strictEqual(filter.shouldHide(post({ following: 2000 }), s), null);
});

console.log("rule precedence");
t("quick rules win over profile rules", () => {
  const s = {
    ...base,
    keywords: ["amazing"],
    locations: ["Karachi"],
    followers: { min: 0, max: 99 }
  };
  const p = post({ location: "Karachi", followers: 5 });
  assert.strictEqual(filter.shouldHide(p, s), "keyword");
});
t("account beats location", () => {
  const s = { ...base, accounts: ["@someone"], locations: ["Karachi"] };
  const p = post({ location: "Karachi" });
  assert.strictEqual(filter.shouldHide(p, s), "account");
});

console.log("location mode: only (allowlist)");
const only = (loc, over = {}) => ({ ...base, locations: ["Karachi"], locationMode: "only", ...over });
t("only mode: listed location stays visible", () => {
  assert.strictEqual(filter.shouldHide(post({ location: "Karachi, Pakistan" }), only()), null);
});
t("only mode: unlisted location is hidden", () => {
  assert.strictEqual(filter.shouldHide(post({ location: "Lahore, Pakistan" }), only()), "location");
});
t("only mode: profile with no location set is hidden", () => {
  assert.strictEqual(filter.shouldHide(post({ location: "" }), only()), "location");
});
t("only mode: unknown location (fetch failed) fails open", () => {
  assert.strictEqual(filter.shouldHide(post({ location: null }), only()), null);
});
t("only mode: empty list → rule inactive", () => {
  const s = { ...base, locations: [], locationMode: "only" };
  assert.strictEqual(filter.shouldHide(post({ location: "Lahore" }), s), null);
});
t("legacy settings without locationMode behave as hide", () => {
  const s = { ...base, locations: ["Karachi"] }; // no locationMode key at all
  assert.strictEqual(filter.shouldHide(post({ location: "Karachi" }), s), "location");
  assert.strictEqual(filter.shouldHide(post({ location: "Lahore" }), s), null);
});
t("only mode honors equals match mode", () => {
  const s = only("Karachi", { locationMatch: "equals" });
  assert.strictEqual(filter.shouldHide(post({ location: "Karachi" }), s), null);
  assert.strictEqual(filter.shouldHide(post({ location: "Karachi, Pakistan" }), s), "location");
});

console.log("profile HTML parser (RSC + JSON formats)");
t("extracts location/followers/following", () => {
  const html =
    '<html><script id="s" type="application/json">' +
    '{"not":"valid json here"' + // malformed on purpose → regex fallback
    "</script>" +
    '<a href="/someuser/status/1"></a>' +
    '"screen_name":"someuser"' +
    '"location":"Karachi\\u002C Pakistan"' +
    '"followers_count":1234,"following_count":56' +
    "</html>";
  const out = profileCache.parseProfileHtml(html, "someuser");
  assert.ok(out, "expected parse result");
  assert.strictEqual(out.location, "Karachi, Pakistan");
  assert.strictEqual(out.followers, 1234);
  assert.strictEqual(out.following, 56);
});
t("unparseable html → null (fail open)", () => {
  assert.strictEqual(profileCache.parseProfileHtml("<html>nothing</html>", "nobody"), null);
  assert.strictEqual(profileCache.parseProfileHtml("", "nobody"), null);
  assert.strictEqual(profileCache.parseProfileHtml(null, "nobody"), null);
});

console.log("\n" + passed + " assertions-groups passed" + (process.exitCode ? " (WITH FAILURES)" : ""));
