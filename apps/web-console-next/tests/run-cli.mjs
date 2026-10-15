import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Match the existing dist-validator harness: file-backed output also works in
// environments that restrict synchronous child-process pipes.
export async function runCli(args) {
  const output = mkdtempSync(join(tmpdir(), 'next-i18n-cli-'));
  const stdout = join(output, 'stdout'), stderr = join(output, 'stderr');
  const out = openSync(stdout, 'w'), err = openSync(stderr, 'w');
  try {
    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: new URL('..', import.meta.url), stdio: ['ignore', out, err] });
      child.on('error', reject);
      child.on('close', resolve);
    });
    return { status, stdout: readFileSync(stdout, 'utf8'), stderr: readFileSync(stderr, 'utf8') };
  } finally {
    closeSync(out); closeSync(err);
    rmSync(output, { recursive: true, force: true });
  }
}
