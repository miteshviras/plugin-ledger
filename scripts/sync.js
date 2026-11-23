#!/usr/bin/env node
// plugin-ledger: on SessionStart, diff installed plugins/skills against the last sync and ask Claude to update the Drive sheet.
// Usage: sync.js            normal run (hook)
//        sync.js --dry-run  print what changed, write nothing
//        sync.js --commit   mark pending.json as written to the sheet
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
  return v.replace(/^(['"])(.*)\1$/, '$2');
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
  return (m ? m[0] : desc).trim();
}

function findSkillFiles(dir, depth = 3) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isFile() && e.name === 'SKILL.md') out.push(path.join(dir, e.name));
    else if (e.isDirectory() && depth > 0 && !['node_modules', '.git'].includes(e.name)) out.push(...findSkillFiles(path.join(dir, e.name), depth - 1));
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

function collect(home) {
  const pluginsDir = path.join(home, '.claude', 'plugins');
  const installed = readJson(path.join(pluginsDir, 'installed_plugins.json'), { plugins: {} }).plugins || {};
  const markets = readJson(path.join(pluginsDir, 'known_marketplaces.json'), {});
  const rows = [];

  for (const [key, installs] of Object.entries(installed)) {
    const inst = installs[0];
    if (!inst) continue;
    const market = key.split('@')[1];
    const manifest = readJson(path.join(inst.installPath, '.claude-plugin', 'plugin.json'), {});
    const skills = findSkillFiles(inst.installPath).map(f => ({ name: skillName(f), desc: skillDescription(f) }));
    const useCase = skills.filter(s => s.desc).map(s => `${s.name}: ${useCaseOf(s.desc)}`).join('\n');
    rows.push({
      name: key,
      type: 'plugin',
      link: marketplaceLink(markets[market]?.source, manifest.homepage),
      installedAt: inst.installedAt || '',
      description: cap(manifest.description || ''),
      useCase: cap(useCase || useCaseOf(manifest.description || '')),
    });
  }

  const skillsDir = path.join(home, '.claude', 'skills');
  let skillDirs = [];
  try { skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory() || d.isSymbolicLink()); } catch {}
  for (const d of skillDirs) {
    const file = path.join(skillsDir, d.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const desc = skillDescription(file);
    const st = fs.statSync(path.join(skillsDir, d.name));
    rows.push({
      name: `skill:${d.name}`,
      type: 'skill',
      link: '',
      installedAt: (st.birthtime.getTime() ? st.birthtime : st.mtime).toISOString(),
      description: cap(desc),
      useCase: cap(useCaseOf(desc)),
    });
  }
  return rows;
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

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pendingFile, JSON.stringify({
    detectedAt: new Date().toISOString(),
    added,
    removed,
    commitCommand: `node "${__filename}" --commit`,
  }, null, 2));
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
    `plugin-ledger: ${added.length} plugin/skill(s) added and ${removed.length} removed since the last sync. ` +
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

  const rows = collect(home);
  assert.deepStrictEqual(rows.map(r => r.name), ['demo@m', 'skill:solo']);
  assert.strictEqual(rows[0].link, 'https://github.com/o/r');
  assert.strictEqual(rows[0].installedAt, '2026-01-02T00:00:00.000Z');
  assert.strictEqual(rows[0].description, 'Demo plugin.');
  assert.strictEqual(rows[0].useCase, 'alpha-skill: Use when you need alpha.');
  assert.strictEqual(rows[1].description, 'Solo skill. Activate for solo work.');
  assert.strictEqual(rows[1].useCase, 'Activate for solo work.');
  const d = diff(rows, ['demo@m', 'gone@m']);
  assert.deepStrictEqual(d.added.map(r => r.name), ['skill:solo']);
  assert.deepStrictEqual(d.removed, ['gone@m']);
  assert.strictEqual(marketplaceLink({ url: 'https://x.com/a/b.git' }), 'https://x.com/a/b');
  fs.rmSync(home, { recursive: true, force: true });
  console.log('self-test passed');
}

if (process.argv.includes('--test')) selfTest();
else try { main(); } catch (e) { console.error(`plugin-ledger: ${e.message}`); }
