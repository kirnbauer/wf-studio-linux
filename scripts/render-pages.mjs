#!/usr/bin/env node
// Renders the GitHub Pages landing page from packaging/pages/index.html (template).
//   render-pages.mjs <version> <SHA256SUMS> <CHANGELOG.md> <out.html> [repo-url]
// Optional env FLATPAK_GPG_FINGERPRINT is shown as signing-key fingerprint. Placeholders: {{VERSION}} {{FINGERPRINT}} {{DOWNLOADS}} {{HASHES}} {{CHANGELOG}}. No dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [version, sumsFile, changelogFile, outFile, repo = 'https://github.com/kirnbauer/wf-studio-linux'] = process.argv.slice(2);
if (!outFile) { console.error('usage: render-pages.mjs <version> <SHA256SUMS> <CHANGELOG.md> <out.html> [repo-url]'); process.exit(2); }

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');

const sums = readFileSync(sumsFile, 'utf8').split('\n').filter(Boolean).map((l) => {
  const m = l.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
  if (!m) throw new Error(`bad SHA256SUMS line: ${l}`);
  return { hash: m[1], file: m[2] };
});

const downloads = `<ul>\n${sums.map(({ file }) =>
  `    <li><a href="${esc(`${repo}/releases/download/v${version}/${file}`)}">${esc(file)}</a></li>`).join('\n')}\n  </ul>`;
const hashes = `<table>\n    <thead><tr><th>File</th><th>SHA-256</th></tr></thead>\n    <tbody>\n${sums.map(({ file, hash }) =>
  `      <tr><td>${esc(file)}</td><td><code>${hash}</code></td></tr>`).join('\n')}\n    </tbody>\n  </table>`;

// Minimal Markdown for our own CHANGELOG.md: "## " / "### " headings and "- " items.
let html = '', inList = false, started = false;
for (const line of readFileSync(changelogFile, 'utf8').split('\n')) {
  const h = line.match(/^(##|###) (.+)/);
  if (h) started = true;
  if (!started) continue;
  const li = line.match(/^- (.+)/);
  if (inList && !li) { html += '</ul>\n'; inList = false; }
  if (h) html += `<h${h[1].length + 1}>${inline(h[2].replace(/^\[([^\]]+)\]/, '$1'))}</h${h[1].length + 1}>\n`;
  else if (li) { if (!inList) { html += '<ul>\n'; inList = true; } html += `<li>${inline(li[1])}</li>\n`; }
  else if (line.trim()) html += `<p>${inline(line)}</p>\n`;
}
if (inList) html += '</ul>\n';

const template = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../packaging/pages/index.html'), 'utf8');
writeFileSync(outFile, template
  .replaceAll('{{VERSION}}', esc(version))
  .replaceAll('{{FINGERPRINT}}', esc((process.env.FLATPAK_GPG_FINGERPRINT || '').replace(/(.{4})(?=.)/g, '$1 ')))
  .replace('{{DOWNLOADS}}', () => downloads)
  .replace('{{HASHES}}', () => hashes)
  .replace('{{CHANGELOG}}', () => html));
