// organize.js — PURE logic: media classification, dedupe, sort, document
// building, filename sanitization. No DOM, no chrome.*, no network
// (AGENTS.md hard rule 4 — must load in Node for tests).
(function () {
  "use strict";

  const SCHEMA = "x-dm-export/1";

  const TYPE_BY_MEDIA = { img: "image", gif: "gif", vid: "video" };

  function debug(...args) {
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("CE_DEBUG") === "1") {
        console.log("[CE]", ...args);
      }
    } catch (_) {
      /* ignore */
    }
  }

  // text + raw media flags ("img"|"gif"|"vid", category order already fixed
  // by extract.js) → { type, text, caption, media }
  // PRD §4: media-only → text is the placeholder; media+words → placeholder
  // in text, the words preserved in caption; words are text, never media.
  function classify(text, mediaFlags) {
    const media = Array.isArray(mediaFlags) ? mediaFlags.filter((m) => TYPE_BY_MEDIA[m]) : [];
    const words = typeof text === "string" ? text.trim() : "";
    if (!media.length) {
      return { type: "text", text: words, caption: null, media: [] };
    }
    const placeholder = media.join(" + ");
    if (!words) {
      const kinds = [...new Set(media)];
      return { type: kinds.length > 1 ? "mixed" : TYPE_BY_MEDIA[kinds[0]], text: placeholder, caption: null, media };
    }
    return { type: "mixed", text: placeholder, caption: words, media };
  }

  // raw message (from extract.js) → schema message
  function normalizeMessage(raw) {
    raw = raw || {};
    const cls = classify(raw.text, raw.media);
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : null,
      sender: typeof raw.sender === "string" && raw.sender ? raw.sender : null,
      timestamp: typeof raw.timestamp === "string" && raw.timestamp ? raw.timestamp : null,
      type: cls.type,
      text: cls.text,
      caption: cls.caption,
      media: cls.media,
      replyTo: null
    };
  }

  function dedupeKey(m) {
    if (m.id !== null) return "id " + m.id;
    // no id → composite; identical sender+timestamp+text counts as a re-render
    return ["cmp", m.sender, m.timestamp, m.text, m.media.join(",")].join(" ");
  }

  // first occurrence wins (DOM order)
  function dedupe(messages) {
    const seen = new Set();
    const out = [];
    let removed = 0;
    for (const m of messages) {
      const key = dedupeKey(m);
      if (seen.has(key)) {
        removed += 1;
        continue;
      }
      seen.add(key);
      out.push(m);
    }
    return { messages: out, removed };
  }

  // ascending by timestamp; null timestamps LAST; stable within equals
  function sortMessages(messages) {
    return messages
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const ta = a.m.timestamp;
        const tb = b.m.timestamp;
        if (ta === null && tb === null) return a.i - b.i;
        if (ta === null) return 1;
        if (tb === null) return -1;
        if (ta === tb) return a.i - b.i;
        return ta < tb ? -1 : 1; // ISO-8601 UTC compares lexicographically
      })
      .map((x) => x.m);
  }

  function titleHandle(title) {
    if (typeof title !== "string") return null;
    const m = title.match(/@([A-Za-z0-9_-]{1,20})/);
    return m ? "@" + m[1] : null;
  }

  // raw messages + meta → full export document (PRD §4)
  function buildDocument(rawMessages, meta) {
    meta = meta || {};
    const normalized = (rawMessages || []).map(normalizeMessage);
    const { messages: deduped, removed } = dedupe(normalized);
    const sorted = sortMessages(deduped);
    const dated = sorted.filter((m) => m.timestamp !== null);

    const participants = new Set();
    for (const m of sorted) if (m.sender) participants.add(m.sender);
    const handle = titleHandle(meta.title);
    if (handle) participants.add(handle);
    const people = [...participants].sort();

    return {
      schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      source: typeof meta.source === "string" ? meta.source : null,
      conversation: {
        title: typeof meta.title === "string" && meta.title ? meta.title : null,
        participants: people,
        // own-handle detection is a v2 item, so 2 senders is the normal
        // 1:1 case (peer + me). A real group needs 3+ unique senders.
        kind: people.length >= 3 ? "group" : people.length >= 1 ? "1:1" : "unknown"
      },
      stats: {
        messageCount: sorted.length,
        first: dated.length ? dated[0].timestamp : null,
        last: dated.length ? dated[dated.length - 1].timestamp : null
      },
      diagnostics: {
        probes: meta.probes && typeof meta.probes === "object" ? meta.probes : {},
        undatedMessages: sorted.length - dated.length,
        duplicatesRemoved: removed
      },
      messages: sorted
    };
  }

  // filename part: lowercase, [a-z0-9-], collapsed, capped 60, safe fallback
  function sanitizeFilenamePart(s) {
    const base = String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
      .slice(0, 60)
      .replace(/-+$/, "");
    return base || "conversation";
  }

  function exportFilename(doc) {
    const day = new Date().toISOString().slice(0, 10);
    const who = sanitizeFilenamePart(
      (doc && doc.conversation && doc.conversation.title) || "conversation"
    );
    return "x-dm_" + who + "_" + day + ".json";
  }

  globalThis.CE = globalThis.CE || {};
  Object.assign(globalThis.CE, {
    SCHEMA,
    classify,
    normalizeMessage,
    dedupe,
    sortMessages,
    buildDocument,
    sanitizeFilenamePart,
    exportFilename,
    debug
  });
})();
