#!/usr/bin/env bash
# Downloads all pinned dependencies from deps.env into .cache/deps and verifies them.
# Usage: scripts/fetch-deps.sh [NAME...]   (NAME = ELECTRON, BUILD_TOOLS, …; default: all)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${WFS_DEPS_CACHE:-$ROOT/.cache/deps}"
# shellcheck source=/dev/null
source "$ROOT/deps.env"

ALL=(ELECTRON BUILD_TOOLS PLATFORM_TOOLS JDK SEVENZIP APPIMAGETOOL APPIMAGE_RUNTIME)
NAMES=("$@")
[ ${#NAMES[@]} -eq 0 ] && NAMES=("${ALL[@]}")

mkdir -p "$CACHE"

# Prints the cached file path for a dependency name.
dep_path() {
  local url_var="${1}_URL"
  local url="${!url_var}"
  local file
  file="$(basename "${url%%\?*}")"
  file="${file//%2B/+}"
  echo "$CACHE/${1,,}-$file"
}

for name in "${NAMES[@]}"; do
  url_var="${name}_URL"
  sha_var="${name}_SHA256"
  url="${!url_var:?unknown dependency $name}"
  sha="${!sha_var:?missing sha256 for $name}"
  dest="$(dep_path "$name")"
  if [ -f "$dest" ] && echo "$sha  $dest" | sha256sum -c --status; then
    echo "cached  $name"
    continue
  fi
  echo "fetch   $name  $url"
  curl -fL --retry 4 --retry-delay 2 -o "$dest.part" "$url"
  if ! echo "$sha  $dest.part" | sha256sum -c --status; then
    echo "ERROR: checksum mismatch for $name ($url)" >&2
    echo "  expected $sha" >&2
    echo "  got      $(sha256sum "$dest.part" | cut -d' ' -f1)" >&2
    rm -f "$dest.part"
    exit 1
  fi
  mv "$dest.part" "$dest"
done
