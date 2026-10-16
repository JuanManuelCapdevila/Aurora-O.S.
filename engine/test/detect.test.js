'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { detectGame, findCandidates } = require('../src/detect');
const { buildPE, tmpDir, writeFile } = require('./helpers');

test('detecta Direct3D 9 por la tabla de imports', () => {
  const dir = tmpDir();
  const exe = writeFile(path.join(dir, 'gta_sa.exe'), buildPE({ imports: ['d3d9.dll', 'dinput8.dll', 'dsound.dll'] }));
  const r = detectGame(exe);
  assert.equal(r.api, 'd3d9');
  assert.equal(r.arch, 'x86');
  assert.equal(r.input.dinput, true);
  assert.equal(r.input.xinput, false);
  assert.equal(r.audio.dsound, true);
  assert.ok(r.evidence.d3d9.includes('import'));
});

test('detecta DLLs cargadas dinámicamente por sus strings', () => {
  const dir = tmpDir();
  const exe = writeFile(path.join(dir, 'game.exe'), buildPE({ imports: ['kernel32.dll'], strings: ['D3D8.DLL'] }));
  assert.equal(detectGame(exe).api, 'd3d8');
});

test('detecta el renderer en una DLL del juego y prioriza Direct3D sobre OpenGL', () => {
  const dir = tmpDir();
  const exe = writeFile(path.join(dir, 'System', 'Game.exe'), buildPE({ imports: ['core.dll'] }));
  writeFile(path.join(dir, 'System', 'OpenGLDrv.dll'), buildPE({ dll: true, imports: ['opengl32.dll'] }));
  writeFile(path.join(dir, 'System', 'D3D9Drv.dll'), buildPE({ dll: true, imports: ['d3d9.dll', 'xinput1_3.dll'] }));
  const r = detectGame(exe);
  assert.equal(r.api, 'd3d9');
  assert.deepEqual(r.apis, ['d3d9', 'opengl']);
  assert.equal(r.input.xinput, true);
});

test('ignora wrappers copiados junto al juego (ddraw.dll) como evidencia', () => {
  const dir = tmpDir();
  const exe = writeFile(path.join(dir, 'old.exe'), buildPE({ imports: ['ddraw.dll'] }));
  writeFile(path.join(dir, 'ddraw.dll'), buildPE({ dll: true, imports: ['d3d9.dll'] }));
  assert.equal(detectGame(exe).api, 'ddraw');
});

test('sin APIs gráficas conocidas devuelve unknown', () => {
  const dir = tmpDir();
  const exe = writeFile(path.join(dir, 'x.exe'), buildPE({ imports: ['kernel32.dll'] }));
  assert.equal(detectGame(exe).api, 'unknown');
});

test('findCandidates elige el ejecutable del juego y no el desinstalador', () => {
  const dir = tmpDir();
  writeFile(path.join(dir, 'unins000.exe'), buildPE({ imports: ['kernel32.dll', 'user32.dll'] }));
  writeFile(path.join(dir, 'Setup.exe'), buildPE({ imports: ['d3d9.dll'] }));
  writeFile(path.join(dir, 'tools', 'console.exe'), buildPE({ imports: ['kernel32.dll'], subsystem: 3 }));
  writeFile(path.join(dir, 'nfsc.exe'), buildPE({ imports: ['d3d9.dll'] }));
  writeFile(path.join(dir, 'readme.txt'), 'hola');
  const [best] = findCandidates(dir);
  assert.equal(path.basename(best.exe), 'nfsc.exe');
});
