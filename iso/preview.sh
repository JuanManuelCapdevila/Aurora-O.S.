#!/usr/bin/env bash
# Captura pantallas de ES-DE con el tema de Aurora en una pantalla virtual (Xvfb)
# para revisar el diseño sin la consola. Corre en el mismo contenedor que
# build.sh, después de construir (usa ES-DE ya instalado y el airootfs generado).
#
# Resultado: out/preview/*.png y el log de ES-DE.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-/tmp/aurora-build}"
OUT="${OUT_DIR:-$REPO_DIR/out}/preview"
AIROOTFS="$BUILD_DIR/profile/airootfs"
PREVIEW_HOME=/tmp/aurora-preview-home
export DISPLAY=:99

log() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

log "Preparando las capturas del tema"
pacman -S --noconfirm --needed xorg-server-xvfb xdotool imagemagick mesa >/dev/null
rm -rf "$PREVIEW_HOME" "$OUT"
mkdir -p "$PREVIEW_HOME" "$OUT"

# Biblioteca de ejemplo: ejecutables PE mínimos con nombres de juegos reales.
cat > "$PREVIEW_HOME/aurora.json" <<EOF
{
  "gamesDir": "$PREVIEW_HOME/Games",
  "esdeDir": "$PREVIEW_HOME/ES-DE",
  "romsDir": "$PREVIEW_HOME/ROMs",
  "toolsDir": "$AIROOTFS/usr/share/aurora/tools",
  "esdeAssetsDir": "$AIROOTFS/usr/share/aurora/es-de",
  "auroraBin": "/usr/local/bin/aurora"
}
EOF
export AURORA_CONFIG="$PREVIEW_HOME/aurora.json" HOME="$PREVIEW_HOME"
for game in "GTA San Andreas" "GTA Vice City" "Need for Speed Carbon" "Pro Evolution Soccer 2010" "Half-Life 2"; do
  node -e "require('fs').writeFileSync(process.argv[2], require(process.argv[1]).buildPE({ imports: ['d3d9.dll'] }))" \
    "$REPO_DIR/engine/test/helpers.js" "$PREVIEW_HOME/fake.exe"
  mkdir -p "$PREVIEW_HOME/install/$game"
  mv "$PREVIEW_HOME/fake.exe" "$PREVIEW_HOME/install/$game/game.exe"
  node "$REPO_DIR/engine/bin/aurora.js" add "$PREVIEW_HOME/install/$game" >/dev/null
done
node "$REPO_DIR/engine/bin/aurora.js" export-esde

Xvfb :99 -screen 0 1280x720x24 -nolisten tcp &
xvfb_pid=$!
sleep 2

es-de --resolution 1280 720 --no-splash > "$OUT/es-de-stdout.log" 2>&1 &
esde_pid=$!

shot() { sleep "${2:-3}"; import -window root "$OUT/$1.png" && echo "captura $1"; }
key() { xdotool key --delay 300 "$@"; }

shot 01-inicio 20
key Return; shot 02-primer-sistema
key BackSpace Right; shot 03-inicio-segundo
key Return; shot 04-segundo-sistema
key BackSpace Right; shot 05-inicio-tercero
key Return; shot 06-tercer-sistema

kill "$esde_pid" "$xvfb_pid" 2>/dev/null
cp "$PREVIEW_HOME/ES-DE/logs/es_log.txt" "$OUT/" 2>/dev/null || true
ls -l "$OUT"
