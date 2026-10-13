import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = process.argv.slice(2);
const inputs = paths.length ? paths : [resolve(root, 'src'), resolve(root, 'index.html')];
const hex = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b/i;
const palette = /\b(?:bg|text|border|divide|ring|outline|shadow|accent|caret|fill|stroke|from|via|to)-(?:white\b|black\b|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b)/;
let failed = false;

function inspect(path) {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.isSymbolicLink()) continue;
      inspect(resolve(path, entry.name));
    }
    return;
  }
  if (!['.ts', '.tsx', '.js', '.jsx', '.css', '.html'].includes(extname(path))) return;
  readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
    if (hex.test(line) || palette.test(line)) {
      console.error(`${path}:${index + 1}: use semantic colour tokens instead of literal colours`);
      failed = true;
    }
  });
}

try {
  inputs.forEach((path) => inspect(resolve(path)));
  if (failed) process.exitCode = 1;
  else console.log('Colour lint passed.');
} catch {
  console.error('Unable to read a colour-lint input.');
  process.exitCode = 1;
}
