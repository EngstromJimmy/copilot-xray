# Copilot X-Ray 🔬

A GitHub Copilot CLI extension that opens a native desktop window showing **every event happening inside your session in real time** — messages, tool calls, MCP calls, skill/plugin loads, hooks, permissions, errors, and more.

![Copilot X-Ray screenshot showing a live event feed](screenshot.png)

> **Want to see when skills, agents, plug-ins, and MCP servers get loaded into the context?**  
> X-Ray shows you the raw wire — no filtering, no summaries, just the truth.

---

## Features

- **Live event feed** — auto-opens when your session starts, streams every event as it happens
- **All event types** covered: `user.message`, `assistant.message`, `tool.execution_start/complete`, `hook:pre_tool`, `hook:post_tool`, `hook:session_start/end`, `permission.requested`, `session.error`, `session.shutdown`, and every other event the SDK emits
- **Filter pills** — auto-generated per event type; click to show/hide categories
- **Full-text search** — searches across type name and raw JSON payload
- **Expandable raw JSON** — click any row to see the complete event data with syntax highlighting
- **Pause / Resume** — freeze auto-scroll to inspect events; resume to catch up
- **Clear** — wipe the feed and start fresh
- **Zoom** — use `Ctrl`+`scroll` or `Ctrl`+`+`/`-` to zoom the window in or out
- `assistant.streaming_delta` hidden by default (very noisy) — toggle it back on via its filter pill

---

## Requirements

- GitHub Copilot CLI installed and authenticated
- **Experimental features enabled** — X-Ray relies on APIs that are currently behind the experimental flag. Run `gh copilot config` and enable experimental features before installing.
- Windows (uses WebView2 / Edge), macOS (WKWebView), or Linux (webkit2gtk)
- Node.js 20+

---

## Installation

### Option A — Add to a specific project (recommended)

Clone the repo contents into your project's `.github/extensions/copilot-xray/` directory:

```bash
# from your project root
mkdir -p .github/extensions/copilot-xray
gh repo clone EngstromJimmy/copilot-xray .github/extensions/copilot-xray
```

Copilot CLI discovers and loads it automatically the next time you open a session in that repo.

### Option B — Clone manually

```bash
git clone https://github.com/EngstromJimmy/copilot-xray
```

Then copy the cloned folder to `.github/extensions/copilot-xray/` inside any project you want to use X-Ray in.

> **Note on `/plugin install`:** The Copilot CLI plugin system does not currently support auto-loading JS extensions from installed plugin directories. Until that bridge exists, placing the extension directly in `.github/extensions/` is the reliable install path.

---

## Usage

Once installed, X-Ray **auto-opens** when a session starts. You can also open it manually:

```
/copilot-xray
```

The agent can also open, evaluate JS in, or close the window via three registered tools:

| Tool | What it does |
|---|---|
| `copilot_xray_show` | Open the window (idempotent; pass `reload: true` to refresh) |
| `copilot_xray_eval` | Evaluate JavaScript inside the window |
| `copilot_xray_close` | Close the window |

---

## How it works

X-Ray is a Copilot CLI extension built on top of [`copilot-webview`](https://github.com/SteveSandersonMS/copilot-webview-creator). It:

1. Hooks into `onSessionStart`, `onUserPromptSubmitted`, `onPreToolUse`, `onPostToolUse`, and `onSessionEnd`
2. Subscribes to **all** raw session events via `session.on((event) => ...)`
3. Buffers events until the WebSocket connection to the page is ready, then flushes in batches
4. Pushes batches into the webview page via `webview.eval('window.addEvents(...)')`
5. The vanilla JS page renders each event as an expandable row with syntax-highlighted JSON

```
Copilot CLI
    │
    ├─ hooks (onPreToolUse, onPostToolUse, …)   ───┐
    └─ session.on(ALL events)                   ───┤
                                                   ↓
                                           extension process
                                           (buffers + flushes)
                                                   │ WebSocket
                                                   ↓
                                           X-Ray webview window
                                           (live event feed)
```

---

## Development

```bash
git clone https://github.com/EngstromJimmy/copilot-xray
cd copilot-xray
npm install
```

Drop the folder into `.github/extensions/copilot-xray/` of any git repo, then open Copilot CLI there. Use `/copilot-xray` to open the window.

After editing files, run `/reload-extensions` (or type `extensions_reload` in your agent session) to pick up changes without restarting Copilot CLI.

**Editing the UI** (`content/`): vanilla HTML/JS/CSS — no build step. Just reload the window with `copilot_xray_show` with `reload: true`.

**Editing the extension logic** (`main.mjs`): reload extensions after saving.

---

## License

MIT