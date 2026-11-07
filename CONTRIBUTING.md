# Contributing to WF-Studio for Linux

Thanks for helping! Bug reports, test reports from real hardware and pull requests are all welcome.

## Ground rules

- **Never commit, attach or link Samsung files**: not the installer, not `app.asar`, not
  extracted parts or screenshots of its code. This project must stay free of Samsung's
  proprietary software. Everyone gets Watch Face Studio from Samsung directly.
- **Don't patch Samsung's code.** Workarounds live in the loader (`loader/`) and adapt the
  environment Watch Face Studio runs in (see
  [Linux-specific fixes](docs/HOW-IT-WORKS.md#linux-specific-fixes)).
- Security problems: see [SECURITY.md](SECURITY.md). Please do not use public issues for them.

## Reporting bugs

Please include:

- the output of `--wfs-check` (run the AppImage or `flatpak run dev.kirnbauer.WFStudioLinux`
  with `--wfs-check`)
- distribution and version, desktop (GNOME/KDE/…), X11 or Wayland
- package type: AppImage, Flatpak (from the repo or the `.flatpak` file) or self-built
- WF-Studio for Linux version and Watch Face Studio version
- what you did, what you expected, what happened; Watch Face Studio's log is in
  `~/.config/WatchFaceStudio/logs/` (Flatpak: under `~/.var/app/dev.kirnbauer.WFStudioLinux/config/`)

**Test reports are just as valuable**: "Run on Device works with a Galaxy Watch 6 over Wi-Fi on
Fedora 41" helps everyone. Open an issue with the details.

## Development setup

Build once as described in [docs/BUILDING.md](docs/BUILDING.md):

```bash
scripts/build-bundle.sh
```

The loader is plain JavaScript without a build step. After editing files in `loader/`, copy them
into the built bundle instead of rebuilding everything:

```bash
cp -r loader/main.js loader/lib loader/setup loader/boot loader/settings build/wf-studio-linux/resources/app/
```

(`resources/app/assets/`, the icon and MIME file used by the boot screen and the desktop
integration, is copied from `packaging/` by `build-bundle.sh`.)

Run it with a separate data directory so your real installation is not touched:

```bash
WFS_LINUX_DATA_DIR=/tmp/wfs-dev WFS_LINUX_NO_UPDATE_CHECK=1 \
  build/wf-studio-linux/wf-studio --wfs-install-from="$HOME/Downloads/WatchFaceStudio_1.9.9.exe"
```

After the first install, start it without `--wfs-install-from`. Add `--no-sandbox` if Chromium
complains about the sandbox (the unpackaged bundle has no setuid `chrome-sandbox`).

Useful switches: `--wfs-setup`, `--wfs-rollback`, `--wfs-check`, `--wfs-gpu-info`. The full list
is in the [README](README.md#command-line-options).

## Dependencies of the loader

The loader uses **pnpm** (≥ 10; `packageManager` in `loader/package.json` pins 10.x for Corepack
and CI, but any installed pnpm 10–12 is used as-is without switching versions). Settings live in `loader/pnpm-workspace.yaml`: a flat `node_modules`
(`nodeLinker: hoisted`), no pnpm version switching (`pmOnFail: ignore`; for pnpm 10
`manage-package-manager-versions=false` in `loader/.npmrc`) and installing only sharp's WebAssembly build (see
[Why sharp runs as WebAssembly](docs/HOW-IT-WORKS.md#why-sharp-runs-as-webassembly)). After changing
dependencies, update the lockfile:

```bash
cd loader && pnpm install --lockfile-only
```

## Code style and checks

- **JavaScript** (`loader/`): CommonJS, `'use strict'`, no transpiler, no new runtime
  dependencies unless unavoidable (the bundle should stay small and auditable). Explain *why* in
  comments where Watch Face Studio's behaviour is worked around.
- **Shell** (`scripts/`): Bash with `set -euo pipefail`, quote variables.
- Before opening a PR, run:

  ```bash
  for f in loader/main.js loader/lib/*.js loader/setup/*.js; do node --check "$f"; done
  ```

  ```bash
  shellcheck scripts/*.sh
  ```

  ```bash
  desktop-file-validate packaging/dev.kirnbauer.WFStudioLinux.desktop
  ```

  ```bash
  scripts/build-bundle.sh   # ends with the self-test
  ```

## Updating dependencies

All bundled components are pinned in [`deps.env`](deps.env) by URL **and** sha256:

1. Change the URL and the sha256. Take the checksum from the upstream project where it is
   published (e.g. Electron's `SHASUMS256.txt`, Adoptium's API), otherwise download it yourself
   and compute it with `sha256sum`. Say in the PR where the checksum comes from.
2. Run `scripts/build-bundle.sh` (it verifies the checksums and runs the self-test).
3. For Electron: the major version must match the one Watch Face Studio was built with (see
   [Maintenance](docs/HOW-IT-WORKS.md#maintenance-when-samsung-releases-a-new-version)).

## Pull requests

- Keep PRs small and focused; one topic per PR.
- Describe what you changed and **how you tested it** (distro, package type, which Watch Face
  Studio features you tried).
- CI (`build` workflow) must be green.
- Update the README or `docs/` when behaviour or options change.

## Commit messages and releases

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat: …`, `fix(boot): …`,
`feat!: …` for breaking changes). Releases are cut by maintainers from
**Actions → release → Run workflow**; nobody edits version numbers or `CHANGELOG.md` by hand:

- The next version is derived from the commits since the last `v*` tag (`feat` → minor,
  everything else → patch, breaking → major, or minor while below 1.0). The bump can be forced.
- The workflow updates `CHANGELOG.md`, `loader/package.json` and the AppStream metainfo,
  commits, tags `vX.Y.Z` and starts the `build` workflow for the tag.
- That build publishes a **draft** GitHub release (notes from the changelog, plus `SHA256SUMS`)
  and updates the GitHub Pages site. Review the draft and publish it.
- Run it once with `dry_run` (the default) to preview the version and changelog.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE) (inbound = outbound). You keep the copyright on your contributions; there
is no CLA.
