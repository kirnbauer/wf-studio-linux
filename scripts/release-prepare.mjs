#!/usr/bin/env node
// Prepares a release: picks the next version from Conventional Commits since the last v* tag,
// writes the CHANGELOG.md section and syncs the version into loader/package.json and the
// AppStream metainfo. Used by .github/workflows/release.yml; no dependencies.
//
//   release-prepare.mjs [--bump auto|patch|minor|major] [--dry-run]
//   release-prepare.mjs --notes <version>     print that version's CHANGELOG section
//
// Without any v* tag the version already in loader/package.json is released as-is.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.RELEASE_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'loader/package.json');
const METAINFO = join(ROOT, 'packaging/dev.kirnbauer.WFStudioLinux.metainfo.xml');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const BUILDING = join(ROOT, 'docs/BUILDING.md');
const NOTES = join(ROOT, 'build/release-notes.md');

const GROUPS = [
  ['breaking', 'Breaking changes'],
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['other', 'Other changes'],
];

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const fail = (msg) => { console.error(`ERROR: ${msg}`); process.exit(1); };

// --- changelog helpers -------------------------------------------------------------------
function changelogSection(version) {
  const text = readFileSync(CHANGELOG, 'utf8');
  const re = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\].*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, 'm');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };

if (args.includes('--notes')) {
  const v = opt('--notes');
  const section = v && changelogSection(v);
  if (!section) fail(`no CHANGELOG.md section for ${v}`);
  console.log(section);
  process.exit(0);
}

// --- commits since the last tag ----------------------------------------------------------
const dryRun = args.includes('--dry-run');
const bumpArg = opt('--bump') || 'auto';
if (!['auto', 'patch', 'minor', 'major'].includes(bumpArg)) fail(`unknown bump "${bumpArg}"`);

let lastTag = '';
try { lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'); } catch { /* no tag yet */ }

const SEP = '\u001e';
const raw = git('log', '--no-merges', `--format=%h${SEP}%s${SEP}%b${SEP}\u001f`, lastTag ? `${lastTag}..HEAD` : 'HEAD');
const commits = raw.split('\u001f').map((c) => c.trim()).filter(Boolean).map((c) => {
  const [hash, subject, body = ''] = c.split(SEP);
  const m = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  const breaking = !!(m && m[3]) || /^BREAKING[ -]CHANGE:/m.test(body);
  return { hash, type: m ? m[1].toLowerCase() : null, scope: m && m[2], breaking, text: m ? m[4] : subject };
}).filter((c) => !(c.type === 'chore' && c.scope === 'release'));

if (!commits.length) fail(`no commits since ${lastTag || 'the start'}; nothing to release`);

// --- version -----------------------------------------------------------------------------
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
let version = pkg.version;
let bump = 'none (first release)';
if (lastTag) {
  const base = lastTag.slice(1).split('.').map(Number);
  let level = bumpArg;
  if (level === 'auto') {
    if (commits.some((c) => c.breaking)) level = base[0] === 0 ? 'minor' : 'major';
    else if (commits.some((c) => c.type === 'feat')) level = 'minor';
    else level = 'patch';
  }
  bump = level;
  const [a, b, c] = base;
  version = level === 'major' ? `${a + 1}.0.0` : level === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
} else if ([maj, min, pat].some(Number.isNaN)) fail(`bad version in ${PKG}`);

// --- changelog section -------------------------------------------------------------------
const date = new Date().toISOString().slice(0, 10);
const grouped = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
for (const c of commits) {
  const key = c.breaking ? 'breaking' : ['feat', 'fix', 'perf'].includes(c.type) ? c.type : 'other';
  grouped[key].push(`- ${c.scope ? `**${c.scope}:** ` : ''}${c.text} (${c.hash})`);
}
const body = GROUPS.filter(([k]) => grouped[k].length)
  .map(([k, title]) => `### ${title}\n\n${grouped[k].join('\n')}`).join('\n\n');
const section = `## [${version}] - ${date}\n\n${body}\n`;

console.log(`last tag: ${lastTag || '(none)'}  commits: ${commits.length}  bump: ${bump}  ->  v${version}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=v${version}\n`);
if (dryRun) { console.log(`\n${section}`); process.exit(0); }

// --- write files -------------------------------------------------------------------------
let existing = '';
try { existing = readFileSync(CHANGELOG, 'utf8'); } catch { /* new file */ }
if (existing && changelogSection(version) !== null) fail(`CHANGELOG.md already has ${version}`);
const header = '# Changelog\n\nAll notable changes to this project are documented here. The format follows\n[Keep a Changelog](https://keepachangelog.com/); versions follow [Semantic Versioning](https://semver.org/).\n\n';
const rest = existing.replace(/^# Changelog[\s\S]*?(?=^## \[|(?![\s\S]))/m, '');
writeFileSync(CHANGELOG, `${header}${section}\n${rest}`.replace(/\n+$/, '\n'));

mkdirSync(dirname(NOTES), { recursive: true });
writeFileSync(NOTES, `${section.split('\n').slice(2).join('\n').trim()}\n`);

// loader/package.json (keep formatting: only touch the version line)
writeFileSync(PKG, readFileSync(PKG, 'utf8').replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`));

// AppStream metainfo
const highlights = [...grouped.breaking, ...grouped.feat, ...grouped.fix].slice(0, 6)
  .map((l) => l.replace(/^- /, '').replace(/\*\*/g, '').replace(/ \([0-9a-f]+\)$/, ''))
  .map((l) => `<li>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`);
const entry = highlights.length
  ? `<release version="${version}" date="${date}">\n      <description>\n        <ul>\n          ${highlights.join('\n          ')}\n        </ul>\n      </description>\n    </release>`
  : `<release version="${version}" date="${date}"/>`;
let meta = readFileSync(METAINFO, 'utf8');
const sameVersion = new RegExp(`\\s*<release version="${version.replace(/\./g, '\\.')}"[\\s\\S]*?(?:/>|</release>)`);
meta = meta.replace(sameVersion, '');
meta = meta.replace(/<releases>/, `<releases>\n    ${entry}`);
writeFileSync(METAINFO, meta);

// docs/BUILDING.md sample output
let building = readFileSync(BUILDING, 'utf8');
building = building.replace(/(wf-studio-linux-)\d+\.\d+\.\d+(-x86_64\.tar\.gz)/g, `$1${version}$2`);
writeFileSync(BUILDING, building);
console.log(`prepared v${version}`);
