// analyzer.js — extracts a postContext from a feed <article> node.
// DOM access only; no network, no storage.
(function () {
  "use strict";

  const POST_SELECTOR = 'article[data-testid="tweet"]';
  const TEXT_SELECTOR = '[data-testid="tweetText"]';
  const STATUS_LINK_SELECTOR = 'a[href*="/status/"]';

  function debug(...args) {
    if (globalThis.XFF && XFF.settings) XFF.settings.debug(...args);
  }

  // From an anchor href like "/someuser/status/123456" return "someuser".
  function handleFromHref(href) {
    if (typeof href !== "string") return null;
    const m = href.match(/^\/([^/?#]+)\/status\/\d+/);
    if (!m) return null;
    const seg = m[1];
    if (!seg || seg === "i" || seg === "intent" || seg === "search") return null;
    if (seg.startsWith("%")) return null;
    return seg;
  }

  // Author of the post: the first status link inside the article header.
  // For retweets this resolves to the ORIGINAL author (correct — we filter
  // the content we see). Fail open on any doubt.
  function extractHandle(article) {
    try {
      const links = article.querySelectorAll(STATUS_LINK_SELECTOR);
      for (const a of links) {
        const handle = handleFromHref(a.getAttribute("href"));
        if (handle) return handle;
      }
    } catch (e) {
      debug("extractHandle failed", e);
    }
    return null;
  }

  // Post text: concatenates all text blocks inside the article so keyword
  // rules also see quoted-tweet text.
  function extractText(article) {
    try {
      const nodes = article.querySelectorAll(TEXT_SELECTOR);
      const parts = [];
      for (const n of nodes) {
        const t = (n.innerText || "").trim();
        if (t) parts.push(t);
      }
      return parts.join("\n");
    } catch (e) {
      debug("extractText failed", e);
      return "";
    }
  }

  // Builds the postContext for a node. profile fields are filled in later
  // by content.js via profile-cache.
  function extractPostContext(article) {
    try {
      const handle = extractHandle(article);
      if (!handle) return null; // cannot identify author → fail open (null)
      return {
        handle,
        text: extractText(article),
        location: null,
        followers: null,
        following: null
      };
    } catch (e) {
      debug("extractPostContext failed", e);
      return null;
    }
  }

  // Stable-ish key so recycled/virtualized nodes are reprocessed when their
  // content changes, and skipped when unchanged.
  function postKey(ctx) {
    const text = (ctx.text || "").replace(/\s+/g, " ").slice(0, 100);
    return ctx.handle.toLowerCase() + "|" + text;
  }

  function isPostNode(el) {
    return el && el.nodeType === 1 && el.matches && el.matches(POST_SELECTOR);
  }

  globalThis.XFF = globalThis.XFF || {};
  globalThis.XFF.analyzer = {
    POST_SELECTOR,
    handleFromHref,
    extractHandle,
    extractText,
    extractPostContext,
    postKey,
    isPostNode
  };
})();
