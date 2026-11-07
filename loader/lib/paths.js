'use strict';

const os = require('os');
const path = require('path');

// Directory that contains the Electron binary (the bundle root).
const bundleRoot = path.dirname(process.execPath);

// Native Linux helpers shipped with the bundle (Android build tools, JDK, 7-Zip).
const supportDir = process.env.WFS_LINUX_SUPPORT_DIR || path.join(bundleRoot, 'support');
const toolsLinuxDir = path.join(supportDir, 'tools-linux');
const sevenZip = path.join(supportDir, '7zz');

function dataHome() {
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME;
  return path.join(os.homedir(), '.local', 'share');
}

// Where the downloaded Watch Face Studio installs live (writable, per user).
const dataDir = process.env.WFS_LINUX_DATA_DIR || path.join(dataHome(), 'wf-studio-linux');
const installsDir = path.join(dataDir, 'installs');
const cacheDir = path.join(dataDir, 'cache');
const stateFile = path.join(dataDir, 'state.json');

module.exports = {
  bundleRoot,
  supportDir,
  toolsLinuxDir,
  sevenZip,
  dataDir,
  installsDir,
  cacheDir,
  stateFile,
};
