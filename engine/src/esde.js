'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { listGames } = require('./library');

// Integración con ES-DE (EmulationStation Desktop Edition).
// Cada juego se expone como un archivo "<Nombre>.aurora" en ~/ROMs/windows cuyo
// contenido es el ID del juego. ES-DE lo muestra (y scrapea carátulas) por el
// nombre del archivo y al elegirlo ejecuta `aurora launch-rom <archivo>`.
// Un segundo sistema, "Ajustes", muestra los scripts de toolsDir (Wi-Fi, buscar
// juegos, instalar, energía). El tema aurora-material y los íconos de las
// herramientas se enlazan desde esdeAssetsDir (los genera theme/build.mjs).

const SYSTEM_NAME = 'windows';
const ROM_EXT = '.aurora';
const MARKER = '<!-- Generado por Aurora: aurora export-esde. Se sobrescribe en cada exportación. -->';

function esSystemsXml(auroraBin, toolsDir) {
  return `<?xml version="1.0"?>
${MARKER}
<systemList>
  <system>
    <name>${SYSTEM_NAME}</name>
    <fullname>Juegos</fullname>
    <path>%ROMPATH%/${SYSTEM_NAME}</path>
    <extension>${ROM_EXT}</extension>
    <command label="Aurora">${auroraBin} launch-rom %ROM%</command>
    <platform>pc</platform>
    <theme>${SYSTEM_NAME}</theme>
  </system>
  <system>
    <name>aurora</name>
    <fullname>Ajustes</fullname>
    <path>${toolsDir}</path>
    <extension>.sh</extension>
    <command label="Aurora">/usr/bin/bash %ROM%</command>
    <platform>ignore</platform>
    <theme>aurora</theme>
  </system>
</systemList>
`;
}

// Nombre de archivo legible para ES-DE y su scraper.
function romFileName(name) {
  const clean = name
    .replace(/[\u0000-\u001f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return clean || 'juego';
}

function writeEsSystems(system) {
  const file = path.join(system.esdeDir, 'custom_systems', 'es_systems.xml');
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(MARKER)) {
    return { file, written: false, reason: 'ya existe un es_systems.xml propio; agregar el sistema a mano' };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, esSystemsXml(system.auroraBin, system.toolsDir));
  return { file, written: true };
}

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Lista de Ajustes para ES-DE: nombre, descripción y orden de cada entrada de
// tools.json. nogamecount las saca del contador de juegos y de las colecciones
// Todos/Favoritos/Recientes. Se reescribe siempre: estas entradas son de Aurora.
function writeToolsGamelist(system) {
  const manifest = path.join(system.toolsDir || '', 'tools.json');
  if (!system.toolsDir || !fs.existsSync(manifest)) return null;
  const { tools } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const games = tools
    .filter((t) => fs.existsSync(path.join(system.toolsDir, `${t.file}.sh`)))
    .map(
      (t, i) => `  <game>
    <path>./${escapeXml(t.file)}.sh</path>
    <name>${escapeXml(t.name)}</name>
    <sortname>${String(i + 1).padStart(2, '0')} ${escapeXml(t.name)}</sortname>
    <desc>${escapeXml(t.desc || '')}</desc>
    <nogamecount>true</nogamecount>
  </game>`,
    );
  const file = path.join(system.esdeDir, 'gamelists', 'aurora', 'gamelist.xml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `<?xml version="1.0"?>\n<gameList>\n${games.join('\n')}\n</gameList>\n`);
  return file;
}

// Enlaza el tema y los íconos de las herramientas dentro de ~/ES-DE y deja la
// configuración inicial si el usuario todavía no tiene una. Nunca pisa archivos
// del usuario: solo crea lo que falta (y agrega las opciones nuevas de Aurora
// que su configuración todavía no tenga).
function installEsdeAssets(system) {
  const assets = system.esdeAssetsDir;
  if (!assets || !fs.existsSync(assets)) return { installed: [] };
  const installed = [];
  const link = (target, linkPath) => {
    if (!fs.existsSync(target)) return;
    try {
      fs.lstatSync(linkPath);
      return;
    } catch {
      // No existe: se crea.
    }
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(target, linkPath);
    installed.push(linkPath);
  };
  link(path.join(assets, 'themes', 'aurora-material'), path.join(system.esdeDir, 'themes', 'aurora-material'));
  link(path.join(assets, 'media', 'aurora'), path.join(system.esdeDir, 'downloaded_media', 'aurora'));

  const settings = path.join(system.esdeDir, 'settings', 'es_settings.xml');
  const defaults = path.join(assets, 'es_settings.xml');
  if (fs.existsSync(defaults) && !fs.existsSync(settings)) {
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.copyFileSync(defaults, settings);
    installed.push(settings);
  } else if (fs.existsSync(defaults) && addMissingSettings(defaults, settings)) {
    installed.push(settings);
  }
  return { installed };
}

// Agrega al es_settings.xml del usuario las opciones de Aurora que le faltan
// (ej. las que se sumaron en una versión nueva). Las que ya tiene no se tocan.
function addMissingSettings(defaults, settings) {
  const option = /^\s*<\w+ name="([^"]+)"/;
  const current = fs.readFileSync(settings, 'utf8');
  const present = new Set(current.split('\n').map((l) => l.match(option)?.[1]).filter(Boolean));
  const missing = fs
    .readFileSync(defaults, 'utf8')
    .split('\n')
    .filter((l) => {
      const m = l.match(option);
      return m && !present.has(m[1]);
    });
  if (missing.length === 0) return false;
  const sep = current === '' || current.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(settings, `${current}${sep}${missing.map((l) => l.trim()).join('\n')}\n`);
  return true;
}

function exportEsde(system) {
  const romDir = path.join(system.romsDir, SYSTEM_NAME);
  fs.mkdirSync(romDir, { recursive: true });

  const wanted = new Map();
  const usedNames = new Set();
  for (const game of listGames(system.gamesDir)) {
    let base = romFileName(game.name);
    if (usedNames.has(base.toLowerCase())) base = `${base} (${game.id})`;
    usedNames.add(base.toLowerCase());
    wanted.set(`${base}${ROM_EXT}`, game.id);
  }

  const created = [];
  const removed = [];
  for (const entry of fs.readdirSync(romDir)) {
    if (!entry.endsWith(ROM_EXT)) continue;
    const id = fs.readFileSync(path.join(romDir, entry), 'utf8').trim();
    if (wanted.get(entry) === id) {
      wanted.delete(entry);
    } else {
      fs.unlinkSync(path.join(romDir, entry));
      removed.push(entry);
    }
  }
  for (const [entry, id] of wanted) {
    fs.writeFileSync(path.join(romDir, entry), `${id}\n`);
    created.push(entry);
  }

  return {
    romDir,
    systems: writeEsSystems(system),
    tools: writeToolsGamelist(system),
    assets: installEsdeAssets(system),
    created,
    removed,
  };
}

function readRomFile(file) {
  const id = fs.readFileSync(file, 'utf8').trim();
  if (!id) throw new Error(`Archivo vacío: ${file}`);
  return id;
}

module.exports = { exportEsde, installEsdeAssets, readRomFile, romFileName, esSystemsXml, MARKER };
