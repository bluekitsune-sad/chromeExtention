// popup.js — Export button, progress display, blob download.
// organize.js is loaded first (plain script) and exposes globalThis.CE.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const WATCHDOG_MS = 12000; // no message from content for this long → error

  let port = null;
  let watchdog = null;

  function setStatus(text, cls) {
    const el = $("status");
    el.textContent = text;
    el.className = "status" + (cls ? " " + cls : "");
  }

  function setProgress(text) {
    const el = $("progress");
    if (text === null) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = text;
  }

  function setSummary(html) {
    const el = $("summary");
    if (html === null) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = html;
  }

  function resetWatchdog() {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      fail("No response from the page — reload the x.com/messages tab and try again.");
    }, WATCHDOG_MS);
  }

  function stopPort() {
    clearTimeout(watchdog);
    if (port) {
      try {
        port.disconnect();
      } catch (_) {
        /* ignore */
      }
      port = null;
    }
  }

  function fail(message) {
    stopPort();
    setProgress(null);
    setStatus(message, "err");
    $("export").disabled = false;
  }

  // ------------------------------------------------------------- download

  function download(doc) {
    const json = JSON.stringify(doc, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = CE.exportFilename(doc);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return a.download;
  }

  function shortDate(iso) {
    if (!iso) return null;
    try {
      return new Date(iso).toISOString().slice(0, 10);
    } catch (_) {
      return null;
    }
  }

  // --------------------------------------------------------------- start

  function startExport(tabId) {
    stopPort();
    $("export").disabled = true;
    setStatus("Exporting…", "ok");
    setSummary(null);

    port = chrome.tabs.connect(tabId, { name: "export" });
    port.onMessage.addListener((msg) => {
      resetWatchdog();
      if (msg.type === "progress") {
        if (msg.phase === "loading") {
          setProgress("Loading history… " + msg.count + " messages so far");
        } else if (msg.phase === "parsing") {
          setProgress("Organizing " + msg.count + " messages…");
        } else {
          setProgress("Starting…");
        }
      } else if (msg.type === "done") {
        stopPort();
        setProgress(null);
        try {
          const doc = msg.doc;
          const name = download(doc);
          const first = shortDate(doc.stats.first);
          const last = shortDate(doc.stats.last);
          const range = first && last ? first + " → " + last : "timestamps unavailable";
          setStatus("Saved ✓", "ok");
          setSummary(
            doc.stats.messageCount +
              " messages · " +
              range +
              (doc.diagnostics.duplicatesRemoved
                ? " · " + doc.diagnostics.duplicatesRemoved + " duplicates removed"
                : "") +
              "\nFile: " + name
          );
        } catch (e) {
          fail("Download failed: " + (e && e.message));
        }
      } else if (msg.type === "error") {
        fail(msg.error || "Unknown error");
      }
    });
    port.onDisconnect.addListener(() => {
      // content script gone (navigation/reload) without a result
      clearTimeout(watchdog);
      fail("Connection to the page was lost — reload x.com/messages and retry.");
    });
    port.postMessage({ type: "start" });
    resetWatchdog();
  }

  // ---------------------------------------------------------------- init

  function init() {
    $("export").addEventListener("click", () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) {
          fail("No active tab found.");
          return;
        }
        if (!tab.url || !tab.url.startsWith("https://x.com/messages")) {
          fail("Open an X DM conversation first: https://x.com/messages");
          return;
        }
        startExport(tab.id);
      });
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (tab && tab.url && tab.url.startsWith("https://x.com/messages")) {
        setStatus("Ready — open the conversation you want to export.", "ok");
        $("export").disabled = false;
      } else {
        setStatus("Open an X DM conversation: https://x.com/messages", "err");
      }
    });
  }

  init();
})();
