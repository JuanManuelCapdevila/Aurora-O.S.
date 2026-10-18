# Aurora O.S.

Sistema operativo ligero tipo consola para la **Anbernic Win600**, pensado para jugar juegos de PC de
**2000–2010** (DirectX 7/8/9, OpenGL) con una interfaz manejable con el gamepad.

- **Base:** Arch Linux mínimo.
- **Interfaz:** [ES-DE](https://es-de.org) (EmulationStation Desktop Edition) a pantalla completa sobre `cage`, con
  el tema propio **Aurora Material** (estilo Android 5–9: barra de estado, grilla de íconos, Roboto). En cada
  build, CI publica capturas del tema en la rama [`previews`](https://github.com/JuanManuelCapdevila/Aurora-O.S./tree/previews).
- **Compatibilidad:** Proton-GE vía `umu-launcher` (DXVK traduce D3D8–11 a Vulkan).
- **Imagen:** cada juego corre en su propio `gamescope`, que renderiza a baja resolución (ej. 960×540) y escala a
  la pantalla de 720p con FSR.
- **Motor de compatibilidad (`engine/`, Node.js):** detecta qué tecnología usa cada `.exe` y arma la
  configuración automáticamente. Solo los juegos problemáticos necesitan ajustes a mano.

> Estado: primera imagen ISO (live + instalador). El motor tiene tests y la imagen se verifica en QEMU, pero
> **todavía no se probó en la consola real**: la sesión gráfica, el control y el rendimiento se validan ahí.

## Cómo funciona

```
UEFI → systemd-boot → greetd (autologin)
  → aurora-session → cage → ES-DE
       └─ elegir juego → aurora launch-rom "<Juego>.aurora"
            → gamescope -w 960 -h 540 -W 1280 -H 720 -F fsr
                → gamemoderun umu-run juego.exe   (Proton-GE + DXVK)
```

### Configuración por capas

Cada capa sobrescribe a la anterior (`engine/profiles/`):

| Capa | Ejemplo | Qué define |
|---|---|---|
| `defaults.json` | — | Render 960×540, FSR, 60 FPS, Proton-GE, gamemode |
| `device/<modelo>.json` | `win600-3050e` | Resolución de pantalla y modos de TDP |
| `api/<api>.json` | `d3d9`, `ddraw`, `d3d11`… | Detectada automáticamente desde el `.exe` |
| `genre/<género>.json` | `racing`, `fps`, `rts`… | Perfil de controles, ajustes del género |
| `overrides` en `game.json` | — | Excepciones de un juego puntual |

## Instalación (imagen ISO)

GitHub Actions construye el ISO en cada cambio, lo arranca en una máquina virtual con una autoprueba y publica
la última versión de la rama principal en el pre-release
[**dev**](https://github.com/JuanManuelCapdevila/Aurora-O.S./releases/tag/dev).

1. Descargar `aurora-<fecha>-x86_64.iso` y grabarlo en un USB de 4 GB o más con balenaEtcher, Rufus (modo DD),
   Ventoy o `dd`.
2. En la Win600: **desactivar Secure Boot** en el BIOS y arrancar desde el USB (con un hub USB-C).
3. Arranca en modo **live**: ES-DE directo, sin tocar el SSD ni Windows. Los cambios se pierden al apagar.
4. En **Ajustes** (pantalla de inicio) están las vistas gráficas, manejables con el control:
   - *Wi-Fi*: busca redes y pide la clave con un teclado en pantalla.
   - *Energía*: modo batería, equilibrado o rendimiento (se recuerda entre reinicios).
   - *Proton*: lo descarga o actualiza (~1,5 GB) para los juegos de Windows.
   - *Buscar juegos*: registra cada carpeta dentro de `Juegos/` en la raíz de la microSD o un USB.
   - *Hardware*: resumen del hardware de la consola.
   - *Actualizar*: instala la última versión de Aurora sin regrabar el USB (ver abajo).
   - *Instalar Aurora* (solo desde el USB): en la **microSD** (Windows queda intacto) o en el SSD interno (lo borra).
   Las entradas de Ajustes no cuentan como juegos ni aparecen en *Todos*.
5. Durante un juego:
   - **Select + Start** (o el botón Guía) pausa el juego y abre el **menú rápido**: volver al juego, volumen,
     brillo, modo de energía y cerrar juego.
   - **Select + Start mantenidos 2 segundos** cierran el juego al instante (sirve si se colgó).

Para construir el ISO localmente (necesita Docker):

```sh
docker run --rm --privileged -v "$PWD:/repo" archlinux:latest /repo/iso/build.sh   # → out/*.iso
```

### Actualizaciones

Cada build de CI publica, junto al ISO, un paquete chico (`aurora-update.tar.zst`, menos de 1 MB) con la capa
de Aurora: scripts, motor, tema y configuraciones. **Ajustes → Actualizar** (o `aurora-update apply`) lo
descarga, verifica la suma SHA-256, guarda una copia de lo que reemplaza y lo instala; si la versión nueva
necesita paquetes de Arch que faltan, los instala antes con `pacman -Syu`. Los juegos, los prefijos de Wine y
las partidas no se tocan.

- `aurora-update check`: compara la versión instalada (`/etc/aurora/version`) con la publicada.
- `aurora-update rollback` (o **X** en Ajustes → Actualizar): vuelve a la versión anterior.
- Lo que sigue necesitando un ISO nuevo: cambios del kernel o del arranque del live, y paquetes nuevos del AUR.

Para una instalación anterior a `aurora-update`, desde la Terminal de Ajustes:

```sh
curl -fsSL https://github.com/JuanManuelCapdevila/Aurora-O.S./releases/download/dev/aurora-update -o /tmp/aurora-update
sudo bash /tmp/aurora-update apply
```

### Instalación manual (alternativa)

Sobre un Arch Linux mínimo ya instalado, como root: `./install/postinstall.sh player win600-3050e`
(opcional: `./install/fetch-wrappers.sh`).

## Agregar juegos

Los juegos se instalan en cualquier carpeta (SSD o microSD) y se registran con:

```sh
aurora add "/run/media/player/sd/Juegos/GTA San Andreas" --genre action
```

Esto detecta el ejecutable y su API gráfica, crea `~/Games/<id>/game.json` (con un prefijo de Wine propio) y
agrega el juego a ES-DE, que lo muestra y puede scrapear su carátula por el nombre.

Otros comandos:

```sh
aurora detect juego.exe   # qué API, arquitectura e input usa un ejecutable
aurora list               # juegos registrados
aurora plan <id>          # configuración resuelta + comando final, sin ejecutar
aurora launch <id>        # ejecutar desde la terminal
aurora power performance  # TDP: battery | balanced | performance
```

### Ajustar un juego puntual

En `~/Games/<id>/game.json`:

```json
{
  "args": ["-nointro"],
  "umuId": "umu-12120",
  "overrides": {
    "display": { "renderWidth": 800, "renderHeight": 600, "fpsLimit": 30 },
    "compat": { "wrappers": ["cnc-ddraw"], "dllOverrides": { "dsound": "n,b" } }
  }
}
```

- `umuId`: ID del juego en [umu-database](https://github.com/Open-Wine-Components/umu-database). Si se pone,
  Proton aplica automáticamente los arreglos conocidos (protonfixes) para ese juego.
- `wrappers`: `cnc-ddraw` (juegos 2D con DirectDraw) o `dgvoodoo2` (3D con Direct3D 1–7).

## Estructura

```
engine/            Motor de compatibilidad (Node.js, sin dependencias)
  bin/aurora.js    CLI
  src/             Parser PE, detección, capas de config, armado del comando, ES-DE, energía
  profiles/        Perfiles por capas (JSON)
  test/            Tests: cd engine && npm test
theme/             Tema de ES-DE "aurora-material" (estilo Android 5-9) e íconos (build.mjs)
iso/               Perfil de archiso: build.sh, paquetes, archivos solo del live (usuario, autoprueba)
install/           Listas de paquetes, postinstall.sh (instalación manual), fetch-wrappers.sh
rootfs/            Archivos que se copian al sistema: sesión, instalador, herramientas de ES-DE, configs
.github/workflows/ CI: tests, construcción del ISO, autoprueba en QEMU y publicación
docs/              Plan del proyecto
```

## Hoja de ruta

Ver [docs/plan.md](docs/plan.md).
