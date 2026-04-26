// ── State ─────────────────────────────────────────────────────────────────────
const allEvents   = [];
const elemMap     = new Map();    // seq → HTMLElement
const seenTypes   = new Set();
const typeCounts  = new Map();    // type → count
const hiddenTypes = new Set(["assistant.streaming_delta"]);

let searchQuery = "";
let paused      = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const eventList = document.getElementById("event-list");
const emptyEl   = document.getElementById("empty");
const statsEl   = document.getElementById("stats");
const filtersEl = document.getElementById("filters");
const searchEl  = document.getElementById("search");
const btnPause  = document.getElementById("btn-pause");
const btnClear  = document.getElementById("btn-clear");

// ── Type metadata: label + color ──────────────────────────────────────────────
const TYPE_META = {
    "user.message":              { color: "#58a6ff" },
    "assistant.message":         { color: "#3fb950" },
    "assistant.turn_start":      { color: "#388bfd" },
    "assistant.streaming_delta": { color: "#484f58" },
    "tool.execution_start":      { color: "#f0883e" },
    "tool.execution_complete":   { color: "#a5d6ff" },
    "session.idle":              { color: "#8b949e" },
    "session.error":             { color: "#f85149" },
    "session.shutdown":          { color: "#f85149" },
    "permission.requested":      { color: "#bc8cff" },
    "hook:session_start":        { color: "#56d364" },
    "hook:session_end":          { color: "#8b949e" },
    "hook:user_prompt":          { color: "#79c0ff" },
    "hook:pre_tool":             { color: "#ffa657" },
    "hook:post_tool":            { color: "#d2a679" },
};

function getMeta(type) {
    return TYPE_META[type] ?? { color: "#8b949e" };
}

// ── Summary extractor ─────────────────────────────────────────────────────────
function getSummary(type, d) {
    if (!d) return "";
    const trunc = (s, n = 140) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
    switch (type) {
        case "user.message":
        case "hook:user_prompt":
            return trunc(d.content ?? d.prompt ?? "");
        case "assistant.message":
            return trunc(d.content ?? "");
        case "assistant.turn_start":
            return `turnId: ${d.turnId ?? ""}`;
        case "assistant.streaming_delta":
            return `${d.totalResponseSizeBytes ?? 0} bytes accumulated`;
        case "tool.execution_start":
        case "hook:pre_tool": {
            const args = d.arguments ?? d.toolArgs ?? {};
            const argStr = Object.entries(args)
                .slice(0, 4)
                .map(([k, v]) => `${k}=${trunc(JSON.stringify(v), 50)}`)
                .join("  ");
            return `${d.toolName ?? d.tool ?? ""}  ${argStr}`;
        }
        case "tool.execution_complete": {
            const ok  = d.success ? "✓" : "✗";
            const res = d.result ?? d.error ?? "";
            return `${d.toolName ?? ""}  ${ok}  ${trunc(String(res), 100)}`;
        }
        case "hook:post_tool": {
            const res = d.toolResult ?? d.result ?? {};
            return `${d.toolName ?? ""}  →  ${trunc(JSON.stringify(res), 100)}`;
        }
        case "hook:session_start":
            return `source: ${d.source ?? "unknown"}`;
        case "hook:session_end":
            return `reason: ${d.reason ?? "unknown"}`;
        case "session.error":
            return trunc(d.message ?? d.errorType ?? "");
        case "permission.requested": {
            const pr = d.permissionRequest ?? {};
            return `${pr.kind ?? ""}  ${trunc(pr.fullCommandText ?? JSON.stringify(pr), 100)}`;
        }
        case "session.idle":
            return d.backgroundTasks ? `backgroundTasks: ${d.backgroundTasks}` : "";
        case "session.shutdown":
            return `shutdownType: ${d.shutdownType ?? ""}  premiumRequests: ${d.totalPremiumRequests ?? 0}`;
        default:
            return trunc(JSON.stringify(d), 120);
    }
}

// ── Formatting ────────────────────────────────────────────────────────────────
function formatTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
}

function escHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function highlightJSON(raw) {
    const escaped = escHtml(raw);
    return escaped
        // object keys  "key":
        .replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)/g, '<span class="jk">$1</span>$2')
        // string values  : "value"
        .replace(/(:\s*)(&quot;(?:[^&]|&(?!quot;))*?&quot;)/g, '$1<span class="js">$2</span>')
        // booleans
        .replace(/\b(true|false)\b/g, '<span class="jb">$1</span>')
        // null
        .replace(/\bnull\b/g, '<span class="jn">null</span>')
        // numbers (after colon or alone on a line)
        .replace(/(:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, '$1<span class="ji">$2</span>');
}

// ── Visibility check ──────────────────────────────────────────────────────────
function isVisible(event) {
    if (hiddenTypes.has(event.type)) return false;
    if (searchQuery) {
        const hay = `${event.type} ${JSON.stringify(event.data ?? {})}`.toLowerCase();
        if (!hay.includes(searchQuery)) return false;
    }
    return true;
}

// ── Render one event row ──────────────────────────────────────────────────────
function renderEvent(event) {
    const meta    = getMeta(event.type);
    const summary = getSummary(event.type, event.data);
    const jsonStr = JSON.stringify(event.data, null, 2);

    const el = document.createElement("div");
    el.className      = "event";
    el.dataset.seq    = event.seq;
    el.dataset.type   = event.type;

    el.innerHTML = `
      <div class="event-header">
        <span class="event-time">${formatTime(event.ts)}</span>
        <span class="event-badge" style="--badge-color:${meta.color}">${escHtml(event.type)}</span>
        <span class="event-summary">${escHtml(summary)}</span>
        <button class="event-expand" aria-label="toggle raw data">▶</button>
      </div>
      <div class="event-body">
        <pre class="event-json">${highlightJSON(jsonStr)}</pre>
      </div>
    `;

    el.querySelector(".event-header").addEventListener("click", () => {
        el.classList.toggle("expanded");
        el.querySelector(".event-expand").textContent =
            el.classList.contains("expanded") ? "▼" : "▶";
    });

    return el;
}

// ── Filter pills ──────────────────────────────────────────────────────────────
function ensureFilterPill(type) {
    if (seenTypes.has(type)) return;
    seenTypes.add(type);

    const meta = getMeta(type);
    const pill = document.createElement("button");
    pill.className = "filter-pill " + (hiddenTypes.has(type) ? "hidden" : "active");
    pill.dataset.type = type;
    pill.style.setProperty("--pill-color", meta.color);
    pill.title = type;
    pill.textContent = type;

    pill.addEventListener("click", () => {
        if (hiddenTypes.has(type)) {
            hiddenTypes.delete(type);
            pill.className = "filter-pill active";
        } else {
            hiddenTypes.add(type);
            pill.className = "filter-pill hidden";
        }
        applyFilters();
    });

    filtersEl.appendChild(pill);
}

// ── Apply current filters to all rows ────────────────────────────────────────
function applyFilters() {
    for (const event of allEvents) {
        const el = elemMap.get(event.seq);
        if (el) el.style.display = isVisible(event) ? "" : "none";
    }
    updateStats();
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function updateStats() {
    const visible = allEvents.filter(isVisible).length;
    const hidden  = allEvents.length - visible;
    statsEl.textContent = `${allEvents.length} events  |  ${visible} visible` +
        (hidden > 0 ? `  (${hidden} filtered)` : "");
}

// ── Scroll helpers ────────────────────────────────────────────────────────────
function isNearBottom() {
    return eventList.scrollHeight - eventList.scrollTop - eventList.clientHeight < 100;
}

function scrollToBottom() {
    requestAnimationFrame(() => { eventList.scrollTop = eventList.scrollHeight; });
}

// ── Public API: called by the extension via webview.eval() ───────────────────
window.addEvents = function (batch) {
    if (!batch?.length) return;

    const atBottom = isNearBottom();
    if (emptyEl) emptyEl.style.display = "none";

    for (const event of batch) {
        allEvents.push(event);

        // track per-type counts for stats (future use)
        typeCounts.set(event.type, (typeCounts.get(event.type) ?? 0) + 1);

        ensureFilterPill(event.type);

        const el = renderEvent(event);
        elemMap.set(event.seq, el);
        if (!isVisible(event)) el.style.display = "none";
        eventList.appendChild(el);
    }

    updateStats();

    if (!paused && atBottom) scrollToBottom();
};

// ── Controls ──────────────────────────────────────────────────────────────────
searchEl.addEventListener("input", () => {
    searchQuery = searchEl.value.trim().toLowerCase();
    applyFilters();
});

btnPause.addEventListener("click", () => {
    paused = !paused;
    btnPause.textContent  = paused ? "▶ Resume" : "⏸ Pause";
    btnPause.classList.toggle("active", paused);
    if (!paused) scrollToBottom();
});

btnClear.addEventListener("click", () => {
    allEvents.length = 0;
    elemMap.clear();
    seenTypes.clear();
    typeCounts.clear();
    eventList.innerHTML = "";
    filtersEl.innerHTML = "";
    // Re-add streaming delta to hidden since we cleared state
    hiddenTypes.clear();
    hiddenTypes.add("assistant.streaming_delta");
    if (emptyEl) emptyEl.style.display = "";
    updateStats();
});
