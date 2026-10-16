'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { listGames } = require('./library');

// Integración con ES-DE (EmulationStation Desktop Edition).
// Cada juego se expone como un archivo "<Nombre>.aurora" en ~/ROMs/windows cuyo
// contenido es el ID del juego. ES-DE lo muestra (y scrapea carátulas) por el
// nombre del archivo y al elegirlo ejecuta `aurora launch-rom <archivo>`.

const SYSTEM_NAME = 'windows';
const ROM_EXT = '.aurora';
const MARKER = '<!-- Generado por Aurora: aurora export-esde. Se sobrescribe en cada exportación. -->';

function esSystemsXml(auroraBin) {
  return `<?xml version="1.0"?>
${MARKER}
<systemList>
  <system>
    <name>${SYSTEM_NAME}</name>
    <fullname>Microsoft Windows</fullname>
    <path>%ROMPATH%/${SYSTEM_NAME}</path>
    <extension>${ROM_EXT}</extension>
    <command label="Aurora">${auroraBin} launch-rom %ROM%</command>
    <platform>pc</platform>
    <theme>${SYSTEM_NAME}</theme>
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
  fs.writeFileSync(file, esSystemsXml(system.auroraBin));
  return { file, written: true };
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

  return { romDir, systems: writeEsSystems(system), created, removed };
}

function readRomFile(file) {
  const id = fs.readFileSync(file, 'utf8').trim();
  if (!id) throw new Error(`Archivo vacío: ${file}`);
  return id;
}

module.exports = { exportEsde, readRomFile, romFileName, esSystemsXml, MARKER };
