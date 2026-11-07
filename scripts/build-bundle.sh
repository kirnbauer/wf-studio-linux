#!/usr/bin/env bash
# Assembles the distribution-neutral bundle that AppImage and Flatpak both package:
#
#   build/wf-studio-linux/
#     wf-studio            Electron (renamed so app.isPackaged is true)
#     resources/app/             loader (main.js, setup UI, sharp as WebAssembly)
#     support/7zz                unpacks Samsung's installer (static 7-Zip build)
#     support/tools-linux/       native replacements for WFS' tools/window:
#       aapt aapt2 zipalign apksigner lib/apksigner.jar lib64/ adb jdk/
#     LICENSES/                  third-party notices
#
# and packs it as dist/wf-studio-linux-<version>-x86_64.tar.gz.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${WFS_DEPS_CACHE:-$ROOT/.cache/deps}"
OUT="$ROOT/build/wf-studio-linux"
DIST="$ROOT/dist"
WORK="$ROOT/build/work"

# The bundle (Electron, Android tools, JDK) is built for glibc; on musl hosts
# (Alpine, …) neither the build's self-test nor the result would run.
if ldd --version 2>&1 | grep -qi musl || compgen -G "/lib/ld-musl-*" >/dev/null; then
  echo "ERROR: this host uses musl libc. WF-Studio for Linux is built for glibc x86_64;" >&2
  echo "       build on a glibc distribution (Debian, Ubuntu, Fedora, openSUSE, Arch, ...)." >&2
  exit 1
fi

command -v pnpm >/dev/null || {
  echo "ERROR: pnpm (>= 10) is required: 'corepack enable' or 'npm install -g pnpm@10'." >&2
  exit 1
}
# Any pnpm >= 10 is used as-is: version switching to package.json's
# "packageManager" is disabled in loader/pnpm-workspace.yaml.
PNPM_MAJOR="$(cd "$ROOT/loader" && pnpm --version 2>/dev/null | cut -d. -f1)"
if ! [ "${PNPM_MAJOR:-0}" -ge 10 ] 2>/dev/null; then
  echo "ERROR: pnpm >= 10 is required (found: $(cd "$ROOT/loader" && pnpm --version 2>&1 | tail -1))." >&2
  exit 1
fi

"$ROOT/scripts/fetch-deps.sh" ELECTRON BUILD_TOOLS PLATFORM_TOOLS JDK SEVENZIP

# Cached file of a dependency (see fetch-deps.sh for the naming).
dep() {
  local files=("$CACHE"/"$1"-*)
  echo "${files[0]}"
}

VERSION="$(node -p "require('$ROOT/loader/package.json').version")"
echo "==> building wf-studio-linux bundle $VERSION"

rm -rf "$OUT" "$WORK"
mkdir -p "$OUT" "$WORK" "$DIST"

echo "==> Electron"
unzip -q "$(dep electron)" -d "$OUT"
mv "$OUT/electron" "$OUT/wf-studio"
rm -f "$OUT/resources/default_app.asar"
mkdir -p "$OUT/LICENSES"
mv "$OUT/LICENSE" "$OUT/LICENSES/electron.txt"
mv "$OUT/LICENSES.chromium.html" "$OUT/LICENSES/chromium.html"
rm -f "$OUT/version"

echo "==> loader"
APP="$OUT/resources/app"
mkdir -p "$APP"
cp -r "$ROOT/loader/main.js" "$ROOT/loader/lib" "$ROOT/loader/setup" "$ROOT/loader/boot" "$ROOT/loader/settings" \
  "$ROOT/loader/package.json" "$ROOT/loader/pnpm-lock.yaml" "$ROOT/loader/pnpm-workspace.yaml" "$ROOT/loader/.npmrc" "$APP/"
# Icon and MIME types for the boot screen and the desktop integration (settings).
mkdir -p "$APP/assets"
cp "$ROOT/packaging/dev.kirnbauer.WFStudioLinux.svg" "$APP/assets/icon.svg"
cp "$ROOT/packaging/dev.kirnbauer.WFStudioLinux.mime.xml" "$APP/assets/mime.xml"
# sharp runs as WebAssembly (see loader/pnpm-workspace.yaml for why).
(cd "$APP" && pnpm install --frozen-lockfile --prod)
test -d "$APP/node_modules/@img/sharp-wasm32" || {
  echo "ERROR: @img/sharp-wasm32 is missing in the loader's node_modules" >&2
  exit 1
}
if compgen -G "$APP/node_modules/@img/sharp-linux*" >/dev/null; then
  echo "ERROR: a native sharp build was installed; only the WebAssembly build may be bundled" >&2
  exit 1
fi
# Build-only leftovers: sharp sources, pnpm metadata, CLI shims (bin scripts
# with "#!/usr/bin/env node" are never used by the loader).
rm -rf "$APP/node_modules/sharp/src" "$APP/node_modules/.bin" "$APP/node_modules/.pnpm" \
  "$APP/node_modules/.modules.yaml" "$APP/node_modules/semver/bin"

echo "==> Android build tools"
TOOLS="$OUT/support/tools-linux"
mkdir -p "$TOOLS/lib" "$TOOLS/lib64"
unzip -q "$(dep build_tools)" -d "$WORK/bt"
BT="$(dirname "$(find "$WORK/bt" -name aapt2 -type f | head -n1)")"
cp "$BT/aapt" "$BT/aapt2" "$BT/zipalign" "$BT/apksigner" "$TOOLS/"
cp "$BT/lib/apksigner.jar" "$TOOLS/lib/"
cp -P "$BT"/lib64/libc++.so* "$TOOLS/lib64/"
cp "$BT/NOTICE.txt" "$OUT/LICENSES/android-build-tools.txt"

echo "==> Android platform tools"
unzip -q "$(dep platform_tools)" -d "$WORK/pt"
cp "$WORK/pt/platform-tools/adb" "$TOOLS/"
cp "$WORK/pt/platform-tools/NOTICE.txt" "$OUT/LICENSES/android-platform-tools.txt"

echo "==> JDK (jlink-trimmed runtime with java, keytool, jarsigner)"
mkdir -p "$WORK/jdk"
tar -xzf "$(dep jdk)" -C "$WORK/jdk" --strip-components=1
"$WORK/jdk/bin/jlink" \
  --add-modules java.se,jdk.jartool,jdk.crypto.ec,jdk.crypto.cryptoki,jdk.zipfs,jdk.unsupported,jdk.charsets,jdk.localedata,jdk.security.auth,jdk.net \
  --strip-debug --no-header-files --no-man-pages --compress=zip-6 \
  --output "$TOOLS/jdk"
cp "$WORK/jdk/NOTICE" "$OUT/LICENSES/jdk-NOTICE.txt" 2>/dev/null || true
# The JDK's own legal notices stay in support/tools-linux/jdk/legal (jlink output).

echo "==> 7-Zip"
mkdir -p "$WORK/7z"
tar -xJf "$(dep sevenzip)" -C "$WORK/7z"
# Statically linked build (7zzs): works without the system's ELF loader/libstdc++.
cp "$WORK/7z/7zzs" "$OUT/support/7zz"
cp "$WORK/7z/License.txt" "$OUT/LICENSES/7-zip.txt"

cp "$ROOT/LICENSE" "$OUT/LICENSES/wf-studio-linux.txt"
chmod +x "$OUT/wf-studio" "$OUT/support/7zz" "$TOOLS"/{aapt,aapt2,zipalign,apksigner,adb}

echo "==> self-test"
ELECTRON_RUN_AS_NODE=1 "$OUT/wf-studio" "$APP/lib/check.js"

TARBALL="$DIST/wf-studio-linux-$VERSION-x86_64.tar.gz"
tar -C "$OUT/.." -czf "$TARBALL" wf-studio-linux
rm -rf "$WORK"
echo "==> $TARBALL ($(du -h "$TARBALL" | cut -f1))"
