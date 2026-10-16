'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parsePE, PEError } = require('./pe');

// Orden de prioridad: si un juego trae varios renderers (ej. motores Unreal con
// D3DDrv + OpenGLDrv) se elige el más moderno de Direct3D, que es el que mejor
// rinde vía DXVK.
const API_PRIORITY = ['d3d11', 'd3d10', 'd3d9', 'd3d8', 'opengl', 'ddraw'];

const API_BY_DLL = {
  'd3d11.dll': 'd3d11',
  'dxgi.dll': 'd3d11',
  'd3d10.dll': 'd3d10',
  'd3d10_1.dll': 'd3d10',
  'd3d9.dll': 'd3d9',
  'd3d8.dll': 'd3d8',
  'opengl32.dll': 'opengl',
  'ddraw.dll': 'ddraw',
};

const GRAPHICS_DLL_RE = /(d3d11|dxgi|d3d10(?:_1)?|d3d9|d3d8|opengl32|ddraw)\.dll/gi;

// Ejecutables que casi nunca son el juego en sí.
const NOT_GAME_RE =
  /^(unins|setup|install|vcredist|vc_redist|dxsetup|dxwebsetup|directx|dotnet|crash|bugreport|report|update|patch|register|autorun|easyanticheat|redist|physx|config(?!.*game))/i;

const MAX_SCAN_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 400;

function readPE(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) return null;
    const buf = fs.readFileSync(file);
    return { buf, pe: parsePE(buf) };
  } catch (err) {
    if (err instanceof PEError || err.code === 'EACCES') return null;
    throw err;
  }
}

// Busca nombres de DLLs gráficas cargadas dinámicamente (LoadLibrary), que no
// aparecen en la tabla de imports. Revisa ASCII y UTF-16LE.
function scanStrings(buf) {
  const found = new Set();
  for (const text of [buf.toString('latin1'), buf.toString('utf16le'), buf.subarray(1).toString('utf16le')]) {
    for (const m of text.matchAll(GRAPHICS_DLL_RE)) found.add(m[0].toLowerCase());
  }
  return [...found];
}

function listFiles(dir, depth, exts, out = []) {
  if (depth < 0 || out.length >= MAX_FILES) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(full, depth - 1, exts, out);
    else if (exts.includes(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

function pickApi(apis) {
  return API_PRIORITY.find((a) => apis.has(a)) || 'unknown';
}

// Analiza el ejecutable de un juego y las DLLs que lo acompañan.
function detectGame(exePath) {
  const main = readPE(exePath);
  if (!main) throw new Error(`No se pudo leer como ejecutable PE: ${exePath}`);

  const evidence = {};
  const apis = new Set();
  const addEvidence = (dll, source) => {
    const api = API_BY_DLL[dll];
    if (!api) return;
    apis.add(api);
    (evidence[api] ||= new Set()).add(source);
  };

  const allImports = new Set([...main.pe.imports, ...main.pe.delayImports]);
  for (const dll of allImports) addEvidence(dll, 'import');
  for (const dll of scanStrings(main.buf)) addEvidence(dll, 'string');

  // Muchos motores ponen el renderer en una DLL aparte (ej. Source, Unreal).
  const exeDir = path.dirname(exePath);
  for (const dllPath of listFiles(exeDir, 2, ['.dll'])) {
    const name = path.basename(dllPath).toLowerCase();
    // Las DLLs que se llaman igual que una del sistema (ej. un ddraw.dll de
    // un wrapper ya copiado) no dicen nada sobre el juego.
    if (API_BY_DLL[name]) continue;
    const lib = readPE(dllPath);
    if (!lib) continue;
    for (const dll of [...lib.pe.imports, ...lib.pe.delayImports]) {
      addEvidence(dll, `dll:${path.relative(exeDir, dllPath)}`);
      allImports.add(dll);
    }
  }

  const has = (re) => [...allImports].some((d) => re.test(d));

  return {
    exe: exePath,
    arch: main.pe.machine,
    api: pickApi(apis),
    apis: API_PRIORITY.filter((a) => apis.has(a)),
    input: {
      xinput: has(/^xinput1_\d\.dll$|^xinput9_1_0\.dll$/),
      dinput: has(/^dinput8?\.dll$/),
    },
    audio: {
      dsound: has(/^dsound\.dll$/),
      openal: has(/^openal32\.dll$/),
    },
    evidence: Object.fromEntries(Object.entries(evidence).map(([k, v]) => [k, [...v]])),
  };
}

// Dada la carpeta de un juego instalado, ordena los .exe por probabilidad de ser
// el ejecutable principal.
function findCandidates(dir) {
  const exes = listFiles(dir, 3, ['.exe']);
  const scored = [];
  for (const exe of exes) {
    const lib = readPE(exe);
    if (!lib || lib.pe.isDll) continue;
    const name = path.basename(exe);
    let score = Math.log2(lib.buf.length + 1);
    const imports = [...lib.pe.imports, ...lib.pe.delayImports];
    if (imports.some((d) => API_BY_DLL[d]) || scanStrings(lib.buf).length) score += 20;
    if (lib.pe.subsystem !== 'gui') score -= 15;
    if (NOT_GAME_RE.test(name)) score -= 40;
    // Los ejecutables en la raíz del juego suelen ser los principales.
    score -= path.relative(dir, exe).split(path.sep).length - 1;
    scored.push({ exe, score: Math.round(score * 10) / 10 });
  }
  return scored.sort((a, b) => b.score - a.score);
}

module.exports = { detectGame, findCandidates, API_PRIORITY };
