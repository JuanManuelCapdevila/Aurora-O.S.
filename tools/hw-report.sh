#!/usr/bin/env bash
# Fase 0: genera un reporte del hardware de la consola para docs/hardware.md.
# Se puede correr desde cualquier Linux (USB live incluido). No modifica nada.
#
# Uso: ./tools/hw-report.sh [archivo-de-salida]

set -uo pipefail

OUT="${1:-hw-report-$(date +%Y%m%d-%H%M).txt}"

section() { printf '\n===== %s =====\n' "$1"; }
run() {
  printf '$ %s\n' "$*"
  if command -v "$1" >/dev/null; then "$@" 2>&1; else echo "(no instalado: $1)"; fi
}

{
  section "Sistema"
  uname -a
  cat /etc/os-release 2>/dev/null | head -n 3

  section "CPU"
  run lscpu
  section "Memoria"
  run free -h

  section "PCI (GPU, Wi-Fi, audio) con drivers"
  run lspci -nnk
  section "USB (control, Bluetooth)"
  run lsusb

  section "Pantalla: conectores DRM y modos"
  for c in /sys/class/drm/card*-*; do
    [[ -e "$c/status" ]] || continue
    printf '%s: %s\n' "$(basename "$c")" "$(cat "$c/status")"
    sed 's/^/    /' "$c/modes" 2>/dev/null
  done
  echo "Si el modo preferido es vertical (ej. 720x1280), el panel necesita rotación."

  section "Vulkan"
  run vulkaninfo --summary

  section "Dispositivos de entrada"
  grep -E '^(N: Name|H: Handlers)' /proc/bus/input/devices 2>/dev/null

  section "Batería"
  for b in /sys/class/power_supply/*; do
    [[ -e "$b/type" ]] || continue
    printf '%s (%s)\n' "$(basename "$b")" "$(cat "$b/type")"
    for f in status capacity energy_full energy_full_design charge_full charge_full_design; do
      [[ -r "$b/$f" ]] && printf '    %s = %s\n' "$f" "$(cat "$b/$f")"
    done
  done

  section "Sensores"
  run sensors

  section "Almacenamiento"
  run lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL
} > "$OUT"

echo "Reporte guardado en $OUT"
