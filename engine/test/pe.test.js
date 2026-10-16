'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePE, PEError } = require('../src/pe');
const { buildPE } = require('./helpers');

test('lee imports de un PE de 32 bits', () => {
  const pe = parsePE(buildPE({ imports: ['KERNEL32.dll', 'd3d9.dll', 'DSOUND.dll'] }));
  assert.equal(pe.machine, 'x86');
  assert.equal(pe.is64, false);
  assert.equal(pe.subsystem, 'gui');
  assert.deepEqual(pe.imports, ['kernel32.dll', 'd3d9.dll', 'dsound.dll']);
});

test('lee imports y delay-imports de un PE de 64 bits', () => {
  const pe = parsePE(buildPE({ is64: true, imports: ['kernel32.dll'], delayImports: ['d3d11.dll'] }));
  assert.equal(pe.machine, 'x64');
  assert.deepEqual(pe.delayImports, ['d3d11.dll']);
});

test('marca las DLLs', () => {
  assert.equal(parsePE(buildPE({ dll: true, imports: ['a.dll'] })).isDll, true);
});

test('rechaza archivos que no son PE', () => {
  assert.throws(() => parsePE(Buffer.from('#!/bin/sh\necho hola\n'.padEnd(128))), PEError);
  const noSig = buildPE();
  noSig.write('XX', 0x40, 'latin1');
  assert.throws(() => parsePE(noSig), PEError);
});
