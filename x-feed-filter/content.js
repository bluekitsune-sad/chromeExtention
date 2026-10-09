// content.js — watches the X feed, runs the analyze → filter pipeline.
// Observes mutations (no polling), handles SPA navigation, and re-runs
// everything when settings change.
(function () {
  "use strict";

  const HIDDEN_CLASS = "xff-hidden";
  const KEY_ATTR = "data-xff-key";
  const LOCAL_COUNT_KEY = "xff:sessionCount";

  let hiddenCount = 0;
  let lastCountFlush = 0;
  let sessionCountMode = false;
  const seen = new WeakSet(); // nodes we've seen at least once (for rescan)

  function debug(...args) {
    if (globalThis.XFF && XFF.settings) XFF.settings.debug(...args);
  }

  // ---------------------------------------------------------------- hiding

  function wrapperOf(article) {
    return (article.closest && article.closest('div[role="listItem"]')) || article.parentElement;
  }

  function hide(article, ruleName) {
    const already = article.classList.contains(HIDDEN_CLASS);
    article.classList.add(HIDDEN_CLASS);
    const wrap = wrapperOf(article);
    if (wrap && wrap !== article) wrap.classList.add(HIDDEN_CLASS);
    article.setAttribute("data-xff-rule", ruleName || "");
    if (!already) {
      hiddenCount += 1;
      flushCount();
    }
    debug("hidden by rule:", ruleName, article.getAttribute(KEY_ATTR));
  }

  function unhide(article) {
    if (!article.classList.contains(HIDDEN_CLASS)) return;
    article.classList.remove(HIDDEN_CLASS);
    const wrap = wrapperOf(article);
    if (wrap && wrap !== article) wrap.classList.remove(HIDDEN_CLASS);
    article.removeAttribute("data-xff-rule");
  }

  // ------------------------------------------------- hidden-post counter

  async function initCount() {
    try {
      if (chrome.storage && chrome.storage.session) {
        await chrome.storage.session.setAccessLevel({
          accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS"
        });
        const got = await chrome.storage.session.get("hiddenCount");
        hiddenCount = typeof got.hiddenCount === "number" ? got.hiddenCount : 0;
        sessionCountMode = true;
        return;
      }
    } catch (_) {
      /* fall back to local */
    }
    try {
      const got = await chrome.storage.local.get(LOCAL_COUNT_KEY);
      const rec = got[LOCAL_COUNT_KEY];
      if (rec && typeof rec.count === "number" && Date.now() - rec.at < 12 * 60 * 60 * 1000) {
        hiddenCount = rec.count;
      }
    } catch (_) {
      /* ignore */
    }
  }

  function flushCount() {
    const now = Date.now();
    if (now - lastCountFlush < 1000) return; // throttle writes
    lastCountFlush = now;
    try {
      if (sessionCountMode) {
        chrome.storage.session.set({ hiddenCount });
      } else {
        chrome.storage.local.set({ [LOCAL_COUNT_KEY]: { count: hiddenCount, at: Date.now() } });
      }
    } catch (_) {
      /* ignore */
    }
  }

  // ------------------------------------------------------------- pipeline

  async function analyzeAndFilter(article) {
    const s = XFF.settings.get();
    const ctx = XFF.analyzer.extractPostContext(article);
    if (!ctx) {
      unhide(article); // cannot identify author → fail open
      return;
    }
    const key = XFF.analyzer.postKey(ctx);

    if (!s.enabled || s.paused) {
      article.setAttribute(KEY_ATTR, key);
      unhide(article);
      return;
    }

    // Quick pass: keyword + account rules (no network).
    const quick = XFF.filter.matchQuick(ctx, s);
    if (quick) {
      hide(article, quick);
      article.setAttribute(KEY_ATTR, key);
      return;
    }

    // Profile pass: one cached fetch serves location + followers + following.
    const profile = await XFF.profileCache.getProfile(ctx.handle);
    if (!profile) {
      debug("no profile data for @" + ctx.handle + " → location/follower rules fail open");
    }
    if (!article.isConnected) return; // unmounted while awaiting

    // Recompute — the virtualized feed may have recycled this node.
    const fresh = XFF.analyzer.extractPostContext(article);
    if (!fresh) {
      unhide(article);
      return;
    }
    const freshKey = XFF.analyzer.postKey(fresh);
    if (freshKey !== key) {
      processArticle(article); // content changed under us → re-run
      return;
    }

    fresh.location = profile ? profile.location : null;
    fresh.followers = profile ? profile.followers : null;
    fresh.following = profile ? profile.following : null;

    const hit = XFF.filter.matchProfile(fresh, s);
    if (hit) hide(article, hit);
    else unhide(article);
    article.setAttribute(KEY_ATTR, freshKey);
  }

  function processArticle(article) {
    if (!article.isConnected) return;
    if (article.hasAttribute(KEY_ATTR)) {
      const ctx = XFF.analyzer.extractPostContext(article);
      if (ctx && article.getAttribute(KEY_ATTR) === XFF.analyzer.postKey(ctx)) {
        return; // unchanged — skip
      }
    }
    seen.add(article);
    // Per-node promise chain; any error fails open (post stays visible).
    analyzeAndFilter(article).catch((e) => debug("pipeline error", e));
  }

  function collectArticles(root, out) {
    if (!root || root.nodeType !== 1) return;
    if (XFF.analyzer.isPostNode(root)) out.push(root);
    if (root.querySelectorAll) {
      const found = root.querySelectorAll(XFF.analyzer.POST_SELECTOR);
      for (const a of found) out.push(a);
    }
  }

  // ------------------------------------------------------- mutation observer

  let batch = [];
  let scheduled = false;

  function scheduleBatch() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const nodes = batch;
      batch = [];
      const articles = [];
      for (const n of nodes) collectArticles(n, articles);
      const unique = [...new Set(articles)];
      for (const a of unique) processArticle(a);
    });
  }

  function onMutations(mutations) {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) batch.push(node);
      }
      // Text inside an existing post can change (edit / X re-render)
      if (m.type === "characterData" && m.target && m.target.parentElement) {
        const art = m.target.parentElement.closest(XFF.analyzer.POST_SELECTOR);
        if (art) batch.push(art);
      }
    }
    if (batch.length) scheduleBatch();
  }

  // ------------------------------------------------------------ SPA support

  function rescanAll() {
    const articles = document.querySelectorAll(XFF.analyzer.POST_SELECTOR);
    for (const a of articles) {
      a.removeAttribute(KEY_ATTR);
      processArticle(a);
    }
  }

  function hookHistory() {
    const wrap = (type) => {
      const orig = history[type];
      if (typeof orig !== "function") return;
      history[type] = function () {
        const ret = orig.apply(this, arguments);
        try {
          debug("navigation:", type);
          setTimeout(rescanAll, 400); // let X render the new view
        } catch (_) {
          /* ignore */
        }
        return ret;
      };
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", () => setTimeout(rescanAll, 400));
  }

  // ------------------------------------------------------ settings changes

  XFF.onSettingsChanged = function () {
    debug("settings changed → full rescan");
    rescanAll();
  };

  // ---------------------------------------------------------------- startup

  async function main() {
    await XFF.settings.load();
    await initCount();

    // Stylesheet (styles.css keeps the collapse rules next to the hide logic).
    try {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("styles.css");
      (document.head || document.documentElement).appendChild(link);
    } catch (e) {
      debug("stylesheet inject failed", e);
    }

    hookHistory();

    const observer = new MutationObserver(onMutations);
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    rescanAll(); // whatever is already rendered
    debug("X Feed Filter started");
  }

  main().catch((e) => console.warn("[XFF] failed to start (posts stay visible):", e));
})();
