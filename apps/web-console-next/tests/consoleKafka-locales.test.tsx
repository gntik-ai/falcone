import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import i18n from '../src/i18n'
import '../src/pages/consoleKafka/copy'
import es from '../src/locales/es/pages.console-kafka-page.json'
import en from '../src/locales/en/pages.console-kafka-page.json'
const flatten = (value: object, prefix = ''): [string, string][] => Object.entries(value).flatMap(([key, item]) => typeof item === 'string' ? [[`${prefix}${key}`, item]] : flatten(item, `${prefix}${key}.`))
test('every Kafka catalog key exists in both languages and every literal translation reference resolves', () => {
  const spanish = new Map(flatten(es)), english = new Map(flatten(en)); expect([...spanish.keys()].sort()).toEqual([...english.keys()].sort())
  for (const [key, value] of spanish) { expect(value.trim(), key).not.toBe(''); expect(english.get(key)?.trim(), key).not.toBe('') }
  const sources = ['src/pages/consoleKafka.tsx', ...readdirSync('src/pages/consoleKafka').filter((name) => /\.tsx?$/.test(name)).map((name) => `src/pages/consoleKafka/${name}`)]
  for (const path of sources) for (const match of readFileSync(path, 'utf8').matchAll(/\bt\('([^']+)'/g)) { expect(spanish.has(match[1]), `${path}: ${match[1]}`).toBe(true) }
})
test.each(['es', 'en'])('ICU relative time, counts and dynamic section keys resolve in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const t = i18n.getFixedT(locale, 'pages.console-kafka-page')
  expect(t('minutesAgo', { count: 5 })).toBe(locale === 'es' ? 'hace 5 minutos' : '5 minutes ago')
  expect(t('eventCount', { visible: 5, total: 100 })).toBe(locale === 'es' ? '5 de 100 eventos' : '5 of 100 events')
  expect(t('keys', { count: 3 })).toBe(locale === 'es' ? '3 claves' : '3 keys')
  for (const key of ['tabs.detail', 'tabs.access', 'tabs.metadata', 'tabs.publish', 'tabs.stream', 'counts.active', 'counts.provisioning', 'counts.degraded']) expect(t(key)).not.toBe(key)
})
test('Kafka copy does not flag the existing bilingual Postgres Keys label as untranslated', () => {
  const postgres = ['es', 'en'].map((locale) => JSON.parse(readFileSync(`src/locales/${locale}/pages.console-postgres-page.json`, 'utf8')))
  expect(postgres[0].keys).toBe('Keys'); expect(postgres[1].keys).toBe('Keys')
  const spanish = new Map(flatten(es))
  const forbidden = flatten(en).filter(([key, value]) => value !== spanish.get(key) && !value.includes('{')).map(([, value]) => value)
  expect(forbidden).not.toContain(postgres[0].keys)
})
