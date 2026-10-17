#!/usr/bin/env bash
# Copia la "capa Aurora" (lo que es propio del proyecto y cambia seguido) dentro
# de un directorio raíz: scripts y configuraciones de rootfs/, el motor, el tema
# de ES-DE, umu-run y la versión. La usan el ISO (iso/build.sh) y el paquete de
# actualización (aurora-update), así los dos tienen exactamente lo mismo.
#
# Uso: ./install/stage-aurora.sh <raíz> [versión]
#   UMU_RUN=<archivo>  usa ese umu-run en lugar de descargarlo.

set -euo pipefail

ROOT="${1:?Uso: stage-aurora.sh <raíz> [versión]}"
VERSION="${2:-dev}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$ROOT"
# rootfs/ sin cachés de Python que hayan quedado de pruebas locales.
tar -C "$REPO_DIR/rootfs" --exclude=__pycache__ -cf - . | tar -C "$ROOT" -xf -

# El instalador agrega estos parámetros a la entrada de arranque (y aurora-update
# la corrige si cambian).
install -Dm644 "$REPO_DIR/iso/kernel-params" "$ROOT/etc/aurora/kernel-params"

mkdir -p "$ROOT/opt/aurora"
rm -rf "$ROOT/opt/aurora/engine"
cp -a "$REPO_DIR/engine" "$ROOT/opt/aurora/engine"
rm -rf "$ROOT/opt/aurora/engine/test"
mkdir -p "$ROOT/usr/local/bin"
ln -sf /opt/aurora/engine/bin/aurora.js "$ROOT/usr/local/bin/aurora"

if [[ -n "${UMU_RUN:-}" ]]; then
  install -Dm755 "$UMU_RUN" "$ROOT/usr/local/bin/umu-run"
else
  "$REPO_DIR/install/fetch-umu.sh" "$ROOT/usr/local/bin"
fi

node "$REPO_DIR/theme/build.mjs" "$ROOT/usr/share/aurora/es-de" "$REPO_DIR/rootfs/usr/share/aurora/tools"

echo "$VERSION" > "$ROOT/etc/aurora/version"
