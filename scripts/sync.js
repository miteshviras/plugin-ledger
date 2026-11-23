#!/usr/bin/env node
// plugin-ledger: on SessionStart, diff installed plugins/skills against the last sync and ask Claude to update the Drive sheet.
// Usage: sync.js            normal run (hook)
//        sync.js --dry-run  print what changed, write nothing
//        sync.js --commit   mark pending.json as written to the sheet
//        sync.js --csv      print pending additions as CSV (for creating the sheet)
//        sync.js --test     self-test on a fixture
const fs = require('fs');
const path = require('path');
const os = require('os');

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };

// Pull `description:` out of SKILL.md frontmatter (plain, quoted, or | / > block).
function skillDescription(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return '';
  const lines = fm[1].split(/\r?\n/);
  const i = lines.findIndex(l => /^description:/.test(l));
  if (i < 0) return '';
  const v = lines[i].replace(/^description:\s*/, '').trim();
  if (/^[|>][-+]?$/.test(v)) {
    const block = [];
    for (const l of lines.slice(i + 1)) { if (/^\s+\S/.test(l) || l.trim() === '') block.push(l.trim()); else break; }
    return block.join(' ').trim();
  }
  return v.replace(/^(['"])(.*)\1$/, '$2').replace(/\\"/g, '"');
}

// Frontmatter `name:`, else the folder name (a root-level SKILL.md sits in a version folder like 3.1.0).
function skillName(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  const m = text.match(/^---\r?\n[\s\S]*?^name:\s*['"]?([^'"\r\n]+)/m);
  return m ? m[1].trim() : path.basename(path.dirname(file));
}

// The "when to use it" part of a description, else the whole description.
function useCaseOf(desc) {
  const m = desc.match(/\b(Use (?:this|it|when|for|on|to)\b|Activate for|Triggers? (?:on|include))[\s\S]*/i);
  // First sentence only, so a plugin with 30 skills still fits in a readable cell.
  const s = (m ? m[0] : desc).trim().split(/(?<=\.)\s/)[0];
  return s.length > 200 ? s.slice(0, 199) + "…" : s;
}

function findSkillFiles(dir, depth = 3) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isFile() && e.name === 'SKILL.md') out.push(path.join(dir, e.name));
    else if (e.isDirectory() && depth > 0 && e.name !== 'node_modules' && !e.name.startsWith('.')) out.push(...findSkillFiles(path.join(dir, e.name), depth - 1));
  }
  return out;
}

function marketplaceLink(src, homepage) {
  if (src?.repo) return `https://github.com/${src.repo}`;
  if (src?.url) return src.url.replace(/\.git$/, '');
  return homepage || '';
}

// shortcut: Sheets cells cap at 50,000 chars; we cut at 45,000 and stop there.
const cap = s => (s.length > 45000 ? s.slice(0, 45000) + '…' : s);

const birth = p => { const st = fs.statSync(p); return (st.birthtime.getTime() ? st.birthtime : st.mtime).toISOString(); };
const subdirs = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() || d.isSymbolicLink()).map(d => d.name); } catch { return []; } };

// One "skill: use case" line per skill in a plugin folder.
function pluginUseCase(root, fallbackDesc) {
  // Hidden dirs (.claude, .cursor-plugin) hold the repo's own dev skills or mirrors; skip them and dedupe by name.
  const byName = new Map(findSkillFiles(root).map(f => [skillName(f), skillDescription(f)]).reverse());
  const lines = [...byName].reverse().filter(([, d]) => d).map(([n, d]) => `${n}: ${useCaseOf(d)}`);
  return cap(lines.join('\n') || useCaseOf(fallbackDesc || ''));
}

function claudePlugins(home, agent) {
  const pluginsDir = path.join(home, '.claude', 'plugins');
  const installed = readJson(path.join(pluginsDir, 'installed_plugins.json'), { plugins: {} }).plugins || {};
  const markets = readJson(path.join(pluginsDir, 'known_marketplaces.json'), {});
  return Object.entries(installed).filter(([, i]) => i[0]).map(([key, [inst]]) => {
    const manifest = readJson(path.join(inst.installPath, '.claude-plugin', 'plugin.json'), {});
    return {
      name: key, agent, type: 'plugin',
      link: marketplaceLink(markets[key.split('@')[1]]?.source, manifest.homepage),
      installedAt: inst.installedAt || '',
      description: cap(manifest.description || ''),
      useCase: pluginUseCase(inst.installPath, manifest.description),
    };
  });
}

// Folders that each hold a plugin.json (Antigravity's ~/.gemini/config/plugins).
function pluginDirRows(dir, agent, prefix) {
  return subdirs(dir).filter(n => fs.existsSync(path.join(dir, n, 'plugin.json'))).map(n => {
    const m = readJson(path.join(dir, n, 'plugin.json'), {});
    const repo = typeof m.repository === 'string' ? m.repository : m.repository?.url;
    return { name: `${prefix}plugin:${n}`, agent, type: 'plugin', link: gitLink(m.homepage || repo), installedAt: birth(path.join(dir, n)), description: cap(m.description || ''), useCase: pluginUseCase(path.join(dir, n), m.description) };
  });
}

// Single-file plugins (opencode's plugins/*.ts): the first line of the leading /** doc comment is the description.
function pluginFileRows(dir, agent, prefix) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /\.[jt]s$/.test(f)); } catch {}
  return files.map(f => {
    const desc = (fs.readFileSync(path.join(dir, f), 'utf8').match(/\/\*\*\s*\r?\n\s*\*\s*(.+)/) || [])[1] || '';
    return { name: `${prefix}plugin:${f}`, agent, type: 'plugin', link: '', installedAt: birth(path.join(dir, f)), description: desc.trim(), useCase: useCaseOf(desc.trim()) };
  });
}

// Each subfolder with a SKILL.md is a skill. Link and date come from the `npx skills` lock file when it lists the skill.
function skillRows(dir, agent, prefix, lock) {
  return subdirs(dir).filter(n => fs.existsSync(path.join(dir, n, 'SKILL.md'))).map(n => {
    const desc = skillDescription(path.join(dir, n, 'SKILL.md'));
    const l = lock[n];
    return { name: `${prefix}skill:${n}`, agent, type: 'skill', link: gitLink(l?.sourceUrl), installedAt: l?.installedAt || birth(path.join(dir, n)), description: cap(desc), useCase: cap(useCaseOf(desc)) };
  });
}

// Never record env, headers, query strings or secret-looking args: MCP configs often hold API keys.
// shortcut: secrets are spotted by name (key/token/secret/password/bearer); a bare unlabeled token arg would slip through.
const SECRET = /key|token|secret|passw|bearer|auth|header|cookie/i;
function mcpTarget(s) {
  const url = s.url || s.serverUrl || s.httpUrl;
  if (url) { try { const u = new URL(url); return u.origin + u.pathname; } catch { return ''; } }
  const parts = Array.isArray(s.command) ? s.command : [s.command, ...(s.args || [])];
  return parts.filter((a, i) => a && !a.includes('=') && !SECRET.test(a) && !(i > 0 && SECRET.test(parts[i - 1] || ''))).join(' ');
}

function mcpRows(servers, agent, prefix) {
  return Object.entries(servers || {}).map(([n, s]) => ({
    name: `${prefix}mcp:${n}`, agent, type: 'mcp', link: mcpTarget(s),
    installedAt: '', // configs carry no per-server date; main() fills in when it was first seen
    description: `MCP server (${s.url || s.serverUrl || s.httpUrl ? 'remote' : 'local'})`, useCase: '',
  }));
}

// shortcut: strips // and /* */ comments only; trailing commas in a .jsonc file would make it unreadable (skipped).
const readJsonc = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')); } catch { return fb; } };

// Codex keeps MCP servers in TOML: [mcp_servers.name] with command / args / url keys.
function codexMcp(file) {
  let t = '';
  try { t = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  const out = {};
  for (const m of t.matchAll(/^\[mcp_servers\.("?)([^"\]]+)\1\][^\S\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm)) {
    if (m[2].includes('.')) continue; // sub-tables like [mcp_servers.x.env]
    const get = k => (m[3].match(new RegExp(`^${k}\\s*=\\s*(.+)$`, 'm')) || [])[1];
    const str = v => v && v.trim().replace(/^"(.*)"$/, '$1');
    out[m[2]] = { command: str(get('command')), url: str(get('url')), args: (get('args')?.match(/"[^"]*"/g) || []).map(a => a.slice(1, -1)) };
  }
  return out;
}

const gitLink = u => (u || '').replace(/\.git$/, '');

function collect(home) {
  const h = (...p) => path.join(home, ...p);
  const lock = readJson(h('.agents', '.skill-lock.json'), {}).skills || {};
  const gemini = f => readJson(h('.gemini', ...f), {}).mcpServers;
  return [
    // Claude Code keys stay unprefixed so rows already in the sheet keep matching.
    ...claudePlugins(home, 'Claude Code'),
    ...skillRows(h('.claude', 'skills'), 'Claude Code', '', lock),
    ...mcpRows(readJson(h('.claude.json'), {}).mcpServers, 'Claude Code', 'claude:'),
    ...skillRows(h('.agents', 'skills'), 'Shared (~/.agents)', 'agents:', lock),
    ...pluginDirRows(h('.gemini', 'config', 'plugins'), 'Antigravity', 'antigravity:'),
    ...skillRows(h('.gemini', 'config', 'skills'), 'Antigravity', 'antigravity:', lock),
    ...mcpRows({ ...gemini(['antigravity', 'mcp_config.json']), ...gemini(['config', 'mcp_config.json']) }, 'Antigravity', 'antigravity:'),
    ...skillRows(h('.gemini', 'skills'), 'Gemini CLI', 'gemini:', lock),
    ...mcpRows(gemini(['settings.json']), 'Gemini CLI', 'gemini:'),
    ...pluginFileRows(h('.config', 'opencode', 'plugins'), 'opencode', 'opencode:'),
    ...skillRows(h('.config', 'opencode', 'skills'), 'opencode', 'opencode:', lock),
    ...mcpRows(readJsonc(h('.config', 'opencode', 'opencode.jsonc'), null)?.mcp || readJson(h('.config', 'opencode', 'opencode.json'), {}).mcp, 'opencode', 'opencode:'),
    ...mcpRows(readJson(h('.copilot', 'mcp-config.json'), {}).mcpServers, 'Copilot', 'copilot:'),
    ...skillRows(h('.codex', 'skills'), 'Codex', 'codex:', lock),
    ...mcpRows(codexMcp(h('.codex', 'config.toml')), 'Codex', 'codex:'),
  ];
}

// Agent is last so sheets created before it existed only gain a column.
const HEADER = ['Plugin name', 'Type', 'Link (marketplace)', 'Installed date', 'Description', 'Use case', 'Status', 'Removed date', 'Agent'];
// Leading = + - @ would be parsed as a formula on import, so prefix a space.
const cell = v => { const s = String(v ?? '').replace(/^([=+\-@])/, ' $1'); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function toCsv(rows) {
  const lines = rows.map(r => [r.name, r.type, r.link, (r.installedAt || '').slice(0, 10), r.description, r.useCase, 'Installed', '', r.agent].map(cell).join(','));
  return [HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}

// What changed since the last sync: rows to add, names to mark removed.
function diff(rows, synced) {
  const now = new Set(rows.map(r => r.name));
  return { added: rows.filter(r => !synced.includes(r.name)), removed: synced.filter(n => !now.has(n)) };
}

function main() {
  const home = os.homedir();
  const dir = path.join(home, '.claude', 'plugin-ledger');
  const syncedFile = path.join(dir, 'synced.json'); // names currently "Installed" in the sheet
  const pendingFile = path.join(dir, 'pending.json');
  const synced = readJson(syncedFile, []);

  if (process.argv.includes('--csv')) {
    // Pending additions as a CSV that Drive converts into the claude-plugin sheet on upload.
    const p = readJson(pendingFile, { added: [] });
    return process.stdout.write(toCsv(p.added));
  }

  if (process.argv.includes('--commit')) {
    // Claude runs this only after the sheet update succeeded.
    const p = readJson(pendingFile, null);
    if (!p) return console.log('plugin-ledger: nothing pending');
    const next = [...new Set([...synced, ...p.added.map(r => r.name)])].filter(n => !p.removed.includes(n));
    fs.writeFileSync(syncedFile, JSON.stringify(next, null, 2));
    fs.rmSync(pendingFile);
    return console.log(`plugin-ledger: committed ${p.added.length} added, ${p.removed.length} removed`);
  }

  const { added, removed } = diff(collect(home), synced);
  if (process.argv.includes('--dry-run')) return console.log(JSON.stringify({ added, removed }, null, 2));
  if (!added.length && !removed.length) { fs.rmSync(pendingFile, { force: true }); return; }

  const now = new Date().toISOString();
  for (const r of added) r.installedAt ||= now; // MCP servers: first-seen date
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pendingFile, JSON.stringify({
    detectedAt: now,
    added,
    removed,
    commitCommand: `node "${__filename}" --commit`,
  }, null, 2));
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
    `plugin-ledger: ${added.length} plugin/skill/MCP item(s) added and ${removed.length} removed since the last sync. ` +
    `Before answering the user's first message, use the plugin-ledger:sync skill to update the "claude-plugin" Google Sheet, then tell the user in one line.` } }));
}

function selfTest() {
  const assert = require('assert');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const p = path.join(home, '.claude', 'plugins');
  const inst = path.join(p, 'cache', 'm', 'demo', '1.0.0');
  fs.mkdirSync(path.join(inst, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(inst, 'skills', 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'solo'), { recursive: true });
  fs.writeFileSync(path.join(p, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'demo@m': [{ installPath: inst, installedAt: '2026-01-02T00:00:00.000Z' }] } }));
  fs.writeFileSync(path.join(p, 'known_marketplaces.json'), JSON.stringify({ m: { source: { source: 'github', repo: 'o/r' } } }));
  fs.writeFileSync(path.join(inst, '.claude-plugin', 'plugin.json'), JSON.stringify({ description: 'Demo plugin.' }));
  fs.writeFileSync(path.join(inst, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha-skill\ndescription: |\n  Does alpha things.\n  Use when you need alpha.\n---\nbody');
  fs.writeFileSync(path.join(home, '.claude', 'skills', 'solo', 'SKILL.md'), '---\nname: solo\ndescription: "Solo skill. Activate for solo work."\n---\n');

  const w = (rel, body) => { fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); fs.writeFileSync(path.join(home, rel), typeof body === 'string' ? body : JSON.stringify(body)); };
  w('.agents/.skill-lock.json', { skills: { shared: { sourceUrl: 'https://github.com/o/s.git', installedAt: '2026-03-04T00:00:00.000Z' } } });
  w('.agents/skills/shared/SKILL.md', '---\nname: shared\ndescription: Shared skill. Use when sharing.\n---\n');
  w('.gemini/config/plugins/fire/plugin.json', { description: 'Fire plugin.', repository: 'https://github.com/g/fire' });
  w('.gemini/config/plugins/fire/skills/ignite/SKILL.md', '---\nname: ignite\ndescription: Use when lighting.\n---\n');
  w('.gemini/config/mcp_config.json', { mcpServers: { notion: { command: 'npx', args: ['-y', '@notionhq/mcp', '--api-key', 'sk-123', 'TOKEN=abc', '--header', 'X-Goog-Api-Key:zzz'], env: { NOTION_TOKEN: 'secret' } } } });
  w('.claude.json', { mcpServers: { stitch: { type: 'http', url: 'https://x.dev/mcp?key=abc', headers: { Authorization: 'Bearer z' } } } });
  w('.config/opencode/opencode.jsonc', '{\n  // comment\n  "mcp": { "Neon": { "type": "remote", "url": "https://mcp.neon.tech/mcp" } }\n}');
  w('.config/opencode/plugins/crg.ts', 'import x from "y"\n\n/**\n * Code review graph plugin.\n */\n');
  w('.codex/config.toml', 'model = "o"\n\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs-mcp"]\n\n[mcp_servers.docs.env]\nAPI_KEY = "k"\n\n[mcp_servers."remote one"]\nurl = "https://r.dev/mcp"\n');

  const rows = collect(home);
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.deepStrictEqual(rows.map(r => r.name), ['demo@m', 'skill:solo', 'claude:mcp:stitch', 'agents:skill:shared', 'antigravity:plugin:fire', 'antigravity:mcp:notion', 'opencode:plugin:crg.ts', 'opencode:mcp:Neon', 'codex:mcp:docs', 'codex:mcp:remote one']);
  assert.strictEqual(by['agents:skill:shared'].link, 'https://github.com/o/s');
  assert.strictEqual(by['agents:skill:shared'].installedAt, '2026-03-04T00:00:00.000Z');
  assert.strictEqual(by['antigravity:plugin:fire'].link, 'https://github.com/g/fire');
  assert.strictEqual(by['antigravity:plugin:fire'].useCase, 'ignite: Use when lighting.');
  assert.strictEqual(by['antigravity:mcp:notion'].link, 'npx -y @notionhq/mcp');
  assert.strictEqual(by['claude:mcp:stitch'].link, 'https://x.dev/mcp');
  assert.ok(!JSON.stringify(rows).match(/sk-123|abc|secret|Bearer/), 'no secrets in rows');
  assert.strictEqual(by['opencode:plugin:crg.ts'].description, 'Code review graph plugin.');
  assert.strictEqual(by['opencode:mcp:Neon'].agent, 'opencode');
  assert.strictEqual(by['codex:mcp:docs'].link, 'npx -y docs-mcp');
  assert.strictEqual(by['codex:mcp:remote one'].link, 'https://r.dev/mcp');
  assert.strictEqual(by['demo@m'].agent, 'Claude Code');
  assert.strictEqual(rows[0].link, 'https://github.com/o/r');
  assert.strictEqual(rows[0].installedAt, '2026-01-02T00:00:00.000Z');
  assert.strictEqual(rows[0].description, 'Demo plugin.');
  assert.strictEqual(rows[0].useCase, 'alpha-skill: Use when you need alpha.');
  assert.strictEqual(rows[1].description, 'Solo skill. Activate for solo work.');
  assert.strictEqual(rows[1].useCase, 'Activate for solo work.');
  const d = diff(rows.slice(0, 2), ['demo@m', 'gone@m']);
  assert.deepStrictEqual(d.added.map(r => r.name), ['skill:solo']);
  assert.deepStrictEqual(d.removed, ['gone@m']);
  assert.strictEqual(toCsv([{ name: 'a', description: 'x, "y"\nz', useCase: '=1', agent: 'Codex' }]).split('\r\n')[1], 'a,,,,"x, ""y""\nz", =1,Installed,,Codex');
  assert.strictEqual(marketplaceLink({ url: 'https://x.com/a/b.git' }), 'https://x.com/a/b');
  fs.rmSync(home, { recursive: true, force: true });
  console.log('self-test passed');
}

if (process.argv.includes('--test')) selfTest();
else try { main(); } catch (e) { console.error(`plugin-ledger: ${e.message}`); }
