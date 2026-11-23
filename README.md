# plugin-ledger

**Never forget what an AI plugin is for.**

You install a plugin or skill, use it once, and a month later you have no idea what it does or where it came from. plugin-ledger keeps a ledger of every plugin, skill and MCP server installed in **any coding agent on your machine**: Claude Code, Antigravity, Gemini CLI, opencode, GitHub Copilot and Codex. Each row has a link, install date, description and use case. When you uninstall something, its row is marked **Removed** with the date instead of being deleted, so you keep the history.

**You choose where it lives** the first time it runs:

| Destination | Formats | Needs | Updates |
|---|---|---|---|
| **Local: Claude folder** (`~/.claude/plugin-ledger/`) | Excel `.xlsx`, `.csv`, `.json` | Nothing | At every session start, by the hook itself, using no tokens |
| **Local: a folder you choose** | Excel `.xlsx`, `.csv`, `.json` | Nothing | Same as above |
| **Google Drive** | Google Sheet (`claude-plugin`) | Google Drive and Google Sheets connectors | In Claude's first turn after a change |

The Excel file is styled like a table: dark frozen header, filters on every column, banded rows, wrapped text, and green **Installed** / red **Removed**. Google Drive only supports a Google Sheet, because the Drive connector can't update a CSV or JSON file in place.

---

## What the ledger looks like

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

**Always:**

| Requirement | Why it's needed |
|---|---|
| **Claude Code** | Runs the plugin's session-start hook and skills. |
| **Node.js 18 or newer** on your `PATH` | The hook runs `node scripts/sync.js`. No npm packages are needed. |

**Only for the Google Drive destination:**

| Requirement | Why it's needed |
|---|---|
| Claude Code signed in with your **claude.ai** account | Connectors come from claude.ai. |
| **Google Drive connector** | Creates the `claude-plugin` sheet the first time. |
| **Google Sheets connector** | Adds rows, marks removals and applies the table style on later syncs. Drive alone can create a file but can't edit one. |

Connect both with the **same Google account**: the Sheets connector can only open sheets that account can access. You don't need a Google Cloud project, API keys or an Apps Script.

Other agents (Antigravity, Codex, etc.) don't need anything installed. plugin-ledger just reads their config folders. An agent that isn't installed is skipped.

---

## Setup

### 1. Install the plugin

In Claude Code:

```
/plugin marketplace add miteshviras/plugin-ledger
/plugin install plugin-ledger@plugin-ledger
```

Type each command on its own in the message box. Or, from a terminal:

```
claude plugin marketplace add miteshviras/plugin-ledger
claude plugin install plugin-ledger@plugin-ledger
```

### 2. Start a new session and pick a destination

At the next session start, Claude asks two questions before anything else:

1. **Where?** Claude folder (recommended) · a folder you choose · Google Drive
2. **Format?** Excel (recommended) · CSV · JSON (local only)

It then writes the ledger with everything already installed and tells you where it is. From then on:

- **Local:** the file is rewritten only when something is installed or removed.
- **Google Drive:** Claude updates the sheet in its first turn after a change.

Run `/plugin-ledger:setup` any time to change the destination or format.

### 3. (Google Drive only) Connect Google

1. Open **claude.ai → Settings → Connectors**.
2. Connect **Google Drive** and **Google Sheets** with the same Google account.
3. In Claude Code, run `/mcp` and check both are listed and connected.

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
hook: node scripts/sync.js ── scans every agent
   │
   ├─ not set up yet ──► Claude runs plugin-ledger:setup (asks where + format)
   │
   ├─ LOCAL ──► merges into ledger.json ──► rewrites plugin-ledger.xlsx/.csv/.json
   │            (nothing changed: does nothing; no Claude, no tokens)
   │
   └─ GOOGLE DRIVE ──► compares with synced.json
          ├─ nothing changed ──► exits silently
          └─ changes ──► writes pending.json ──► Claude runs plugin-ledger:sync
                 no sheet yet: Drive creates it from CSV
                 sheet exists: Sheets appends rows, marks removals, applies the table style
                 only if every write succeeded: sync.js --commit
```

- **Nothing is lost.** Local: if the file can't be written (for example it's open in Excel), the ledger isn't advanced and the next session retries. Drive: if Google is unreachable or a connector is missing, Claude doesn't commit, and the same changes are offered again next session.
- **Local is instant and free.** The hook writes the file itself, with no Claude turn and no connector.
- **Drive updates in your first turn, not at the moment you install.** Hooks can't call connectors, so Claude does the update.

---

## Privacy and security

- **Your ledger stays yours.** A local file stays on your machine. A Google Sheet is created in your own Drive, and plugin-ledger never shares it.
- **No secrets are written.** MCP rows record only the server URL (without its query string) or its launch command. Environment variables, HTTP headers and arguments like `--api-key`, `--header` or `TOKEN=…` are dropped.
  - Secrets are spotted by name (key, token, secret, password, auth, header, cookie). A raw token passed as an unlabeled argument would still get through, so check the MCP rows once.
- **Local paths may appear.** A local MCP server's command can include a path on your machine, such as `node C:/Users/you/project/index.js`.
- **Descriptions are treated as data.** Text from third-party plugins is written to cells as-is and never followed as instructions.
- **No network calls.** The hook script only reads local files. All Google access goes through Claude's connectors.

---

## Commands

| Command | What it does |
|---|---|
| `/plugin-ledger:setup` | Choose or change where the ledger is stored and its format |
| `/plugin-ledger:sync` | Update the Google Sheet now (Drive destination), without waiting for a new session |
| `node scripts/sync.js` | Local destination: update the file now |
| `node scripts/sync.js --configure --destination local --format xlsx\|csv\|json [--path <folder>]` | Set the destination without asking (`--destination drive` for Google Drive) |
| `node scripts/sync.js --dry-run` | Show what would be added or removed, and change nothing |
| `node scripts/sync.js --test` | Run the self-test (every agent, no-secrets check, ledger history, xlsx structure) |
| `node scripts/sync.js --csv` / `--commit` | Used by the Drive sync: export pending rows, mark them written |

State is kept in `~/.claude/plugin-ledger/`:
- `config.json`: your destination, format and folder.
- `ledger.json`: local destination's full history (every row, Installed or Removed). The output file is rebuilt from it.
- `synced.json` and `pending.json`: Drive destination; what the sheet lists as Installed, and changes waiting to be written.

To rebuild from scratch, delete `ledger.json` (local) or `synced.json` (Drive). Removal history is lost for local; Drive rows are updated, not duplicated.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Claude says the Google Sheets connector is missing | Connect **Google Sheets** in claude.ai → Settings → Connectors, check it with `/mcp`, then run `/plugin-ledger:sync`. |
| No sheet was created | Check that the **Google Drive** connector is connected (`/mcp`). Run `node scripts/sync.js --dry-run`: if it shows nothing, everything is already synced. |
| "could not write plugin-ledger.xlsx (EBUSY/EPERM)" | The file is open in Excel. Close it; the next session writes it, and nothing is lost. |
| Sheets connector says "Permission denied" | It's signed in with a different Google account than the one that owns the sheet. Reconnect Google Sheets with the same account as Google Drive. |
| `node: command not found` at session start | Install Node.js 18+ and make sure `node` is on your `PATH`. |
| A plugin from another agent is missing | Check that it's in one of the folders under [What it tracks](#what-it-tracks). Agents that store plugins elsewhere aren't covered yet. |
| A second `claude-plugin` file appeared | Keep one. Claude only creates the sheet when it can't find one titled exactly `claude-plugin`, so check whether it was renamed or moved to the trash. |

---

## Limitations

- **Updates happen at Claude Code session start.** Other agents' installs are recorded the next time you open a Claude Code session.
- **Google Drive is Google Sheet only.** The Drive connector can't update a CSV or JSON file in place, so those formats are local only.
- **Switching destination doesn't move history.** Each destination keeps its own rows; the first sync to a new one lists what's currently installed.
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
├── scripts/sync.js         # scanner, ledger, xlsx/csv/json writers, Drive handoff, self-test (no dependencies)
└── skills/
    ├── setup/SKILL.md      # asks where to store the ledger and in which format
    └── sync/SKILL.md       # how Claude writes changes to the Google Sheet
```

## License

MIT, as declared in `.claude-plugin/plugin.json`.
