// content.js — export orchestrator. Listens on a popup port, loads the full
// chat history (scroll-to-top loop, bounded), extracts, organizes, replies.
// Read-only page interaction: only scrollTop changes during loading, and the
// original scroll position is restored afterwards.
(function () {
  "use strict";

  // Idempotency guard: this file may be injected on demand by the popup
  // (chrome.scripting) even when a copy is already registered — listeners
  // must never be registered twice (it would double-run every export).
  if (globalThis.__CE_CONTENT_LOADED__) return;
  globalThis.__CE_CONTENT_LOADED__ = true;

  const MAX_ROUNDS = 600;
  const MAX_ENTRIES = 50000;
  const HARD_TIMEOUT_MS = 10 * 60 * 1000;
  const ROUND_DELAY_MS = 700;

  let exporting = false;

  function debug(...args) {
    if (globalThis.CE && CE.debug) CE.debug(...args);
  }

  function post(port, msg) {
    try {
      port.postMessage(msg);
    } catch (_) {
      /* popup closed — runExport's abort flag handles the rest */
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function probeFrom(rawMessages) {
    const probes = CE.extract.probeCounts(document);
    let images = 0;
    let videos = 0;
    let gifs = 0;
    for (const r of rawMessages) {
      for (const m of r.media || []) {
        if (m === "img") images += 1;
        else if (m === "vid") videos += 1;
        else if (m === "gif") gifs += 1;
      }
    }
    return { entries: probes.entries, images, videos, gifs };
  }

  async function loadHistory(port, aborted) {
    const container = CE.extract.findThreadContainer(document) || document.scrollingElement;
    const prevScroll = container ? container.scrollTop : 0;
    let entries = CE.extract.findEntries(document);
    post(port, { type: "progress", phase: "loading", count: entries.length });

    let last = -1;
    let stable = 0;
    let rounds = 0;
    const startedAt = Date.now();

    while (
      !aborted() &&
      stable < 3 &&
      rounds < MAX_ROUNDS &&
      entries.length < MAX_ENTRIES &&
      Date.now() - startedAt < HARD_TIMEOUT_MS
    ) {
      rounds += 1;
      if (container) container.scrollTop = 0;
      await sleep(ROUND_DELAY_MS);
      if (aborted()) break;
      entries = CE.extract.findEntries(document);
      if (entries.length === last) stable += 1;
      else {
        stable = 0;
        last = entries.length;
      }
      post(port, { type: "progress", phase: "loading", count: entries.length });
    }

    if (container) container.scrollTop = prevScroll; // restore
    return entries;
  }

  async function runExport(port) {
    if (exporting) {
      post(port, { type: "error", error: "An export is already running." });
      return;
    }
    exporting = true;
    let disconnected = false;
    const onDisconnect = () => {
      disconnected = true;
      debug("popup disconnected — aborting");
    };
    port.onDisconnect.addListener(onDisconnect);

    try {
      let entries = CE.extract.findEntries(document);
      if (!entries.length) {
        let report = "";
        try {
          report = CE.extract.domReport(document);
          console.error("[CE] no message entries found. DOM report:", report);
        } catch (_) {
          /* report is best effort */
        }
        throw new Error(
          "No message bubbles were found — X's chat layout may have changed. Report: " + report
        );
      }

      post(port, { type: "progress", phase: "start", count: entries.length });

      entries = await loadHistory(port, () => disconnected);
      if (disconnected) return;

      post(port, { type: "progress", phase: "parsing", count: entries.length });
      const raw = entries.map((e) => CE.extract.parseEntry(e));
      const title = CE.extract.findTitle(document);
      const doc = CE.buildDocument(raw, {
        source: location.href.split("?")[0],
        id: CE.extract.conversationIdFromPath(location.pathname),
        title,
        probes: probeFrom(raw)
      });
      debug("export built", doc.stats, doc.diagnostics);

      if (disconnected) return;
      post(port, { type: "done", doc });
    } catch (e) {
      debug("export failed", e);
      post(port, { type: "error", error: String((e && e.message) || e) });
    } finally {
      exporting = false;
    }
  }

  // Lets the popup verify this tab actually has the content script before
  // starting an export (tabs opened before the extension was loaded/reloaded
  // don't get the script injected).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "chat-exporter-ping") {
      sendResponse({ ok: true });
    }
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "export") return;
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === "start") {
        runExport(port).catch((e) =>
          post(port, { type: "error", error: String((e && e.message) || e) })
        );
      }
    });
  });

  debug("Chat Exporter content script ready on", location.pathname);
})();
