---
name: setup
description: Choose where plugin-ledger keeps its auto-updated ledger of installed plugins, skills and MCP servers (a local Excel file, or a Google Sheet in Google Drive) and what to name it. Use on first run, when the session-start note says plugin-ledger isn't set up, or when the user asks to change where the ledger is kept or what it's called. For a one-off CSV/JSON copy, use plugin-ledger:export instead.
---

# plugin-ledger setup

The script is `scripts/sync.js` in this plugin: two folders up from this skill's base directory (`<base>/../../scripts/sync.js`). Use its absolute path in every command below.

## 1. Ask

Ask both questions in one `AskUserQuestion` call. Without that tool, ask in chat.

1. **Where should plugin-ledger keep the ledger?**
   - **Claude folder (Recommended):** an Excel file in `~/.claude/plugin-ledger/`. No connectors needed; it updates by itself at every session start.
   - **A folder I choose:** an Excel file in a folder the user names.
   - **Google Drive:** a Google Sheet. Needs the Google Drive connector (to create it) and the Google Sheets connector (to update it).
2. **What should it be called?**
   - **plugin-ledger (Recommended):** the default. Gives `plugin-ledger.xlsx`, or a Google Sheet named `plugin-ledger`.
   - The user can type another name in "Other".
   Tell them the name is fixed once chosen. To rename later they run setup again, which starts a new file or sheet; the old one is kept.

If the user picked **A folder I choose** and didn't give the folder in "Other", ask for its full path.

The auto-updated ledger is always Excel locally and a Google Sheet on Drive. If the user asks for CSV or JSON, explain they're on-demand exports (`/plugin-ledger:export`), so they choose the format, name and folder each time.

## 2. Save the choice

```
node "<script>" --configure --destination local [--name "<name>"] [--path "<folder>"]
node "<script>" --configure --destination drive [--name "<name>"]
```

Leave out `--name` for the default and `--path` for the Claude folder. The script creates the folder, strips an `.xlsx` extension, and rejects names containing `\ / : * ? " < > |`. If it rejects the name, ask for another.

## 3. First sync

- **Local:** run `node "<script>"` once. It writes `<name>.xlsx` in the chosen folder. Tell the user the full path in one line.
- **Google Drive:** run `node "<script>"` once, then follow the `plugin-ledger:sync` skill. It uses the sheet name saved here. If the Google Drive or Google Sheets connector is missing, say which one to connect in claude.ai → Settings → Connectors. The changes wait in `pending.json` until then.

## Switching later

Running setup again only changes where future updates go and under what name. History is kept in `~/.claude/plugin-ledger/ledger.json`, so a new local file includes past removals. A new Google Sheet starts from what's installed now. Nothing is deleted from the old file or sheet.
