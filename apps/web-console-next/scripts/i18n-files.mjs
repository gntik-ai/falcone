import { readdirSync, lstatSync } from 'node:fs';
import { resolve, extname } from 'node:path';

export function sourceFiles(inputs) {
  return inputs.flatMap((input) => {
    const path = resolve(input);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [];
    if (stat.isDirectory()) return sourceFiles(readdirSync(path).filter((name) => !['node_modules', 'dist'].includes(name)).map((name) => resolve(path, name)));
    return ['.tsx', '.jsx', '.ts', '.js', '.mjs'].includes(extname(path)) ? [path] : [];
  });
}
