# Building WF-Studio for Linux yourself

You can build the AppImage and the Flatpak from source with three scripts. All third-party
components are downloaded from their official sources and verified against the sha256 checksums
in [`deps.env`](../deps.env). Watch Face Studio itself is never part of the build.

## 1. Requirements

x86_64 Linux, about 3 GB of free disk space, internet access for the first build.

**Debian / Ubuntu**

```bash
sudo apt install git curl unzip nodejs npm desktop-file-utils zsync
```

**Fedora**

```bash
sudo dnf install git curl unzip nodejs npm desktop-file-utils zsync
```

**openSUSE**

```bash
sudo zypper install git curl unzip nodejs npm desktop-file-utils zsync
```

**Arch Linux**

```bash
sudo pacman -S --needed git curl unzip nodejs npm desktop-file-utils zsync
```

Node.js 18 or newer is required, and **pnpm** (the loader's package manager). The easiest way is
Corepack, which ships with Node.js and uses exactly the pnpm version pinned in
`loader/package.json`:

```bash
sudo corepack enable
```

Without Corepack (Node.js 25 and newer no longer ship it), install the pinned pnpm with npm:

```bash
sudo npm install -g pnpm@10.34.9
```

(Or install pnpm from your distribution. On some distributions Corepack is a separate
`corepack` package.) Any pnpm **10, 11 or 12** works: the build uses the pnpm you have and does
not switch versions (`pmOnFail: ignore` in `loader/pnpm-workspace.yaml`). `packageManager` in
`loader/package.json` pins pnpm 10 for Corepack and CI, because from pnpm 12 on the npm package
is only a wrapper around a native binary that npm installs as an optional dependency, which
breaks in several setups (see Troubleshooting). For the Flatpak you additionally need `flatpak` and
`flatpak-builder` (same package names on all three).

## 2. Get the source

```bash
git clone https://github.com/kirnbauer/wf-studio-linux.git
```

```bash
cd wf-studio-linux
```

## 3. Build

### Bundle (required first)

```bash
scripts/build-bundle.sh
```

This downloads Electron, the Android tools, the JDK and 7-Zip (cached in `.cache/deps`, or in
`$WFS_DEPS_CACHE` if set), assembles `build/wf-studio-linux/`, runs the self-test and writes
`dist/wf-studio-linux-<version>-x86_64.tar.gz`. The last lines should read:

```
all checks passed
==> …/dist/wf-studio-linux-0.1.0-x86_64.tar.gz
```

### AppImage

```bash
scripts/build-appimage.sh
```

Output: `dist/WF-Studio-Linux-<version>-x86_64.AppImage` and its `.zsync` file. For a private
build without update information:

```bash
WFS_APPIMAGE_UPDATE_INFO= scripts/build-appimage.sh
```

### Flatpak

```bash
scripts/build-flatpak.sh
```

The script adds the Flathub remote for your user if needed and installs the runtimes
(`org.freedesktop.Platform//26.08`, `org.electronjs.Electron2.BaseApp//26.08`) on the first run.
Output: `dist/WF-Studio-Linux-<version>-x86_64.flatpak` and a local OSTree repo in
`build/flatpak-repo`.

## 4. Run and install your build

Run the bundle directly, without packaging:

```bash
build/wf-studio-linux/wf-studio --no-sandbox
```

Run the AppImage:

```bash
./dist/WF-Studio-Linux-*-x86_64.AppImage
```

Install the Flatpak:

```bash
flatpak install --user dist/WF-Studio-Linux-*-x86_64.flatpak
```

```bash
flatpak run dev.kirnbauer.WFStudioLinux
```

Self-built and official packages use the same app ID and data directories, so they replace each
other.

## 5. Verify

- **Self-test**: `--wfs-check` on any build checks every bundled tool and prints the GPU status.
- **Checksums**: every URL and sha256 in `deps.env` can be compared with the upstream project's
  published checksums (Electron `SHASUMS256.txt`, Adoptium API, `sha256sum` of Google's and
  7-Zip's downloads).
- **CI**: [`.github/workflows/build.yml`](../.github/workflows/build.yml) runs exactly these
  scripts on Ubuntu 24.04 and in the Flathub build container, so you can compare your result
  with the release artifacts.

## Troubleshooting

| Problem | Solution |
| --- | --- |
| `no @pnpm/exe.linux-x64 native binary was found for this host` / `Failed to switch pnpm to v…` / `PNPM_ENGINE_IDENTITY_UNVERIFIABLE` | pnpm tried to switch to the version in `packageManager` and failed (missing native binary of pnpm ≥ 12 when npm skipped optional dependencies; pnpm ≥ 11.20 on musl, [pnpm#13622](https://github.com/pnpm/pnpm/issues/13622)). The project disables switching in `loader/pnpm-workspace.yaml` (`pmOnFail: ignore`; for pnpm 10 `manage-package-manager-versions=false` in `loader/.npmrc`), so pull the latest source. If your own pnpm install is broken, reinstall it: `sudo npm install -g pnpm@10.34.9`. |
| `this host uses musl libc` | Build on a glibc distribution; the bundle (Electron, Android tools, JDK) does not run on musl (Alpine). |
| `pnpm is required` | `sudo corepack enable`, see [Requirements](#1-requirements). |
| `@img/sharp-wasm32 is missing` / `a native sharp build was installed` | Keep `supportedArchitectures` in `loader/pnpm-workspace.yaml` (cpu: wasm32) and rerun. |
| `ERROR: checksum mismatch` | The download was corrupted or changed upstream. Delete the file in `.cache/deps` and retry; if it persists, open an issue (don't just change the checksum). |
| `desktop-file-validate is required` / `zsyncmake is required` | Install `desktop-file-utils` / `zsync`. |
| appimagetool fails with a FUSE error | The script already uses `APPIMAGE_EXTRACT_AND_RUN=1`; make sure `/tmp` is not mounted `noexec`. |
| Flatpak runtimes not found | `flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo`, then rerun. |
| Downloads fail behind a proxy | `curl` and `pnpm` honour `HTTPS_PROXY`; with TLS interception set `CURL_CA_BUNDLE` / `NODE_EXTRA_CA_CERTS`. |
| `Running as root without --no-sandbox is not supported` | Don't run the app as root, or add `--no-sandbox` for testing. |

## Releasing

Releases are made by the `release` GitHub workflow (see [RELEASING.md](RELEASING.md) and [CONTRIBUTING.md](../CONTRIBUTING.md#commit-messages-and-releases)).
Its logic lives in `scripts/release-prepare.mjs` and can be previewed locally with
`node scripts/release-prepare.mjs --dry-run`. `scripts/render-pages.mjs` renders the GitHub Pages
landing page from `packaging/pages/index.html`.
