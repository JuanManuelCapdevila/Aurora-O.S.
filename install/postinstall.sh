#!/usr/bin/env bash
# Convierte una instalación mínima de Arch Linux en Aurora O.S.
#
# Uso (como root, desde la raíz del repo):
#   ./install/postinstall.sh [usuario] [dispositivo]
#
#   usuario      usuario que juega y arranca la sesión (por defecto: player)
#   dispositivo  perfil de engine/profiles/device (por defecto: win600-3050e)
#
# Se puede volver a ejecutar: cada paso comprueba lo que ya está hecho.

set -euo pipefail

AURORA_USER="${1:-player}"
AURORA_DEVICE="${2:-win600-3050e}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_DEST=/opt/aurora/engine

log() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

# Lee una lista de paquetes ignorando comentarios y líneas vacías.
read_list() { sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$1"; }

[[ $EUID -eq 0 ]] || die "ejecutar como root"
[[ -f /etc/arch-release ]] || die "este script es para Arch Linux"
[[ -f "$REPO_DIR/engine/profiles/device/$AURORA_DEVICE.json" ]] || die "dispositivo desconocido: $AURORA_DEVICE"

log "Usuario: $AURORA_USER · Dispositivo: $AURORA_DEVICE"

if ! id "$AURORA_USER" &>/dev/null; then
  useradd -m -G wheel,video,audio,input -s /bin/bash "$AURORA_USER"
  warn "Usuario $AURORA_USER creado sin contraseña. Asignarle una con: passwd $AURORA_USER"
fi
usermod -aG video,audio,input "$AURORA_USER"
USER_HOME="$(getent passwd "$AURORA_USER" | cut -d: -f6)"

log "Habilitando el repositorio multilib (librerías de 32 bits)"
if ! grep -q '^\[multilib\]' /etc/pacman.conf; then
  sed -i '/^#\[multilib\]/{s/^#//;n;s/^#//}' /etc/pacman.conf
fi
# Algunas imágenes (ej. el contenedor de Docker) no traen la sección comentada.
if ! grep -q '^\[multilib\]' /etc/pacman.conf; then
  printf '\n[multilib]\nInclude = /etc/pacman.d/mirrorlist\n' >> /etc/pacman.conf
fi
grep -q '^\[multilib\]' /etc/pacman.conf || die "no se pudo habilitar multilib en /etc/pacman.conf"

log "Instalando paquetes oficiales"
mapfile -t PACKAGES < <(read_list "$REPO_DIR/install/packages.txt")
pacman -Syu --needed --noconfirm "${PACKAGES[@]}"

log "Instalando paquetes que pueden venir del AUR"
FAILED=()
# makepkg no corre como root: se compila como el usuario, con permiso temporal
# para instalar con pacman.
SUDOERS_TMP=/etc/sudoers.d/99-aurora-build
trap 'rm -f "$SUDOERS_TMP"' EXIT
echo "$AURORA_USER ALL=(root) NOPASSWD: /usr/bin/pacman" > "$SUDOERS_TMP"
chmod 440 "$SUDOERS_TMP"
while read -r pkg; do
  if pacman -Qq "$pkg" &>/dev/null; then
    continue
  elif pacman -Si "$pkg" &>/dev/null; then
    pacman -S --needed --noconfirm "$pkg" || FAILED+=("$pkg")
  else
    build_dir="$(sudo -u "$AURORA_USER" mktemp -d)"
    if sudo -u "$AURORA_USER" git clone --depth 1 "https://aur.archlinux.org/$pkg.git" "$build_dir/$pkg" &&
       [[ -f "$build_dir/$pkg/PKGBUILD" ]] &&
       (cd "$build_dir/$pkg" && sudo -u "$AURORA_USER" makepkg -si --noconfirm --needed); then
      :
    else
      FAILED+=("$pkg")
    fi
    rm -rf "$build_dir"
  fi
done < <(read_list "$REPO_DIR/install/aur.txt")
rm -f "$SUDOERS_TMP"
trap - EXIT

log "Instalando umu-launcher"
"$REPO_DIR/install/fetch-umu.sh" /usr/local/bin || FAILED+=("umu-launcher")

log "Instalando el motor de compatibilidad en $ENGINE_DEST"
mkdir -p "$ENGINE_DEST"
cp -a "$REPO_DIR/engine/." "$ENGINE_DEST/"
rm -rf "$ENGINE_DEST/test"
chmod +x "$ENGINE_DEST/bin/aurora.js"
ln -sf "$ENGINE_DEST/bin/aurora.js" /usr/local/bin/aurora

log "Copiando archivos de sistema"
cp -a "$REPO_DIR/rootfs/." /
sed -i "s/@AURORA_USER@/$AURORA_USER/" /etc/greetd/config.toml
chmod +x /usr/local/bin/aurora-session

mkdir -p /etc/aurora
cat > /etc/aurora/aurora.json <<EOF
{
  "gamesDir": "$USER_HOME/Games",
  "esdeDir": "$USER_HOME/ES-DE",
  "romsDir": "$USER_HOME/ROMs",
  "wrappersDir": "/usr/share/aurora/wrappers",
  "auroraBin": "/usr/local/bin/aurora",
  "device": "$AURORA_DEVICE"
}
EOF

# El launcher cambia el TDP sin pedir contraseña, pero solo vía ryzenadj.
RYZENADJ="$(command -v ryzenadj || true)"
if [[ -n "$RYZENADJ" ]]; then
  echo "$AURORA_USER ALL=(root) NOPASSWD: $RYZENADJ" > /etc/sudoers.d/90-aurora-ryzenadj
  chmod 440 /etc/sudoers.d/90-aurora-ryzenadj
  visudo -cf /etc/sudoers.d/90-aurora-ryzenadj >/dev/null || die "regla de sudoers inválida"
else
  warn "ryzenadj no está instalado: los modos de energía no van a funcionar"
fi

log "Preparando las carpetas del usuario"
sudo -u "$AURORA_USER" mkdir -p "$USER_HOME/Games" "$USER_HOME/ROMs/windows"
sudo -u "$AURORA_USER" HOME="$USER_HOME" /usr/local/bin/aurora export-esde

log "Activando servicios"
systemctl enable greetd.service NetworkManager.service bluetooth.service
systemctl set-default graphical.target

if ((${#FAILED[@]})); then
  warn "No se pudieron instalar: ${FAILED[*]}"
  warn "Revisar los nombres en install/aur.txt y volver a ejecutar el script."
fi

log "Listo. Opcional: ./install/fetch-wrappers.sh para los wrappers de juegos muy viejos."
log "Reiniciar para entrar en la sesión de consola."
