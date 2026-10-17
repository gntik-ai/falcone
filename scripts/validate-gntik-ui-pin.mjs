import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const pins = {
  '@gntik-ai/ui': '0.7.0',
  '@gntik-ai/blocks': '0.7.0',
  '@gntik-ai/templates': '0.7.0',
  '@gntik-ai/tokens': '0.2.1',
};

try {
  const manifest = JSON.parse(readFileSync(resolve(root, 'apps/web-console-next/package.json'), 'utf8'));
  const lock = YAML.parse(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'));
  const dependencies = lock.importers?.['apps/web-console-next']?.dependencies;
  const errors = [];
  for (const [name, pin] of Object.entries(pins)) {
    const entry = dependencies?.[name];
    if (manifest.dependencies?.[name] !== pin) errors.push(`${name}: manifest must pin exactly ${pin}`);
    if (entry?.specifier !== pin) errors.push(`${name}: lockfile specifier must be exactly ${pin}`);
    if (typeof entry?.version !== 'string' || entry.version.split('(')[0] !== pin) {
      errors.push(`${name}: lockfile base version must be exactly ${pin}`);
    }
  }
  // Integrity-only registry entries use pnpm's default public npm registry.
  // Reject an explicit tarball redirect for any kit package, including transitives.
  for (const [name, entry] of Object.entries(lock.packages ?? {})) {
    if (!name.startsWith('@gntik-ai/') || !entry.resolution?.tarball) continue;
    const url = new URL(entry.resolution.tarball);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') {
      errors.push(`${name}: tarball must resolve from registry.npmjs.org`);
    }
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('gntik-ui manifest and lockfile pins are exact.');
  }
} catch {
  console.error('Unable to read the web-console-next manifest or pnpm lockfile.');
  process.exitCode = 1;
}
