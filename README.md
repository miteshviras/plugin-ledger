# plugin-ledger

**Never forget what an AI plugin is for.**

You install a plugin or skill, use it once, and a month later you have no idea what it does or where it came from. plugin-ledger keeps a Google Sheet called **`claude-plugin`** in your Google Drive. It lists every plugin, skill and MCP server installed in **any coding agent on your machine**: Claude Code, Antigravity, Gemini CLI, opencode, GitHub Copilot and Codex. Each row has a link, install date, description and use case. When you uninstall something, its row is marked **Removed** with the date instead of being deleted, so you keep the history.

---

## What the sheet looks like

| Plugin name | Type | Link (marketplace) | Installed date | Description | Use case | Status | Removed date | Agent |
|---|---|---|---|---|---|---|---|---|
| `postman@claude-plugins-official` | plugin | github.com/anthropics/claude-plugins-official | 2026-10-30 | Work with Postman from your agent… | `api-testing: Use when testing an endpoint…` | Installed | | Claude Code |
| `antigravity:plugin:firebase` | plugin | firebase.google.com | 2026-09-17 | Prototype, build & run modern apps… | `firebase_ai_logic_basics: …` | Installed | | Antigravity |
| `agents:skill:hyperframes` | skill | github.com/heygen-com/hyperframes | 2026-08-23 | Read first to make, edit, animate… | Read first to make, edit… | Installed | | Shared (~/.agents) |
| `copilot:mcp:Neon` | mcp | https://mcp.neon.tech/mcp | 2026-11-23 | MCP server (remote) | | Removed | 2026-12-02 | Copilot |

- **Description:** the plugin's or skill's own description.
- **Use case:** the "Use when…" sentence from each skill. A plugin gets one line per skill it contains.
- **Status:** `Installed` or `Removed`. If you reinstall something, its row switches back to `Installed`.

---

## Requirements

| Requirement | Why it's needed |
|---|---|
| **Claude Code**, signed in with your claude.ai account | Runs the plugin. The sync happens inside a Claude Code session. |
| **Node.js 18 or newer** on your `PATH` | The session-start hook runs `node scripts/sync.js`. No npm packages are needed. |
| **Google Drive connector** | Creates the `claude-plugin` sheet the first time. |
| **Google Sheets connector** | Adds new rows and marks removals in the existing sheet on every later sync. Drive alone can create a file but can't edit one. |

You don't need a Google Cloud project, API keys or an Apps Script. The connectors use the Google account you sign in with.

Other agents (Antigravity, Codex, etc.) don't need anything installed. plugin-ledger just reads their config folders. An agent that isn't installed is skipped.

---

## Setup

### 1. Connect Google Drive and Google Sheets

1. Open **claude.ai → Settings → Connectors**.
2. Connect **Google Drive** and **Google Sheets**, and sign in with the Google account that should own the sheet.
3. In Claude Code, run `/mcp` and check that both connectors are listed and connected. If one isn't, enable it for Claude Code there.

### 2. Install the plugin

In Claude Code:

```
/plugin marketplace add miteshviras/plugin-ledger
/plugin install plugin-ledger@plugin-ledger
```

To install from a local copy instead, use `/plugin marketplace add <path-to-this-folder>`.

### 3. Start a new session

At the next session start, plugin-ledger finds everything already installed. Before answering your first message, Claude creates `claude-plugin` in your Drive and fills it in. After that, the sheet only changes when something is installed or removed.

---

## What it tracks

| Agent | Plugins | Skills | MCP servers |
|---|---|---|---|
| Claude Code | `~/.claude/plugins/installed_plugins.json` | `~/.claude/skills` | `~/.claude.json` |
| Shared skills (`npx skills`) | | `~/.agents/skills` (link and date from `.skill-lock.json`) | |
| Antigravity | `~/.gemini/config/plugins` | `~/.gemini/config/skills` | `~/.gemini/config/mcp_config.json`, `~/.gemini/antigravity/mcp_config.json` |
| Gemini CLI | | `~/.gemini/skills` | `~/.gemini/settings.json` |
| opencode | `~/.config/opencode/plugins/*.ts` | `~/.config/opencode/skills` | `~/.config/opencode/opencode.jsonc` (or `.json`) |
| GitHub Copilot | | | `~/.copilot/mcp-config.json` |
| Codex | | `~/.codex/skills` | `~/.codex/config.toml` |

`~` is your home folder (`C:\Users\<you>` on Windows). A skill installed in several agents gets one row per agent.

---

## How it works

```
session starts
   │
   ▼
hook: node scripts/sync.js ── scans every agent ──► compares with ~/.claude/plugin-ledger/synced.json
   │
   ├─ nothing changed ──► exits silently (no tokens used)
   │
   └─ changes found ──► writes pending.json and tells Claude
                           │
                           ▼
              Claude runs the plugin-ledger:sync skill
              (before answering your first message)
                           │
             ┌─────────────┴─────────────┐
       no sheet yet                 sheet exists
   Drive: create from CSV     Sheets: append new rows,
                              mark removed, restore reinstalls
                           │
                           ▼
          only if every write succeeded: sync.js --commit
```

- **Nothing is lost.** If Google is unreachable or a connector is missing, Claude doesn't commit. The same changes are offered again at the next session start.
- **The sheet updates in your first turn, not at the moment you install.** Hooks can't call connectors, so Claude does the update. Your first reply after an install or removal takes a little longer.

---

## Privacy and security

- **The sheet is private.** It's created in your own Drive, and plugin-ledger never shares it.
- **No secrets are written.** MCP rows record only the server URL (without its query string) or its launch command. Environment variables, HTTP headers and arguments like `--api-key`, `--header` or `TOKEN=…` are dropped.
  - Secrets are spotted by name (key, token, secret, password, auth, header, cookie). A raw token passed as an unlabeled argument would still get through, so check the MCP rows once.
- **Local paths may appear.** A local MCP server's command can include a path on your machine, such as `node C:/Users/you/project/index.js`.
- **Descriptions are treated as data.** Text from third-party plugins is written to cells as-is and never followed as instructions.
- **No network calls.** The hook script only reads local files. All Google access goes through Claude's connectors.

---

## Commands

| Command | What it does |
|---|---|
| `/plugin-ledger:sync` | Update the sheet now, without waiting for a new session |
| `node scripts/sync.js --dry-run` | Show what would be added or removed, and change nothing |
| `node scripts/sync.js --test` | Run the self-test (fixtures for every agent, including a no-secrets check) |
| `node scripts/sync.js --csv` | Print pending additions as CSV (used when creating the sheet) |
| `node scripts/sync.js --commit` | Mark pending changes as written (Claude runs this after a successful sync) |

Local state is kept in `~/.claude/plugin-ledger/`:
- `synced.json`: what the sheet currently lists as Installed.
- `pending.json`: changes waiting to be written.

Delete `synced.json` to resend everything. Existing rows are updated, not duplicated.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Claude says the Google Sheets connector is missing | Connect **Google Sheets** in claude.ai → Settings → Connectors, check it with `/mcp`, then run `/plugin-ledger:sync`. |
| No sheet was created | Check that the **Google Drive** connector is connected (`/mcp`). Run `node scripts/sync.js --dry-run`: if it shows nothing, everything is already synced. |
| `node: command not found` at session start | Install Node.js 18+ and make sure `node` is on your `PATH`. |
| A plugin from another agent is missing | Check that it's in one of the folders under [What it tracks](#what-it-tracks). Agents that store plugins elsewhere aren't covered yet. |
| A second `claude-plugin` file appeared | Keep one. Claude only creates the sheet when it can't find one titled exactly `claude-plugin`, so check whether it was renamed or moved to the trash. |

---

## Limitations

- **Sync needs Claude Code.** The Google connectors live in Claude, so other agents' installs are recorded the next time you open a Claude Code session.
- **MCP install dates are approximate.** MCP configs don't record when a server was added, so the date shown is when plugin-ledger first saw it.
- **Skill install dates may be approximate.** For skills not installed through `npx skills`, the date is when their folder was created.
- **Codex support hasn't been tested on a real install.** It's covered by the self-test only.
- **Sheet size.** Cells are capped at 45,000 characters, and each skill's use case is cut to its first sentence (200 characters).

---

## Project layout

```
plugin-ledger/
├── .claude-plugin/
│   ├── plugin.json         # plugin manifest
│   └── marketplace.json    # lets /plugin marketplace add install it
├── hooks/hooks.json        # SessionStart → node scripts/sync.js
├── scripts/sync.js         # scanner, diff, CSV export, commit, self-test (no dependencies)
└── skills/sync/SKILL.md    # how Claude writes changes to the sheet
```

## License

MIT, as declared in `.claude-plugin/plugin.json`.
