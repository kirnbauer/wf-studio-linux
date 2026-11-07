'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  installed: $('installed'),
  latest: $('latest'),
  previousRow: $('previous-row'),
  previous: $('previous'),
  progressBox: $('progress-box'),
  phase: $('phase'),
  bar: $('bar'),
  detail: $('detail'),
  error: $('error'),
  btnFile: $('btn-file'),
  btnPage: $('btn-page'),
  btnStart: $('btn-start'),
  btnRollback: $('btn-rollback'),
};


function showError(e) {
  els.error.textContent = e ? String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '';
  els.error.hidden = !e;
}

function setBusy(b) {
  document.querySelectorAll('button').forEach((btn) => {
    if (btn !== els.btnPage) btn.disabled = b;
  });
}

async function loadInfo() {
  const info = await window.setup.info();
  els.installed.textContent = info.installed ? `Watch Face Studio ${info.installed.version}` : 'not installed';
  els.btnStart.hidden = !info.installed;
  els.previousRow.hidden = !info.previous;
  els.btnRollback.hidden = !info.previous;
  if (info.previous) {
    els.previous.textContent = `Watch Face Studio ${info.previous.version}`;
    els.btnRollback.textContent = `Go back to ${info.previous.version}`;
  }
}

async function loadRelease() {
  try {
    const release = await window.setup.release();
    els.latest.textContent = release.title;
  } catch {
    els.latest.textContent = 'could not check (offline?)';
  }
}

async function runInstall(fn) {
  showError(null);
  setBusy(true);
  els.progressBox.hidden = false;
  els.phase.textContent = 'Preparing…';
  els.bar.removeAttribute('value');
  els.detail.textContent = '';
  try {
    const result = await fn();
    if (!result) {
      els.progressBox.hidden = true;
      return;
    }
    els.phase.textContent = `Watch Face Studio ${result.version} is ready. Starting…`;
    els.bar.value = 100;
    await window.setup.launch();
  } catch (e) {
    els.progressBox.hidden = true;
    showError(e);
  } finally {
    setBusy(false);
    loadInfo();
  }
}

window.setup.onProgress((s) => {
  els.phase.textContent = s.phase;
  if (typeof s.percent === 'number') els.bar.value = s.percent;
  else els.bar.removeAttribute('value');
  els.detail.textContent = '';
});

els.btnFile.addEventListener('click', () => runInstall(() => window.setup.installFile()));
els.btnPage.addEventListener('click', () => window.setup.openDownloadPage());
els.btnStart.addEventListener('click', () => window.setup.launch());
els.btnRollback.addEventListener('click', () => runInstall(() => window.setup.rollback()));

loadInfo().then(loadRelease);
