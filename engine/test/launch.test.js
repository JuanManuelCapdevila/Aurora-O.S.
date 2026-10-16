'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveConfig } = require('../src/config');
const { buildPlan, applyWrappers } = require('../src/launch');
const { tmpDir, writeFile } = require('./helpers');

function setup() {
  const root = tmpDir();
  const system = {
    device: 'win600-3050e',
    gamesDir: path.join(root, 'Games'),
    wrappersDir: path.join(root, 'wrappers'),
  };
  const exe = writeFile(path.join(root, 'install', 'game', 'game.exe'), 'MZ');
  return { root, system, exe };
}

test('arma el comando gamescope + gamemode + umu-run', () => {
  const { system, exe } = setup();
  const game = { id: 'gta-sa', exe, args: ['-nointro'], detected: { api: 'd3d9' }, store: 'gog' };
  const { config } = resolveConfig(game, system);
  const plan = buildPlan(game, config, system);

  assert.equal(plan.command, 'gamescope');
  assert.deepEqual(plan.args, [
    '-W', '1280', '-H', '720', '-w', '960', '-h', '540', '-f', '-F', 'fsr', '-S', 'fit',
    '--', 'gamemoderun', 'umu-run', exe, '-nointro',
  ]);
  assert.equal(plan.cwd, path.dirname(exe));
  assert.equal(plan.env.WINEPREFIX, path.join(system.gamesDir, 'gta-sa', 'prefix'));
  assert.equal(plan.env.GAMEID, 'umu-gta-sa');
  assert.equal(plan.env.STORE, 'gog');
  assert.equal(plan.env.PROTONPATH, 'GE-Proton');
  assert.equal(plan.env.DXVK_FRAME_RATE, '60');
  assert.equal(plan.env.WINEDLLOVERRIDES, undefined);
});

test('los wrappers agregan DLL overrides y se copian junto al exe con backup', () => {
  const { system, exe } = setup();
  const wdir = path.join(system.wrappersDir, 'cnc-ddraw');
  writeFile(path.join(wdir, 'manifest.json'), JSON.stringify({
    files: ['ddraw.dll'], configFiles: ['ddraw.ini'], overrides: { ddraw: 'n,b' },
  }));
  writeFile(path.join(wdir, 'ddraw.dll'), 'wrapper');
  writeFile(path.join(wdir, 'ddraw.ini'), 'default');
  const gameDir = path.dirname(exe);
  writeFile(path.join(gameDir, 'ddraw.dll'), 'original');
  writeFile(path.join(gameDir, 'ddraw.ini'), 'editado a mano');

  const game = {
    id: 'old', exe, detected: { api: 'ddraw' },
    overrides: { compat: { wrappers: ['cnc-ddraw'], dllOverrides: { dsound: 'n,b' } } },
  };
  const { config } = resolveConfig(game, system);
  const plan = buildPlan(game, config, system);
  assert.equal(plan.env.WINEDLLOVERRIDES, 'dsound=n,b;ddraw=n,b');
  assert.deepEqual(plan.args.slice(4, 8), ['-w', '800', '-h', '600']);

  applyWrappers(plan);
  assert.equal(fs.readFileSync(path.join(gameDir, 'ddraw.dll'), 'utf8'), 'wrapper');
  assert.equal(fs.readFileSync(path.join(gameDir, 'ddraw.dll.aurora-bak'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(gameDir, 'ddraw.ini'), 'utf8'), 'editado a mano');
  // Segunda vez: no hay nada que hacer y el backup original se conserva.
  assert.deepEqual(applyWrappers(plan), []);
  assert.equal(fs.readFileSync(path.join(gameDir, 'ddraw.dll.aurora-bak'), 'utf8'), 'original');
});

test('falla con un mensaje claro si el wrapper no está instalado', () => {
  const { system, exe } = setup();
  const game = { id: 'x', exe, overrides: { compat: { wrappers: ['dgvoodoo2'] } } };
  const { config } = resolveConfig(game, system);
  assert.throws(() => buildPlan(game, config, system), /fetch-wrappers/);
});

test('sin gamemode ni límite de FPS no agrega gamemoderun ni MangoHud', () => {
  const { system, exe } = setup();
  const game = { id: 'x', exe, overrides: { gamemode: false, display: { fpsLimit: null } } };
  const { config } = resolveConfig(game, system);
  const plan = buildPlan(game, config, system);
  assert.ok(!plan.args.includes('gamemoderun'));
  assert.equal(plan.env.MANGOHUD, undefined);
});
