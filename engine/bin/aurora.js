#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const { loadSystemConfig, resolveConfig } = require('../src/config');
const { detectGame } = require('../src/detect');
const { addGame, getGame, listGames } = require('../src/library');
const { buildPlan, applyWrappers } = require('../src/launch');
const { setPowerMode } = require('../src/power');
const { serve } = require('../src/server');

const USAGE = `Uso: aurora <comando> [opciones]

  detect <archivo.exe>                 Analiza un ejecutable (API gráfica, arquitectura, input)
  add <carpeta|exe> [--id ID] [--name NOMBRE] [--genre GENERO] [--store gog|steam] [--force]
                                       Registra un juego instalado
  list                                 Lista los juegos registrados
  plan <id>                            Muestra la configuración resuelta y el comando, sin ejecutar
  launch <id>                          Ejecuta el juego
  serve [--port N] [--once]            Servidor del launcher
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

function launch(system, id) {
  const game = getGame(system.gamesDir, id);
  const { config } = resolveConfig(game, system);
  const plan = buildPlan(game, config, system);
  for (const action of applyWrappers(plan)) console.error(`[aurora] ${action}`);

  const child = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: { ...process.env, ...plan.env },
    stdio: 'inherit',
  });
  child.on('error', (err) => {
    console.error(`[aurora] no se pudo ejecutar ${plan.command}: ${err.message}`);
    process.exit(127);
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
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
      const { game, file, candidates } = addGame(system.gamesDir, positional[0], flags);
      console.log(`Agregado "${game.name}" (${game.id}) → ${file}`);
      console.log(`  exe: ${game.exe}`);
      console.log(`  API: ${game.detected.api} · ${game.detected.arch}`);
      if (candidates.length > 1) {
        console.log('  Otros candidatos (editar "exe" en game.json si el elegido no es el correcto):');
        for (const c of candidates.slice(1)) console.log(`    ${c.score}\t${c.exe}`);
      }
      return;
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
    case 'serve': {
      const port = Number(flags.port || 7777);
      serve(system, { port, once: Boolean(flags.once) });
      console.error(`[aurora] launcher en http://127.0.0.1:${port}`);
      return;
    }
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
