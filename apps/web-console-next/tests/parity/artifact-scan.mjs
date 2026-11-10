import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

// Needles for one secret value in the encodings a report writer can produce. Names are public, values never are.
export function needles(value) {
  const bytes = Buffer.from(value, 'utf8');
  const base64 = [0, 1, 2].map((shift) => {
    const encoded = Buffer.concat([Buffer.alloc(shift), bytes]).toString('base64');
    // Drop the characters that depend on the neighbouring bytes, keep the stable middle.
    return encoded.slice(Math.ceil((shift * 4) / 3) + 1, encoded.length - 3);
  }).filter((part) => part.length >= 8);
  return [
    ['plain', bytes], ['url', Buffer.from(encodeURIComponent(value))], ['utf16', Buffer.from(value, 'utf16le')],
    ['hex', Buffer.from(bytes.toString('hex'))], ...base64.map((part, index) => [`base64-${index}`, Buffer.from(part)]),
  ];
}

// Minimal zip reader (central directory, stored and deflated entries); Playwright traces and the HTML report are zips.
export function zipEntries(buffer) {
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index--) if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  if (end < 0) return [];
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let entry = 0; entry < count && buffer.readUInt32LE(cursor) === 0x02014b50; entry++) {
    const method = buffer.readUInt16LE(cursor + 10), size = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    try { entries.push({ name, data: method === 8 ? inflateRawSync(buffer.subarray(start, start + size)) : buffer.subarray(start, start + size) }); } catch { /* A corrupt entry cannot hide a value from the plain scan of the archive. */ }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function inspect(label, buffer, list, hits, depth = 0) {
  for (const [kind, needle] of list) if (buffer.includes(needle)) hits.push(`${label} [${kind}]`);
  if (depth > 2) return;
  if (buffer.length > 22 && buffer.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))) for (const entry of zipEntries(buffer)) inspect(`${label}!${entry.name}`, entry.data, list, hits, depth + 1);
  // The HTML report embeds its data as a base64 zip.
  const text = buffer.length < 200_000_000 && /\.html?$/.test(label) ? buffer.toString('latin1') : '';
  for (const match of text.matchAll(/data:application\/zip;base64,([A-Za-z0-9+/=]+)/g)) inspect(`${label}#report`, Buffer.from(match[1], 'base64'), list, hits, depth + 1);
}

// Scans every file below `directory`. Returns file labels and encoding names only, never the matching text.
export function scanTree(directory, secrets) {
  const list = secrets.flatMap(needles);
  const hits = [];
  let files = 0;
  const visit = (path) => {
    const stat = statSync(path);
    if (stat.isDirectory()) { for (const entry of readdirSync(path)) visit(join(path, entry)); return; }
    files += 1;
    inspect(path, readFileSync(path), list, hits);
  };
  visit(directory);
  return { files, hits };
}

// A one-entry deflated zip, as written by the Playwright trace and report writers.
export function zipOf(name, data) {
  const raw = deflateRawSync(Buffer.from(data));
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(8, 8); header.writeUInt32LE(raw.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(raw.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const body = Buffer.concat([header, Buffer.from(name), raw]);
  const directory = Buffer.concat([central, Buffer.from(name)]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, end]);
}

// Seeded canary: plants the value in every shape a report can hold it and asserts the scanner finds each one,
// reports only file labels, and scans a redacted tree clean.
export function seededCheck(canary) {
  const planted = mkdtempSync(join(tmpdir(), 'artifact-scan-'));
  const clean = mkdtempSync(join(tmpdir(), 'artifact-clean-'));
  try {
    writeFileSync(join(planted, 'plain.txt'), `request body {"secretValue":"${canary}"}`);
    writeFileSync(join(planted, 'encoded.json'), JSON.stringify({ blob: Buffer.from(`prefix:${canary}`).toString('base64') }));
    writeFileSync(join(planted, 'trace.zip'), zipOf('0-trace.trace', `{"fill":"${canary}"}`));
    writeFileSync(join(planted, 'index.html'), `<script>window.report="data:application/zip;base64,${zipOf('report.json', canary).toString('base64')}"</script>`);
    mkdirSync(join(planted, 'nested')); writeFileSync(join(planted, 'nested', 'error-context.md'), `- textbox [value=${encodeURIComponent(canary)}]`);
    writeFileSync(join(clean, 'report.json'), JSON.stringify({ secretValue: '[redacted-secret-value]' }));
    const found = scanTree(planted, [canary]);
    for (const label of ['plain.txt', 'encoded.json', 'trace.zip', 'index.html', 'error-context.md']) assert.ok(found.hits.some((hit) => hit.includes(label)), `Missing seeded detection: ${label}`);
    assert.ok(found.hits.every((hit) => !hit.includes(canary)), 'The scanner output must never contain the value');
    assert.equal(scanTree(clean, [canary]).hits.length, 0, 'A redacted tree must scan clean');
    return found;
  } finally { rmSync(planted, { recursive: true, force: true }); rmSync(clean, { recursive: true, force: true }); }
}
