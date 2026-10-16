'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Genera ejecutables PE mínimos (una sección .idata) para probar el parser y
// la detección sin necesitar binarios reales de juegos.
function buildPE({ is64 = false, dll = false, imports = [], delayImports = [], strings = [], subsystem = 2 } = {}) {
  const fileAlign = 0x200;
  const sectionRva = 0x1000;
  const optSize = is64 ? 240 : 224;

  const sec = Buffer.alloc(0x1000);
  const importDescSize = (imports.length + 1) * 20;
  const delayDescOffset = importDescSize;
  const delayDescSize = delayImports.length ? (delayImports.length + 1) * 32 : 0;
  let cursor = delayDescOffset + delayDescSize;
  const writeName = (name) => {
    const off = cursor;
    sec.write(`${name}\0`, off, 'latin1');
    cursor += name.length + 1;
    return off;
  };
  imports.forEach((name, i) => {
    const off = writeName(name);
    sec.writeUInt32LE(sectionRva + off, i * 20 + 12);
    sec.writeUInt32LE(sectionRva, i * 20 + 16);
  });
  delayImports.forEach((name, i) => {
    const off = writeName(name);
    const d = delayDescOffset + i * 32;
    sec.writeUInt32LE(1, d);
    sec.writeUInt32LE(sectionRva + off, d + 4);
  });
  for (const s of strings) writeName(s);
  const rawSize = Math.ceil(cursor / fileAlign) * fileAlign || fileAlign;

  const headers = Buffer.alloc(fileAlign);
  headers.write('MZ', 0, 'latin1');
  headers.writeUInt32LE(0x40, 0x3c);
  headers.write('PE\0\0', 0x40, 'latin1');
  const coff = 0x44;
  headers.writeUInt16LE(is64 ? 0x8664 : 0x14c, coff);
  headers.writeUInt16LE(1, coff + 2);
  headers.writeUInt16LE(optSize, coff + 16);
  headers.writeUInt16LE(0x0102 | (dll ? 0x2000 : 0), coff + 18);
  const opt = coff + 20;
  headers.writeUInt16LE(is64 ? 0x20b : 0x10b, opt);
  if (is64) headers.writeBigUInt64LE(0x140000000n, opt + 24);
  else headers.writeUInt32LE(0x400000, opt + 28);
  headers.writeUInt16LE(subsystem, opt + 68);
  const dd = opt + (is64 ? 112 : 96);
  headers.writeUInt32LE(16, dd - 4);
  if (imports.length) {
    headers.writeUInt32LE(sectionRva, dd + 8);
    headers.writeUInt32LE(importDescSize, dd + 12);
  }
  if (delayImports.length) {
    headers.writeUInt32LE(sectionRva + delayDescOffset, dd + 13 * 8);
    headers.writeUInt32LE(delayDescSize, dd + 13 * 8 + 4);
  }
  const st = opt + optSize;
  headers.write('.idata', st, 'latin1');
  headers.writeUInt32LE(rawSize, st + 8);
  headers.writeUInt32LE(sectionRva, st + 12);
  headers.writeUInt32LE(rawSize, st + 16);
  headers.writeUInt32LE(fileAlign, st + 20);

  return Buffer.concat([headers, sec.subarray(0, rawSize)]);
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-test-'));
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

module.exports = { buildPE, tmpDir, writeFile };
