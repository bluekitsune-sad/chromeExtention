// popup.js — Export button, progress display, blob download.
// organize.js is loaded first (plain script) and exposes globalThis.CE.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const WATCHDOG_MS = 12000; // no message from content for this long → error

  // DMs live at https://x.com/i/chat (open a DM → /i/chat/<conversation-id>);
  // the older /messages URLs still redirect there and are accepted too.
  function isChatPage(url) {
    return (
      typeof url === "string" &&
      (url.startsWith("https://x.com/i/chat") || url.startsWith("https://x.com/messages"))
    );
  }

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
      fail("No response from the page — reload https://x.com/i/chat and try again.");
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

  // Content scripts normally pre-inject on /i/chat, but a tab opened before
  // the extension was (re)loaded has none — inject the scripts on demand via
  // chrome.scripting instead of failing. allowInject caps it to one attempt.
  function ping(tabId, onReady, allowInject) {
    chrome.tabs.sendMessage(tabId, { type: "chat-exporter-ping" }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        if (allowInject) inject(tabId, onReady);
        else fail("Content script couldn't attach — reload https://x.com/i/chat once and retry.");
        return;
      }
      onReady();
    });
  }

  function inject(tabId, onReady) {
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      fail("Extension needs one reload for a new permission: click ⟳ in chrome://extensions, then export again.");
      return;
    }
    setStatus("Attaching to page…");
    chrome.scripting.executeScript(
      { target: { tabId }, files: ["organize.js", "extract.js", "content.js"] },
      () => {
        if (chrome.runtime.lastError) {
          fail("Couldn't attach to this tab: " + chrome.runtime.lastError.message);
          return;
        }
        setTimeout(() => ping(tabId, onReady, false), 150);
      }
    );
  }

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
        $("export").disabled = false; // allow re-export from the same popup
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
      fail("Connection to the page was lost — the tab reloaded or navigated. Open https://x.com/i/chat again and retry.");
    });
    port.postMessage({ type: "start" });
    resetWatchdog();
  }

  // ---------------------------------------------------------------- init

  function init() {
    $("export").addEventListener("click", () => {
      $("export").disabled = true; // no double-clicks while attaching/pinging
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) {
          fail("No active tab found.");
          return;
        }
        if (!isChatPage(tab.url)) {
          fail("Open an X chat first: https://x.com/i/chat");
          return;
        }
        setStatus("Checking page…");
        ping(tab.id, () => startExport(tab.id), true);
      });
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (tab && isChatPage(tab.url)) {
        const short = tab.url.replace(/^https:\/\//, "").split("?")[0];
        setStatus("Ready — " + (short.length > 60 ? short.slice(0, 60) + "…" : short), "ok");
        $("export").disabled = false;
      } else {
        setStatus("Open an X chat: https://x.com/i/chat", "err");
      }
    });
  }

  init();
})();
