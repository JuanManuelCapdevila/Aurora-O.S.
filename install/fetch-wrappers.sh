#!/usr/bin/env bash
# Descarga los wrappers opcionales para juegos muy viejos (DirectDraw / Direct3D 1-7)
# y los deja en /usr/share/aurora/wrappers/<nombre>/ con su manifest.json.
#
# Se activan por juego en game.json:
#   "overrides": { "compat": { "wrappers": ["cnc-ddraw"] } }
#
#   cnc-ddraw  juegos 2D con DirectDraw (estrategia, aventuras, etc.)
#   dgvoodoo2  juegos 3D con Direct3D 1-7 (los traduce a D3D11 y DXVK a Vulkan)
#
# Uso (como root): ./install/fetch-wrappers.sh

set -euo pipefail

DEST=/usr/share/aurora/wrappers
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "ejecutar como root"
command -v jq >/dev/null || die "falta jq"
command -v unzip >/dev/null || die "falta unzip"

# URL del primer asset del último release de GitHub cuyo nombre coincide con el regex.
latest_asset() {
  curl -fsSL "https://api.github.com/repos/$1/releases/latest" |
    jq -r --arg re "$2" '[.assets[] | select(.name | test($re))][0].browser_download_url // empty'
}

log "cnc-ddraw"
url="$(latest_asset FunkyFr3sh/cnc-ddraw '^cnc-ddraw\.zip$')"
[[ -n "$url" ]] || die "no se encontró el release de cnc-ddraw"
curl -fsSL "$url" -o "$TMP/cnc-ddraw.zip"
mkdir -p "$TMP/cnc-ddraw"
unzip -q "$TMP/cnc-ddraw.zip" -d "$TMP/cnc-ddraw"
mkdir -p "$DEST/cnc-ddraw"
install -m644 "$TMP/cnc-ddraw/ddraw.dll" "$DEST/cnc-ddraw/ddraw.dll"
if [[ -f "$TMP/cnc-ddraw/ddraw.ini" ]]; then
  install -m644 "$TMP/cnc-ddraw/ddraw.ini" "$DEST/cnc-ddraw/ddraw.ini"
  config='["ddraw.ini"]'
else
  config='[]'
fi
cat > "$DEST/cnc-ddraw/manifest.json" <<EOF
{
  "source": "$url",
  "files": ["ddraw.dll"],
  "configFiles": $config,
  "overrides": { "ddraw": "n,b" }
}
EOF

log "dgVoodoo2"
url="$(latest_asset dege-diosg/dgVoodoo2 '^dgVoodoo.*\.zip$')"
[[ -n "$url" ]] || die "no se encontró el release de dgVoodoo2"
curl -fsSL "$url" -o "$TMP/dgvoodoo.zip"
mkdir -p "$TMP/dgvoodoo"
unzip -q "$TMP/dgvoodoo.zip" -d "$TMP/dgvoodoo"
# Los juegos de esta época son de 32 bits: se usan las DLLs de MS/x86.
src="$(find "$TMP/dgvoodoo" -type d -path '*MS/x86' | head -n1)"
conf="$(find "$TMP/dgvoodoo" -maxdepth 2 -name 'dgVoodoo.conf' | head -n1)"
[[ -n "$src" && -n "$conf" ]] || die "estructura inesperada en el zip de dgVoodoo2"
mkdir -p "$DEST/dgvoodoo2"
install -m644 "$src/DDraw.dll" "$DEST/dgvoodoo2/DDraw.dll"
install -m644 "$src/D3DImm.dll" "$DEST/dgvoodoo2/D3DImm.dll"
# Sin la marca de agua de dgVoodoo en pantalla.
sed 's/^\(dgVoodooWatermark[[:space:]]*=\).*/\1 false/' "$conf" > "$DEST/dgvoodoo2/dgVoodoo.conf"
cat > "$DEST/dgvoodoo2/manifest.json" <<EOF
{
  "source": "$url",
  "files": ["DDraw.dll", "D3DImm.dll"],
  "configFiles": ["dgVoodoo.conf"],
  "overrides": { "ddraw": "n,b", "d3dimm": "n,b" }
}
EOF

log "Wrappers instalados en $DEST"
ls -1 "$DEST"
