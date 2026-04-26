import { joinSession } from "@github/copilot-sdk/extension";
import { join } from "node:path";
import { CopilotWebview } from "./lib/copilot-webview.js";

// ── Event queue ──────────────────────────────────────────────────────────────
// Set XRAY_MAX_EVENTS=0 to disable the cap (unlimited buffering).
const MAX_EVENTS = (() => {
    const v = parseInt(process.env.XRAY_MAX_EVENTS ?? "1000", 10);
    return isNaN(v) || v < 0 ? 1000 : v;
})();

let eventQueue = [];
let flushScheduled = false;
let seqNum = 0;

// Truncate long strings so the JSON payload stays reasonable.
function safeData(data) {
    try {
        return JSON.parse(JSON.stringify(data ?? {}, (_key, val) => {
            if (typeof val === "string" && val.length > 600) return val.slice(0, 597) + "…";
            return val;
        }));
    } catch {
        return { _raw: String(data).slice(0, 600) };
    }
}

function enqueue(type, data) {
    eventQueue.push({ seq: seqNum++, type, data: safeData(data), ts: Date.now() });
    if (MAX_EVENTS > 0 && eventQueue.length > MAX_EVENTS) {
        eventQueue.splice(0, eventQueue.length - MAX_EVENTS);
    }
    scheduleFlush();
}

function scheduleFlush() {
    if (!flushScheduled) {
        flushScheduled = true;
        setImmediate(doFlush);
    }
}

async function doFlush() {
    flushScheduled = false;
    if (eventQueue.length === 0 || !webview._handle) return;
    const batch = eventQueue.splice(0);
    try {
        await webview.eval(`window.addEvents(${JSON.stringify(batch)})`, { timeoutMs: 5000 });
    } catch {
        // Page not ready yet — put events back and retry soon
        eventQueue = [...batch, ...eventQueue];
        setTimeout(scheduleFlush, 300);
    }
}

// Periodic retry in case events were queued before the page WebSocket connected
setInterval(() => {
    if (eventQueue.length > 0 && webview._handle) scheduleFlush();
}, 250);

// ── Webview ───────────────────────────────────────────────────────────────────
const webview = new CopilotWebview({
    extensionName: "copilot_xray",
    contentDir: join(import.meta.dirname, "content"),
    title: "Copilot X-Ray 🔬",
    width: 1240,
    height: 880,
    callbacks: {},
});

// ── Join session ──────────────────────────────────────────────────────────────
const session = await joinSession({
    tools: webview.tools,
    commands: [{
        name: "copilot-xray",
        description: "Open Copilot X-Ray — a live window that shows every message, tool call, MCP call, skill/plugin load event, and hook in real time.",
        handler: async () => { await webview.show(); },
    }],
    hooks: {
        onSessionStart: async (input) => {
            enqueue("hook:session_start", input);
        },
        onUserPromptSubmitted: async (input) => {
            enqueue("hook:user_prompt", { prompt: input.prompt, cwd: input.cwd, timestamp: input.timestamp });
        },
        onPreToolUse: async (input) => {
            enqueue("hook:pre_tool", input);
        },
        onPostToolUse: async (input) => {
            enqueue("hook:post_tool", input);
        },
        onSessionEnd: async (input) => {
            enqueue("hook:session_end", input);
            await new Promise(r => setTimeout(r, 900));
            webview.close();
        },
    },
});

// ── Listen to ALL raw session events ─────────────────────────────────────────
session.on((event) => {
    enqueue(event.type, event.data ?? {});
});
