'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

function read() {
  try {
    return JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function write(state) {
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const tmp = `${paths.stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, paths.stateFile);
}

function update(patch) {
  const next = { ...read(), ...patch };
  write(next);
  return next;
}

// Returns { version, dir } of the active install, or null if none is usable.
function currentInstall() {
  const { current } = read();
  return usable(current) ? current : null;
}

function usable(install) {
  return !!(install && install.dir && fs.existsSync(path.join(install.dir, 'resources', 'app.asar')));
}

// The install that was active before the last update, if still on disk.
function previousInstall() {
  const { previous } = read();
  return usable(previous) ? previous : null;
}

// True when the last start of the current install never got WFS' window up
// (crash or hang right after an update).
function lastStartFailed() {
  const { current } = read();
  return !!(current && !current.verified && (current.launchAttempts || 0) > 0);
}

// Makes the previous install current again; the failed one becomes "previous"
// (so it can be retried) and its version is not offered as update again.
function rollback() {
  const st = read();
  if (!usable(st.previous)) throw new Error('No previous Watch Face Studio version available.');
  const failed = st.current;
  write({
    ...st,
    current: { ...st.previous, verified: true, launchAttempts: 0 },
    previous: failed ? { ...failed, launchAttempts: 0 } : null,
    skippedVersion: failed ? failed.version : st.skippedVersion,
    pendingUpdate: false,
  });
  return read().current;
}

function patchCurrent(patch) {
  const st = read();
  if (!st.current) return;
  write({ ...st, current: { ...st.current, ...patch } });
}

module.exports = { read, write, update, currentInstall, previousInstall, lastStartFailed, rollback, patchCurrent };
