'use strict';

// Display / GPU related Chromium switches and diagnostics.
//
// Settings (settings.js) can be overridden with environment variables:
//   WFS_LINUX_OZONE=x11|wayland|auto   display backend (default: x11, Electron's default;
//                                      "auto" uses Wayland when WAYLAND_DISPLAY is set)
//   WFS_LINUX_IGNORE_GPU_BLOCKLIST=1   use hardware acceleration even on drivers that
//                                      Chromium blocklists
//   WFS_LINUX_DISABLE_GPU=1            force software rendering (for broken drivers)

const { app } = require('electron');

// Must run before the "ready" event. Environment variables override the
// stored settings (settings.js).
function applySwitches(env = process.env, prefs = require('./settings').read()) {
  const ozone = (env.WFS_LINUX_OZONE || prefs.ozone || 'x11').toLowerCase();
  if (ozone === 'wayland') {
    app.commandLine.appendSwitch('ozone-platform', 'wayland');
  } else if (ozone === 'auto') {
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  } else if (ozone !== 'x11') {
    console.warn(`[wf-studio-linux] ignoring unknown display backend "${ozone}" (use x11, wayland or auto)`);
  } else if (env.WFS_LINUX_OZONE) {
    app.commandLine.appendSwitch('ozone-platform', 'x11');
  }
  if (ozone === 'wayland' || ozone === 'auto') {
    // Client-side window decorations (title bar) on Wayland compositors without SSD.
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
  }
  if (env.WFS_LINUX_IGNORE_GPU_BLOCKLIST === '1' || prefs.ignoreGpuBlocklist) {
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
  }
  if (env.WFS_LINUX_DISABLE_GPU === '1' || prefs.disableGpu) app.disableHardwareAcceleration();
}

// Hardware acceleration status as data (used by --wfs-gpu-info and the settings).
async function gpuInfo() {
  await app.whenReady();
  const status = app.getGPUFeatureStatus();
  let info = {};
  try {
    info = await app.getGPUInfo('basic');
  } catch (e) {
    info = { error: e.message };
  }
  const devices = (info.gpuDevice || [])
    .filter((d) => d.active)
    .map((d) => `${d.vendorString || d.vendorId} ${d.deviceString || d.deviceId}`.trim());
  const accelerated = ['gpu_compositing', 'webgl', 'rasterization'].every((k) =>
    String(status[k] || '').startsWith('enabled'),
  );
  const backend =
    app.commandLine.getSwitchValue('ozone-platform') ||
    (app.commandLine.hasSwitch('ozone-platform-hint') ? 'auto (Wayland if available, else X11)' : 'x11 (default)');
  const features = {};
  for (const key of ['gpu_compositing', 'rasterization', 'webgl', 'video_decode', 'canvas_oop_rasterization']) {
    if (key in status) features[key] = status[key];
  }
  return {
    backend,
    devices,
    glRenderer: (info.auxAttributes && info.auxAttributes.glRenderer) || null,
    features,
    accelerated,
  };
}

// Prints whether rendering is hardware accelerated. Needs a display.
async function printGpuInfo() {
  const g = await gpuInfo();
  console.log('GPU / display:');
  console.log(`  backend          ${g.backend}`);
  console.log(`  active GPU       ${g.devices.join(', ') || 'unknown'}`);
  if (g.glRenderer) console.log(`  GL renderer      ${g.glRenderer}`);
  for (const [key, value] of Object.entries(g.features)) console.log(`  ${key.padEnd(16)} ${value}`);
  if (g.accelerated) {
    console.log('  => hardware acceleration is active');
  } else {
    console.log('  => SOFTWARE rendering: the UI may feel slow.');
    console.log('     Try "Ignore GPU blocklist" in the settings, or check your Mesa/NVIDIA driver installation.');
  }
  return g.accelerated;
}

module.exports = { applySwitches, gpuInfo, printGpuInfo };
