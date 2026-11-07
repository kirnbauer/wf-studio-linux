'use strict';

// Self-test of the native pieces shipped with the bundle. Works both from the
// loader (--wfs-check) and headless in plain Node mode:
//   ELECTRON_RUN_AS_NODE=1 ./wf-studio resources/app/lib/check.js

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths');

const tools = paths.toolsLinuxDir;
const jdk = path.join(tools, 'jdk');
const env = {
  ...process.env,
  JAVA_HOME: jdk,
  PATH: [path.join(jdk, 'bin'), tools, process.env.PATH || ''].join(path.delimiter),
};

function runTool(file, args, okCodes = [0]) {
  const r = spawnSync(file, args, { env, encoding: 'utf8', timeout: 60000 });
  if (r.error) throw r.error;
  if (!okCodes.includes(r.status)) {
    throw new Error(`exit ${r.status}: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}`);
  }
  const lines = `${r.stdout || ''}${r.stderr || ''}`.split('\n').map((l) => l.trim());
  return lines.find((l) => l && !l.startsWith('Picked up ')) || '';
}

const checks = [
  ['java', () => runTool(path.join(jdk, 'bin', 'java'), ['-version'])],
  ['keytool', () => (fs.accessSync(path.join(jdk, 'bin', 'keytool'), fs.constants.X_OK), 'ok')],
  ['jarsigner', () => (fs.accessSync(path.join(jdk, 'bin', 'jarsigner'), fs.constants.X_OK), 'ok')],
  ['aapt', () => runTool(path.join(tools, 'aapt'), ['v'])],
  ['aapt2', () => runTool(path.join(tools, 'aapt2'), ['version'])],
  ['zipalign', () => (runTool(path.join(tools, 'zipalign'), [], [0, 2]), 'ok')],
  ['apksigner', () => runTool(path.join(tools, 'apksigner'), ['--version'])],
  ['adb', () => runTool(path.join(tools, 'adb'), ['version'])],
  ['7zz', () => runTool(paths.sevenZip, ['i'], [0]).replace(/\s+/g, ' ')],
  [
    'sharp',
    async () => {
      const sharp = require('sharp');
      const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#1428a0' } }).png().toBuffer();
      const meta = await sharp(png).metadata();
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>');
      const mask = await sharp(svg).png().toBuffer();
      await sharp(png).composite([{ input: mask, blend: 'dest-in' }]).trim({ threshold: 1 }).toBuffer();
      const wasm = sharp.versions.emscripten ? 'WebAssembly' : 'native';
      return `sharp ${sharp.versions.sharp} (${wasm}), libvips ${sharp.versions.vips}, ${meta.width}x${meta.height} ${meta.format}`;
    },
  ],
];

// Runs every check; returns [{ name, ok, detail }].
async function results() {
  const out = [];
  for (const [name, fn] of checks) {
    try {
      out.push({ name, ok: true, detail: String(await fn()) });
    } catch (e) {
      out.push({ name, ok: false, detail: e.message });
    }
  }
  return out;
}

async function run() {
  console.log(`wf-studio-linux self-test (bundle: ${paths.bundleRoot})`);
  const res = await results();
  for (const r of res) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(10)} ${r.detail}`);
  const ok = res.every((r) => r.ok);
  console.log(ok ? 'all checks passed' : 'some checks FAILED');
  return ok;
}

module.exports = { run, results };

if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
