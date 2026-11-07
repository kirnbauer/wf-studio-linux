'use strict';

const $ = (id) => document.getElementById(id);
let info = null;

function showError(e) {
  const el = $('error');
  el.textContent = e ? String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '';
  el.hidden = !e;
}

async function act(fn) {
  showError(null);
  try {
    const res = await fn();
    if (res && res.prefs) render(res);
    return res;
  } catch (e) {
    showError(e);
    return null;
  }
}

function dl(el, rows) {
  el.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

function render(next) {
  info = next;
  const p = info.prefs;
  const env = info.envOverrides;

  // Display
  for (const r of document.querySelectorAll('input[name=ozone]')) r.checked = r.value === p.ozone;
  $('ozone-override').hidden = !env.ozone;
  $('ozone-override').textContent = env.ozone ? `Overridden by WFS_LINUX_OZONE=${env.ozone}` : '';
  $('ignoreGpuBlocklist').checked = p.ignoreGpuBlocklist || env.ignoreGpuBlocklist;
  $('ignoreGpuBlocklist').disabled = env.ignoreGpuBlocklist;
  $('disableGpu').checked = p.disableGpu || env.disableGpu;
  $('disableGpu').disabled = env.disableGpu;
  $('restart-bar').hidden = !info.restartNeeded;

  // Integration
  const ig = info.integration;
  if (ig.menuEntryManagedByPackage) {
    $('menu-status').textContent = 'Provided by the Flatpak.';
    $('btn-menu').hidden = true;
  } else {
    $('menu-status').textContent = ig.hasMenuEntry
      ? 'WF-Studio for Linux and WF-Studio Settings are in the start menu.'
      : 'Not in the start menu yet.';
    $('btn-menu').hidden = false;
    $('btn-menu').textContent = ig.hasMenuEntry ? 'Remove from start menu' : 'Add to start menu';
  }
  $('shortcut-status').textContent = ig.hasDesktopShortcut
    ? `Shortcut on the desktop (${ig.desktopDir}).`
    : `No shortcut on the desktop (${ig.desktopDir}).`;
  $('btn-shortcut').textContent = ig.hasDesktopShortcut ? 'Remove shortcut' : 'Create desktop shortcut';
  if (ig.kind === 'flatpak') {
    $('mime-status').textContent = 'Handled by the Flatpak: double-clicking .wfs files opens WF-Studio for Linux.';
    $('btn-mime').hidden = true;
  } else if (!ig.fileAssociationSupported) {
    $('mime-status').textContent = 'xdg-mime (xdg-utils) is not installed, so the default application cannot be set from here.';
    $('btn-mime').hidden = true;
  } else {
    $('mime-status').textContent = ig.isDefaultForWfs
      ? '.wfs files open with WF-Studio for Linux.'
      : '.wfs files do not open with WF-Studio for Linux yet.';
    $('btn-mime').hidden = ig.isDefaultForWfs;
    $('btn-mime').textContent = 'Open .wfs files with WF-Studio';
  }

  // Installation & updates
  const inst = info.install;
  dl($('install-info'), [
    ['Installed', inst ? `${inst.version}${inst.signedBy ? ` (signed by ${inst.signedBy})` : ''}` : 'not installed'],
    ['Previous version', info.previous ? info.previous.version : '–'],
    ['Status', info.wfsRunning ? 'running' : 'not running'],
  ]);
  $('btn-rollback').hidden = !info.previous;
  if (info.previous) $('btn-rollback').textContent = `Go back to ${info.previous.version}`;
  $('checkWfsUpdates').checked = p.checkWfsUpdates;
  $('checkLauncherUpdates').checked = p.checkLauncherUpdates;
  $('checkWfsUpdates').disabled = env.noUpdateCheck;
  $('checkLauncherUpdates').disabled = env.noUpdateCheck;
  $('update-override').hidden = !env.noUpdateCheck;

  // Startup & about
  $('bootScreen').checked = p.bootScreen;
  dl($('about'), [
    ['WF-Studio for Linux', info.versions.launcher],
    ['Package', { flatpak: 'Flatpak', appimage: 'AppImage', tarball: 'Bundle' }[info.packageKind] || info.packageKind],
    ['Electron', info.versions.electron],
    ['Watch Face Studio', inst ? inst.version : '–'],
    ['Data folder', info.dataDir],
  ]);

  $('btn-start-wfs').hidden = !info.canStartWfs;
}

async function loadGpu() {
  dl($('gpu'), [['Status', 'loading…']]);
  try {
    const g = await window.wfs.gpu();
    dl($('gpu'), [
      ['Acceleration', g.accelerated ? 'hardware (GPU)' : 'software – the UI may feel slow'],
      ['Backend', g.backend],
      ['GPU', g.devices.join(', ') || 'unknown'],
      ...(g.glRenderer ? [['Renderer', g.glRenderer]] : []),
      ...Object.entries(g.features).map(([k, v]) => [k.replace(/_/g, ' '), v]),
    ]);
  } catch (e) {
    dl($('gpu'), [['Status', String(e.message || e)]]);
  }
}

async function runSelftest() {
  const btn = $('btn-selftest');
  btn.disabled = true;
  btn.textContent = 'Running…';
  try {
    const res = await window.wfs.selftest();
    const body = $('selftest').querySelector('tbody');
    body.replaceChildren(
      ...res.map((r) => {
        const tr = document.createElement('tr');
        const a = document.createElement('td');
        a.className = r.ok ? 'ok' : 'fail';
        a.textContent = r.ok ? 'ok' : 'FAIL';
        const b = document.createElement('td');
        b.textContent = r.name;
        const c = document.createElement('td');
        c.textContent = r.detail;
        tr.append(a, b, c);
        return tr;
      }),
    );
    $('selftest').hidden = false;
  } catch (e) {
    showError(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run self-test';
  }
}

// Tabs
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
    for (const s of document.querySelectorAll('section[data-panel]')) s.hidden = s.dataset.panel !== tab.dataset.tab;
  });
}

// Preferences
for (const r of document.querySelectorAll('input[name=ozone]')) {
  r.addEventListener('change', () => act(() => window.wfs.set({ ozone: r.value })));
}
for (const id of ['ignoreGpuBlocklist', 'disableGpu', 'checkWfsUpdates', 'checkLauncherUpdates', 'bootScreen']) {
  $(id).addEventListener('change', () => act(() => window.wfs.set({ [id]: $(id).checked })));
}

// Actions
$('btn-restart').addEventListener('click', () => act(() => window.wfs.restart()));
$('btn-gpu').addEventListener('click', loadGpu);
$('btn-selftest').addEventListener('click', runSelftest);
$('btn-menu').addEventListener('click', () =>
  act(() => window.wfs.integration(info.integration.hasMenuEntry ? 'removeMenuEntry' : 'addMenuEntry')),
);
$('btn-shortcut').addEventListener('click', () =>
  act(() => window.wfs.integration(info.integration.hasDesktopShortcut ? 'removeDesktopShortcut' : 'addDesktopShortcut')),
);
$('btn-mime').addEventListener('click', () => act(() => window.wfs.integration('makeDefaultForWfs')));
$('btn-install').addEventListener('click', () => act(() => window.wfs.install()));
$('btn-rollback').addEventListener('click', () => act(() => window.wfs.rollback()));
$('btn-download').addEventListener('click', () => act(() => window.wfs.openUrl('download')));
$('btn-logs').addEventListener('click', () => act(() => window.wfs.openPath('logs')));
$('btn-data').addEventListener('click', () => act(() => window.wfs.openPath('data')));
$('btn-reset').addEventListener('click', () => act(() => window.wfs.reset()));
$('btn-repo').addEventListener('click', () => act(() => window.wfs.openUrl('repo')));
$('btn-docs').addEventListener('click', () => act(() => window.wfs.openUrl('docs')));
$('btn-start-wfs').addEventListener('click', () => act(() => window.wfs.startWfs()));

act(() => window.wfs.get());
loadGpu();
