// popup.js — settings UI. Auto-saves on every change (chrome.storage.sync),
// which broadcasts to open tabs via storage.onChanged (settings.js).
// settings.js is loaded first via a plain <script> tag and exposes
// globalThis.XFF.settings (works identically in the popup and content script).
const settings = globalThis.XFF.settings;

const $ = (id) => document.getElementById(id);

let statusTimer = null;
function status(msg, isError) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.textContent = "";
    el.classList.remove("error");
  }, 2000);
}

// ------------------------------------------------------------ list helpers

function renderList(ulId, items, onRemove) {
  const ul = $(ulId);
  ul.textContent = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "none";
    ul.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = item;
    const btn = document.createElement("button");
    btn.className = "remove";
    btn.type = "button";
    btn.textContent = "✕";
    btn.title = "Remove";
    btn.addEventListener("click", () => onRemove(item));
    li.append(span, btn);
    ul.appendChild(li);
  }
}

function addToList(key, value) {
  const v = String(value || "").trim();
  if (!v) return;
  const list = settings.get()[key] || [];
  if (list.some((x) => x.toLowerCase() === v.toLowerCase())) {
    status("Already in the list.", true);
    return;
  }
  settings.save({ [key]: [...list, v] }).then(() => {
    refresh();
    status("Saved.");
  });
}

function removeFromList(key, value) {
  const list = (settings.get()[key] || []).filter((x) => x !== value);
  settings.save({ [key]: list }).then(() => {
    refresh();
    status("Saved.");
  });
}

// ------------------------------------------------------------ range helpers

// Remember last typed bounds so re-enabling restores them.
const lastRange = {
  followers: { min: null, max: null },
  following: { min: null, max: null }
};

function parseBound(input, which) {
  const raw = input.value.trim();
  if (raw === "") return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    status(`${which} must be a number ≥ 0.`, true);
    return { ok: false, value: null };
  }
  return { ok: true, value: Math.floor(n) };
}

function saveRange(kind) {
  const enabled = $(kind + "Enabled").checked;
  if (!enabled) {
    // keep what's typed for restore, but persist an inactive rule
    const min = $(kind + "Min").value.trim();
    const max = $(kind + "Max").value.trim();
    if (min !== "") lastRange[kind].min = Number(min);
    if (max !== "") lastRange[kind].max = Number(max);
    settings.save({ [kind]: { min: null, max: null } }).then(() => status("Saved."));
    return;
  }
  const min = parseBound($(kind + "Min"), "min");
  const max = parseBound($(kind + "Max"), "max");
  if (!min.ok || !max.ok) return;
  if (min.value === null && max.value === null) {
    status("Enter at least one bound (min or max).", true);
    return;
  }
  if (min.value !== null && max.value !== null && min.value > max.value) {
    status("min cannot be greater than max.", true);
    return;
  }
  settings
    .save({ [kind]: { min: min.value, max: max.value } })
    .then(() => status("Saved."));
}

function renderRange(kind) {
  const range = settings.get()[kind] || { min: null, max: null };
  const active = settings.rangeActive ? settings.rangeActive(range) : range.min !== null || range.max !== null;
  $(kind + "Enabled").checked = active;
  $(kind + "Min").value = range.min !== null && range.min !== undefined ? range.min : "";
  $(kind + "Max").value = range.max !== null && range.max !== undefined ? range.max : "";
}

// ------------------------------------------------------------ hidden count

async function renderCount() {
  let count = 0;
  try {
    if (chrome.storage.session) {
      const got = await chrome.storage.session.get("hiddenCount");
      if (typeof got.hiddenCount === "number") count = got.hiddenCount;
    }
  } catch (_) {
    /* ignore */
  }
  if (!count) {
    try {
      const got = await chrome.storage.local.get("xff:sessionCount");
      if (got["xff:sessionCount"] && Date.now() - got["xff:sessionCount"].at < 12 * 3600 * 1000) {
        count = got["xff:sessionCount"].count;
      }
    } catch (_) {
      /* ignore */
    }
  }
  $("hiddenCount").textContent = "Hidden: " + count;
}

// ------------------------------------------------------------ location mode

function updateLocationModeHint(mode) {
  $("locationModeHint").textContent =
    mode === "only"
      ? "⚠ Only-mode: posts hide unless the author's profile location matches. Authors with no profile location are hidden too."
      : "Posts hide when the author's profile location matches.";
}

// ------------------------------------------------------------- diagnostics

const MAX_DIAG_ROWS = 12;

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

async function renderDiagnostics() {
  const box = $("diagnostics");
  box.textContent = "";
  let all = {};
  try {
    all = await chrome.storage.local.get(null);
  } catch (_) {
    /* ignore */
  }
  const entries = Object.keys(all)
    .filter((k) => k.startsWith("profile:"))
    .map((k) => ({ handle: k.slice("profile:".length), ...(all[k] || {}) }))
    .sort((a, b) => (b.fetchedAt || 0) - (a.fetchedAt || 0));

  const summary = document.createElement("p");
  summary.className = "diag-summary";

  if (!entries.length) {
    summary.textContent = "No profiles cached yet — open X and scroll the feed once.";
    box.appendChild(summary);
    return;
  }

  const failed = entries.filter((e) => !e.ok).length;
  summary.textContent =
    entries.length + " author" + (entries.length === 1 ? "" : "s") + " cached · " +
    failed + " failed";
  if (failed > 0) {
    summary.classList.add("warn");
    const hint = document.createElement("div");
    hint.className = "diag-more";
    hint.textContent =
      "⚠ Failed lookups retry after 1 h, or press Clear profile cache and reload X.";
    box.appendChild(summary);
    box.appendChild(hint);
  } else {
    box.appendChild(summary);
  }

  for (const e of entries.slice(0, MAX_DIAG_ROWS)) {
    const row = document.createElement("div");
    row.className = "diag-row";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = "@" + e.handle;
    const what = document.createElement("span");
    what.className = "what";
    if (!e.ok) {
      what.classList.add("err");
      what.textContent = "⚠ " + (e.error || "fetch failed");
      what.title = e.error || "fetch failed";
    } else {
      const loc =
        e.location === "" ? "(no location set)" : e.location ? "“" + e.location + "”" : "(unknown)";
      const fol = typeof e.followers === "number" ? " · " + e.followers + " followers" : "";
      const meta = (e.source ? " · " + e.source : "") + (e.fetchedAt ? " · " + timeAgo(e.fetchedAt) : "");
      what.textContent = loc + fol + meta;
      what.title = loc + fol + meta;
    }
    row.append(who, what);
    box.appendChild(row);
  }
  if (entries.length > MAX_DIAG_ROWS) {
    const more = document.createElement("div");
    more.className = "diag-more";
    more.textContent = "+ " + (entries.length - MAX_DIAG_ROWS) + " more…";
    box.appendChild(more);
  }
}

// ---------------------------------------------------------------- refresh

function refresh() {
  const s = settings.get();
  $("enabled").checked = !!s.enabled;
  $("paused").checked = !!s.paused;
  $("locationMatch").value = s.locationMatch === "equals" ? "equals" : "contains";
  $("locationMode").value = s.locationMode === "only" ? "only" : "hide";
  updateLocationModeHint(s.locationMode);
  $("caseSensitive").checked = !!s.caseSensitive;

  renderList("locationList", s.locations || [], (v) => removeFromList("locations", v));
  renderList("accountList", s.accounts || [], (v) => removeFromList("accounts", v));
  renderList("keywordList", s.keywords || [], (v) => removeFromList("keywords", v));

  renderRange("followers");
  renderRange("following");
  renderCount();
  renderDiagnostics();
}

// ---------------------------------------------------------------- wire up

function wire() {
  $("enabled").addEventListener("change", (e) =>
    settings.save({ enabled: e.target.checked }).then(() => status("Saved."))
  );
  $("paused").addEventListener("change", (e) =>
    settings.save({ paused: e.target.checked }).then(() => status("Saved."))
  );
  $("caseSensitive").addEventListener("change", (e) =>
    settings.save({ caseSensitive: e.target.checked }).then(() => status("Saved."))
  );
  $("locationMode").addEventListener("change", (e) => {
    const mode = e.target.value === "only" ? "only" : "hide";
    updateLocationModeHint(mode);
    settings.save({ locationMode: mode }).then(() => status("Saved."));
  });
  $("locationMatch").addEventListener("change", (e) =>
    settings.save({ locationMatch: e.target.value === "equals" ? "equals" : "contains" }).then(() =>
      status("Saved.")
    )
  );

  const adders = [
    ["addLocation", "locationInput", "locations"],
    ["addAccount", "accountInput", "accounts"],
    ["addKeyword", "keywordInput", "keywords"]
  ];
  for (const [btnId, inputId, key] of adders) {
    $(btnId).addEventListener("click", () => {
      addToList(key, $(inputId).value);
      $(inputId).value = "";
    });
    $(inputId).addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        $(btnId).click();
      }
    });
  }

  for (const kind of ["followers", "following"]) {
    $(kind + "Enabled").addEventListener("change", () => saveRange(kind));
    for (const bound of ["Min", "Max"]) {
      $(kind + bound).addEventListener("change", () => saveRange(kind));
      $(kind + bound).addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveRange(kind);
        }
      });
    }
  }

  $("testFetch").addEventListener("click", () => {
    testFetchProfile().catch((e) => {
      $("testOut").hidden = false;
      $("testOut").textContent = "test failed: " + (e && e.message);
    });
  });
  $("testHandle").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("testFetch").click();
    }
  });

  $("clearCache").addEventListener("click", async () => {
    try {
      const index = await chrome.storage.local.get("xff:profile-index");
      const keys = Object.keys(index["xff:profile-index"] || {});
      await chrome.storage.local.remove([...keys, "xff:profile-index"]);
      status("Profile cache cleared.");
      renderDiagnostics();
    } catch (e) {
      status("Could not clear cache.", true);
    }
  });
}

// ------------------------------------------------------------- test fetch

// Replicates the content script's fetch from the popup (extension origin,
// same host permission) and shows exactly what comes back + how it parses.
async function testFetchProfile() {
  const out = $("testOut");
  out.hidden = false;
  const handle = $("testHandle").value.trim().replace(/^@+/, "");
  if (!handle) {
    out.textContent = "Enter a handle first, e.g. Karachi";
    return;
  }
  out.textContent = "fetching https://x.com/" + handle + " …";
  try {
    const res = await fetch("https://x.com/" + encodeURIComponent(handle), {
      credentials: "include",
      redirect: "follow",
      headers: { accept: "text/html" }
    });
    const html = await res.text();
    const esc = handle.replace(/[^\w]/g, "");
    const anchorCount = (html.match(new RegExp("screen_name\\s*:\\s*\"" + esc + "\"", "gi")) || []).length;
    const parsed = globalThis.XFF.profileCache.parseProfileHtml(html, handle);
    const probe = globalThis.XFF.profileCache.probeAbout(html, handle);
    const anchorIdx = html.search(new RegExp("screen_name\\s*:\\s*\"" + esc + "\"", "i"));
    const excerpt =
      anchorIdx >= 0
        ? html.slice(Math.max(0, anchorIdx - 300), anchorIdx + 1200)
        : html.slice(0, 1500);
    const probeLines = probe.keywords.map(
      (k) => "  " + k.kw + " ×" + k.count + " :: " + (k.excerpts[0] || "")
    );
    out.textContent = [
      "status: " + res.status,
      "redirected: " + res.redirected + (res.redirected ? " → " + res.url : ""),
      "html bytes: " + html.length,
      "screen_name anchors for @" + handle + ": " + anchorCount,
      "parser result: " + JSON.stringify(parsed),
      "",
      "— ABOUT PROBE (About-this-account section: where does it live?) —",
      "anchors: " + probe.anchors,
      "payload keys near @" + handle + ": " + (probe.keys.length ? probe.keys.join(", ") : "(none found)"),
      "label hits: " +
        (probe.keywords.length
          ? ""
          : "(none — section data likely arrives via a separate XHR, not in the profile HTML)"),
      ...probeLines,
      "",
      "— excerpt around first anchor (copy this to debug) —",
      excerpt
    ].join("\n");
  } catch (e) {
    out.textContent = "fetch failed: " + (e && e.message);
  }
}

// Fill the location input's autocomplete from the curated preset list.
function populatePresets() {
  const dl = $("locationPresets");
  if (!dl) return;
  const presets = globalThis.XFF_LOCATION_PRESETS || [];
  const frag = document.createDocumentFragment();
  for (const p of presets) {
    const o = document.createElement("option");
    o.value = p;
    frag.appendChild(o);
  }
  dl.appendChild(frag);
}

async function init() {
  await settings.load();
  populatePresets();
  wire();
  refresh();
}

init().catch((e) => {
  status("Failed to load settings.", true);
  console.error("[XFF popup]", e);
});
