'use strict';

// Restarts WF-Studio for Linux, e.g. after changing display settings (Chromium
// reads them only at startup) or to reset/roll back the installation.
//
// The package launchers (AppImage AppRun, Flatpak wrapper) export
// WFS_LINUX_LAUNCHER, so the restart goes through them again: the AppImage mount
// disappears when this process exits, and inside Flatpak the zypak wrapper must
// start the new process. (app.relaunch() is not used: it did not reliably
// start the new process in tests.)

const { spawn } = require('child_process');
const { app } = require('electron');

function relaunch(extraArgs = []) {
  const launcher = process.env.WFS_LINUX_LAUNCHER;
  const cmd = launcher || process.execPath;
  // Without a package launcher, keep switches the launcher would have added.
  const own = launcher ? [] : app.commandLine.hasSwitch('no-sandbox') ? ['--no-sandbox'] : [];
  // --wfs-relaunched: the new instance waits for this one to release the
  // single-instance lock instead of handing over to it.
  const args = [...own, '--wfs-relaunched', ...extraArgs];
  // Detached: the new process must survive this one exiting.
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  app.exit(0);
}

module.exports = { relaunch };
