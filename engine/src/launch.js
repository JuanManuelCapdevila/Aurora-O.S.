'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJSON } = require('./config');

function loadWrapper(name, wrappersDir) {
  if (!/^[a-z0-9._-]+$/i.test(name)) throw new Error(`Nombre de wrapper inválido: ${name}`);
  const dir = path.join(wrappersDir, name);
  const manifest = readJSON(path.join(dir, 'manifest.json'));
  if (!manifest) {
    throw new Error(`Wrapper "${name}" no instalado en ${dir}. Ejecutar install/fetch-wrappers.sh`);
  }
  return { name, dir, files: [], configFiles: [], overrides: {}, ...manifest };
}

function formatDllOverrides(overrides) {
  return Object.entries(overrides)
    .map(([dll, mode]) => `${dll}=${mode}`)
    .join(';');
}

// Construye el comando final sin ejecutarlo. Separarlo de la ejecución permite
// probarlo y mostrarlo con `aurora plan`.
function buildPlan(game, config, system) {
  const { display, compat } = config;
  const exeDir = path.dirname(game.exe);
  const gameDir = path.join(system.gamesDir, game.id);

  const wrappers = (compat.wrappers || []).map((w) => loadWrapper(w, system.wrappersDir));
  const dllOverrides = { ...compat.dllOverrides };
  for (const w of wrappers) Object.assign(dllOverrides, w.overrides);

  const env = {
    ...config.env,
    WINEPREFIX: path.join(gameDir, 'prefix'),
    GAMEID: game.umuId || `umu-${game.id}`,
    PROTONPATH: compat.proton,
  };
  if (game.store) env.STORE = game.store;
  if (Object.keys(dllOverrides).length) env.WINEDLLOVERRIDES = formatDllOverrides(dllOverrides);
  if (compat.useWined3d) env.PROTON_USE_WINED3D = '1';
  if (display.fpsLimit) {
    // DXVK limita D3D8-11; MangoHud cubre el resto de lo que pase por Vulkan.
    env.DXVK_FRAME_RATE = String(display.fpsLimit);
    env.MANGOHUD = '1';
    env.MANGOHUD_CONFIG = `fps_limit=${display.fpsLimit},no_display`;
  }

  const gamescopeArgs = [
    '-W', String(display.outputWidth),
    '-H', String(display.outputHeight),
    '-w', String(display.renderWidth),
    '-h', String(display.renderHeight),
    '-f',
  ];
  if (display.filter) gamescopeArgs.push('-F', display.filter);
  if (display.scaler) gamescopeArgs.push('-S', display.scaler);

  const inner = [];
  if (config.gamemode) inner.push('gamemoderun');
  if (compat.runner !== 'umu') throw new Error(`Runner no soportado: ${compat.runner}`);
  inner.push('umu-run', game.exe, ...(game.args || []));

  return {
    command: 'gamescope',
    args: [...gamescopeArgs, '--', ...inner],
    env,
    // Muchos juegos viejos buscan sus archivos relativos al directorio actual.
    cwd: exeDir,
    wrappers: wrappers.map((w) => ({ name: w.name, dir: w.dir, files: w.files, configFiles: w.configFiles })),
    prefixDir: env.WINEPREFIX,
  };
}

function sameContent(a, b) {
  const sa = fs.statSync(a);
  const sb = fs.statSync(b);
  return sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
}

// Copia los archivos de los wrappers junto al .exe. Si el juego ya traía un
// archivo con el mismo nombre se guarda como .aurora-bak (una sola vez).
function applyWrappers(plan) {
  const actions = [];
  for (const w of plan.wrappers) {
    for (const file of w.files) {
      const src = path.join(w.dir, file);
      const dest = path.join(plan.cwd, file);
      if (fs.existsSync(dest)) {
        if (sameContent(src, dest)) continue;
        const backup = `${dest}.aurora-bak`;
        if (!fs.existsSync(backup)) {
          fs.renameSync(dest, backup);
          actions.push(`backup ${dest}`);
        }
      }
      fs.copyFileSync(src, dest);
      actions.push(`copy ${file} (${w.name})`);
    }
    // Los archivos de configuración se copian solo si faltan, para respetar
    // los ajustes hechos a mano.
    for (const file of w.configFiles) {
      const dest = path.join(plan.cwd, file);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(path.join(w.dir, file), dest);
        actions.push(`copy ${file} (${w.name}, config)`);
      }
    }
  }
  return actions;
}

module.exports = { buildPlan, applyWrappers, formatDllOverrides };
