'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { addGame, listGames, slugify } = require('../src/library');
const { exportEsde, readRomFile, MARKER } = require('../src/esde');
const { buildPE, tmpDir, writeFile } = require('./helpers');

function setup() {
  const root = tmpDir();
  return {
    root,
    system: {
      gamesDir: path.join(root, 'Games'),
      romsDir: path.join(root, 'ROMs'),
      esdeDir: path.join(root, 'ES-DE'),
      auroraBin: '/usr/local/bin/aurora',
      toolsDir: '/usr/share/aurora/tools',
    },
  };
}

test('slugify genera IDs válidos', () => {
  assert.equal(slugify('Grand Theft Auto: San Andreas'), 'grand-theft-auto-san-andreas');
  assert.equal(slugify('Pro Evolution Soccer 2010 (Edición Ñ)'), 'pro-evolution-soccer-2010-edicion-n');
});

test('add registra el juego con la detección y no pisa uno existente', () => {
  const { root, system } = setup();
  const dir = path.join(root, 'install', 'GTA Vice City');
  writeFile(path.join(dir, 'gta-vc.exe'), buildPE({ imports: ['d3d8.dll'] }));
  const { game } = addGame(system.gamesDir, dir, { genre: 'action' });
  assert.equal(game.id, 'gta-vice-city');
  assert.equal(game.detected.api, 'd3d8');
  assert.equal(listGames(system.gamesDir).length, 1);
  assert.throws(() => addGame(system.gamesDir, dir), /Ya existe/);
  assert.equal(addGame(system.gamesDir, dir, { 'if-new': true }).skipped, true);
});

test('export-esde crea un archivo por juego, el sistema y limpia los viejos', () => {
  const { root, system } = setup();
  for (const [name, dll] of [['GTA San Andreas', 'd3d9.dll'], ['NFS: Carbon', 'd3d9.dll']]) {
    const dir = path.join(root, 'install', slugify(name));
    writeFile(path.join(dir, 'game.exe'), buildPE({ imports: [dll] }));
    addGame(system.gamesDir, dir, { name });
  }
  const romDir = path.join(system.romsDir, 'windows');
  writeFile(path.join(romDir, 'Borrado.aurora'), 'ya-no-existe\n');
  writeFile(path.join(romDir, 'otro.txt'), 'no tocar');

  const r = exportEsde(system);
  assert.deepEqual(r.created.sort(), ['GTA San Andreas.aurora', 'NFS Carbon.aurora']);
  assert.deepEqual(r.removed, ['Borrado.aurora']);
  assert.equal(readRomFile(path.join(romDir, 'NFS Carbon.aurora')), 'nfs-carbon');
  assert.ok(fs.existsSync(path.join(romDir, 'otro.txt')));
  const xml = fs.readFileSync(r.systems.file, 'utf8');
  assert.match(xml, /<command label="Aurora">\/usr\/local\/bin\/aurora launch-rom %ROM%<\/command>/);
  assert.match(xml, /<path>\/usr\/share\/aurora\/tools<\/path>/);
  assert.match(xml, /<fullname>Juegos<\/fullname>/);
  assert.match(xml, /<theme>aurora<\/theme>/);

  // Idempotente.
  const again = exportEsde(system);
  assert.deepEqual([again.created, again.removed], [[], []]);
});

test('export-esde no pisa un es_systems.xml escrito por el usuario', () => {
  const { system } = setup();
  const file = writeFile(path.join(system.esdeDir, 'custom_systems', 'es_systems.xml'), '<systemList/>');
  const r = exportEsde(system);
  assert.equal(r.systems.written, false);
  assert.equal(fs.readFileSync(file, 'utf8'), '<systemList/>');
  assert.ok(!fs.readFileSync(file, 'utf8').includes(MARKER));
});

test('export-esde enlaza el tema, los íconos y la configuración inicial sin pisar la del usuario', () => {
  const { root, system } = setup();
  const assets = path.join(root, 'assets');
  writeFile(path.join(assets, 'themes', 'aurora-material', 'theme.xml'), '<theme/>');
  writeFile(path.join(assets, 'media', 'aurora', 'covers', 'Terminal.png'), 'png');
  writeFile(path.join(assets, 'es_settings.xml'), '<string name="Theme" value="aurora-material" />');
  system.esdeAssetsDir = assets;

  const r = exportEsde(system);
  assert.equal(r.assets.installed.length, 3);
  assert.equal(
    fs.readFileSync(path.join(system.esdeDir, 'themes', 'aurora-material', 'theme.xml'), 'utf8'),
    '<theme/>',
  );
  assert.ok(fs.existsSync(path.join(system.esdeDir, 'downloaded_media', 'aurora', 'covers', 'Terminal.png')));

  // Si el usuario cambió la configuración de ES-DE, no se toca.
  const settings = path.join(system.esdeDir, 'settings', 'es_settings.xml');
  fs.writeFileSync(settings, '<string name="Theme" value="otro" />');
  assert.deepEqual(exportEsde(system).assets.installed, []);
  assert.equal(fs.readFileSync(settings, 'utf8'), '<string name="Theme" value="otro" />');
});

test('export-esde funciona sin recursos del tema instalados', () => {
  const { root, system } = setup();
  system.esdeAssetsDir = path.join(root, 'no-existe');
  assert.deepEqual(exportEsde(system).assets.installed, []);
});
