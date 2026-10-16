'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJSON } = require('./config');
const { detectGame, findCandidates } = require('./detect');

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function gameFile(gamesDir, id) {
  if (!ID_RE.test(id)) throw new Error(`ID de juego inválido: ${id}`);
  return path.join(gamesDir, id, 'game.json');
}

function getGame(gamesDir, id) {
  const game = readJSON(gameFile(gamesDir, id));
  if (!game) throw new Error(`Juego no encontrado: ${id}`);
  return game;
}

function listGames(gamesDir) {
  let entries;
  try {
    entries = fs.readdirSync(gamesDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const games = [];
  for (const e of entries) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    const game = readJSON(path.join(gamesDir, e.name, 'game.json'));
    if (game) games.push(game);
  }
  return games.sort((a, b) => a.name.localeCompare(b.name));
}

function saveGame(gamesDir, game) {
  const file = gameFile(gamesDir, game.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(game, null, 2)}\n`);
  return file;
}

// Registra un juego ya instalado (carpeta o .exe). La detección decide la
// capa de API; género y overrides quedan para ajustar después.
function addGame(gamesDir, target, opts = {}) {
  const abs = path.resolve(target);
  let exe = abs;
  let candidates = [];
  if (fs.statSync(abs).isDirectory()) {
    candidates = findCandidates(abs);
    if (!candidates.length) throw new Error(`No se encontraron .exe en ${abs}`);
    exe = candidates[0].exe;
  }

  const name = opts.name || path.basename(fs.statSync(abs).isDirectory() ? abs : path.dirname(abs));
  const id = opts.id || slugify(name);
  if (!ID_RE.test(id)) throw new Error(`No se pudo generar un ID válido para "${name}"; usar --id`);
  if (fs.existsSync(gameFile(gamesDir, id)) && !opts.force) {
    throw new Error(`Ya existe un juego con ID "${id}" (usar --force para reemplazarlo)`);
  }

  const game = {
    id,
    name,
    exe,
    args: [],
    genre: opts.genre || null,
    store: opts.store || null,
    detected: detectGame(exe),
    overrides: {},
    addedAt: new Date().toISOString(),
  };
  const file = saveGame(gamesDir, game);
  return { game, file, candidates: candidates.slice(0, 5) };
}

module.exports = { addGame, getGame, listGames, saveGame, slugify };
