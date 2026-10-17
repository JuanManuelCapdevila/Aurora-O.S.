#!/usr/bin/env node
// Genera los recursos de ES-DE de Aurora:
//   <dest>/themes/aurora-material/   tema (XML + íconos + fondo + fuentes Roboto)
//   <dest>/media/aurora/covers/      íconos de las herramientas ("apps")
//   <dest>/settings/icons/           glifos sueltos para aurora-settings
//   <dest>/es_settings.xml           configuración inicial de ES-DE
//
// Necesita rsvg-convert (librsvg) y la fuente Roboto instalada (fc-match).
// Uso: node theme/build.mjs <dest> [directorio-de-herramientas]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [dest, toolsDir = path.join(HERE, '..', 'rootfs/usr/share/aurora/tools')] = process.argv.slice(2);
if (!dest) {
  console.error('Uso: node theme/build.mjs <dest> [directorio-de-herramientas]');
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'icons.json'), 'utf8'));
const themeDir = path.join(dest, 'themes', 'aurora-material');
const coversDir = path.join(dest, 'media', 'aurora', 'covers');
const work = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'aurora-theme-'));

const escapeXml = (s) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Ícono estilo Material clásico: círculo de color con sombra, glifo blanco y
// la etiqueta debajo (ES-DE no muestra el nombre bajo las imágenes de la grilla).
function iconSvg({ label, color, glyph }) {
  const d = spec.glyphs[glyph];
  if (!d) throw new Error(`Glifo desconocido: ${glyph}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity="0.4"/>
    </filter>
  </defs>
  <circle cx="120" cy="96" r="76" fill="${color}" filter="url(#shadow)"/>
  <g transform="translate(78 54) scale(3.5)" fill="#ffffff"><path d="${d}"/></g>
  ${label ? `<text x="120" y="214" text-anchor="middle" font-family="Roboto" font-weight="500" font-size="27" fill="#ffffff" filter="url(#shadow)">${escapeXml(label)}</text>` : ''}
</svg>`;
}

// Fondo estilo Lollipop: capas de "papel" geométricas sobre gris azulado.
const WALLPAPER = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <filter id="paper" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="1280" height="720" fill="#263238"/>
  <polygon points="0,0 560,0 0,330" fill="#37474F" filter="url(#paper)"/>
  <polygon points="1280,0 1280,560 540,0" fill="#303F9F" filter="url(#paper)"/>
  <polygon points="1280,0 1280,300 900,0" fill="#3F51B5" filter="url(#paper)"/>
  <polygon points="0,720 0,400 700,720" fill="#00796B" filter="url(#paper)"/>
  <polygon points="1280,720 780,720 1280,440" fill="#00897B" filter="url(#paper)"/>
</svg>`;

function render(svg, out, width, height) {
  const svgFile = path.join(work, `${path.basename(out)}.svg`);
  fs.writeFileSync(svgFile, svg);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('rsvg-convert', ['-w', String(width), '-h', String(height), '-o', out, svgFile]);
}

function fontFile(pattern) {
  const file = execFileSync('fc-match', ['-f', '%{file}', pattern], { encoding: 'utf8' }).trim();
  if (!/roboto/i.test(path.basename(file))) throw new Error(`No se encontró la fuente ${pattern} (instalar ttf-roboto)`);
  return file;
}

fs.rmSync(themeDir, { recursive: true, force: true });
fs.cpSync(path.join(HERE, 'aurora-material'), themeDir, { recursive: true });

render(WALLPAPER, path.join(themeDir, 'assets', 'wallpaper.png'), 1280, 720);
for (const [name, icon] of Object.entries(spec.system)) {
  render(iconSvg(icon), path.join(themeDir, 'icons', 'system', `${name}.png`), 240, 240);
}

fs.mkdirSync(path.join(themeDir, 'fonts'), { recursive: true });
fs.copyFileSync(fontFile('Roboto:style=Regular'), path.join(themeDir, 'fonts', 'Roboto-Regular.ttf'));
fs.copyFileSync(fontFile('Roboto:style=Medium'), path.join(themeDir, 'fonts', 'Roboto-Medium.ttf'));

// Cada herramienta tiene que tener su ícono: si se agrega un script nuevo sin
// entrada en icons.json, la construcción falla en lugar de mostrar un hueco.
const tools = fs.readdirSync(toolsDir).filter((f) => f.endsWith('.sh')).map((f) => f.slice(0, -3));
const missing = tools.filter((t) => !spec.tools[t]);
if (missing.length) throw new Error(`Herramientas sin ícono en theme/icons.json: ${missing.join(', ')}`);
fs.rmSync(coversDir, { recursive: true, force: true });
for (const tool of tools) {
  render(iconSvg(spec.tools[tool]), path.join(coversDir, `${tool}.png`), 240, 240);
}

// Glifos sueltos (blancos, fondo transparente) para las vistas de aurora-settings.
const glyphDir = path.join(dest, 'settings', 'icons');
fs.rmSync(glyphDir, { recursive: true, force: true });
for (const [name, d] of Object.entries(spec.glyphs)) {
  render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#ffffff" d="${d}"/></svg>`,
    path.join(glyphDir, `${name}.png`),
    96,
    96,
  );
}

fs.copyFileSync(path.join(HERE, 'es_settings.xml'), path.join(dest, 'es_settings.xml'));
fs.rmSync(work, { recursive: true, force: true });
console.log(`Tema y ${tools.length} íconos de herramientas generados en ${dest}`);
