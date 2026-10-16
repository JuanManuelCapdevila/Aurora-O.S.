#!/usr/bin/env node
// Valida theme.xml contra las propiedades que acepta ES-DE (esde-properties.json).
// ES-DE descarta el tema completo ante una sola propiedad desconocida, así que
// conviene detectarlo antes de construir la imagen.
//
// Uso: node theme/validate.mjs [theme.xml]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || path.join(HERE, 'aurora-material', 'theme.xml');
const { elements } = JSON.parse(fs.readFileSync(path.join(HERE, 'esde-properties.json'), 'utf8'));

// Sin dependencias: alcanza con un recorrido simple de etiquetas, sin
// comentarios. Se sigue la pila para saber de qué elemento es cada propiedad.
const xml = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const STRUCTURE = new Set(['theme', 'variables', 'variant', 'view', 'aspectRatio', 'colorScheme', 'fontSize', 'language', 'include']);
const stack = [];
const errors = [];
let inVariables = false;

for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w-]*)([^>]*?)(\/?)>/g)) {
  const [, closing, tag, attrs, selfClosing] = m;
  if (closing) {
    stack.pop();
    if (tag === 'variables') inVariables = false;
    continue;
  }
  const parent = stack[stack.length - 1];
  if (tag === 'variables') inVariables = true;
  if (!inVariables && !STRUCTURE.has(tag)) {
    const named = /\bname="/.test(attrs);
    if (named && !elements[tag]) errors.push(`elemento desconocido <${tag}>`);
    if (!named && parent && elements[parent.tag] && !elements[parent.tag].includes(tag)) {
      errors.push(`<${parent.tag} name="${parent.name}">: propiedad desconocida <${tag}>`);
    }
  }
  if (!selfClosing) stack.push({ tag, name: (attrs.match(/\bname="([^"]*)"/) || [])[1] });
}

if (errors.length) {
  for (const e of errors) console.error(`Error: ${e}`);
  process.exit(1);
}
console.log(`${path.basename(file)}: sin propiedades desconocidas`);
