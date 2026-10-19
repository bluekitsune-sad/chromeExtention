// extract.js — DOM extraction for X DM conversations. Thin and defensive:
// every touchpoint is an ORDERED list of candidate selectors, first match
// wins, and probe counts feed diagnostics (AGENTS.md hard rule 5).
// Read-only: this file never mutates the page.
(function () {
  "use strict";

  const SELECTORS = {
    entry: [
      'div[data-testid="messageEntry"]',
      '[data-testid="messageEntry"]',
      '[data-testid="message"]'
    ],
    text: [
      '[data-testid="tweetText"]',
      '[data-testid="messageText"]'
    ],
    title: [
      'div[data-testid="primaryColumn"] header a[href^="/"][role="link"]',
      'header a[href^="/"][role="link"]',
      'header [data-testid="UserName"]'
    ]
  };

  const EXCLUDED_PATHS = [
    "i", "intent", "messages", "search", "settings", "compose", "home",
    "explore", "notifications", "login", "logout", "share", "about", "help"
  ];

  function debug(...args) {
    if (globalThis.CE && CE.debug) CE.debug(...args);
  }

  // "/someuser" → "@someuser"; anything non-profile → null
  function handleFromHref(href) {
    if (typeof href !== "string") return null;
    const m = href.match(/^\/([A-Za-z0-9_-]{1,20})(?:[/?#]|$)/);
    if (!m) return null;
    const seg = m[1];
    if (EXCLUDED_PATHS.includes(seg.toLowerCase())) return null;
    return "@" + seg;
  }

  // "/i/chat/1234567890" or "/messages/1234567890" → "1234567890"
  // (the DM home is https://x.com/i/chat; opening a DM adds its id to the path)
  function conversationIdFromPath(pathname) {
    if (typeof pathname !== "string") return null;
    const m = pathname.match(/^\/(?:i\/chat|messages)\/([A-Za-z0-9_-]{1,30})/);
    return m ? m[1] : null;
  }

  function firstMatch(root, candidates) {
    for (const sel of candidates) {
      try {
        const el = root.querySelector(sel);
        if (el) return { el, selector: sel };
      } catch (_) {
        /* invalid selector for this DOM — try next */
      }
    }
    return null;
  }

  // ------------------------------------------------------------- entries

  // Cached selectors discovered at runtime (null = not attempted yet).
  // Cached only on success — a failed discovery is retried on next call.
  let DISCOVERED_SELECTORS = null;

  // The conversation pane is the container holding the most time[datetime]
  // nodes; discovery runs inside it so the sidebar's conversation times
  // can't poison the result.
  function messageScope(doc) {
    let best = null;
    let bestN = 0;
    let candidates = [];
    try {
      candidates = doc.querySelectorAll("div,section,main,ul,ol");
    } catch (_) {
      return null;
    }
    for (const el of candidates) {
      let n = 0;
      try {
        n = el.querySelectorAll("time[datetime]").length;
      } catch (_) {
        continue;
      }
      // >= keeps the innermost element with the maximum count
      if (n >= bestN && n > 0) {
        best = el;
        bestN = n;
      }
    }
    return best;
  }

  // Derive entry selectors from an unknown DOM: for every message timestamp,
  // take its TOPMOST single-message ancestor carrying a data-testid (that's
  // the message row) and pick the most frequent such key. X's layout changes
  // break fixed selectors — this adapts instead (PRD §6 fallback).
  function discoverEntrySelectors(doc) {
    const scope = messageScope(doc);
    if (!scope) return [];
    let times = [];
    try {
      times = Array.from(scope.querySelectorAll("time[datetime]"));
    } catch (_) {
      return [];
    }
    if (times.length < 2) return [];

    // pass 1: element → number of timestamps inside it
    const counts = new Map();
    for (const t of times) {
      let el = t.parentElement;
      let depth = 0;
      while (el && el !== scope.parentElement && depth < 25) {
        counts.set(el, (counts.get(el) || 0) + 1);
        el = el.parentElement;
        depth += 1;
      }
    }

    // pass 2: per timestamp, the topmost testid-ancestor wrapping one message
    const freq = new Map(); // key → { count, firstTimeIndex, selector }
    times.forEach((t, timeIndex) => {
      let el = t.parentElement;
      let depth = 0;
      let chosen = null;
      while (el && el !== scope.parentElement && depth < 25) {
        const testid = el.getAttribute && el.getAttribute("data-testid");
        if (testid && counts.get(el) === 1) chosen = el; // keep climbing
        el = el.parentElement;
        depth += 1;
      }
      if (!chosen) return;
      const tag = (chosen.tagName || "div").toLowerCase();
      const key = tag + "|" + chosen.getAttribute("data-testid");
      const rec =
        freq.get(key) || {
          count: 0,
          firstTimeIndex: timeIndex,
          selector: tag + '[data-testid="' + chosen.getAttribute("data-testid") + '"]'
        };
      rec.count += 1;
      rec.firstTimeIndex = Math.min(rec.firstTimeIndex, timeIndex);
      freq.set(key, rec);
    });

    const ranked = Array.from(freq.values()).sort(
      (a, b) => b.count - a.count || a.firstTimeIndex - b.firstTimeIndex
    );
    const best = ranked[0];
    if (!best || best.count < Math.max(2, Math.ceil(times.length * 0.4))) return [];
    // include secondary keys (e.g. own-message rows use a different testid)
    const threshold = Math.max(2, Math.ceil(best.count * 0.6));
    const selectors = ranked.filter((r) => r.count >= threshold).map((r) => r.selector);
    if (globalThis.CE && CE.debug) CE.debug("discovered entry selectors", selectors);
    return selectors;
  }

  function discoverEntries(doc) {
    if (!DISCOVERED_SELECTORS) {
      DISCOVERED_SELECTORS = discoverEntrySelectors(doc) || [];
    }
    const out = new Set();
    for (const sel of DISCOVERED_SELECTORS) {
      try {
        doc.querySelectorAll(sel).forEach((el) => out.add(el));
      } catch (_) {
        /* skip broken selector */
      }
    }
    return Array.from(out);
  }

  function findEntries(doc) {
    for (const sel of SELECTORS.entry) {
      try {
        const list = Array.from(doc.querySelectorAll(sel));
        if (list.length) return list;
      } catch (_) {
        /* try next */
      }
    }
    return discoverEntries(doc);
  }

  // One-line snapshot of the page's structure — included in hard failures so
  // a single pasted error is enough to retune selectors.
  function domReport(doc) {
    const parts = [];
    try {
      parts.push("url " + location.pathname);
    } catch (_) {
      /* ignore */
    }
    for (const sel of [
      'time[datetime]',
      '[data-testid="primaryColumn"]',
      "main",
      "article",
      '[role="listitem"]',
      "img",
      "video"
    ]) {
      let n = 0;
      try {
        n = doc.querySelectorAll(sel).length;
      } catch (_) {
        /* ignore */
      }
      parts.push(sel + "=" + n);
    }
    try {
      const tally = new Map();
      doc.querySelectorAll("[data-testid]").forEach((el) => {
        const v = el.getAttribute("data-testid");
        tally.set(v, (tally.get(v) || 0) + 1);
      });
      const top = Array.from(tally.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([k, v]) => k + ":" + v);
      if (top.length) parts.push("testids " + top.join(", "));
    } catch (_) {
      /* ignore */
    }
    try {
      const times = doc.querySelectorAll("time[datetime]");
      for (let i = 0; i < Math.min(2, times.length); i++) {
        const chain = [];
        let el = times[i].parentElement;
        let depth = 0;
        while (el && el !== doc.body && depth < 8) {
          const tid = el.getAttribute && el.getAttribute("data-testid");
          chain.push((el.tagName || "").toLowerCase() + (tid ? "[" + tid + "]" : ""));
          el = el.parentElement;
          depth += 1;
        }
        parts.push("chain" + (i + 1) + " " + chain.join(">"));
      }
    } catch (_) {
      /* ignore */
    }
    return parts.join(" | ");
  }

  // nearest scrollable ancestor of the first entry (DM thread pane);
  // null → content.js falls back to the document scroller.
  function findThreadContainer(doc) {
    const entries = findEntries(doc);
    if (!entries.length) return null;
    let el = entries[0].parentElement;
    while (el && el !== doc.documentElement) {
      try {
        const style = getComputedStyle(el);
        const oy = style.overflowY;
        if ((oy === "auto" || oy === "scroll" || oy === "overlay") &&
            el.scrollHeight > el.clientHeight + 10) {
          return el;
        }
      } catch (_) {
        /* keep climbing */
      }
      el = el.parentElement;
    }
    return null;
  }

  // -------------------------------------------------------------- fields

  function idOf(entry) {
    try {
      return (
        (typeof entry.id === "string" && entry.id) ||
        entry.getAttribute("data-id") ||
        entry.getAttribute("data-ember") ||
        null
      );
    } catch (_) {
      return null;
    }
  }

  function timeOf(entry) {
    try {
      const t = entry.querySelector("time[datetime]");
      if (!t) return null;
      const dt = t.getAttribute("datetime");
      if (!dt) return null;
      const d = new Date(dt);
      return isNaN(d.getTime()) ? null : d.toISOString();
    } catch (_) {
      return null;
    }
  }

  // sender: first profile-looking link inside the entry (avatar or name)
  function senderOf(entry) {
    try {
      const links = entry.querySelectorAll('a[href^="/"]');
      for (const a of links) {
        const h = handleFromHref(a.getAttribute("href"));
        if (h) return h;
      }
    } catch (_) {
      /* fall through */
    }
    return null;
  }

  // text: dedicated text node if present, else cleaned innerText minus <time>
  function textOf(entry) {
    try {
      const found = firstMatch(entry, SELECTORS.text);
      if (found) return (found.el.innerText || "").trim();
      let raw = entry.innerText || "";
      const t = entry.querySelector("time");
      if (t && t.textContent) raw = raw.split(t.textContent).join("");
      return raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .join("\n")
        .trim();
    } catch (_) {
      return "";
    }
  }

  // ------------------------------------------------------------ media

  // Avatars and emoji are TEXT/identity, never attachments.
  function isAvatarImg(img) {
    const src = (img.currentSrc || img.src || "").toLowerCase();
    if (src.includes("profile_images")) return true;
    const a = img.closest && img.closest('a[href^="/"]');
    if (a && handleFromHref(a.getAttribute("href"))) return true;
    return false;
  }

  function isEmojiImg(img) {
    const src = (img.currentSrc || img.src || "").toLowerCase();
    if (src.includes("emoji") || src.includes("twemoji")) return true;
    try {
      const rect = img.getBoundingClientRect();
      const px = Math.max(rect.width, rect.height);
      if (px > 0 && px <= 48) return true;
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  function looksLikeGif(el) {
    const hay = [
      el.getAttribute && el.getAttribute("alt"),
      el.currentSrc || el.src,
      typeof el.className === "string" ? el.className : "",
      el.getAttribute && el.getAttribute("data-testid")
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes("gif");
  }

  // Fixed category order keeps output deterministic: gifs, videos, images.
  function mediaOf(entry) {
    const media = [];
    try {
      for (let i = 0; i < entry.querySelectorAll('[data-testid="gif"]').length; i++) media.push("gif");
      for (let i = 0; i < entry.querySelectorAll("video").length; i++) media.push("vid");
      for (const img of entry.querySelectorAll("img")) {
        if (img.closest('[data-testid="gif"]')) continue; // already counted
        if (img.closest("video")) continue; // video poster, not an image
        if (isEmojiImg(img)) continue; // emoji = part of text
        if (isAvatarImg(img)) continue; // avatar = sender identity
        if (looksLikeGif(img)) {
          media.push("gif");
          continue;
        }
        media.push("img");
      }
    } catch (_) {
      /* best effort */
    }
    return media;
  }

  // ------------------------------------------------------------ entry

  function parseEntry(entry) {
    return {
      id: idOf(entry),
      sender: senderOf(entry),
      timestamp: timeOf(entry),
      text: textOf(entry),
      media: mediaOf(entry)
    };
  }

  function findTitle(doc) {
    const hit = firstMatch(doc, SELECTORS.title);
    if (!hit) return null;
    const t = (hit.el.innerText || hit.el.textContent || "").trim();
    return t || null;
  }

  // counts for diagnostics.probes
  function probeCounts(doc) {
    let entries = 0;
    for (const sel of SELECTORS.entry) {
      try {
        entries = doc.querySelectorAll(sel).length;
      } catch (_) {
        /* ignore */
      }
      if (entries) break;
    }
    return { entries };
  }

  globalThis.CE = globalThis.CE || {};
  CE.extract = {
    SELECTORS,
    handleFromHref,
    conversationIdFromPath,
    findEntries,
    findThreadContainer,
    parseEntry,
    findTitle,
    probeCounts,
    domReport,
    discoverEntrySelectors
  };
})();
