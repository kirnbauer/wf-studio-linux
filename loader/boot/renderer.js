'use strict';

// Boot screen: quick tool check and update check, then starts Watch Face Studio
// automatically, unless the user interacts (any key or click keeps it open) or
// an update / problem needs attention.

const AUTO_START_SECONDS = 2;

const $ = (id) => document.getElementById(id);
const btnStart = $('btn-start');
const hint = $('hint');
const notices = $('notices');

let stay = false;
let countdown = null;

function setStep(id, cls, text) {
  const li = $(id);
  li.className = cls;
  li.querySelector('.text').textContent = text;
}

function stopAutoStart(reason) {
  stay = true;
  if (countdown) clearInterval(countdown);
  countdown = null;
  hint.textContent = reason || '';
}

function notice({ kind = 'warn', message, actions = [] }) {
  const div = document.createElement('div');
  div.className = `notice ${kind}`;
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = message;
  div.append(msg);
  for (const [label, fn, cls] of actions) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = `small ${cls || 'ghost'}`;
    b.addEventListener('click', async () => {
      await fn();
      div.remove();
    });
    div.append(b);
  }
  notices.append(div);
}

function start() {
  if (countdown) clearInterval(countdown);
  btnStart.disabled = true;
  hint.textContent = 'Starting Watch Face Studio…';
  window.boot.start();
}

function autoStart() {
  if (stay) return;
  let left = AUTO_START_SECONDS;
  hint.textContent = `Starting in ${left} s – press any key to stay here`;
  countdown = setInterval(() => {
    left -= 1;
    if (left <= 0) start();
    else hint.textContent = `Starting in ${left} s – press any key to stay here`;
  }, 1000);
}

async function run() {
  const info = await window.boot.info();
  $('versions').textContent = `Watch Face Studio ${info.wfsVersion} · WF-Studio for Linux ${info.launcherVersion}`;

  const tools = await window.boot.tools();
  if (tools.ok) {
    setStep('step-tools', 'ok', 'Tools ready');
  } else {
    setStep('step-tools', 'error', 'Some bundled tools are missing');
    notice({
      kind: 'error',
      message: `Missing: ${tools.missing.join(', ')}. Please reinstall WF-Studio for Linux.`,
    });
    stopAutoStart('A problem needs attention');
  }
  btnStart.disabled = false;

  const { wfs, launcher } = await window.boot.updates();
  const parts = [];
  if (!wfs && !launcher) {
    setStep('step-updates', 'skip', 'Update check disabled');
  } else {
    if (wfs && wfs.error) parts.push('Watch Face Studio: could not check');
    if (launcher && launcher.error) parts.push('WF-Studio for Linux: could not check');
    const available = (wfs && wfs.available) || (launcher && launcher.available);
    if (available) setStep('step-updates', 'warn', 'Updates available');
    else if (parts.length) setStep('step-updates', 'skip', `Up to date as far as known (${parts.join('; ')})`);
    else setStep('step-updates', 'ok', 'Everything up to date');
  }

  if (wfs && wfs.available) {
    notice({
      message: `Watch Face Studio ${wfs.version} is available (installed: ${wfs.installed}). Download it from Samsung; on the next start you choose the file.`,
      actions: [
        ['Open download page', () => window.boot.wfsDownload(), 'primary'],
        ['Skip version', () => window.boot.wfsSkip()],
      ],
    });
    stopAutoStart('Update available – click Start when ready');
  }
  if (launcher && launcher.available) {
    notice({
      message: `WF-Studio for Linux ${launcher.version} is available (installed: ${launcher.installed}).`,
      actions: [
        ['Release page', () => window.boot.launcherRelease(), 'primary'],
        ['Skip version', () => window.boot.launcherSkip()],
      ],
    });
    stopAutoStart('Update available – click Start when ready');
  }

  btnStart.focus();
  autoStart();
}

for (const ev of ['keydown', 'mousedown']) {
  window.addEventListener(ev, (e) => {
    if (e.type === 'keydown' && e.key === 'Enter' && document.activeElement === btnStart) return;
    if (!stay) stopAutoStart('Waiting – click Start when ready');
  }, true);
}
btnStart.addEventListener('click', start);
$('btn-settings').addEventListener('click', () => {
  stopAutoStart('Waiting – click Start when ready');
  window.boot.settings();
});
$('btn-quit').addEventListener('click', () => window.boot.quit());

run().catch((e) => {
  notice({ kind: 'error', message: String(e.message || e) });
  stopAutoStart();
  btnStart.disabled = false;
});
