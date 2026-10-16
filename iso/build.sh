#!/usr/bin/env bash
# Construye el ISO de Aurora O.S. (live + instalador) con archiso.
#
# Debe correr como root dentro de Arch Linux, por ejemplo en un contenedor:
#   docker run --rm --privileged -v "$PWD:/repo" archlinux:latest /repo/iso/build.sh
#
# Resultado: out/aurora-<fecha>-x86_64.iso

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$REPO_DIR/out}"
BUILD_DIR="${BUILD_DIR:-/tmp/aurora-build}"
PROFILE="$BUILD_DIR/profile"
LOCAL_REPO="$BUILD_DIR/localrepo"
AURORA_USER=player

log() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
read_list() { sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$@"; }

[[ $EUID -eq 0 ]] || die "ejecutar como root"
[[ -f /etc/arch-release ]] || die "necesita Arch Linux (usar el contenedor archlinux:latest)"

log "Preparando el entorno de construcción"
if ! grep -q '^\[multilib\]' /etc/pacman.conf; then
  sed -i '/^#\[multilib\]/{s/^#//;n;s/^#//}' /etc/pacman.conf
fi
# Algunas imágenes (ej. el contenedor de Docker) no traen la sección comentada.
if ! grep -q '^\[multilib\]' /etc/pacman.conf; then
  printf '\n[multilib]\nInclude = /etc/pacman.d/mirrorlist\n' >> /etc/pacman.conf
fi
pacman -Syu --noconfirm --needed archiso base-devel git sudo jq nodejs librsvg ttf-roboto
rm -rf "$BUILD_DIR"
mkdir -p "$PROFILE" "$LOCAL_REPO" "$OUT_DIR"

log "Compilando los paquetes que no están en los repos oficiales (AUR)"
id builder &>/dev/null || useradd -m builder
echo 'builder ALL=(root) NOPASSWD: /usr/bin/pacman' > /etc/sudoers.d/builder
chmod 440 /etc/sudoers.d/builder
aur_dir="$BUILD_DIR/aur"
install -d -o builder "$aur_dir"
while read -r pkg; do
  if pacman -Si "$pkg" &>/dev/null; then
    echo "$pkg: está en los repos oficiales"
    continue
  fi
  echo "$pkg: compilando desde el AUR"
  sudo -u builder git clone --depth 1 "https://aur.archlinux.org/$pkg.git" "$aur_dir/$pkg"
  [[ -f "$aur_dir/$pkg/PKGBUILD" ]] || die "el paquete $pkg no existe en el AUR (revisar install/aur.txt)"
  (cd "$aur_dir/$pkg" && sudo -u builder makepkg -s --noconfirm --needed)
  mapfile -t built < <(find "$aur_dir/$pkg" -maxdepth 1 -name '*.pkg.tar.zst' ! -name '*-debug-*')
  cp "${built[@]}" "$LOCAL_REPO/"
  # Se instala en el contenedor para que los paquetes siguientes de la lista
  # puedan depender de este (ej. freeimage → emulationstation-de).
  pacman -U --noconfirm --needed "${built[@]}"
done < <(read_list "$REPO_DIR/install/aur.txt")
# Base de datos del repo local (puede quedar vacía si todo está en los oficiales).
shopt -s nullglob
pkgs=("$LOCAL_REPO"/*.pkg.tar.zst)
shopt -u nullglob
if ((${#pkgs[@]})); then
  repo-add "$LOCAL_REPO/aurora.db.tar.gz" "${pkgs[@]}"
else
  tar -czf "$LOCAL_REPO/aurora.db.tar.gz" -T /dev/null
  ln -sf aurora.db.tar.gz "$LOCAL_REPO/aurora.db"
fi

log "Armando el perfil de archiso"
RELENG=/usr/share/archiso/configs/releng
for dir in efiboot syslinux grub; do
  [[ -d "$RELENG/$dir" ]] && cp -a "$RELENG/$dir" "$PROFILE/"
done
if [[ -d "$PROFILE/efiboot/loader/entries" ]]; then
  # Solo la entrada principal de arranque (sin voz, memtest ni shell UEFI).
  find "$PROFILE/efiboot/loader/entries" -type f ! -name '01-*' -delete
  sed -i 's/^timeout .*/timeout 3/' "$PROFILE/efiboot/loader/loader.conf"
  # Más espacio para escribir en el live (la RAM se usa solo si hace falta).
  sed -i '/^options/ s/$/ cow_spacesize=4G/' "$PROFILE"/efiboot/loader/entries/01-*.conf
fi

if [[ -d "$PROFILE/syslinux" ]]; then
  # Menú BIOS: solo arrancar Aurora, reiniciar y apagar (sin "Boot existing OS",
  # que en una VM o disco vacío deja la máquina colgada).
  awk 'BEGIN { RS=""; ORS="\n\n" } !/LABEL [^\n]*speech/' "$PROFILE/syslinux/archiso_sys-linux.cfg" \
    > "$PROFILE/syslinux/archiso_sys-linux.cfg.new"
  mv "$PROFILE/syslinux/archiso_sys-linux.cfg.new" "$PROFILE/syslinux/archiso_sys-linux.cfg"
  sed -i '/^APPEND/ s/$/ cow_spacesize=4G/' "$PROFILE/syslinux/archiso_sys-linux.cfg"
  cat > "$PROFILE/syslinux/archiso_tail.cfg" <<'CFG'
LABEL reboot
MENU LABEL Reiniciar
COM32 reboot.c32

LABEL poweroff
MENU LABEL Apagar
COM32 poweroff.c32
CFG
fi
# Textos de los menús: Aurora en lugar de Arch Linux.
find "$PROFILE" \( -name '*.cfg' -o -name '*.conf' \) -exec \
  sed -i -e 's/Arch Linux install medium/Aurora O.S. (live)/g' -e 's/Arch Linux/Aurora O.S./g' {} +

# shellcheck source=/dev/null disable=SC2034  # file_permissions lo usa el archivo cargado
bootmodes="$(declare -A file_permissions; source "$RELENG/profiledef.sh" && declare -p bootmodes)"
sed "s|@BOOTMODES@|${bootmodes#declare -a }|" "$REPO_DIR/iso/profiledef.sh.in" > "$PROFILE/profiledef.sh"

cp /etc/pacman.conf "$PROFILE/pacman.conf"
cat >> "$PROFILE/pacman.conf" <<EOF

[aurora]
SigLevel = Optional TrustAll
Server = file://$LOCAL_REPO
EOF

read_list "$REPO_DIR/iso/packages.extra" "$REPO_DIR/install/packages.txt" "$REPO_DIR/install/aur.txt" |
  sort -u > "$PROFILE/packages.x86_64"

log "Copiando archivos del sistema"
AIROOTFS="$PROFILE/airootfs"
mkdir -p "$AIROOTFS"
cp -a "$REPO_DIR/rootfs/." "$AIROOTFS/"
cp -a "$REPO_DIR/iso/airootfs/." "$AIROOTFS/"
sed -i "s/@AURORA_USER@/$AURORA_USER/" "$AIROOTFS/etc/greetd/config.toml"
# pacman.conf del sistema instalado: el de Arch con multilib (sin el repo local).
cp /etc/pacman.conf "$AIROOTFS/etc/pacman.conf"

mkdir -p "$AIROOTFS/opt/aurora"
cp -a "$REPO_DIR/engine" "$AIROOTFS/opt/aurora/engine"
rm -rf "$AIROOTFS/opt/aurora/engine/test"
ln -sf /opt/aurora/engine/bin/aurora.js "$AIROOTFS/usr/local/bin/aurora"
"$REPO_DIR/install/fetch-umu.sh" "$AIROOTFS/usr/local/bin"
# Configuraciones regionales: se generan en el contenedor (misma glibc que la
# imagen) y se copia el archivo resultante.
cp "$REPO_DIR/iso/airootfs/etc/locale.gen" /etc/locale.gen
locale-gen
install -Dm644 /usr/lib/locale/locale-archive "$AIROOTFS/usr/lib/locale/locale-archive"
node "$REPO_DIR/theme/build.mjs" "$AIROOTFS/usr/share/aurora/es-de" "$REPO_DIR/rootfs/usr/share/aurora/tools"

# Servicios (equivale a systemctl enable dentro de la imagen).
units="$AIROOTFS/etc/systemd/system"
mkdir -p "$units/multi-user.target.wants" "$units/bluetooth.target.wants"
ln -sf /usr/lib/systemd/system/graphical.target "$units/default.target"
ln -sf /usr/lib/systemd/system/greetd.service "$units/display-manager.service"
ln -sf /usr/lib/systemd/system/NetworkManager.service "$units/multi-user.target.wants/NetworkManager.service"
ln -sf /usr/lib/systemd/system/bluetooth.service "$units/bluetooth.target.wants/bluetooth.service"
ln -sf /etc/systemd/system/aurora-selftest.service "$units/multi-user.target.wants/aurora-selftest.service"
ln -sf /etc/systemd/system/aurora-locale.service "$units/multi-user.target.wants/aurora-locale.service"
ln -sf /usr/share/zoneinfo/America/Argentina/Buenos_Aires "$AIROOTFS/etc/localtime"

log "Construyendo el ISO"
mkarchiso -v -w "$BUILD_DIR/work" -o "$OUT_DIR" "$PROFILE"

log "Listo"
ls -lh "$OUT_DIR"/*.iso
