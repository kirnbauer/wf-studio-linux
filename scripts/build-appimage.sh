#!/usr/bin/env bash
# Packs build/wf-studio-linux (see build-bundle.sh) into dist/WF-Studio-Linux-<version>-x86_64.AppImage.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${WFS_DEPS_CACHE:-$ROOT/.cache/deps}"
BUNDLE="$ROOT/build/wf-studio-linux"
APPDIR="$ROOT/build/AppDir"
ID=dev.kirnbauer.WFStudioLinux

for tool in desktop-file-validate zsyncmake; do
  command -v "$tool" >/dev/null || {
    echo "ERROR: $tool is required (packages desktop-file-utils, zsync)" >&2
    exit 1
  }
done

[ -x "$BUNDLE/wf-studio" ] || "$ROOT/scripts/build-bundle.sh"
"$ROOT/scripts/fetch-deps.sh" APPIMAGETOOL APPIMAGE_RUNTIME

VERSION="$(node -p "require('$ROOT/loader/package.json').version")"
OUTFILE="$ROOT/dist/WF-Studio-Linux-$VERSION-x86_64.AppImage"

echo "==> AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/lib" "$APPDIR/usr/share/applications" "$APPDIR/usr/share/metainfo" \
  "$APPDIR/usr/share/mime/packages" "$APPDIR/usr/share/icons/hicolor/scalable/apps"
cp -a "$BUNDLE" "$APPDIR/usr/lib/wf-studio-linux"
# The setuid sandbox helper cannot work from a FUSE mount (see AppRun).
rm -f "$APPDIR/usr/lib/wf-studio-linux/chrome-sandbox"

cp "$ROOT/packaging/$ID.desktop" "$ROOT/packaging/$ID.Settings.desktop" "$APPDIR/usr/share/applications/"
cp "$ROOT/packaging/$ID.desktop" "$APPDIR/"
cp "$ROOT/packaging/$ID.metainfo.xml" "$APPDIR/usr/share/metainfo/$ID.appdata.xml"
cp "$ROOT/packaging/$ID.mime.xml" "$APPDIR/usr/share/mime/packages/$ID.xml"
cp "$ROOT/packaging/$ID.svg" "$APPDIR/usr/share/icons/hicolor/scalable/apps/"
cp "$ROOT/packaging/$ID.svg" "$APPDIR/"
ln -s "$ID.svg" "$APPDIR/.DirIcon"

cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
# Chromium's setuid sandbox helper cannot run from an AppImage (FUSE mounts are
# nosuid) and unprivileged user namespaces are blocked on several distributions,
# so the Chromium sandbox is disabled. WFS only loads local, bundled content.
HERE="$(dirname "$(readlink -f "$0")")"
# Used by WF-Studio for Linux to restart itself and for desktop shortcuts.
export WFS_LINUX_LAUNCHER="${APPIMAGE:-$0}"
exec "$HERE/usr/lib/wf-studio-linux/wf-studio" --no-sandbox "$@"
EOF
chmod +x "$APPDIR/AppRun"

echo "==> appimagetool"
TOOL="$(ls "$CACHE"/appimagetool-*)"
RUNTIME="$(ls "$CACHE"/appimage_runtime-*)"
chmod +x "$TOOL"
mkdir -p "$ROOT/dist"
# Extract-and-run: works without FUSE (CI containers).
# Update information for AppImageUpdate / Gear Lever (delta updates from GitHub
# releases); appimagetool also writes the matching .zsync file next to the AppImage.
UPDATE_INFO="${WFS_APPIMAGE_UPDATE_INFO-gh-releases-zsync|kirnbauer|wf-studio-linux|latest|WF-Studio-Linux-*-x86_64.AppImage.zsync}"
UPDATE_ARGS=()
[ -n "$UPDATE_INFO" ] && UPDATE_ARGS=(--updateinformation "$UPDATE_INFO")
(cd "$ROOT/dist" && APPIMAGE_EXTRACT_AND_RUN=1 ARCH=x86_64 "$TOOL" --no-appstream --runtime-file "$RUNTIME" \
  "${UPDATE_ARGS[@]}" "$APPDIR" "$OUTFILE")
if [ -n "$UPDATE_INFO" ]; then
  # Delta-update metadata for AppImageUpdate / Gear Lever (uploaded with the release).
  (cd "$ROOT/dist" && zsyncmake -u "$(basename "$OUTFILE")" -o "$(basename "$OUTFILE").zsync" "$(basename "$OUTFILE")")
fi
echo "==> $OUTFILE ($(du -h "$OUTFILE" | cut -f1))"
