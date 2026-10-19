// test/organize.test.js — dependency-free tests for the pure export core.
// Run:  node test\organize.test.js   (from inside chat-exporter/)
"use strict";
const assert = require("node:assert");

globalThis.localStorage = undefined; // organize.js must tolerate Node
require("../organize.js");
const CE = globalThis.CE;

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok  " + name);
  } catch (e) {
    failed = true;
    console.error("  FAIL " + name + " → " + e.message);
  }
}
let failed = false;

console.log("classify — text");
t("text-only message", () => {
  assert.deepStrictEqual(CE.classify("hello", []), {
    type: "text",
    text: "hello",
    caption: null,
    media: []
  });
});
t("text is trimmed; non-string text becomes empty", () => {
  assert.strictEqual(CE.classify("  hi  ", []).text, "hi");
  assert.strictEqual(CE.classify(null, []).text, "");
});
t("invalid media flags are ignored", () => {
  assert.deepStrictEqual(CE.classify("x", ["img", "banana"]).media, ["img"]);
});

console.log("classify — media placeholders (PRD: img/gif/vid only)");
t("image-only → text is the literal 'img'", () => {
  const c = CE.classify("", ["img"]);
  assert.strictEqual(c.text, "img");
  assert.strictEqual(c.type, "image");
  assert.strictEqual(c.caption, null);
});
t("gif-only → 'gif'", () => {
  const c = CE.classify("   ", ["gif"]);
  assert.strictEqual(c.text, "gif");
  assert.strictEqual(c.type, "gif");
});
t("video-only → 'vid', type video", () => {
  const c = CE.classify("", ["vid"]);
  assert.strictEqual(c.text, "vid");
  assert.strictEqual(c.type, "video");
});
t("media + caption → placeholder in text, words in caption, mixed", () => {
  const c = CE.classify("look at this!", ["img"]);
  assert.strictEqual(c.type, "mixed");
  assert.strictEqual(c.text, "img");
  assert.strictEqual(c.caption, "look at this!");
});
t("multiple media, no text → 'img + vid'", () => {
  const c = CE.classify("", ["img", "vid"]);
  assert.strictEqual(c.text, "img + vid");
  assert.strictEqual(c.type, "mixed");
  assert.deepStrictEqual(c.media, ["img", "vid"]);
});

console.log("normalizeMessage — schema shape");
t("defaults: id/sender/timestamp null", () => {
  const m = CE.normalizeMessage({ text: "yo", media: [] });
  assert.deepStrictEqual(m, {
    id: null,
    sender: null,
    timestamp: null,
    type: "text",
    text: "yo",
    caption: null,
    media: [],
    replyTo: null
  });
});
t("key order is byte-stable (PRD field order)", () => {
  const m = CE.normalizeMessage({ id: "1", sender: "@a", timestamp: "2026-01-01T00:00:00.000Z", text: "x", media: [] });
  assert.strictEqual(
    JSON.stringify(m),
    '{"id":"1","sender":"@a","timestamp":"2026-01-01T00:00:00.000Z","type":"text","text":"x","caption":null,"media":[],"replyTo":null}'
  );
});

console.log("dedupe");
t("by id — first occurrence wins", () => {
  const msgs = [
    CE.normalizeMessage({ id: "9", text: "first", media: [] }),
    CE.normalizeMessage({ id: "9", text: "re-render duplicate", media: [] })
  ];
  const { messages, removed } = CE.dedupe(msgs);
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].text, "first");
  assert.strictEqual(removed, 1);
});
t("composite fallback when no ids", () => {
  const msgs = [
    CE.normalizeMessage({ sender: "@a", timestamp: "2026-01-01T00:00:00.000Z", text: "ok", media: [] }),
    CE.normalizeMessage({ sender: "@a", timestamp: "2026-01-01T00:00:00.000Z", text: "ok", media: [] }),
    CE.normalizeMessage({ sender: "@b", timestamp: "2026-01-01T00:00:00.000Z", text: "ok", media: [] })
  ];
  const { messages, removed } = CE.dedupe(msgs);
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(removed, 1);
});

console.log("sortMessages — deterministic ordering");
t("ascending chronological", () => {
  const m = (ts, text) => CE.normalizeMessage({ timestamp: ts, text, media: [] });
  const sorted = CE.sortMessages([
    m("2026-01-05T00:00:00.000Z", "c"),
    m("2026-01-01T00:00:00.000Z", "a"),
    m("2026-01-03T00:00:00.000Z", "b")
  ]);
  assert.deepStrictEqual(sorted.map((x) => x.text), ["a", "b", "c"]);
});
t("stable within equal timestamps", () => {
  const m = (text) => CE.normalizeMessage({ timestamp: "2026-01-01T00:00:00.000Z", text, media: [] });
  const sorted = CE.sortMessages([m("one"), m("two"), m("three")]);
  assert.deepStrictEqual(sorted.map((x) => x.text), ["one", "two", "three"]);
});
t("undated messages go last, keeping relative order", () => {
  const m = (ts, text) => CE.normalizeMessage({ timestamp: ts, text, media: [] });
  const sorted = CE.sortMessages([
    m(null, "undated-1"),
    m("2026-01-02T00:00:00.000Z", "dated-2"),
    m(null, "undated-2"),
    m("2026-01-01T00:00:00.000Z", "dated-1")
  ]);
  assert.deepStrictEqual(sorted.map((x) => x.text), ["dated-1", "dated-2", "undated-1", "undated-2"]);
});

console.log("buildDocument — full document");
const rawFixture = [
  { id: "m3", sender: "@alice", timestamp: "2026-01-03T10:00:00.000Z", text: "sending a pic", media: ["img"] },
  { id: "m1", sender: "@bob", timestamp: "2026-01-01T09:00:00.000Z", text: "hey", media: [] },
  { id: "m2", sender: "@alice", timestamp: "2026-01-02T09:30:00.000Z", text: "", media: ["gif"] },
  { id: "m1", sender: "@bob", timestamp: "2026-01-01T09:00:00.000Z", text: "hey", media: [] }, // dup
  { id: "m4", sender: null, timestamp: null, text: "no time no sender", media: [] }
];
const doc = CE.buildDocument(rawFixture, {
  source: "https://x.com/messages/123",
  title: "Alice (@alice)",
  probes: { entries: 5, images: 1, videos: 0, gifs: 1 }
});
t("schema + counts + dedupe stats", () => {
  assert.strictEqual(doc.schema, "x-dm-export/1");
  assert.strictEqual(doc.source, "https://x.com/messages/123");
  assert.strictEqual(doc.stats.messageCount, 4);
  assert.strictEqual(doc.diagnostics.duplicatesRemoved, 1);
  assert.strictEqual(doc.diagnostics.undatedMessages, 1);
  assert.strictEqual(doc.diagnostics.probes.images, 1);
});
t("messages sorted ascending, media message reads 'img'/'gif'", () => {
  assert.deepStrictEqual(doc.messages.map((m) => m.text), ["hey", "gif", "img", "no time no sender"]);
  assert.strictEqual(doc.messages[1].type, "gif");
  assert.strictEqual(doc.messages[2].type, "mixed");
  assert.strictEqual(doc.messages[2].caption, "sending a pic");
  assert.deepStrictEqual(doc.messages[2].media, ["img"]);
});
t("participants from senders + title handle; kind group", () => {
  assert.deepStrictEqual(doc.conversation.participants, ["@alice", "@bob"]);
  assert.strictEqual(doc.conversation.kind, "1:1"); // two unique people
  assert.strictEqual(doc.conversation.title, "Alice (@alice)");
});
t("stats first/last ignore undated", () => {
  assert.strictEqual(doc.stats.first, "2026-01-01T09:00:00.000Z");
  assert.strictEqual(doc.stats.last, "2026-01-03T10:00:00.000Z");
});
t("deterministic: same input → identical JSON (minus exportedAt)", () => {
  const doc2 = CE.buildDocument(rawFixture, {
    source: "https://x.com/messages/123",
    title: "Alice (@alice)",
    probes: { entries: 5, images: 1, videos: 0, gifs: 1 }
  });
  const strip = (d) => JSON.stringify({ ...d, exportedAt: null });
  assert.strictEqual(strip(doc), strip(doc2));
});
t("unknown kind when nothing identified", () => {
  const empty = CE.buildDocument([], {});
  assert.strictEqual(empty.conversation.kind, "unknown");
  assert.strictEqual(empty.stats.messageCount, 0);
  assert.strictEqual(empty.stats.first, null);
});
t("group kind with 3+ participants", () => {
  const g = CE.buildDocument(
    [
      { sender: "@a", timestamp: null, text: "1", media: [] },
      { sender: "@b", timestamp: null, text: "2", media: [] },
      { sender: "@c", timestamp: null, text: "3", media: [] }
    ],
    {}
  );
  assert.strictEqual(g.conversation.kind, "group");
  assert.deepStrictEqual(g.conversation.participants, ["@a", "@b", "@c"]);
});

console.log("filenames");
t("sanitize: name, punctuation, fallback, cap", () => {
  assert.strictEqual(CE.sanitizeFilenamePart("Alice (@alice)!"), "alice-alice");
  assert.strictEqual(CE.sanitizeFilenamePart(""), "conversation");
  assert.strictEqual(CE.sanitizeFilenamePart("   "), "conversation");
  assert.ok(CE.sanitizeFilenamePart("x".repeat(200)).length <= 60);
  assert.ok(!/-+$/.test(CE.sanitizeFilenamePart("name...")));
});
t("export filename shape x-dm_<name>_<date>.json", () => {
  const name = CE.exportFilename(doc);
  assert.match(name, /^x-dm_alice-alice_\d{4}-\d{2}-\d{2}\.json$/);
});

console.log("\n" + passed + " tests passed" + (failed ? " — WITH FAILURES" : ""));
process.exitCode = failed ? 1 : 0;
