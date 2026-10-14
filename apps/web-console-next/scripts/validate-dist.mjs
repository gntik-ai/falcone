// Public CLI: node scripts/validate-dist.mjs [dist-directory]. No dependencies.
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'dist');
const errors = [];
const fail = (file, reason, value) => errors.push(`${file}: ${reason}: ${JSON.stringify(value)}`);

const remote = (value) => /^(?:https?:|\/\/)/i.test(value.trim());
function attributes(source) {
  const values = new Map();
  for (const attr of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const name = attr[1].toLowerCase();
    // Browsers keep the first value of duplicate attributes.
    if (!values.has(name)) values.set(name, (attr[2] ?? attr[3] ?? attr[4] ?? '').replace(
      /&(?:#(x[0-9a-f]+|[0-9]+)|colon|sol|Tab|NewLine|amp);/gi,
      (entity, code) => code ? String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code))
        : ({ '&colon;': ':', '&sol;': '/', '&tab;': '\t', '&newline;': '\n', '&amp;': '&' }[entity.toLowerCase()])
    ));
  }
  return values;
}

try {
  const file = join(root, 'index.html');
  const html = await readFile(file, 'utf8');
  const tags = /<!--[\s\S]*?-->|<(script|link)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  for (let tag; (tag = tags.exec(html));) {
    if (!tag[1]) continue;
    const attrs = attributes(tag[2]);
    const isScript = tag[1].toLowerCase() === 'script';
    const value = attrs.get(isScript ? 'src' : 'href');
    if (isScript && !value?.trim()) fail(file, 'script has no src', '<script>');
    if (value && remote(value)) fail(file, 'remote asset URL', value);
    if (isScript) {
      const close = /<\/script\s*>/gi;
      close.lastIndex = tags.lastIndex;
      const end = close.exec(html);
      const body = html.slice(tags.lastIndex, end?.index ?? html.length);
      if (body.length) fail(file, 'inline script body', body);
      tags.lastIndex = end ? close.lastIndex : html.length;
    }
  }
} catch (error) {
  fail(join(root, 'index.html'), 'cannot read required build entry', error.message);
}
async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}
let files = [];
try {
  files = await filesIn(root);
  for (const file of files) {
    if (!file.endsWith('.css')) continue;
    const css = (await readFile(file, 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi, (_, hex, char) => hex ? String.fromCodePoint(parseInt(hex, 16) || 0xfffd) : char);
    for (const target of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|@import\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const value = target.slice(1).find((value) => value !== undefined);
      if (remote(value)) fail(file, 'remote CSS URL', value);
    }
  }
} catch (error) {
  fail(root, 'cannot scan build assets', error.message);
}
for (const [family, prefix] of [['Geist Sans', 'geist-sans'], ['Geist Mono', 'geist-mono']]) {
  const count = files.filter((file) => file.startsWith(join(root, 'assets') + '/') && file.split('/').at(-1).startsWith(prefix) && file.endsWith('.woff2')).length;
  if (!count) fail(join(root, 'assets'), 'missing self-hosted font', family);
  else console.log(`${family} woff2: ${count}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
