#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSystemConfig, resolveConfig } = require('../src/config');
const { detectGame } = require('../src/detect');
const { exportEsde, readRomFile } = require('../src/esde');
const { addGame, getGame, listGames } = require('../src/library');
const { buildPlan, applyWrappers } = require('../src/launch');
const { setPowerMode } = require('../src/power');

const USAGE = `Uso: aurora <comando> [opciones]

  detect <archivo.exe>                 Analiza un ejecutable (API gráfica, arquitectura, input)
  add <carpeta|exe> [--id ID] [--name NOMBRE] [--genre GENERO] [--store gog|steam] [--force | --if-new]
                                       Registra un juego instalado y actualiza ES-DE
  list                                 Lista los juegos registrados
  plan <id>                            Muestra la configuración resuelta y el comando, sin ejecutar
  launch <id>                          Ejecuta el juego
  launch-rom <archivo.aurora>          Ejecuta el juego de un archivo de ES-DE
  export-esde                          Regenera los archivos de juegos y el sistema de ES-DE
  power <battery|balanced|performance> Ajusta el TDP con ryzenadj
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) positional.push(a);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return { positional, flags };
}

const print = (obj) => console.log(JSON.stringify(obj, null, 2));

const stateDir = () =>
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'aurora');

// Cada juego deja la salida de su última ejecución en
// ~/.local/state/aurora/games/<id>.log (lo junta aurora-logs).
function openGameLog(id) {
  const dir = path.join(stateDir(), 'games');
  try {
    fs.mkdirSync(dir, { recursive: true });
    return fs.openSync(path.join(dir, `${id}.log`), 'w');
  } catch {
    return null;
  }
}

function launch(system, id, { logToFile = false } = {}) {
  const game = getGame(system.gamesDir, id);
  const fd = logToFile ? openGameLog(game.id) : null;
  const log = (line) => (fd === null ? console.error(line) : fs.writeSync(fd, `${line}\n`));
  const { config } = resolveConfig(game, system);
  const plan = buildPlan(game, config, system);
  log(`[aurora] ${new Date().toISOString()} ${game.name}: ${game.exe}`);
  for (const action of applyWrappers(plan)) log(`[aurora] ${action}`);
  log(`[aurora] ${[plan.command, ...plan.args].join(' ')}`);

  // El juego va en su propio grupo de procesos: aurora-hotkeys lo pausa o lo
  // cierra entero (Proton deja varios procesos) sin tocar a ES-DE.
  const child = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: { ...process.env, ...plan.env },
    stdio: fd === null ? 'inherit' : ['inherit', fd, fd],
    detached: true,
  });
  const running = path.join(stateDir(), 'running-game.json');
  const clear = () => fs.rmSync(running, { force: true });
  if (child.pid) {
    try {
      fs.mkdirSync(stateDir(), { recursive: true });
      fs.writeFileSync(running, JSON.stringify({ id: game.id, name: game.name, pid: child.pid }) + '\n');
    } catch {
      // Sin este archivo el juego corre igual, solo sin menú rápido.
    }
  }
  // Si ES-DE corta el lanzador, el juego se cierra con él.
  for (const sig of ['SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      try {
        process.kill(-child.pid, sig);
      } catch {
        // Ya terminó.
      }
    });
  }
  child.on('error', (err) => {
    clear();
    log(`[aurora] no se pudo ejecutar ${plan.command}: ${err.message}`);
    process.exit(127);
  });
  child.on('exit', (code, signal) => {
    clear();
    log(`[aurora] terminó: ${signal ? `señal ${signal}` : `código ${code}`}`);
    process.exit(signal ? 1 : code ?? 0);
  });
}

function reportExport(result) {
  const { romDir, systems, created, removed } = result;
  console.log(`ES-DE: ${romDir} (+${created.length} / -${removed.length})`);
  if (!systems.written) console.log(`  Aviso: ${systems.file}: ${systems.reason}`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const system = loadSystemConfig();

  switch (cmd) {
    case 'detect':
      if (!positional[0]) throw new Error('Falta el .exe');
      return print(detectGame(positional[0]));
    case 'add': {
      if (!positional[0]) throw new Error('Falta la carpeta o el .exe');
      const { game, file, candidates, skipped } = addGame(system.gamesDir, positional[0], flags);
      if (skipped) return console.log(`Ya registrado: "${game.name}" (${game.id})`);
      console.log(`Agregado "${game.name}" (${game.id}) → ${file}`);
      console.log(`  exe: ${game.exe}`);
      console.log(`  API: ${game.detected.api} · ${game.detected.arch}`);
      if (candidates.length > 1) {
        console.log('  Otros candidatos (editar "exe" en game.json si el elegido no es el correcto):');
        for (const c of candidates.slice(1)) console.log(`    ${c.score}\t${c.exe}`);
      }
      return reportExport(exportEsde(system));
    }
    case 'list':
      for (const g of listGames(system.gamesDir)) {
        console.log(`${g.id}\t${g.detected?.api ?? '?'}\t${g.genre ?? '-'}\t${g.name}`);
      }
      return;
    case 'plan': {
      const game = getGame(system.gamesDir, positional[0] || '');
      const { config, layers } = resolveConfig(game, system);
      return print({ layers, config, plan: buildPlan(game, config, system) });
    }
    case 'launch':
      return launch(system, positional[0] || '');
    case 'launch-rom':
      if (!positional[0]) throw new Error('Falta el archivo .aurora');
      return launch(system, readRomFile(positional[0]), { logToFile: true });
    case 'export-esde':
      return reportExport(exportEsde(system));
    case 'power':
      return print(setPowerMode(system, positional[0] || ''));
    default:
      process.stdout.write(USAGE);
      process.exitCode = cmd && cmd !== 'help' ? 1 : 0;
  }
}

try {
  main();
} catch (err) {
  console.error(`aurora: ${err.message}`);
  process.exit(1);
}
