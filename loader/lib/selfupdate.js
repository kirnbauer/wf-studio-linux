'use strict';

// Package type and release information of WF-Studio for Linux itself
// (the update check that uses it lives in updates.js).

const REPO = 'kirnbauer/wf-studio-linux';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

function packageKind() {
  if (process.env.FLATPAK_ID) return 'flatpak';
  if (process.env.APPIMAGE) return 'appimage';
  return 'tarball';
}

async function latestRelease() {
  const { net } = require('electron');
  const res = await net.fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wf-studio-linux' },
  });
  // 404: no release published yet, so nothing newer exists.
  if (res.status === 404) return { version: '', url: RELEASES_PAGE };
  if (!res.ok) throw new Error(`GitHub API returned HTTP ${res.status}`);
  const rel = await res.json();
  return { version: String(rel.tag_name || '').replace(/^v/, ''), url: rel.html_url || RELEASES_PAGE };
}

function howToUpdate() {
  return {
    flatpak:
      'Update it with your software centre or run:\n  flatpak update dev.kirnbauer.WFStudioLinux\n' +
      '(If you installed the .flatpak file, download the new one from the release page.)',
    appimage: 'Update the AppImage with Gear Lever / AppImageUpdate, or download the new AppImage from the release page.',
    tarball: 'Download the new version from the release page.',
  }[packageKind()];
}

// The release URL comes from the GitHub API response; only ever open our own repository's pages.
function safeReleaseUrl(url) {
  return typeof url === 'string' && url.startsWith(`https://github.com/${REPO}/`) ? url : RELEASES_PAGE;
}

module.exports = { packageKind, latestRelease, howToUpdate, safeReleaseUrl, RELEASES_PAGE, REPO };
