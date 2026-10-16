# Aurora O.S.

Sistema operativo ligero tipo consola para la **Anbernic Win600**, pensado para jugar juegos de PC de
**2000–2010** (DirectX 7/8/9, OpenGL) con una interfaz manejable con el gamepad.

- **Base:** Arch Linux mínimo.
- **Interfaz:** [ES-DE](https://es-de.org) (EmulationStation Desktop Edition) a pantalla completa sobre `cage`.
- **Compatibilidad:** Proton-GE vía `umu-launcher` (DXVK traduce D3D8–11 a Vulkan).
- **Imagen:** cada juego corre en su propio `gamescope`, que renderiza a baja resolución (ej. 960×540) y escala a
  la pantalla de 720p con FSR.
- **Motor de compatibilidad (`engine/`, Node.js):** detecta qué tecnología usa cada `.exe` y arma la
  configuración automáticamente. Solo los juegos problemáticos necesitan ajustes a mano.

> Estado: fases 1–3 escritas y con tests del motor. **Todavía no se probó en la consola real**: falta la fase 0
> (reconocimiento del hardware) y validar la sesión gráfica.

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

## Instalación

1. Instalar Arch Linux mínimo en la Win600 (`archinstall`, perfil *minimal*, con red y systemd-boot).
2. Clonar este repo y ejecutar como root:

   ```sh
   ./install/postinstall.sh player win600-3050e
   ./install/fetch-wrappers.sh   # opcional: wrappers para juegos de DirectDraw / D3D 1-7
   ```

3. Reiniciar: arranca directo en ES-DE.

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
install/           postinstall.sh, listas de paquetes, fetch-wrappers.sh
rootfs/            Archivos que se copian al sistema (greetd, sesión, zram, sysctl)
tools/hw-report.sh Reporte de hardware (fase 0)
docs/              Plan del proyecto y hardware
```

## Hoja de ruta

Ver [docs/plan.md](docs/plan.md).
