'use strict';

// Entry point of the Linux bundle.
//
//   first start            -> setup window (choose the installer downloaded from Samsung)
//   normal start           -> boot screen (tool check, update check, settings) -> Watch Face Studio
//   boot screen disabled   -> Watch Face Studio directly, update check in the background
//   --wfs-settings         -> WF-Studio Settings (also reachable from the boot screen)
//
// Command line switches (all optional):
//   --wfs-settings  open the settings ("WF-Studio Settings" menu entry)
//   --wfs-setup     show the setup window even if WFS is installed (update/reinstall)
//   --wfs-reset     delete the downloaded WFS install and cache, then run setup
//   --wfs-rollback  switch back to the Watch Face Studio version used before the last update
//   --wfs-check     print a self-test of the bundled native tools and the GPU status, then exit
//   --wfs-gpu-info  print only the GPU / hardware acceleration status and exit
//   --wfs-install-from=<WatchFaceStudio_x.y.z.exe>
//                   install from a local installer without the setup window, then start

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const paths = require('./lib/paths');
const state = require('./lib/state');
const settings = require('./lib/settings');
const installer = require('./lib/installer');
const { launch } = require('./lib/launch');
const graphics = require('./lib/graphics');
const updates = require('./lib/updates');
const integration = require('./lib/integration');
const selfupdate = require('./lib/selfupdate');
const { relaunch } = require('./lib/relaunch');

const OWN_FLAGS = ['--wfs-setup', '--wfs-reset', '--wfs-check', '--wfs-gpu-info', '--wfs-rollback', '--wfs-settings', '--wfs-relaunched'];
const INSTALL_FROM = '--wfs-install-from=';
const flags = Object.fromEntries(OWN_FLAGS.map((f) => [f.slice(6).replace(/-./g, (m) => m[1].toUpperCase()), process.argv.includes(f)]));
const installFromArg = process.argv.find((a) => a.startsWith(INSTALL_FROM));
flags.installFrom = installFromArg ? path.resolve(installFromArg.slice(INSTALL_FROM.length)) : null;
// Keep our switches away from WFS' own argument handling.
process.argv = process.argv.filter((a) => !OWN_FLAGS.includes(a) && !a.startsWith(INSTALL_FROM));

// Settings as applied at startup (display switches only take effect on restart).
const startupPrefs = settings.read();
graphics.applySwitches(process.env, startupPrefs);

const PAGE = (name) => path.join(__dirname, name, 'index.html');
const PRELOAD = (name) => path.join(__dirname, name, 'preload.js');
const webPreferences = (name) => ({ preload: PRELOAD(name), contextIsolation: true, nodeIntegration: false, sandbox: true });

let wfsRunning = false;
let switching = false;
let bootWin = null;
let settingsWin = null;

if (flags.check) {
  (async () => {
    const ok = await require('./lib/check').run();
    console.log('');
    await graphics.printGpuInfo();
    // Software rendering is a performance hint, not a failure.
    app.exit(ok ? 0 : 1);
  })();
} else if (flags.gpuInfo) {
  graphics.printGpuInfo().then(() => app.exit(0));
} else {
  main();
}

function main() {
  // One instance: a second start (menu entry, .wfs file, settings) is handed
  // to the running one. WFS' own requestSingleInstanceLock() later succeeds too.
  if (app.requestSingleInstanceLock()) {
    start();
  } else if (flags.relaunched) {
    // Restarted by ourselves: the old instance is still exiting; wait for it.
    let tries = 0;
    const retry = setInterval(() => {
      if (app.requestSingleInstanceLock()) {
        clearInterval(retry);
        start();
      } else if (++tries > 50) {
        clearInterval(retry);
        app.quit();
      }
    }, 100);
  } else {
    app.quit();
  }
}

function start() {
  app.on('second-instance', onSecondInstance);

  if (flags.reset) resetInstallation();

  if (flags.installFrom) {
    quitWhenAllClosed();
    app.whenReady().then(async () => {
      try {
        let last = '';
        const res = await installer.installFromExe(flags.installFrom, (s) => {
          const line = `${s.phase} ${s.percent ?? ''}%`;
          if (line !== last) console.log(`[wf-studio-linux] ${(last = line)}`);
        });
        console.log(`[wf-studio-linux] installed Watch Face Studio ${res.version} to ${res.dir}`);
        launchWfs();
      } catch (e) {
        console.error(`[wf-studio-linux] install failed: ${e.message}`);
        app.exit(1);
      }
    });
    return;
  }

  if (flags.rollback) {
    try {
      const restored = state.rollback();
      console.log(`[wf-studio-linux] switched back to Watch Face Studio ${restored.version}`);
    } catch (e) {
      console.error(`[wf-studio-linux] ${e.message}`);
    }
  }

  if (flags.settings) {
    quitWhenAllClosed();
    app.whenReady().then(() => openSettings());
    return;
  }

  const st = state.read();
  const install = state.currentInstall();

  // The last start after an update never got WFS' window up: offer the old version.
  if (install && !flags.setup && state.lastStartFailed() && state.previousInstall()) {
    quitWhenAllClosed();
    app.whenReady().then(offerRollback);
    return;
  }

  // After "Open download page" for an update: show the setup window once, so the
  // user can choose the downloaded installer. Nothing is picked automatically.
  const showSetupForUpdate = !!(st.pendingUpdate && install);
  if (showSetupForUpdate) state.update({ pendingUpdate: false });

  if (install && !flags.setup && !showSetupForUpdate) {
    if (startupPrefs.bootScreen) {
      quitWhenAllClosed();
      app.whenReady().then(showBoot);
    } else {
      if (app.isReady()) {
        launchWfs();
      } else {
        // Before "ready", so WFS registers its handlers the normal way.
        wfsRunning = true;
        launch(install);
      }
      app.whenReady().then(() => setTimeout(() => updates.checkInBackground(), 20000));
    }
    return;
  }

  quitWhenAllClosed();
  app.whenReady().then(showSetup);
}

function onSecondInstance(_event, argv) {
  if (argv.includes('--wfs-settings')) {
    openSettings();
    // Keep WFS' own handler (if WFS runs) from treating the switch as a project file.
    argv.splice(0, argv.length, process.execPath, '--wfs-linux', '--source-shortcut=wfs-linux');
    setTimeout(() => settingsWin && !settingsWin.isDestroyed() && settingsWin.focus(), 150);
    return;
  }
  if (!wfsRunning) {
    const win = [settingsWin, bootWin, ...BrowserWindow.getAllWindows()].find((w) => w && !w.isDestroyed());
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  }
}

// Default Electron behaviour, except during the hand-over to WFS (WFS creates
// its window asynchronously, so for a moment no window exists). WFS itself
// registers no window-all-closed handler.
function quitWhenAllClosed() {
  app.on('window-all-closed', () => {
    if (!switching) app.quit();
  });
}

// Starts WFS in this process after the boot/setup/settings window. WFS sets
// everything up in app.on('ready'), which has already fired, so it is re-emitted.
function launchWfs(...windowsToClose) {
  const install = state.currentInstall();
  if (!install || wfsRunning) return;
  state.update({ pendingUpdate: false });
  wfsRunning = true;
  switching = true;
  app.once('browser-window-created', () => {
    switching = false;
    for (const w of [...windowsToClose, bootWin, settingsWin]) {
      if (w && !w.isDestroyed()) w.close();
    }
  });
  launch(install);
  app.emit('ready', { preventDefault() {} }, {});
}

function resetInstallation() {
  installer.clearCache();
  const prev = process.noAsar;
  process.noAsar = true;
  fs.rmSync(paths.installsDir, { recursive: true, force: true });
  process.noAsar = prev;
  state.write({});
}

async function offerRollback() {
  const cur = state.read().current;
  const prev = state.previousInstall();
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Watch Face Studio',
    message: `Watch Face Studio ${cur.version} did not start correctly last time.`,
    detail: `You can go back to version ${prev.version}, which worked before, or try ${cur.version} again.`,
    buttons: [`Use ${prev.version}`, `Try ${cur.version} again`, 'Quit'],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 2) return app.quit();
  if (response === 0) state.rollback();
  else state.patchCurrent({ launchAttempts: 0 });
  launchWfs();
}

// ---------------------------------------------------------------------------
// Setup window (first start, update, reinstall)

let setupShown = false;

function showSetup() {
  if (setupShown) return;
  setupShown = true;
  const win = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 560,
    minHeight: 480,
    title: 'WF-Studio for Linux – Setup',
    autoHideMenuBar: true,
    webPreferences: webPreferences('setup'),
  });
  win.setMenu(null);
  win.loadFile(PAGE('setup'));

  const send = (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const progress = (s) => send('setup:progress', s);
  let busy = false;
  const guarded = (fn) => async (...args) => {
    if (busy) throw new Error('Another operation is still running.');
    busy = true;
    try {
      return await fn(...args);
    } finally {
      busy = false;
    }
  };

  ipcMain.handle('setup:info', () => ({
    installed: state.currentInstall(),
    previous: state.previousInstall(),
    loaderVersion: require('./package.json').version,
    dataDir: paths.dataDir,
    downloadPage: installer.DOWNLOAD_PAGE,
  }));

  ipcMain.handle('setup:release', () => installer.fetchReleaseInfo());

  ipcMain.handle(
    'setup:install-file',
    guarded(async () => {
      const res = await dialog.showOpenDialog(win, {
        title: 'Choose the Watch Face Studio installer for Windows',
        // Only the folder the dialog opens in; the user picks the file.
        defaultPath: installer.downloadsDir(),
        filters: [{ name: 'Windows installer', extensions: ['exe'] }],
        properties: ['openFile'],
      });
      if (res.canceled || !res.filePaths[0]) return null;
      return installer.installFromExe(res.filePaths[0], progress);
    }),
  );

  ipcMain.handle('setup:open-download-page', () => shell.openExternal(installer.DOWNLOAD_PAGE));
  ipcMain.handle('setup:launch', () => launchWfs(win));
  ipcMain.handle(
    'setup:rollback',
    guarded(async () => state.rollback()),
  );
  ipcMain.handle('setup:quit', () => app.quit());
}

// ---------------------------------------------------------------------------
// Boot screen

let lastUpdateCheck = null;

function quickToolCheck() {
  const t = paths.toolsLinuxDir;
  const required = [
    paths.sevenZip,
    path.join(t, 'adb'),
    path.join(t, 'aapt2'),
    path.join(t, 'zipalign'),
    path.join(t, 'apksigner'),
    path.join(t, 'jdk', 'bin', 'java'),
  ];
  const missing = required.filter((f) => {
    try {
      fs.accessSync(f, fs.constants.X_OK);
      return false;
    } catch {
      return true;
    }
  });
  try {
    require.resolve('sharp');
  } catch {
    missing.push('sharp');
  }
  return missing;
}

function showBoot() {
  bootWin = new BrowserWindow({
    width: 580,
    height: 420,
    resizable: false,
    maximizable: false,
    frame: false,
    show: false,
    title: 'WF-Studio for Linux',
    backgroundColor: '#14182b',
    webPreferences: webPreferences('boot'),
  });
  bootWin.once('ready-to-show', () => bootWin.show());
  bootWin.on('closed', () => {
    bootWin = null;
  });
  bootWin.loadFile(PAGE('boot'));
}

ipcMain.handle('boot:info', () => {
  const install = state.currentInstall();
  return {
    wfsVersion: install ? install.version : null,
    launcherVersion: require('./package.json').version,
  };
});

ipcMain.handle('boot:tools', () => {
  const missing = quickToolCheck();
  return { ok: missing.length === 0, missing };
});

ipcMain.handle('boot:updates', async () => {
  lastUpdateCheck = await updates.checkAll({ timeoutMs: 3000 });
  return lastUpdateCheck;
});

ipcMain.handle('boot:start', () => launchWfs(bootWin));
ipcMain.handle('boot:settings', () => openSettings());
ipcMain.handle('boot:quit', () => app.quit());
ipcMain.handle('boot:wfs-download', () => updates.openWfsDownload());
ipcMain.handle('boot:wfs-skip', () => {
  if (lastUpdateCheck && lastUpdateCheck.wfs && lastUpdateCheck.wfs.version) updates.skipWfsVersion(lastUpdateCheck.wfs.version);
});
ipcMain.handle('boot:launcher-release', () => {
  const url = lastUpdateCheck && lastUpdateCheck.launcher && lastUpdateCheck.launcher.url;
  shell.openExternal(selfupdate.safeReleaseUrl(url));
});
ipcMain.handle('boot:launcher-skip', () => {
  if (lastUpdateCheck && lastUpdateCheck.launcher && lastUpdateCheck.launcher.version) {
    updates.skipLauncherVersion(lastUpdateCheck.launcher.version);
  }
});

// ---------------------------------------------------------------------------
// Settings ("WF-Studio Settings")

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 780,
    height: 680,
    minWidth: 600,
    minHeight: 520,
    title: 'WF-Studio Settings',
    autoHideMenuBar: true,
    webPreferences: webPreferences('settings'),
  });
  settingsWin.setMenu(null);
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  settingsWin.loadFile(PAGE('settings'));
}

const DISPLAY_KEYS = ['ozone', 'ignoreGpuBlocklist', 'disableGpu'];

function restartNeeded(prefs) {
  return DISPLAY_KEYS.some((k) => prefs[k] !== startupPrefs[k]);
}

function settingsInfo() {
  const prefs = settings.read();
  return {
    prefs,
    restartNeeded: restartNeeded(prefs),
    envOverrides: {
      ozone: process.env.WFS_LINUX_OZONE || null,
      ignoreGpuBlocklist: process.env.WFS_LINUX_IGNORE_GPU_BLOCKLIST === '1',
      disableGpu: process.env.WFS_LINUX_DISABLE_GPU === '1',
      noUpdateCheck: !!process.env.WFS_LINUX_NO_UPDATE_CHECK,
    },
    wfsRunning,
    canStartWfs: !wfsRunning && !!state.currentInstall(),
    install: state.currentInstall(),
    previous: state.previousInstall(),
    versions: {
      launcher: require('./package.json').version,
      electron: process.versions.electron,
    },
    packageKind: selfupdate.packageKind(),
    integration: integration.status(),
    dataDir: paths.dataDir,
  };
}

function settingsParent() {
  return settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined;
}

async function confirm(message, detail, confirmLabel) {
  const opts = { type: 'warning', message, detail, buttons: [confirmLabel, 'Cancel'], defaultId: 1, cancelId: 1 };
  const parent = settingsParent();
  const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
  return response === 0;
}

ipcMain.handle('settings:get', () => settingsInfo());

ipcMain.handle('settings:set', (_e, patch) => {
  settings.update(patch);
  return settingsInfo();
});

ipcMain.handle('settings:gpu', () => graphics.gpuInfo());
ipcMain.handle('settings:selftest', () => require('./lib/check').results());

const INTEGRATION_ACTIONS = {
  addMenuEntry: integration.addMenuEntry,
  removeMenuEntry: integration.removeMenuEntry,
  addDesktopShortcut: integration.addDesktopShortcut,
  removeDesktopShortcut: integration.removeDesktopShortcut,
  makeDefaultForWfs: integration.makeDefaultForWfs,
};
ipcMain.handle('settings:integration', (_e, action) => {
  const fn = INTEGRATION_ACTIONS[action];
  if (!fn) throw new Error(`Unknown action ${action}`);
  fn();
  return settingsInfo();
});

ipcMain.handle('settings:restart', async () => {
  if (wfsRunning && !(await confirm('Restart Watch Face Studio?', 'Save your work first. Unsaved changes are lost.', 'Restart'))) {
    return false;
  }
  relaunch();
  return true;
});

ipcMain.handle('settings:start-wfs', () => launchWfs(settingsWin));

ipcMain.handle('settings:install', async () => {
  if (wfsRunning) {
    if (!(await confirm('Close Watch Face Studio to install another version?', 'Save your work first. WF-Studio for Linux restarts into the setup window.', 'Restart'))) {
      return false;
    }
    relaunch(['--wfs-setup']);
    return true;
  }
  for (const w of [settingsWin, bootWin]) if (w && !w.isDestroyed()) w.hide();
  showSetup();
  for (const w of [settingsWin, bootWin]) if (w && !w.isDestroyed()) w.destroy();
  return true;
});

ipcMain.handle('settings:rollback', async () => {
  const prev = state.previousInstall();
  if (!prev) throw new Error('No previous version available.');
  if (!(await confirm(`Go back to Watch Face Studio ${prev.version}?`, wfsRunning ? 'Save your work first. WF-Studio for Linux restarts.' : '', 'Go back'))) {
    return settingsInfo();
  }
  state.rollback();
  if (wfsRunning) relaunch();
  return settingsInfo();
});

ipcMain.handle('settings:reset', async () => {
  const ok = await confirm(
    'Reset the Watch Face Studio installation?',
    'The downloaded Watch Face Studio is removed; afterwards you choose the installer file again. ' +
      'Your projects, the workspace (~/WatchFaceStudio) and Watch Face Studio\'s own settings are kept.' +
      (wfsRunning ? '\n\nSave your work first. WF-Studio for Linux restarts.' : ''),
    'Reset',
  );
  if (!ok) return false;
  relaunch(['--wfs-reset']);
  return true;
});

const PATHS = {
  logs: () => path.join(app.getPath('userData'), 'logs'),
  data: () => paths.dataDir,
  wfsSettings: () => app.getPath('userData'),
};
ipcMain.handle('settings:open-path', (_e, which) => {
  const fn = PATHS[which];
  if (!fn) throw new Error(`Unknown path ${which}`);
  const p = fn();
  fs.mkdirSync(p, { recursive: true });
  return shell.openPath(p);
});

const URLS = {
  repo: `https://github.com/${selfupdate.REPO}`,
  docs: `https://github.com/${selfupdate.REPO}/blob/main/docs/HOW-IT-WORKS.md`,
  download: installer.DOWNLOAD_PAGE,
  releases: selfupdate.RELEASES_PAGE,
};
ipcMain.handle('settings:open-url', (_e, which) => {
  if (!URLS[which]) throw new Error(`Unknown link ${which}`);
  return shell.openExternal(URLS[which]);
});
