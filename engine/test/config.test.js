'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deepMerge, resolveConfig } = require('../src/config');

const system = { device: 'win600-3050e' };

test('deepMerge combina objetos, reemplaza arrays y borra con null', () => {
  const out = deepMerge({ a: { b: 1, c: 2 }, l: [1, 2], x: 1 }, { a: { c: 3 }, l: [9], x: null });
  assert.deepEqual(out, { a: { b: 1, c: 3 }, l: [9] });
});

test('aplica las capas en orden: defaults → dispositivo → API → género → juego', () => {
  const game = {
    detected: { api: 'd3d11' },
    genre: 'racing',
    overrides: { display: { fpsLimit: 45 }, compat: { wrappers: ['dgvoodoo2'] } },
  };
  const { config, layers } = resolveConfig(game, system);
  assert.deepEqual(layers, ['defaults', 'device/win600-3050e', 'api/d3d11', 'genre/racing', 'game']);
  assert.equal(config.display.renderWidth, 854);
  assert.equal(config.display.outputWidth, 1280);
  assert.equal(config.display.fpsLimit, 45);
  assert.equal(config.controls.profile, 'racing');
  assert.deepEqual(config.compat.wrappers, ['dgvoodoo2']);
  assert.equal(config.compat.proton, 'GE-Proton');
  assert.equal(config.description, undefined);
});

test('una API sin perfil propio usa solo los defaults', () => {
  const { layers, config } = resolveConfig({ detected: { api: 'unknown' } }, system);
  assert.deepEqual(layers, ['defaults', 'device/win600-3050e']);
  assert.equal(config.display.renderWidth, 960);
});

test('rechaza nombres de perfil con rutas', () => {
  assert.throws(() => resolveConfig({ genre: '../defaults' }, system), /inválido/);
});
