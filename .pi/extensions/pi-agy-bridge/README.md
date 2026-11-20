# pi-agy-bridge

A lean, ToS-compliant **Antigravity ACP Bridge** for the **Pi coding agent**.

Provides seamless access to `gemini-3.8-flash`, `gemini-4-argon`, and other Antigravity subscription models in Pi without third-party OAuth extraction or headless automation risks.

---

## Highlights

- **Lean Architecture (~650 lines vs 15,300+ lines in older bridges):** Zero `stream-json` (`agy -p`) bloat, zero SQLite scraping, zero ANSI patch repair, and no background `AskAntigravity` quota burns.
- **Strictly ToS-Compliant:** Uses the official Google Agent Client Protocol (`agy acp`) stdio server. Authentication is handled natively by Google `agy` (`oauth-personal` via your Google AI Pro subscription).
- **Flawless MCP Tool Delegation (G9 Round-Trip):** Custom Pi tools (`curriculum`, `arena_run`, `arena_ledger`, `ladder`, `catalog`, `course`, `browser_fetch`, `quiz`, `subagent`, `ask_user_question`) run 100% inside Pi.
- **180s Timeout Protection:** Prevents `agy`'s client timeout from dropping long-running tools (like subagents or human confirmations) via automatic early-ack and `bridge_poll_result` polling.
- **RBAC Shell Gating:** Intercepts `session/request_permission` on shell executions (`run_command`), automatically blocking dangerous destructive patterns and protected ledger overwrites.
- **Native System Prompt Append:** Injects instructions directly through `_meta.antigravity.systemPrompt.append` without creating mock agent files on disk.
- **Exact Token Accounting:** Consumes authoritative `PromptResponse.usage` on every turn directly from `agy 1.5.7+`.

---

## File Structure

```
pi-agy-bridge/
├── package.json               # Package definition & MCP dependency
├── index.ts                   # Pi extension entry point (registers "antigravity" provider)
├── src/
│   ├── types.ts               # Core protocol and bridge types
│   ├── frame-guard.ts         # Stdio line buffering and frame ceiling
│   ├── jsonrpc.ts             # Hardened newline-delimited JSON-RPC 2.0 client
│   ├── bridge-catalog.ts      # Filters Pi tools (excludes builtins, exposes custom tools)
│   ├── rbac-permission.ts     # ACP session/request_permission shell command evaluator
│   ├── mcp-server.ts          # Streamable HTTP MCP server with escalation polling
│   ├── acp-connection.ts      # Child process manager for `agy acp`
│   ├── acp-driver.ts          # Pi turn coordinator, streaming deltas & tool roundtrips
│   └── sessions.ts            # Atomic session store (~/.pi/agent/antigravity-bridge/sessions.json)
└── tests/
    ├── bridge.test.ts         # Unit tests (JSON-RPC, catalog filter, RBAC gating, store)
    └── e2e.test.ts            # Live E2E test against live agy acp binary
```

---

## Installation & Setup

### 1. Requirements
- Node.js 22+ (verified on Node v24.14.0)
- Google `agy` CLI installed and logged in (`agy login`)
- `@modelcontextprotocol/sdk` installed

### 2. Copy to Pi Extensions
You can copy this folder to either:
1. **Global Extension (all Pi sessions):**
   ```bash
   cp -r /mnt/c/Users/tssha/OneDrive/Desktop/curriculum-ledger/pi-agy-bridge ~/.pi/agent/extensions/agy-bridge
   ```
2. **Workspace Extension (course vault only):**
   ```bash
   cp -r /mnt/c/Users/tssha/OneDrive/Desktop/curriculum-ledger/pi-agy-bridge /mnt/c/Users/tssha/OneDrive/Desktop/brain/learn/.pi/extensions/agy-bridge
   ```

### 3. Running Tests
Run the automated test suite anytime inside WSL:
```bash
# Unit tests
node --experimental-strip-types --test tests/bridge.test.ts

# Live end-to-end integration test (requires logged-in agy CLI)
node --experimental-strip-types --test tests/e2e.test.ts
```

---

## Selecting Models in Pi

Once installed, open Pi and pick an Antigravity model:
- `antigravity/gemini-3.8-flash`
- `antigravity/gemini-4-argon`
- `antigravity/claude-sonnet-5-5`

Run `/agy` in the Pi prompt to inspect connection status and active MCP port.
