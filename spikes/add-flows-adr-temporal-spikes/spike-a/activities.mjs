// EPHEMERAL SPIKE — not production code.
// Activities for Spike A. Activities run OUTSIDE the deterministic workflow sandbox, so they
// may touch the filesystem. `flakyCharge` fails its first two attempts using a per-run counter
// file, proving Temporal's retry policy (and that the retry count survives a worker restart).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(HERE, '.run-state');

function counterFile(key) {
  return join(STATE_DIR, `attempts-${key}.json`);
}

export async function flakyCharge(input) {
  const key = input?.runKey ?? 'default';
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  const file = counterFile(key);
  let n = 0;
  if (existsSync(file)) n = JSON.parse(readFileSync(file, 'utf8')).attempts ?? 0;
  n += 1;
  writeFileSync(file, JSON.stringify({ attempts: n }));
  // Fail the first two attempts so Temporal must retry (maximumAttempts: 3 -> succeed on #3).
  if (n < 3) {
    throw new Error(`flakyCharge transient failure (attempt ${n})`);
  }
  return { charged: true, attempts: n };
}

// Slows the run enough that a SIGKILL during execution lands mid-activity, forcing a
// history replay on restart.
export async function slowStep(input) {
  const ms = input?.ms ?? 8000;
  await new Promise((r) => setTimeout(r, ms));
  return { sleptMs: ms };
}

export function readAttempts(key) {
  const file = counterFile(key);
  if (!existsSync(file)) return 0;
  return JSON.parse(readFileSync(file, 'utf8')).attempts ?? 0;
}
