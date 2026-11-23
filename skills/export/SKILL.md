---
name: export
description: Export the plugin-ledger list of installed and removed plugins, skills and MCP servers (from every coding agent on this machine) to a CSV, JSON or Excel file, with the user choosing the format, file name and folder each time. Use when the user asks to export, download, back up or share their plugin list, or wants it as CSV or JSON.
---

# plugin-ledger export

Exports run only when the user asks. Nothing writes CSV or JSON on its own. The script is `scripts/sync.js` in this plugin: `<this skill's base directory>/../../scripts/sync.js`. Use its absolute path.

## 1. Ask (every time; don't reuse last time's answers)

One `AskUserQuestion` call with three questions. Without that tool, ask in chat.

1. **Format:** CSV (opens anywhere) · JSON (for scripts and tools) · Excel .xlsx (styled table).
2. **File name:** `plugin-ledger (Recommended)`, or the user types one in "Other". The extension is added for them.
3. **Folder:** Downloads (`~/Downloads`) · this project's folder (the current working directory) · Claude folder (`~/.claude/plugin-ledger`) · or the user types a path in "Other".

## 2. Export

```
node "<script>" --export --format csv|json|xlsx --out "<folder>/<name>"
```

- If the script says the file **already exists**, ask the user: overwrite, or pick another name. Add `--overwrite` only if they say overwrite.
- A name containing `\ / : * ? " < > |` can't be a file name; ask for another.

## 3. Report

One line with the full path and the row count from the script's output. The export holds the full history plugin-ledger has recorded: Installed and Removed rows, with the Agent column.
