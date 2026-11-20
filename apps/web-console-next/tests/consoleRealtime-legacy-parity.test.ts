import entries from './frozen-legacy/realtime-snippets.json'
import { expect, test } from 'vitest'
import es from '../src/locales/es/pages.console-realtime-page.json'
import en from '../src/locales/en/pages.console-realtime-page.json'

test('all nine snippet templates, labels and secret notes preserve the current legacy catalog', () => {
  expect(entries).toHaveLength(9)
  expect(Object.keys(es.entries)).toEqual(entries.map((entry) => entry.id))
  for (const entry of entries) {
    expect(es.entries[entry.id as keyof typeof es.entries]).toEqual({ code: entry.codeTemplate, label: entry.label, secret: entry.secretPlaceholderRef })
    expect(('fallbackNotes' in entry ? entry.fallbackNotes : undefined) ?? []).toEqual([])
    // English translates the two existing Spanish comment lines; executable snippet text is identical.
    expect(en.entries[entry.id as keyof typeof en.entries].code).toBe(entry.codeTemplate
      .replace('// Requiere un token de acceso Keycloak válido para esta área de trabajo', '// Requires: a valid Keycloak access token for this workspace'))
  }
})
