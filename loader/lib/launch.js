'use strict';

// Starts Samsung's Watch Face Studio main process inside this (Linux) Electron.
//
// WFS resolves everything relative to app.getAppPath()/../.. and already knows a
// "linux" tool directory (tools/linux/{adb,aapt,aapt2,zipalign,apksigner,jdk}),
// so we only have to:
//   * point app.getAppPath() at the downloaded app.asar,
//   * link tools/linux to the native tools shipped with this bundle,
//   * swap the Windows-only native module (sharp) for sharp's WebAssembly build.

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { app } = require('electron');
const paths = require('./paths');
const state = require('./state');

function withNoAsar(fn) {
  const prev = process.noAsar;
  process.noAsar = true;
  try {
    return fn();
  } finally {
    process.noAsar = prev;
  }
}

// tools/linux -> <bundle>/support/tools-linux. Re-created on every start because
// the AppImage mount point changes between runs.
function linkTools(installDir) {
  const link = path.join(installDir, 'tools', 'linux');
  withNoAsar(() => {
    let current = null;
    try {
      current = fs.readlinkSync(link);
    } catch {
      /* missing or not a link */
    }
    if (current === paths.toolsLinuxDir) return;
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(paths.toolsLinuxDir, link);
  });
}

function setupEnv() {
  const jdk = path.join(paths.toolsLinuxDir, 'jdk');
  process.env.JAVA_HOME = jdk;
  process.env.PATH = [path.join(jdk, 'bin'), paths.toolsLinuxDir, process.env.PATH || ''].join(path.delimiter);
}

// WFS ships sharp-win32-x64.node inside app.asar.unpacked; redirect every
// require('sharp') to the sharp bundled with the loader. That one runs as
// WebAssembly: native libvips builds carry their own GLib, which clashes with
// the system GLib loaded by Electron/GTK (libvips aborts on newer GLib).
function hookNativeModules() {
  const sharpPath = require.resolve('sharp');
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'sharp') return sharpPath;
    return original.call(this, request, parent, ...rest);
  };
}

const PROJECT_FILE = /\.(wfs|wfsplugin)$/i;

function findProjectFile(args, cwd) {
  const file = args.find((a) => !a.startsWith('-') && PROJECT_FILE.test(a));
  return file ? path.resolve(cwd, file) : null;
}

// WFS follows Windows conventions for its command line:
//   * first instance: process.argv[1] is a project file to open, if present;
//   * second instance: argv[2] is the file, or "--source-shortcut=…" to just focus.
// On Linux argv also carries Chromium switches (e.g. --no-sandbox from the
// AppImage), which WFS would try to open as a project. Normalise both.
function normaliseArgv() {
  const file = findProjectFile(process.argv.slice(1), process.cwd());
  process.argv = file ? [process.argv[0], file] : [process.argv[0]];

  // Registered before WFS' own handler, so it sees the rewritten array.
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const other = findProjectFile(argv.slice(1), workingDirectory || process.cwd());
    argv.splice(0, argv.length, process.execPath, '--wf-studio-linux', other || '--source-shortcut=wf-studio-linux');
  });
}

// Counts start attempts and marks the install as working once WFS' first
// window has loaded; used to offer a rollback after a broken update.
function trackStartup() {
  const cur = state.read().current || {};
  state.patchCurrent({ launchAttempts: (cur.launchAttempts || 0) + 1 });
  app.once('browser-window-created', (_e, win) => {
    win.webContents.once('did-finish-load', () => state.patchCurrent({ verified: true, launchAttempts: 0 }));
  });
}

function launch(install) {
  const asar = path.join(install.dir, 'resources', 'app.asar');
  const pkg = JSON.parse(fs.readFileSync(path.join(asar, 'package.json'), 'utf8'));

  linkTools(install.dir);
  setupEnv();
  hookNativeModules();
  normaliseArgv();

  // WFS registers a "file" protocol handler that strips "file:///" and so
  // produces paths relative to the working directory ("home/user/…"). macOS
  // launches apps with cwd "/", which makes that work; do the same here.
  process.chdir('/');

  trackStartup();

  app.setVersion(pkg.version);
  app.setAppPath(asar);
  Module._load(path.join(asar, pkg.main), Module, true);
}

module.exports = { launch, linkTools };
