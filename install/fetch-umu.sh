#!/usr/bin/env bash
# Instala umu-run desde el último release de umu-launcher (versión zipapp,
# autocontenida; solo necesita python). Se usa en lugar del paquete del AUR,
# cuyas dependencias de 32 bits no siempre coinciden con los repos actuales.
#
# Uso: ./install/fetch-umu.sh <directorio-destino>   (ej. /usr/local/bin)

set -euo pipefail

DEST="${1:?Uso: fetch-umu.sh <directorio-destino>}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

REPO=Open-Wine-Components/umu-launcher
# La API de GitHub limita los pedidos sin autenticar (403 en CI): se usa el
# token si hay uno y, si la API falla, se arma la URL desde la redirección de
# releases/latest, que no tiene ese límite.
auth=()
[[ -n "${GITHUB_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
url="$(curl -fsSL "${auth[@]}" "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null |
  jq -r '[.assets[] | select(.name | test("zipapp\\.tar$"))][0].browser_download_url // empty' || true)"
if [[ -z "$url" ]]; then
  tag="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")"
  tag="${tag##*/}"
  [[ -n "$tag" && "$tag" != latest ]] && url="https://github.com/$REPO/releases/download/$tag/umu-launcher-$tag-zipapp.tar"
fi
[[ -n "$url" ]] || { echo "Error: no se encontró el zipapp de umu-launcher" >&2; exit 1; }

echo "umu-launcher: $url"
curl -fsSL "$url" -o "$TMP/umu.tar"
tar -xf "$TMP/umu.tar" -C "$TMP"
bin="$(find "$TMP" -type f -name umu-run | head -n1)"
[[ -n "$bin" ]] || { echo "Error: el zipapp no contiene umu-run" >&2; exit 1; }
install -Dm755 "$bin" "$DEST/umu-run"
