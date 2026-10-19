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

  function findEntries(doc) {
    for (const sel of SELECTORS.entry) {
      try {
        const list = Array.from(doc.querySelectorAll(sel));
        if (list.length) return list;
      } catch (_) {
        /* try next */
      }
    }
    return [];
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
    probeCounts
  };
})();
