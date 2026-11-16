import { readFileSync, readdirSync } from 'node:fs'
import { render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { collectKafkaLocaleValues } from './parity/pages/console-kafka-page.locale.mjs'
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
test('Kafka copy does not flag existing bilingual Postgres labels as untranslated', () => {
  const postgres = ['es', 'en'].map((locale) => JSON.parse(readFileSync(`src/locales/${locale}/pages.console-postgres-page.json`, 'utf8')))
  expect(postgres[0].keys).toBe('Keys'); expect(postgres[1].keys).toBe('Keys')
  expect(postgres[0].policyName).toBe('Policy'); expect(postgres[1].policyName).toBe('Policy')
  const spanish = new Map(flatten(es))
  const forbidden = flatten(en).filter(([key, value]) => value !== spanish.get(key) && !value.includes('{')).map(([, value]) => value)
  expect(forbidden).not.toContain(postgres[0].keys)
  expect(forbidden).not.toContain(postgres[0].policyName)
  // Postgres preserves these legacy risk labels in both languages. Kafka's
  // translated lag labels must not add them to the whole-app English denylist.
  for (const level of ['low', 'medium', 'high']) {
    expect(postgres[0].enums[level]).toBe(postgres[1].enums[level])
    expect(forbidden, `Postgres risk level: ${level}`).not.toContain(postgres[0].enums[level])
  }
})
test('only the existing shell empty workspace trigger text is exempt from the Kafka scan', () => {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  const labels = { contextLabel: 'Contexto activo', workspaceLabel: 'Área de trabajo activa' }
  const view = render(<section aria-label={labels.contextLabel}><button aria-label={labels.workspaceLabel}><span><span>Select workspace</span></span></button></section>)
  // Chromium reports innerText for both the trigger and its nested spans.
  for (const element of document.querySelectorAll('button, button span')) Object.defineProperty(element, 'innerText', { value: element.textContent })
  const before = document.body.innerHTML
  expect(collectKafkaLocaleValues(labels)).not.toContain('Select workspace')
  expect(collectKafkaLocaleValues(labels)).toContain(labels.workspaceLabel)
  expect(document.body.innerHTML).toBe(before)
  view.unmount()
})
test('Kafka, portal, attribute and other shell copy are still checked without exemptions', () => {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  const labels = { contextLabel: 'Contexto activo', workspaceLabel: 'Área de trabajo activa' }
  render(<>
    <section aria-label={labels.contextLabel}><button aria-label={labels.workspaceLabel} title="Select workspace"><span>Select workspace</span><span>Search...</span></button><button>Select workspace</button></section>
    <section data-testid="console-kafka-page" aria-label={labels.contextLabel}><button aria-label={labels.workspaceLabel}>Select workspace</button><input placeholder="Select workspace" /><span aria-labelledby="missing-key" /></section>
    <div role="dialog"><span>Select workspace</span><span id="missing-key">pages.untranslated</span></div>
  </>)
  const values = collectKafkaLocaleValues(labels)
  // Tooltip, unrelated shell button, Kafka text, placeholder and portal text.
  expect(values.filter((value: string) => value === 'Select workspace')).toHaveLength(5)
  expect(values).toContain('Search...')
  expect(values).toContain('pages.untranslated')
})
