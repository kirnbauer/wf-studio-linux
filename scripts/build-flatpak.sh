#!/usr/bin/env bash
# Builds dist/WF-Studio-Linux-<version>-x86_64.flatpak from build/wf-studio-linux.
# Requires flatpak + flatpak-builder and the Flathub remote (runtimes are
# installed automatically with --install-deps-from=flathub).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ID=dev.kirnbauer.WFStudioLinux
MANIFEST="$ROOT/flatpak/$ID.yml"
VERSION="$(node -p "require('$ROOT/loader/package.json').version")"
OUTFILE="$ROOT/dist/WF-Studio-Linux-$VERSION-x86_64.flatpak"
REPO="$ROOT/build/flatpak-repo"

TARBALL="$ROOT/dist/wf-studio-linux-$VERSION-x86_64.tar.gz"
[ -f "$TARBALL" ] || "$ROOT/scripts/build-bundle.sh"
mkdir -p "$ROOT/build/flatpak-src"
cp "$TARBALL" "$ROOT/build/flatpak-src/wf-studio-linux-x86_64.tar.gz"

flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

# No build cache: the module only copies the prebuilt bundle, and a local archive
# without checksum would not invalidate the cache when the bundle changes.
flatpak-builder --user --install-deps-from=flathub --force-clean --disable-rofiles-fuse --disable-cache \
  --state-dir="$ROOT/build/.flatpak-builder" --repo="$REPO" \
  "$ROOT/build/flatpak-build" "$MANIFEST"

flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  "$REPO" "$OUTFILE" "$ID"
echo "==> $OUTFILE ($(du -h "$OUTFILE" | cut -f1))"
