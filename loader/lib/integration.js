'use strict';

// Desktop integration from the settings: start-menu entry, desktop shortcut and
// the ".wfs" file association.
//
// The Flatpak installs its menu entry, icon and MIME types itself; the AppImage
// and the plain bundle have none until the user adds them here.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { packageKind } = require('./selfupdate');

const APP_ID = 'dev.kirnbauer.WFStudioLinux';
const SETTINGS_ID = `${APP_ID}.Settings`;
const MIME_TYPES = ['application/x-watchfacestudio-project', 'application/x-watchfacestudio-plugin'];
const ASSETS = path.join(__dirname, '..', 'assets');

const home = os.homedir();
const dataHome = process.env.XDG_DATA_HOME && !process.env.FLATPAK_ID ? process.env.XDG_DATA_HOME : path.join(home, '.local', 'share');
const appsDir = path.join(dataHome, 'applications');
const iconFile = path.join(dataHome, 'icons', 'hicolor', 'scalable', 'apps', `${APP_ID}.svg`);
const mimeFile = path.join(dataHome, 'mime', 'packages', `${APP_ID}.xml`);

function desktopDir() {
  try {
    const cfg = fs.readFileSync(path.join(process.env.XDG_CONFIG_HOME && !process.env.FLATPAK_ID ? process.env.XDG_CONFIG_HOME : path.join(home, '.config'), 'user-dirs.dirs'), 'utf8');
    const m = cfg.match(/^XDG_DESKTOP_DIR="?([^"\n]+)"?/m);
    if (m) return m[1].replace('$HOME', home);
  } catch {
    /* default below */
  }
  return path.join(home, 'Desktop');
}

function quote(arg) {
  return /[\s"'\\$`]/.test(arg) ? `"${arg.replace(/(["\\$`])/g, '\\$1')}"` : arg;
}

// Command that starts this installation from a .desktop file.
function launchCommand() {
  switch (packageKind()) {
    case 'flatpak':
      return `flatpak run ${APP_ID}`;
    case 'appimage':
      return quote(process.env.APPIMAGE);
    default:
      return quote(process.env.WFS_LINUX_LAUNCHER || process.execPath);
  }
}

function iconName() {
  // Flatpak installs the themed icon; otherwise use the copy we install.
  return packageKind() === 'flatpak' ? APP_ID : iconFile;
}

function mainEntry() {
  const cmd = launchCommand();
  return `[Desktop Entry]
Type=Application
Name=WF-Studio for Linux
GenericName=Watch Face Designer
Comment=Design watch faces for Wear OS – unofficial Linux launcher for Samsung Galaxy Watch Face Studio
Exec=${cmd} %f
Icon=${iconName()}
Terminal=false
Categories=Graphics;2DGraphics;
MimeType=${MIME_TYPES.join(';')};
Keywords=Watch Face Studio;Wear OS;Galaxy Watch;watch face;WFS;
StartupWMClass=WatchFaceStudio
Actions=settings;

[Desktop Action settings]
Name=WF-Studio Settings
Exec=${cmd} --wfs-settings
`;
}

function settingsEntry() {
  return `[Desktop Entry]
Type=Application
Name=WF-Studio Settings
Comment=Settings, desktop integration and installation of WF-Studio for Linux
Exec=${launchCommand()} --wfs-settings
Icon=${iconName()}
Terminal=false
Categories=Graphics;2DGraphics;
StartupWMClass=WatchFaceStudio
`;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000 });
  return r.error ? null : r;
}

function refreshCaches() {
  run('update-desktop-database', [appsDir]);
  run('update-mime-database', [path.join(dataHome, 'mime')]);
}

function writeFile(file, content, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode });
  fs.chmodSync(file, mode);
}

// ---- start menu ------------------------------------------------------------

function menuEntryManagedByPackage() {
  return packageKind() === 'flatpak';
}

function hasMenuEntry() {
  return fs.existsSync(path.join(appsDir, `${APP_ID}.desktop`));
}

function addMenuEntry() {
  if (menuEntryManagedByPackage()) throw new Error('The Flatpak already provides the menu entry.');
  writeFile(iconFile, fs.readFileSync(path.join(ASSETS, 'icon.svg')));
  writeFile(mimeFile, fs.readFileSync(path.join(ASSETS, 'mime.xml')));
  writeFile(path.join(appsDir, `${APP_ID}.desktop`), mainEntry());
  writeFile(path.join(appsDir, `${SETTINGS_ID}.desktop`), settingsEntry());
  refreshCaches();
}

function removeMenuEntry() {
  for (const f of [path.join(appsDir, `${APP_ID}.desktop`), path.join(appsDir, `${SETTINGS_ID}.desktop`), mimeFile, iconFile]) {
    fs.rmSync(f, { force: true });
  }
  refreshCaches();
}

// ---- desktop shortcut ------------------------------------------------------

function shortcutFile() {
  return path.join(desktopDir(), `${APP_ID}.desktop`);
}

function hasDesktopShortcut() {
  return fs.existsSync(shortcutFile());
}

function addDesktopShortcut() {
  if (packageKind() !== 'flatpak') writeFile(iconFile, fs.readFileSync(path.join(ASSETS, 'icon.svg')));
  const file = shortcutFile();
  writeFile(file, mainEntry(), 0o755);
  // GNOME/Nautilus only launches desktop files marked as trusted.
  run('gio', ['set', file, 'metadata::trusted', 'true']);
}

function removeDesktopShortcut() {
  fs.rmSync(shortcutFile(), { force: true });
}

// ---- file association ------------------------------------------------------

function fileAssociationSupported() {
  // Inside the Flatpak sandbox xdg-mime would only change the sandbox's config.
  return packageKind() !== 'flatpak' && !!run('xdg-mime', ['--version']);
}

function isDefaultForWfs() {
  const r = run('xdg-mime', ['query', 'default', MIME_TYPES[0]]);
  return !!(r && r.stdout && r.stdout.trim() === `${APP_ID}.desktop`);
}

function makeDefaultForWfs() {
  if (!hasMenuEntry()) addMenuEntry();
  for (const type of MIME_TYPES) {
    const r = run('xdg-mime', ['default', `${APP_ID}.desktop`, type]);
    if (!r || r.status !== 0) throw new Error('xdg-mime failed; is xdg-utils installed?');
  }
}

function status() {
  const kind = packageKind();
  return {
    kind,
    menuEntryManagedByPackage: menuEntryManagedByPackage(),
    hasMenuEntry: menuEntryManagedByPackage() || hasMenuEntry(),
    hasDesktopShortcut: hasDesktopShortcut(),
    desktopDir: desktopDir(),
    fileAssociationSupported: fileAssociationSupported(),
    isDefaultForWfs: fileAssociationSupported() ? isDefaultForWfs() : kind === 'flatpak',
  };
}

module.exports = {
  APP_ID,
  status,
  addMenuEntry,
  removeMenuEntry,
  addDesktopShortcut,
  removeDesktopShortcut,
  makeDefaultForWfs,
};
