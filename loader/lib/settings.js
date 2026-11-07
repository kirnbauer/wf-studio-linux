'use strict';

// User settings of WF-Studio for Linux (not Watch Face Studio's own settings),
// stored in <data dir>/settings.json. Environment variables still override them
// (see graphics.js and the README).

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const FILE = path.join(paths.dataDir, 'settings.json');

const DEFAULTS = Object.freeze({
  // Boot screen with update check and access to the settings on every start.
  bootScreen: true,
  // Look up the latest Watch Face Studio version on Samsung's download page.
  checkWfsUpdates: true,
  // Look up new releases of WF-Studio for Linux on GitHub.
  checkLauncherUpdates: true,
  // Display backend: 'x11' (Electron's default), 'wayland' or 'auto'.
  ozone: 'x11',
  // Use the GPU even on drivers that Chromium blocklists.
  ignoreGpuBlocklist: false,
  // Force software rendering.
  disableGpu: false,
});

function read() {
  try {
    const stored = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

function update(patch) {
  const next = { ...read() };
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULTS)) continue;
    if (typeof value !== typeof DEFAULTS[key]) continue;
    if (key === 'ozone' && !['x11', 'wayland', 'auto'].includes(value)) continue;
    next[key] = value;
  }
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  return next;
}

// Update checks can be switched off globally with WFS_LINUX_NO_UPDATE_CHECK=1.
function updateChecksAllowed() {
  return !process.env.WFS_LINUX_NO_UPDATE_CHECK;
}

module.exports = { DEFAULTS, read, update, updateChecksAllowed, FILE };
