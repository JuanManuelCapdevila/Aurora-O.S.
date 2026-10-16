'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROFILES_DIR = path.join(__dirname, '..', 'profiles');

const HOME = process.env.HOME || '/home/player';

const DEFAULT_SYSTEM = {
  gamesDir: path.join(HOME, 'Games'),
  esdeDir: path.join(HOME, 'ES-DE'),
  romsDir: path.join(HOME, 'ROMs'),
  wrappersDir: '/usr/share/aurora/wrappers',
  toolsDir: '/usr/share/aurora/tools',
  auroraBin: '/usr/local/bin/aurora',
  device: 'win600-3050e',
};

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`JSON inválido en ${file}: ${err.message}`);
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Merge profundo: los objetos se combinan, los arrays y valores simples se
// reemplazan. `null` en una capa superior borra el valor heredado.
function deepMerge(base, layer) {
  if (!isPlainObject(layer)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    if (value === null) delete out[key];
    else if (isPlainObject(value) && isPlainObject(out[key])) out[key] = deepMerge(out[key], value);
    else out[key] = value;
  }
  return out;
}

function loadSystemConfig() {
  const file = process.env.AURORA_CONFIG || '/etc/aurora/aurora.json';
  return { ...DEFAULT_SYSTEM, ...(readJSON(file) || {}) };
}

function loadProfile(kind, name, profilesDir = PROFILES_DIR) {
  if (!name) return null;
  if (!/^[a-z0-9._-]+$/i.test(name)) throw new Error(`Nombre de perfil inválido: ${name}`);
  const file = kind ? path.join(profilesDir, kind, `${name}.json`) : path.join(profilesDir, `${name}.json`);
  const profile = readJSON(file);
  if (!profile) throw new Error(`Perfil no encontrado: ${kind ? `${kind}/` : ''}${name}`);
  return profile;
}

// Resuelve la configuración final de un juego aplicando las capas en orden:
// defaults → dispositivo → API detectada → género → overrides del juego.
function resolveConfig(game, system, profilesDir = PROFILES_DIR) {
  const layers = [
    ['defaults', loadProfile(null, 'defaults', profilesDir)],
    [`device/${system.device}`, loadProfile('device', system.device, profilesDir)],
  ];
  const api = game.detected?.api;
  if (api && fs.existsSync(path.join(profilesDir, 'api', `${api}.json`))) {
    layers.push([`api/${api}`, loadProfile('api', api, profilesDir)]);
  }
  if (game.genre) layers.push([`genre/${game.genre}`, loadProfile('genre', game.genre, profilesDir)]);
  if (game.overrides) layers.push(['game', game.overrides]);

  let config = {};
  for (const [, layer] of layers) config = deepMerge(config, layer);
  // Los metadatos de un perfil (ej. "description") no forman parte de la config.
  delete config.description;
  return { config, layers: layers.map(([name]) => name) };
}

module.exports = { deepMerge, loadSystemConfig, loadProfile, resolveConfig, readJSON, PROFILES_DIR };
