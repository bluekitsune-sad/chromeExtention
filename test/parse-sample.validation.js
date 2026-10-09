// test/parse-sample.validation.js — validates the RSC-format parser approach
// against REAL x.com profile HTML captured 2026-10-10.
// Run: node test/parse-sample.validation.js
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");

globalThis.XFF = { settings: { debug: () => {} } };
require("../x-feed-filter/profile-cache.js");
const { profileCache } = globalThis.XFF;

// expected: [handle, location, followersMin?] from the captured pages
const samples = [
  { file: "xff_ImranKhanPTI.html", handle: "ImranKhanPTI", location: "Pakistan" },
  { file: "xff_narendramodi.html", handle: "narendramodi", location: "India" },
  { file: "xff_Karachi.html", handle: "Karachi", location: "Karachi, Pakistan" },
  { file: "xff_samaaTV.html", handle: "samaaTV", location: "Pakistan" },
  { file: "xff_profile.html", handle: "elonmusk", location: "" } // empty but parsed
];

let failed = false;
for (const s of samples) {
  const p = path.join(os.tmpdir(), s.file);
  if (!fs.existsSync(p)) {
    console.log("  SKIP (missing capture) " + s.file);
    continue;
  }
  const html = fs.readFileSync(p, "utf8");
  const out = profileCache.parseProfileHtml(html, s.handle);
  try {
    assert.ok(out, "parse returned null");
    assert.strictEqual(out.location, s.location, "location mismatch");
    assert.ok(typeof out.followers === "number" && out.followers > 0, "followers invalid: " + out.followers);
    assert.ok(typeof out.following === "number" && out.following >= 0, "following invalid: " + out.following);
    console.log("  ok  " + s.handle + " → loc=" + JSON.stringify(out.location) + " followers=" + out.followers + " following=" + out.following);
  } catch (e) {
    failed = true;
    console.error("  FAIL " + s.handle + " → " + e.message + " got=" + JSON.stringify(out));
  }
}

// negative: login-wall / shell page must fail open (null)
const shell = "<html><body>Log in to X</body></html>";
assert.strictEqual(profileCache.parseProfileHtml(shell, "nobody"), null);
console.log("  ok  shell page → null (fail open)");

// --- synthetic layouts encoding real user-reported bugs -------------------

// 1) contamination: a NEARBY user's data (who-to-follow style) must never
//    be attributed to our handle — the old parser picked the decoy's
//    followers:10 / location:"" for a user with 4000+ followers.
{
  const decoy =
    'x:"y",name:"Random Person",followers:10,following:99999,location:"Nowhere",restId:"1"';
  const ours =
    'core:{name:"Test User",screen_name:"testuser"},pad:"' + "a".repeat(900) + '",' +
    decoy + // decoy 900+ chars from our core name block
    'pad:"' + "b".repeat(2000) + '",' +
    'name:"Test User",followers:4000,following:55,location:"Karachi, Pakistan",restId:"2"';
  const out = profileCache.parseProfileHtml("<html>" + ours + "</html>", "testuser");
  try {
    assert.strictEqual(out.followers, 4000, "picked decoy followers: " + out.followers);
    assert.strictEqual(out.following, 55, "picked decoy following: " + out.following);
    assert.strictEqual(out.location, "Karachi, Pakistan");
    console.log("  ok  contamination test → our values win (4000 / Karachi)");
  } catch (e) {
    failed = true;
    console.error("  FAIL contamination → " + e.message + " got=" + JSON.stringify(out));
  }
}

// 2) spread layout: fields 3000 chars away from the name block (hoisted
//    payload) must still be recovered via the wide tier.
{
  const page =
    '<title>Test User (@testuser) / X</title>' +
    'screen_name:"testuser",pad:"' + "c".repeat(3000) + '",' +
    'name:"Test User",followers:777,following:8,location:"Lahore"';
  const out = profileCache.parseProfileHtml("<html>" + page + "</html>", "testuser");
  try {
    assert.strictEqual(out.followers, 777);
    assert.strictEqual(out.location, "Lahore");
    console.log("  ok  spread layout → wide tier recovers (777 / Lahore)");
  } catch (e) {
    failed = true;
    console.error("  FAIL spread layout → " + e.message + " got=" + JSON.stringify(out));
  }
}

// 3) title-derived display name when core name is hoisted far away.
{
  const page =
    '<title>Samaa Person (@fakehandle) / X</title>' +
    'screen_name:"fakehandle",pad:"' + "d".repeat(1200) + '",' +
    'name:"Samaa Person",followers:3088321,following:8,location:"Pakistan"';
  const out = profileCache.parseProfileHtml("<html>" + page + "</html>", "fakehandle");
  try {
    assert.strictEqual(out.followers, 3088321);
    assert.strictEqual(out.location, "Pakistan");
    console.log("  ok  title-derived name → fields recovered");
  } catch (e) {
    failed = true;
    console.error("  FAIL title name → " + e.message + " got=" + JSON.stringify(out));
  }
}

console.log(failed ? "PARSE VALIDATION FAILED" : "PARSE VALIDATION PASSED");
process.exitCode = failed ? 1 : 0;
