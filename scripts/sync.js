#!/usr/bin/env node
// plugin-ledger: on SessionStart, diff installed plugins/skills against the last sync and ask Claude to update the Drive sheet.
// Usage: sync.js            normal run (hook): local mode writes the file itself, Drive mode hands off to Claude
//        sync.js --configure --destination local|drive [--format xlsx|csv|json] [--path <folder>]
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
// One row as the sheet's 9 columns. Rows without a status (pending additions) are Installed.
const columns = r => [r.name, r.type, r.link, (r.installedAt || '').slice(0, 10), r.description, r.useCase, r.status || 'Installed', (r.removedAt || '').slice(0, 10), r.agent];
function toCsv(rows) {
  return [HEADER.join(','), ...rows.map(r => columns(r).map(cell).join(','))].join('\r\n') + '\r\n';
}

const toJson = rows => JSON.stringify(rows.map(r => Object.fromEntries(HEADER.map((h, i) => [h, columns(r)[i] ?? '']))), null, 2) + '\n';

// --- .xlsx without dependencies: a zip of a few XML parts, styled like a table. ---
const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = buf => { let c = ~0; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return ~c >>> 0; };

function zip(files) {
  const zlib = require('zlib');
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8'), comp = zlib.deflateRawSync(data), nm = Buffer.from(name);
    const h = Buffer.alloc(30); // local file header
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt16LE(33, 12);
    h.writeUInt32LE(crc32(data), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); // central directory entry
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(h, nm, comp); centrals.push(c, nm);
    offset += h.length + nm.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// XML-escape and drop control characters XML 1.0 forbids.
const xml = s => String(s ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const WIDTHS = [36, 9, 40, 13, 55, 65, 12, 13, 20];

function toXlsx(rows) {
  const last = rows.length + 1, col = i => String.fromCharCode(65 + i);
  // Style ids (cellXfs below): 1 header, 2/3 banded body, 4 Installed, 5 Removed.
  const c = (ref, v, s) => `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  const body = rows.map((r, i) => {
    const n = i + 2, band = i % 2 ? 3 : 2;
    return `<row r="${n}">${columns(r).map((v, j) => c(col(j) + n, v, j === 6 ? (v === 'Removed' ? 5 : 4) : band)).join('')}</row>`;
  }).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData><row r="1" ht="24" customHeight="1">${HEADER.map((h, j) => c(col(j) + 1, h, 1)).join('')}</row>${body}</sheetData>`
    + `<autoFilter ref="A1:I${last}"/></worksheet>`;
  const fill = rgb => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/></patternFill></fill>`;
  const border = '<border><left style="thin"><color rgb="FFD0D7E2"/></left><right style="thin"><color rgb="FFD0D7E2"/></right><top style="thin"><color rgb="FFD0D7E2"/></top><bottom style="thin"><color rgb="FFD0D7E2"/></bottom><diagonal/></border>';
  const xf = (font, fill, align) => `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment ${align}/></xf>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>`
    + `<font><b/><sz val="11"/><color rgb="FF137333"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFA50E0E"/><name val="Calibri"/></font></fonts>`
    + `<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill('1F3A5F')}${fill('EEF3F8')}${fill('D9F2E3')}${fill('FCE1E1')}</fills>`
    + `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${border}</borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${xf(1, 2, 'vertical="center" wrapText="1"')}${xf(0, 0, 'vertical="top" wrapText="1"')}${xf(0, 3, 'vertical="top" wrapText="1"')}${xf(2, 4, 'horizontal="center" vertical="top"')}${xf(3, 5, 'horizontal="center" vertical="top"')}</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets><sheet name="Plugins" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Plugins!$A$1:$I$${last}</definedName></definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styles],
  ]);
}

const RENDER = { xlsx: toXlsx, csv: toCsv, json: toJson };

// Fold the current scan into the full ledger: new rows Installed, missing ones Removed, reinstalls Installed again.
function mergeLedger(ledger, rows, now) {
  const byName = new Map(ledger.map(r => [r.name, r]));
  const seen = new Set(rows.map(r => r.name));
  let added = 0, removed = 0;
  for (const r of rows) {
    const old = byName.get(r.name);
    if (!old) { ledger.push({ ...r, installedAt: r.installedAt || now, status: 'Installed', removedAt: '' }); added++; }
    else if (old.status === 'Removed') { Object.assign(old, r, { installedAt: r.installedAt || now, status: 'Installed', removedAt: '' }); added++; }
  }
  for (const r of ledger) if (r.status === 'Installed' && !seen.has(r.name)) { r.status = 'Removed'; r.removedAt = now; removed++; }
  return { added, removed };
}

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const expandHome = (p, home) => p.replace(/^~(?=$|[\\/])/, home);

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
  const configFile = path.join(dir, 'config.json');

  if (process.argv.includes('--configure')) {
    // The setup skill runs this with the user's answers.
    const destination = arg('--destination'), format = arg('--format') || 'xlsx';
    if (!['local', 'drive'].includes(destination)) throw new Error('--destination must be local or drive');
    if (destination === 'local' && !RENDER[format]) throw new Error('--format must be xlsx, csv or json');
    const folder = path.resolve(expandHome(arg('--path') || dir, home));
    const cfg = destination === 'drive' ? { destination } : { destination, format, path: folder };
    fs.mkdirSync(dir, { recursive: true });
    if (destination === 'local') fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
    return console.log(`plugin-ledger: saved ${JSON.stringify(cfg)}`);
  }

  const cfg = readJson(configFile, null);
  if (!cfg && !fs.existsSync(syncedFile)) {
    // First run: nothing chosen yet. (A synced.json without config means an existing Google Drive setup.)
    if (process.argv.includes('--dry-run')) return console.log('plugin-ledger: not set up yet');
    return console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
      `plugin-ledger is installed but not set up. Before answering the user's first message, use the plugin-ledger:setup skill to ask where to keep the ledger and in which format.` } }));
  }

  if (cfg?.destination === 'local') {
    // Local file: the hook does everything itself; no connector, no tokens unless something changed.
    const ledgerFile = path.join(dir, 'ledger.json');
    const out = path.join(cfg.path, `plugin-ledger.${cfg.format}`);
    const ledger = readJson(ledgerFile, []);
    const { added, removed } = mergeLedger(ledger, collect(home), new Date().toISOString());
    if (process.argv.includes('--dry-run')) return console.log(JSON.stringify({ added, removed, out }, null, 2));
    if (!added && !removed && fs.existsSync(out)) return;
    try {
      fs.mkdirSync(cfg.path, { recursive: true });
      fs.writeFileSync(out + '.tmp', RENDER[cfg.format](ledger));
      fs.renameSync(out + '.tmp', out);
    } catch (e) {
      // Usually the file is open in Excel. ledger.json is left unchanged, so the next session retries.
      fs.rmSync(out + '.tmp', { force: true });
      return console.error(`plugin-ledger: could not write ${out} (${e.code || e.message}); close it if it's open, it will retry next session`);
    }
    fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
    return console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
      `plugin-ledger: updated ${out} (${added} added, ${removed} marked removed). Mention it in one line only if the user asks about plugins.` } }));
  }

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

  // Ledger: add, remove, reinstall.
  const L = [];
  assert.deepStrictEqual(mergeLedger(L, rows.slice(0, 2), 'T1'), { added: 2, removed: 0 });
  assert.deepStrictEqual(mergeLedger(L, rows.slice(0, 1), 'T2'), { added: 0, removed: 1 });
  assert.strictEqual(L[1].status, 'Removed'); assert.strictEqual(L[1].removedAt, 'T2');
  assert.deepStrictEqual(mergeLedger(L, rows.slice(0, 1), 'T3'), { added: 0, removed: 0 });
  assert.deepStrictEqual(mergeLedger(L, rows.slice(0, 2), 'T4'), { added: 1, removed: 0 });
  assert.strictEqual(L[1].status, 'Installed'); assert.strictEqual(L[1].removedAt, '');
  L[1].status = 'Removed'; L[1].removedAt = '2026-05-06T00:00:00Z';

  assert.strictEqual(JSON.parse(toJson(L))[1]['Removed date'], '2026-05-06');
  assert.strictEqual(toCsv(L).split('\r\n').length, 4);

  // xlsx: unzip every part, check its CRC, and check the sheet holds every row with the right status styles.
  const zlib = require('zlib'), buf = toXlsx(L), parts = {};
  for (let o = 0; buf.readUInt32LE(o) === 0x04034b50;) {
    const size = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), name = buf.toString('utf8', o + 30, o + 30 + nl);
    const data = zlib.inflateRawSync(buf.subarray(o + 30 + nl, o + 30 + nl + size));
    assert.strictEqual(crc32(data), buf.readUInt32LE(o + 14), `crc ${name}`);
    parts[name] = data.toString('utf8');
    o += 30 + nl + size;
  }
  assert.deepStrictEqual(Object.keys(parts).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  const s1 = parts['xl/worksheets/sheet1.xml'];
  assert.strictEqual((s1.match(/<row /g) || []).length, 3);
  assert.ok(s1.includes('<autoFilter ref="A1:I3"/>') && s1.includes('state="frozen"'));
  assert.ok(s1.includes('r="G2" t="inlineStr" s="4"') && s1.includes('r="G3" t="inlineStr" s="5"'), 'Installed/Removed styles');
  assert.ok(toXlsx([{ name: 'a & <b>\x07' }]).length > 0 && xml('a & <b>\x07') === 'a &amp; &lt;b&gt;');
  fs.rmSync(home, { recursive: true, force: true });
  console.log('self-test passed');
}

if (process.argv.includes('--test')) selfTest();
else try { main(); } catch (e) { console.error(`plugin-ledger: ${e.message}`); }
