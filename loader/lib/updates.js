'use strict';

// Update checks. Nothing is ever downloaded here: the checks only read the
// version on Samsung's download page and the latest WF-Studio for Linux release
// on GitHub, and tell the user.

const { BrowserWindow, dialog, shell } = require('electron');
const installer = require('./installer');
const selfupdate = require('./selfupdate');
const settings = require('./settings');
const state = require('./state');

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Returns { wfs, launcher } with one entry per enabled check:
//   wfs:      { available, version, installed, title } | { error }
//   launcher: { available, version, installed, url }   | { error }
async function checkAll({ timeoutMs = 3000 } = {}) {
  const prefs = settings.read();
  const st = state.read();
  const install = state.currentInstall();
  const ownVersion = require('../package.json').version;
  const allowed = settings.updateChecksAllowed();

  const wfsCheck =
    allowed && prefs.checkWfsUpdates && install
      ? withTimeout(installer.fetchReleaseInfo(), timeoutMs).then(
          (r) => ({
            available: installer.compareVersions(r.version, install.version) > 0 && st.skippedVersion !== r.version,
            version: r.version,
            installed: install.version,
            title: r.title,
          }),
          (e) => ({ error: e.message }),
        )
      : Promise.resolve(null);

  const launcherCheck =
    allowed && prefs.checkLauncherUpdates
      ? withTimeout(selfupdate.latestRelease(), timeoutMs).then(
          (r) => ({
            available:
              !!r.version && installer.compareVersions(r.version, ownVersion) > 0 && st.skippedLauncherVersion !== r.version,
            version: r.version,
            installed: ownVersion,
            url: r.url,
          }),
          (e) => ({ error: e.message }),
        )
      : Promise.resolve(null);

  const [wfs, launcher] = await Promise.all([wfsCheck, launcherCheck]);
  return { wfs, launcher };
}

// "Open download page" for a new Watch Face Studio: the setup window opens on
// the next start so the user can choose the downloaded installer.
function openWfsDownload() {
  shell.openExternal(installer.DOWNLOAD_PAGE);
  state.update({ pendingUpdate: true });
}

function skipWfsVersion(version) {
  state.update({ skippedVersion: version });
}

function skipLauncherVersion(version) {
  state.update({ skippedLauncherVersion: version });
}

async function showBox(options) {
  const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

// Background variant when the boot screen is switched off: checks after WFS
// has started and asks with dialogs.
async function checkInBackground() {
  const { wfs, launcher } = await checkAll({ timeoutMs: 15000 });
  if (wfs && wfs.available) {
    const { response } = await showBox({
      type: 'info',
      title: 'Watch Face Studio update',
      message: `Watch Face Studio ${wfs.version} is available (installed: ${wfs.installed}).`,
      detail:
        "Download the Windows version from Samsung's page in your browser. " +
        'The next time you start WF-Studio for Linux, the setup window opens; choose the downloaded file there. ' +
        'Nothing is downloaded automatically.',
      buttons: ['Open download page', 'Later', 'Skip this version'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) openWfsDownload();
    if (response === 2) skipWfsVersion(wfs.version);
  }
  if (launcher && launcher.available) {
    const { response } = await showBox({
      type: 'info',
      title: 'WF-Studio for Linux update',
      message: `WF-Studio for Linux ${launcher.version} is available (installed: ${launcher.installed}).`,
      detail: selfupdate.howToUpdate(),
      buttons: ['Open release page', 'Later', 'Skip this version'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) shell.openExternal(selfupdate.safeReleaseUrl(launcher.url));
    if (response === 2) skipLauncherVersion(launcher.version);
  }
}

module.exports = { checkAll, checkInBackground, openWfsDownload, skipWfsVersion, skipLauncherVersion };
