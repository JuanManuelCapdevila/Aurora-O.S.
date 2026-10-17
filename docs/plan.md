# Plan del proyecto

Objetivo: que **la mayoría de los juegos de PC de 2000–2010** corran en la Win600 sin configuración manual,
aceptando resolución baja (la pantalla es de 5,94" a 720p).

## Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Reconocimiento del hardware (herramienta *Reporte de hardware* del live → `docs/hardware.md`) | Pendiente (en la consola) |
| 1 | Instalación reproducible: Arch + multilib + Mesa 32/64 bits + umu + Proton-GE | Escrita, sin probar en la consola |
| 2 | Sesión de consola: greetd → cage → ES-DE | Escrita, sin probar en la consola |
| 3 | Motor de compatibilidad: detección PE, perfiles por capas, `aurora launch`, wrappers, ES-DE | Escrita, con tests |
| 4 | Controles: perfiles por género (mapeo gamepad → teclado/mouse para juegos sin XInput) | Pendiente |
| 5 | Instaladores: GOG offline, imágenes ISO/CD, microSD como biblioteca | Pendiente |
| 6 | Batería de pruebas: ~30 juegos representativos por API y año; medir la tasa de compatibilidad | Pendiente |
| 7 | Imagen ISO live + instalador (archiso), construida y autoprobada en CI | Primera versión; falta snapshots btrfs |

## Puntos a validar en la consola (fases 0–2)

- **Orientación del panel:** confirmado en la consola: el panel es vertical y sale girado 90°.
  `left_side_up` dejó el texto de cabeza, así que va `video=eDP-1:panel_orientation=right_side_up`
  (`iso/kernel-params`). La sesión usa `aurora-display` con 270° (`/etc/aurora/display.conf`): **confirmado
  en la consola**. El menú de arranque lo dibuja el firmware y sigue girado.
- **copytoram:** el live copiaba la imagen entera a la RAM (minutos con un USB lento y ~2 GB de RAM menos);
  se arranca con `copytoram=n`.
- **Control en modo gamepad:** que aparezca como XInput (`/proc/bus/input/devices`).
- **gamescope anidado en cage:** cada juego abre su gamescope como ventana Wayland dentro de cage. Si da
  problemas, la alternativa es que la sesión alterne entre ES-DE y gamescope sin anidar.
- **Límite de FPS:** se aplica con `DXVK_FRAME_RATE` (D3D8–11) y MangoHud (Vulkan). En juegos OpenGL o con
  WineD3D puede no aplicar; validar con juegos que se rompen a más de 60 FPS.
- **ryzenadj en la 3050e:** confirmar que los límites de `device/win600-3050e.json` se aplican
  (`sudo ryzenadj --info`) y ajustar los valores según temperatura y batería.
- **Secure Boot:** el ISO no está firmado; hay que desactivarlo en el BIOS de la Win600.
- **Arranque desde microSD:** confirmar que el BIOS de la Win600 permite elegir la microSD como disco de arranque.

## Pantalla táctil (pospuesto)

- **Juegos:** Wine recibe el toque como clic de mouse; falta comprobar en la consola que coincida con la
  pantalla rotada (probar en *Ajustes → Terminal*).
- **ES-DE:** en Linux ignora el táctil (solo lo soporta en Android/iOS, `InputManager.cpp`). Opciones si se
  retoma: un servicio que traduzca gestos a teclas (~1 día; tocar abre el ítem seleccionado, no el tocado) o
  un launcher propio. Descartado por ahora.

## Seguridad (pendiente antes de una versión estable)

- `root` entra sin contraseña desde la consola y `player` tiene sudo sin contraseña: facilita el diagnóstico
  en esta etapa. Antes de una versión estable, pedir una contraseña en el primer arranque.

## Límites conocidos del hardware

- Juegos de 2009–2010 que exigen 4 núcleos o DirectX 10/11 pesado (GTA IV, Crysis) no van a correr bien.
- DRM de discos (SafeDisc, SecuROM) no funciona en Wine: usar versiones de GOG/Steam o copias propias parcheadas.
- Estrategia en tiempo real: requiere el modo mouse físico de la Win600.
