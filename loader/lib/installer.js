'use strict';

// Installs Samsung's official Windows release of Watch Face Studio that the
// user downloaded themselves: verifies Samsung's code signature, then unpacks
// the platform-independent parts (Electron app.asar + resources/tools) into a
// per-user install directory. This project never downloads Samsung software on
// its own; it only reads the public download page to tell the user about new
// versions.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const paths = require('./paths');
const state = require('./state');
const authenticode = require('./authenticode');

const DOWNLOAD_PAGE = 'https://developer.samsung.com/watch-face-studio/download.html';
const DOWNLOAD_ORIGIN = 'https://developer.samsung.com';

// Files/directories taken from the inner app-64.7z. The Windows Electron
// runtime and tools/window (adb.exe, JDK for Windows, …) are left out; native
// Linux replacements ship with this bundle.
const EXTRACT_INCLUDE = ['resources', 'tools', 'TermsOfService.txt', 'OpenSourceLicenses.txt'];
const EXTRACT_EXCLUDE = ['tools/window', 'resources/elevate.exe'];

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

// Parses Samsung's download page and returns info about the Windows build.
function parseDownloadPage(html) {
  const tags = html.match(/<a\s[^>]*href="\/WatchFaceStudio\/file\/[^"]+"[^>]*>/gi) || [];
  for (const tag of tags) {
    const title = attr(tag, 'data-original-title') || attr(tag, 'title') || '';
    const m = title.match(/for\s+Win(?:dows)?\s+v?(\d+(?:\.\d+)+)/i);
    if (!m) continue;
    const terms = attr(tag, 'data-terms-content');
    let eula = null;
    if (terms) {
      try {
        eula = decodeURIComponent(terms);
      } catch {
        eula = terms;
      }
    }
    return {
      version: m[1],
      title,
      url: new URL(attr(tag, 'href'), DOWNLOAD_ORIGIN).toString(),
      eula,
      requiresLogin: attr(tag, 'data-login') === 'true',
    };
  }
  throw new Error('Could not find the Windows download on the Watch Face Studio download page. The page layout may have changed; use "Choose installer file" instead.');
}

async function fetchReleaseInfo() {
  const { net } = require('electron');
  const res = await net.fetch(DOWNLOAD_PAGE, { headers: { 'User-Agent': 'wf-studio-linux' } });
  if (!res.ok) throw new Error(`Download page returned HTTP ${res.status}`);
  return parseDownloadPage(await res.text());
}

function sevenZipMissing(cause) {
  return new Error(
    `The 7-Zip helper of WF-Studio for Linux is missing or not executable (${paths.sevenZip}: ${cause}). ` +
      'Please reinstall the package, or rebuild the bundle if you built it yourself.',
  );
}

function run7z(args, onPercent) {
  try {
    fs.accessSync(paths.sevenZip, fs.constants.X_OK);
  } catch (e) {
    return Promise.reject(sevenZipMissing(e.code || e.message));
  }
  return new Promise((resolve, reject) => {
    const p = spawn(paths.sevenZip, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', (d) => {
      const all = d.toString().match(/(\d+)%/g);
      if (all && onPercent) onPercent(parseInt(all[all.length - 1], 10));
    });
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', (e) => reject(e.code === 'ENOENT' || e.code === 'EACCES' ? sevenZipMissing(e.code) : e));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`7-Zip failed (exit ${code}): ${err.trim()}`));
    });
  });
}

// Electron's fs treats *.asar files as directories; recursive deletes must not
// descend into them, so asar support is switched off while deleting.
function rmrf(p) {
  const prev = process.noAsar;
  process.noAsar = true;
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } finally {
    process.noAsar = prev;
  }
}

// Reads the WFS version from package.json inside app.asar (Electron's fs can read asar archives).
function readAsarPackage(asarPath) {
  return JSON.parse(fs.readFileSync(path.join(asarPath, 'package.json'), 'utf8'));
}

// Electron version the Windows build was made with, read from the
// "Electron/x.y.z" user agent string inside WatchFaceStudio.exe. The exe is
// streamed out of the archive (7-Zip -so) and never written to disk.
function detectElectronVersion(innerArchive) {
  return new Promise((resolve, reject) => {
    const p = spawn(paths.sevenZip, ['e', '-so', innerArchive, 'WatchFaceStudio.exe'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const re = /Electron\/(\d+\.\d+\.\d+)/;
    let tail = '';
    let found = null;
    p.stdout.on('data', (chunk) => {
      if (found) return;
      const text = tail + chunk.toString('latin1');
      const m = text.match(re);
      if (m) {
        found = m[1];
        p.kill();
      } else {
        tail = text.slice(-32);
      }
    });
    p.on('error', reject);
    p.on('close', () => resolve(found));
  });
}

function majorOf(v) {
  return parseInt(String(v).split('.')[0], 10);
}

// Unpacks an installer .exe into installs/<version> and makes it current.
async function installFromExe(exePath, onStatus) {
  const status = (phase, percent) => onStatus && onStatus({ phase, percent });

  status('Verifying Samsung signature', null);
  let signature = null;
  if (process.env.WFS_LINUX_SKIP_SIGNATURE_CHECK === '1') {
    console.warn('[wf-studio-linux] signature check skipped (WFS_LINUX_SKIP_SIGNATURE_CHECK=1)');
  } else {
    try {
      signature = authenticode.verifyFile(exePath);
    } catch (e) {
      throw new Error(`This file is not a genuine Watch Face Studio installer from Samsung: ${e.message}. Nothing was installed.`);
    }
  }
  fs.mkdirSync(paths.installsDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(paths.installsDir, '.tmp-'));
  try {
    status('Unpacking installer', 0);
    const outer = path.join(work, 'outer');
    await run7z(['x', '-y', '-bso0', '-bsp1', `-o${outer}`, exePath, '$PLUGINSDIR/app-64.7z'], (p) => status('Unpacking installer', p));
    const inner = path.join(outer, '$PLUGINSDIR', 'app-64.7z');
    if (!fs.existsSync(inner)) {
      throw new Error('This does not look like a Watch Face Studio installer for Windows (app-64.7z not found).');
    }

    status('Extracting Watch Face Studio', 0);
    const stage = path.join(work, 'app');
    await run7z(
      ['x', '-y', '-bso0', '-bsp1', `-o${stage}`, inner, ...EXTRACT_INCLUDE, ...EXTRACT_EXCLUDE.map((e) => `-x!${e}`)],
      (p) => status('Extracting Watch Face Studio', p),
    );
    status('Checking compatibility', 100);
    const electron = await detectElectronVersion(inner);
    rmrf(outer);

    const asar = path.join(stage, 'resources', 'app.asar');
    if (!fs.existsSync(asar)) throw new Error('resources/app.asar missing in installer payload.');
    const pkg = readAsarPackage(asar);
    if (!pkg.main) throw new Error('Unexpected app.asar layout (no "main" in package.json).');

    // The version becomes a directory name below installsDir (and is rmrf'ed): never trust it blindly.
    if (!/^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/.test(String(pkg.version))) {
      throw new Error(`Unexpected Watch Face Studio version "${pkg.version}" in the installer payload.`);
    }

    const runtime = process.versions.electron;
    if (electron && majorOf(electron) !== majorOf(runtime) && process.env.WFS_LINUX_IGNORE_ELECTRON_MISMATCH !== '1') {
      throw new Error(
        `Watch Face Studio ${pkg.version} was built for Electron ${electron}, but this package contains Electron ${runtime}. ` +
          'Please update the AppImage/Flatpak (wf-studio-linux) first. Your current Watch Face Studio installation was left unchanged.',
      );
    }

    status('Finishing', 100);
    const st = state.read();
    const prev = st.current && st.current.dir ? st.current : null;
    const dest = path.join(paths.installsDir, pkg.version);
    rmrf(dest);
    fs.renameSync(stage, dest);

    // Keep the version that was active before as a fallback (one only, ~270 MB each).
    let previous = st.previous || null;
    if (prev && prev.dir !== dest) {
      if (previous && previous.dir !== prev.dir && previous.dir !== dest) rmrf(previous.dir);
      previous = prev;
    } else if (previous && previous.dir === dest) {
      previous = null;
    }

    const current = {
      version: pkg.version,
      dir: dest,
      electron: electron || null,
      installedAt: new Date().toISOString(),
      signedBy: signature ? signature.publisher : null,
      verified: false,
      launchAttempts: 0,
    };
    state.update({ current, previous, skippedVersion: null });
    return current;
  } finally {
    rmrf(work);
  }
}

function downloadsDir() {
  const os = require('os');
  // XDG user dirs (localised "Downloads" folder names).
  try {
    const cfg = fs.readFileSync(path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'user-dirs.dirs'), 'utf8');
    const m = cfg.match(/^XDG_DOWNLOAD_DIR="?([^"\n]+)"?/m);
    if (m) return m[1].replace('$HOME', os.homedir());
  } catch {
    /* no user-dirs.dirs */
  }
  return path.join(os.homedir(), 'Downloads');
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function clearCache() {
  rmrf(paths.cacheDir);
}

module.exports = {
  DOWNLOAD_PAGE,
  detectElectronVersion,
  parseDownloadPage,
  fetchReleaseInfo,
  downloadsDir,
  installFromExe,
  compareVersions,
  clearCache,
};
