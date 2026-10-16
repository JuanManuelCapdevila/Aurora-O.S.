'use strict';

// Parser mínimo de ejecutables PE (Windows .exe/.dll).
// Solo lee lo que necesita el motor: arquitectura, subsistema y DLLs importadas
// (tabla de imports normal + delay-load).

const MACHINES = {
  0x014c: 'x86',
  0x8664: 'x64',
};

const IMAGE_DIRECTORY_ENTRY_IMPORT = 1;
const IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT = 13;

class PEError extends Error {}

function readCString(buf, offset, max = 256) {
  if (offset < 0 || offset >= buf.length) return null;
  const end = buf.indexOf(0, offset);
  const stop = end === -1 ? Math.min(buf.length, offset + max) : Math.min(end, offset + max);
  return buf.toString('latin1', offset, stop);
}

function parsePE(buf) {
  if (buf.length < 0x40 || buf.toString('latin1', 0, 2) !== 'MZ') {
    throw new PEError('No es un ejecutable MZ/PE');
  }
  const peOffset = buf.readUInt32LE(0x3c);
  if (peOffset + 24 > buf.length || buf.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new PEError('Firma PE no encontrada');
  }

  const coff = peOffset + 4;
  const machineCode = buf.readUInt16LE(coff);
  const numberOfSections = buf.readUInt16LE(coff + 2);
  const sizeOfOptionalHeader = buf.readUInt16LE(coff + 16);
  const characteristics = buf.readUInt16LE(coff + 18);

  const opt = coff + 20;
  const magic = buf.readUInt16LE(opt);
  const is64 = magic === 0x20b;
  if (magic !== 0x10b && magic !== 0x20b) throw new PEError('Optional header desconocido');

  const imageBase = is64 ? Number(buf.readBigUInt64LE(opt + 24)) : buf.readUInt32LE(opt + 28);
  const subsystem = buf.readUInt16LE(opt + 68);
  const dataDirOffset = opt + (is64 ? 112 : 96);
  const numberOfRvaAndSizes = buf.readUInt32LE(dataDirOffset - 4);

  const sections = [];
  const sectionTable = opt + sizeOfOptionalHeader;
  for (let i = 0; i < numberOfSections; i++) {
    const s = sectionTable + i * 40;
    if (s + 40 > buf.length) break;
    sections.push({
      name: buf.toString('latin1', s, s + 8).replace(/\0+$/, ''),
      virtualSize: buf.readUInt32LE(s + 8),
      virtualAddress: buf.readUInt32LE(s + 12),
      sizeOfRawData: buf.readUInt32LE(s + 16),
      pointerToRawData: buf.readUInt32LE(s + 20),
    });
  }

  const rvaToOffset = (rva) => {
    for (const s of sections) {
      const size = Math.max(s.virtualSize, s.sizeOfRawData);
      if (rva >= s.virtualAddress && rva < s.virtualAddress + size) {
        return rva - s.virtualAddress + s.pointerToRawData;
      }
    }
    return -1;
  };

  const dataDir = (index) => {
    if (index >= numberOfRvaAndSizes) return null;
    const o = dataDirOffset + index * 8;
    const rva = buf.readUInt32LE(o);
    const size = buf.readUInt32LE(o + 4);
    return rva ? { rva, size } : null;
  };

  const imports = [];
  const imp = dataDir(IMAGE_DIRECTORY_ENTRY_IMPORT);
  if (imp) {
    let d = rvaToOffset(imp.rva);
    // Descriptor de 20 bytes; Name RVA en +12. Termina con un descriptor nulo.
    while (d >= 0 && d + 20 <= buf.length) {
      const nameRva = buf.readUInt32LE(d + 12);
      const firstThunk = buf.readUInt32LE(d + 16);
      if (!nameRva && !firstThunk) break;
      const name = readCString(buf, rvaToOffset(nameRva));
      if (name) imports.push(name.toLowerCase());
      d += 20;
    }
  }

  const delayImports = [];
  const dly = dataDir(IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT);
  if (dly) {
    let d = rvaToOffset(dly.rva);
    // Descriptor de 32 bytes; DllNameRVA en +4. Si Attributes == 0 (formato
    // viejo de VC6) los campos son VAs y hay que restar ImageBase.
    while (d >= 0 && d + 32 <= buf.length) {
      const attributes = buf.readUInt32LE(d);
      let nameRef = buf.readUInt32LE(d + 4);
      if (!nameRef) break;
      if ((attributes & 1) === 0) nameRef -= imageBase;
      const name = readCString(buf, rvaToOffset(nameRef));
      if (name) delayImports.push(name.toLowerCase());
      d += 32;
    }
  }

  return {
    machine: MACHINES[machineCode] || `unknown(0x${machineCode.toString(16)})`,
    is64,
    isDll: (characteristics & 0x2000) !== 0,
    subsystem: subsystem === 2 ? 'gui' : subsystem === 3 ? 'console' : `other(${subsystem})`,
    imports: [...new Set(imports)],
    delayImports: [...new Set(delayImports)],
  };
}

module.exports = { parsePE, PEError };
