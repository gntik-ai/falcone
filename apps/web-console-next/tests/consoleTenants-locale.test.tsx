import { render } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { forbiddenTenantCopy, tenantLocaleValues } from './parity/pages/consoleTenants.locale'

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
})

test('tenant locale coverage includes inventory, wizard, toast and announcer portals without shared shell copy', () => {
  render(<>
    <section aria-label="Active context"><button>Select workspace</button></section>
    <div className="console-tenants"><h1>Inventario</h1><input aria-label="Nombre" placeholder="Nombre de la organización" /><img alt="Organización" /><button title="Reintentar">Reintentar</button></div>
    <div className="console-tenants-portal" role="dialog"><h2>Resumen</h2><span id="failure-label">No se pudo crear la organización</span><section aria-labelledby="failure-label">Reintentar</section></div>
    <div className="console-tenants-portal"><span role="status">Recurso creado correctamente</span><button aria-label="Cerrar">Cerrar</button></div>
    <div className="console-tenants-portal" aria-live="polite">Beta es ahora la organización activa</div>
  </>)
  const values = tenantLocaleValues()
  for (const text of ['Inventario', 'Nombre', 'Nombre de la organización', 'Organización', 'Reintentar', 'Resumen', 'No se pudo crear la organización', 'Recurso creado correctamente', 'Cerrar', 'Beta es ahora la organización activa']) expect(values).toContain(text)
  expect(values).not.toContain('Select workspace')
})

test('tenant locale rules reject untranslated page and portal copy, including accessible attributes', async () => {
  render(<>
    <div className="console-tenants"><input placeholder="Organization name" /></div>
    <div className="console-tenants-portal"><button aria-label="Select workspace">Loading…</button><h2>Summary</h2></div>
  </>)
  const forbidden = await forbiddenTenantCopy('es')
  const unexpected = tenantLocaleValues().filter((text) => forbidden.has(text))
  for (const text of ['Organization name', 'Select workspace', 'Loading…', 'Summary']) expect(unexpected).toContain(text)
  expect((await forbiddenTenantCopy('en')).has('Summary')).toBe(false)
})
