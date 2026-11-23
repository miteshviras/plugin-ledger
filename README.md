<p align="center">
  <img src="assets/banner.svg" alt="plugin-ledger: never forget what an AI plugin is for" width="100%">
</p>

<p align="center">
  <img alt="version 1.1.0" src="https://img.shields.io/badge/version-1.1.0-1F3A5F?style=flat-square">
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-34A853?style=flat-square">
  <img alt="Node 18+" src="https://img.shields.io/badge/node-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white">
  <img alt="zero dependencies" src="https://img.shields.io/badge/dependencies-0-64748B?style=flat-square">
  <img alt="6 agents" src="https://img.shields.io/badge/agents-6-7DD3FC?style=flat-square">
  <a href="https://www.buymeacoffee.com/miteshviras329"><img alt="Buy me a coffee" src="https://img.shields.io/badge/buy%20me%20a%20coffee-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=black"></a>
</p>

<p align="center">
  <a href="#-quick-start"><b>Quick start</b></a> ·
  <a href="#-where-your-ledger-lives"><b>Destinations</b></a> ·
  <a href="#-how-it-works"><b>How it works</b></a> ·
  <a href="#-export-csv-or-json"><b>Export</b></a> ·
  <a href="#-reference"><b>Reference</b></a>
</p>

---

You install a plugin or skill, use it once, and a month later you have no idea what it does or where it came from.

**plugin-ledger** keeps a ledger of every **plugin, skill and MCP server** installed in **any coding agent on your machine**: Claude Code, Antigravity, Gemini CLI, opencode, GitHub Copilot and Codex. Each row has a link, install date, description and use case. Uninstall something and its row is marked **Removed** with the date, so you keep the history.

## 🚀 Quick start

```
/plugin marketplace add miteshviras/plugin-ledger
/plugin install plugin-ledger@plugin-ledger
```

Type each command on its own in Claude Code's message box, or run the same thing from a terminal:

```
claude plugin marketplace add miteshviras/plugin-ledger
claude plugin install plugin-ledger@plugin-ledger
```

**Start a new session.** Claude asks two questions, then writes your ledger with everything already installed:

| | Question | Your options |
|---|---|---|
| 1️⃣ | **Where?** | Claude folder *(recommended)* · a folder you choose · Google Drive |
| 2️⃣ | **Name?** | `plugin-ledger` *(recommended)* or your own. Fixed from then on. |

That's it. Change either answer later with `/plugin-ledger:setup`.

## 📁 Where your ledger lives

| Destination | Kept as | Needs | Updates |
|---|---|---|---|
| 💻 **Claude folder** `~/.claude/plugin-ledger/` | `<name>.xlsx` | Nothing | At session start, by the hook itself. **Zero tokens.** |
| 📂 **A folder you choose** | `<name>.xlsx` | Nothing | Same as above |
| ☁️ **Google Drive** | Google Sheet `<name>` | Google Drive + Google Sheets connectors | In Claude's first turn after a change |

The Excel file looks like a real table: dark frozen header, filters on every column, banded rows, wrapped text, and 🟢 **Installed** / 🔴 **Removed**. The Google Sheet gets the same style.

<details>
<summary><b>☁️ Using Google Drive? Connect Google first</b></summary>

<br>

1. Open **claude.ai → Settings → Connectors**.
2. Connect **Google Drive** and **Google Sheets** with the **same Google account**. The Sheets connector can only open sheets that account can access.
3. In Claude Code, run `/mcp` and check both are listed and connected.

| Connector | Why |
|---|---|
| Google Drive | Creates the sheet the first time |
| Google Sheets | Adds rows, marks removals and applies the table style on later syncs. Drive alone can create a file but can't edit one. |

You don't need a Google Cloud project, API keys or an Apps Script.

</details>

## 🧾 What the ledger looks like

| Plugin name | Type | Link | Installed | Description | Use case | Status | Removed | Agent |
|---|---|---|---|---|---|---|---|---|
| `postman@claude-plugins-official` | plugin | github.com/anthropics/claude-plugins-official | 2026-10-30 | Work with Postman from your agent… | `api-testing: Use when testing an endpoint…` | 🟢 Installed | | Claude Code |
| `antigravity:plugin:firebase` | plugin | firebase.google.com | 2026-09-17 | Prototype, build & run modern apps… | `firebase_ai_logic_basics: …` | 🟢 Installed | | Antigravity |
| `agents:skill:hyperframes` | skill | github.com/heygen-com/hyperframes | 2026-08-23 | Read first to make, edit, animate… | Read first to make, edit… | 🟢 Installed | | Shared (~/.agents) |
| `copilot:mcp:Neon` | mcp | https://mcp.neon.tech/mcp | 2026-11-23 | MCP server (remote) | | 🔴 Removed | 2026-12-02 | Copilot |

- **Description:** the plugin's or skill's own description.
- **Use case:** the "Use when…" sentence from each skill. A plugin gets one line per skill.
- **Status:** reinstall something and its row switches back to Installed.

## ⚙️ How it works

<p align="center">
  <img src="assets/how-it-works.svg" alt="Agents → session-start hook → Excel ledger, Google Sheet, or on-demand CSV/JSON export" width="100%">
</p>

- **Local is instant and free.** The hook writes the Excel file itself, with no Claude turn and no connector, and only when something changed.
- **Drive updates in your first turn.** Hooks can't call connectors, so Claude does the update.
- **Nothing is lost.** If the Excel file is open, or Google is unreachable, nothing is marked as done and the next session retries.

<details>
<summary><b>Show the full flow</b></summary>

<br>

```
session starts
   │
   ▼
hook: node scripts/sync.js ── scans every agent
   │
   ├─ not set up yet ──► Claude runs plugin-ledger:setup (asks where + name)
   │
   ├─ LOCAL ──► merges into ledger.json ──► rewrites <name>.xlsx
   │            (nothing changed: does nothing; no Claude, no tokens)
   │
   └─ GOOGLE DRIVE ──► compares with synced.json
          ├─ nothing changed ──► exits silently
          └─ changes ──► writes pending.json ──► Claude runs plugin-ledger:sync
                 no sheet yet: Drive creates it from CSV
                 sheet exists: Sheets appends rows, marks removals, applies the table style
                 only if every write succeeded: sync.js --commit
```

</details>

## 📤 Export CSV or JSON

CSV and JSON are **never written automatically**. Run `/plugin-ledger:export` and Claude asks each time:

| | Choose |
|---|---|
| **Format** | CSV · JSON · Excel |
| **File name** | `plugin-ledger` *(recommended)* or your own |
| **Folder** | Downloads · this project · Claude folder · any path |

It never overwrites a file without asking. The export has the full history: Installed and Removed rows from every agent.

## 🛡️ Privacy

- **Your ledger stays yours.** Local files stay on your machine. A Google Sheet is created in your own Drive and never shared.
- **No secrets are written.** MCP rows keep only the server URL (without query string) or its launch command. Environment variables, headers, and arguments like `--api-key`, `--header` or `TOKEN=…` are dropped.
- **No network calls.** The hook only reads local files. Google access goes through Claude's connectors.

<details>
<summary>More detail</summary>

<br>

- Secrets are spotted by name (key, token, secret, password, auth, header, cookie). A raw token passed as an unlabeled argument would still get through, so check the MCP rows once.
- A local MCP server's command can include a path on your machine, such as `node C:/Users/you/project/index.js`.
- Text from third-party plugins is written to cells as-is and never followed as instructions.

</details>

---

## 📚 Reference

<details>
<summary><b>🔍 What it tracks</b>: folders read for each agent</summary>

<br>

| Agent | Plugins | Skills | MCP servers |
|---|---|---|---|
| Claude Code | `~/.claude/plugins/installed_plugins.json` | `~/.claude/skills` | `~/.claude.json` |
| Shared skills (`npx skills`) | | `~/.agents/skills` (link and date from `.skill-lock.json`) | |
| Antigravity | `~/.gemini/config/plugins` | `~/.gemini/config/skills` | `~/.gemini/config/mcp_config.json`, `~/.gemini/antigravity/mcp_config.json` |
| Gemini CLI | | `~/.gemini/skills` | `~/.gemini/settings.json` |
| opencode | `~/.config/opencode/plugins/*.ts` | `~/.config/opencode/skills` | `~/.config/opencode/opencode.jsonc` (or `.json`) |
| GitHub Copilot | | | `~/.copilot/mcp-config.json` |
| Codex | | `~/.codex/skills` | `~/.codex/config.toml` |

`~` is your home folder (`C:\Users\<you>` on Windows). Agents that aren't installed are skipped, and they don't need anything installed. A skill installed in several agents gets one row per agent.

</details>

<details>
<summary><b>✅ Requirements</b></summary>

<br>

| Requirement | Why |
|---|---|
| **Claude Code** | Runs the session-start hook and skills |
| **Node.js 18+** on your `PATH` | The hook runs `node scripts/sync.js`. No npm packages. |
| *Google Drive only:* claude.ai sign-in, **Google Drive** and **Google Sheets** connectors (same account) | Create and update the sheet |

</details>

<details>
<summary><b>⌨️ Commands</b></summary>

<br>

| Command | What it does |
|---|---|
| `/plugin-ledger:setup` | Choose or change where the ledger is stored and its name |
| `/plugin-ledger:sync` | Update the Google Sheet now (Drive destination) |
| `/plugin-ledger:export` | Export a CSV, JSON or Excel copy; you choose format, name and folder |
| `node scripts/sync.js` | Local destination: update the file now |
| `node scripts/sync.js --configure --destination local\|drive [--name <name>] [--path <folder>]` | Set destination and name without asking |
| `node scripts/sync.js --export --format csv\|json\|xlsx --out <file> [--overwrite]` | Export without asking. Refuses to replace a file unless `--overwrite`. |
| `node scripts/sync.js --dry-run` | Show what would be added or removed; changes nothing |
| `node scripts/sync.js --test` | Self-test: every agent, no-secrets check, ledger history, xlsx structure |
| `node scripts/sync.js --csv` / `--commit` | Used by the Drive sync: export pending rows, mark them written |

**State** lives in `~/.claude/plugin-ledger/`:

- `config.json`: destination, name and folder.
- `ledger.json`: full history (Installed and Removed) for both destinations. The Excel file and every export are built from it.
- `synced.json` and `pending.json`: Drive only. What the sheet lists as Installed, and changes waiting to be written.

To rebuild from scratch, delete `ledger.json` (local) or `synced.json` (Drive). Local removal history is lost; Drive rows are updated, not duplicated.

</details>

<details>
<summary><b>🩺 Troubleshooting</b></summary>

<br>

| Symptom | Fix |
|---|---|
| Claude says the Google Sheets connector is missing | Connect **Google Sheets** in claude.ai → Settings → Connectors, check `/mcp`, then run `/plugin-ledger:sync`. |
| Sheets says "Permission denied" | It's signed in with a different Google account than the sheet's owner. Reconnect it with the same account as Google Drive. |
| No sheet was created | Check the **Google Drive** connector in `/mcp`. If `node scripts/sync.js --dry-run` shows nothing, everything is already synced. |
| "could not write <name>.xlsx (EBUSY/EPERM)" | The file is open in Excel. Close it; the next session writes it, and nothing is lost. |
| Export says the file already exists | Choose overwrite or a different name when Claude asks. |
| `node: command not found` at session start | Install Node.js 18+ and make sure `node` is on your `PATH`. |
| A plugin from another agent is missing | Check it's in a folder listed under **What it tracks**. Agents that store plugins elsewhere aren't covered yet. |
| A second sheet with your ledger's name appeared | Keep one. Claude only creates the sheet when it can't find one with exactly the name chosen at setup, so check whether it was renamed or moved to the trash. |

</details>

<details>
<summary><b>⚠️ Limitations</b></summary>

<br>

- **Updates happen at Claude Code session start.** Other agents' installs are recorded the next time you open a Claude Code session.
- **The auto-updated ledger is Excel or a Google Sheet.** CSV and JSON are on-demand exports only. The Drive connector can't update CSV or JSON files in place.
- **Switching destination doesn't move history.** A new Google Sheet starts from what's installed now.
- **MCP install dates are approximate:** the first time plugin-ledger saw the server.
- **Skill install dates may be approximate** for skills not installed through `npx skills` (folder creation date).
- **Codex support** is covered by the self-test only.
- **Cell size:** cells are capped at 45,000 characters, and each skill's use case is cut to its first sentence (200 characters).

</details>

<details>
<summary><b>🗂️ Project layout</b></summary>

<br>

```
plugin-ledger/
├── .claude-plugin/
│   ├── plugin.json         # plugin manifest
│   └── marketplace.json    # lets /plugin marketplace add install it
├── assets/                 # logo, banner and diagram (animated SVG)
├── hooks/hooks.json        # SessionStart → node scripts/sync.js
├── scripts/sync.js         # scanner, ledger, xlsx writer, exports, Drive handoff, self-test (no dependencies)
└── skills/
    ├── setup/SKILL.md      # asks where to keep the ledger and what to name it
    ├── sync/SKILL.md       # how Claude writes changes to the Google Sheet
    └── export/SKILL.md     # on-demand CSV / JSON / Excel export
```

</details>

---

<p align="center">
  <b>Finding plugin-ledger useful?</b><br><br>
  <a href="https://www.buymeacoffee.com/miteshviras329"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=miteshviras329&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="48"></a>
</p>

<p align="center">
  <img src="assets/logo.svg" alt="plugin-ledger logo" width="72"><br>
  <sub>MIT licensed (see <code>.claude-plugin/plugin.json</code>) · made for people who install too many plugins</sub>
</p>
