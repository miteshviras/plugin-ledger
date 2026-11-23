---
name: setup
description: Choose where plugin-ledger keeps its ledger of installed plugins, skills and MCP servers (a local file, or a Google Sheet in Google Drive) and, for a local file, its format (Excel, CSV or JSON). Use on first run, when the session-start note says plugin-ledger isn't set up, or when the user asks to change where or how the ledger is stored.
---

# plugin-ledger setup

The script is `scripts/sync.js` in this plugin: two folders up from this skill's base directory (`<base>/../../scripts/sync.js`). Use its absolute path in every command below.

## 1. Ask

Ask both questions in one `AskUserQuestion` call. Without that tool, ask in chat.

1. **Where should plugin-ledger keep the ledger?**
   - **Claude folder (Recommended):** a local file in `~/.claude/plugin-ledger/`. No connectors needed; it updates by itself at every session start.
   - **A folder I choose:** a local file in a folder the user names.
   - **Google Drive:** a Google Sheet called `claude-plugin`. Needs the Google Drive connector (to create it) and the Google Sheets connector (to update it).
2. **Which format?** (ignored for Google Drive, which is always a Google Sheet)
   - **Excel (.xlsx) (Recommended):** a styled table with a frozen header, filters, banded rows, and green/red Status.
   - **CSV:** plain text, opens anywhere.
   - **JSON:** for scripts and other tools.

If the user picked **A folder I choose** and didn't give the folder in "Other", ask for its full path.

## 2. Save the choice

```
node "<script>" --configure --destination local --format xlsx|csv|json [--path "<folder>"]
node "<script>" --configure --destination drive
```

Leave out `--path` for the Claude folder. The script creates the folder if needed and rejects anything else.

## 3. First sync

- **Local:** run `node "<script>"` once. It writes `plugin-ledger.<format>` in the chosen folder. Tell the user the full path in one line.
- **Google Drive:** run `node "<script>"` once, then follow the `plugin-ledger:sync` skill. If the Google Drive or Google Sheets connector is missing, say which one to connect in claude.ai → Settings → Connectors. The changes wait in `pending.json` until then.

## Switching later

Running setup again only changes where future updates go. Each destination keeps its own history: local files are built from `~/.claude/plugin-ledger/ledger.json`, and the Google Sheet keeps its own rows. The first sync to a new destination lists everything currently installed. Nothing is deleted from the old destination.
