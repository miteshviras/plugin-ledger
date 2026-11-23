# plugin-ledger

Keeps a Google Sheet called **claude-plugin** in your Google Drive listing every Claude Code plugin and skill you install, including the ones you later remove.

Columns: Plugin name · Type · Link (marketplace) · Installed date · Description · Use case · Status · Removed date

## Setup

1. Turn on the **Google Drive** connector for Claude Code (claude.ai → Settings → Connectors, then make sure it is enabled for Code sessions).
2. Install the plugin:
   ```
   /plugin marketplace add <path-to-this-folder>
   /plugin install plugin-ledger@plugin-ledger
   ```

At the next session start, Claude creates `claude-plugin` and fills it with everything already installed.

## How it works

1. A `SessionStart` hook runs `scripts/sync.js`. It compares what is installed (`~/.claude/plugins/installed_plugins.json` and `~/.claude/skills/`) with `~/.claude/plugin-ledger/synced.json`.
2. If nothing changed, it does nothing and costs no tokens.
3. If something changed, it writes `pending.json` and tells Claude. Before answering your first message, Claude runs the `plugin-ledger:sync` skill: it appends new rows, marks removed ones `Removed` with the date, and flips reinstalls back to `Installed`.
4. Only after the sheet update succeeds does Claude run `sync.js --commit`. If Drive is unreachable, the same changes are offered again next session.

Hooks cannot call connectors themselves, so the sheet update happens in Claude's first turn of the session, not at the moment you install.

- `/plugin-ledger:sync` updates the sheet on demand.
- `node scripts/sync.js --dry-run` shows what changed.
- `node scripts/sync.js --test` runs the self-test.
- Delete `~/.claude/plugin-ledger/synced.json` to resend everything (existing rows are updated, not duplicated).
