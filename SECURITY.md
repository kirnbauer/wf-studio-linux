# Security Policy

## Supported versions

Only the **latest release** of WF-Studio for Linux receives security fixes. Please update before
reporting, and mention the version you use (`--wfs-check` prints the bundle path; the release
version is in the file name and in *About* of your software centre).

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub: open the repository's **Security** tab and click
**Report a vulnerability** ([direct link](https://github.com/kirnbauer/wf-studio-linux/security/advisories/new)).

Please include:

- what an attacker can do, and the preconditions (local user, file in `~/Downloads`, network position, …)
- steps to reproduce or a proof of concept
- WF-Studio for Linux version, package type (AppImage / Flatpak / tarball), distribution

What to expect:

- confirmation within **7 days**
- an assessment and, if confirmed, a fix or mitigation plan within **30 days**
- credit in the release notes and the advisory, unless you prefer to stay anonymous

## Scope

In scope, everything in this repository:

| Area | Examples |
| --- | --- |
| Installer verification | bypassing the Samsung signature check (`loader/lib/authenticode.js`), installing a manipulated or foreign installer |
| Installation / unpacking | path traversal or overwriting files outside the install directory, unsafe handling of `state.json` |
| Loader | argument and path handling, the `require` redirect, IPC between the setup window and the main process (`loader/main.js`, `loader/setup/`) |
| Packaging | AppImage launcher, Flatpak permissions in `flatpak/dev.kirnbauer.WFStudioLinux.yml` |
| Supply chain | pinned third-party downloads (`deps.env`, `scripts/fetch-deps.sh`), CI and release workflow (`.github/workflows/`) |

Out of scope, please report upstream:

- **Watch Face Studio itself** (its code in `app.asar`, its behaviour): report to Samsung via the
  [Samsung Developer forum](https://forum.developer.samsung.com/c/watch-face-studio) or
  [Samsung Mobile Security](https://security.samsungmobile.com/).
- **Bundled upstream components**: Electron/Chromium, Android SDK tools, Eclipse Temurin, 7-Zip,
  sharp/libvips. Report to the respective project. Do tell us if a pinned version is affected, so
  we can update it.

## Security model in short

- WF-Studio for Linux **never downloads executables on its own**. The user downloads Samsung's
  installer in the browser; installing always requires a click.
- Every installer must carry a valid **Authenticode signature by Samsung Electronics Co., Ltd.**
  (file hash, PKCS#7 signature, code-signing certificate chaining to a trusted root) before
  anything is unpacked.
- All bundled third-party components are pinned by **sha256** and verified at build time.

Known limitations (documented, not considered vulnerabilities):

- Certificate revocation is not checked; `WFS_LINUX_SKIP_SIGNATURE_CHECK=1` disables the check
  entirely (opt-in, documented as not recommended).
- The AppImage runs Chromium with `--no-sandbox` (a setuid sandbox helper cannot run from a FUSE
  mount). The Flatpak keeps the sandbox.
- The Flatpak requests `--filesystem=home` and `--device=all` (projects anywhere in the home
  directory; adb over USB). USB cannot be limited to one vendor ID because watches from many
  vendors (Samsung, Google, Mobvoi, …) are supported; narrower `--usb` rules need Flatpak >= 1.16.
- The Flatpak repository on GitHub Pages is GPG-signed with a key held in a CI secret; whoever
  controls that secret can sign malicious updates.

Details: [How this application works – Security and legal notes](docs/HOW-IT-WORKS.md#security-and-legal-notes).
