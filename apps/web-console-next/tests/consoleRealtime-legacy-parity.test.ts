import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, test } from 'vitest'
import es from '../src/locales/es/pages.console-realtime-page.json'
import en from '../src/locales/en/pages.console-realtime-page.json'

test('all nine snippet templates, labels and secret notes preserve the current legacy catalog', () => {
  const source = readFileSync('../web-console/src/lib/snippets/snippet-catalog.ts', 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const output: { SNIPPET_CATALOG?: Record<string, Array<{ id: keyof typeof es.entries; codeTemplate: string; label: string; secretPlaceholderRef: string; fallbackNotes?: string[] }>> } = {}
  new Function('exports', compiled)(output)
  const entries = output.SNIPPET_CATALOG!['realtime-subscription']
  expect(entries).toHaveLength(9)
  expect(Object.keys(es.entries)).toEqual(entries.map((entry) => entry.id))
  for (const entry of entries) {
    expect(es.entries[entry.id]).toEqual({ code: entry.codeTemplate, label: entry.label, secret: entry.secretPlaceholderRef })
    expect(entry.fallbackNotes ?? []).toEqual([])
    // English translates the two existing Spanish comment lines; executable snippet text is identical.
    expect(en.entries[entry.id].code).toBe(entry.codeTemplate
      .replace('// Requiere un token de acceso Keycloak válido para esta área de trabajo', '// Requires: a valid Keycloak access token for this workspace'))
  }
})
