import { readdir, readFile } from 'node:fs/promises'
import { URL as NodeURL } from 'node:url'

const catalogRoot = new NodeURL('../../../src/locales/', import.meta.url)
const flatten = (object: Record<string, unknown>, prefix = ''): [string, string][] => Object.entries(object).flatMap(([key, value]) =>
  typeof value === 'string' ? [[prefix + key, value]] : flatten(value as Record<string, unknown>, `${prefix}${key}.`))

// Same untranslated-copy rules as the shared harness, applied to this page's surfaces.
export async function forbiddenMcpCopy(locale: string) {
  const forbidden = new Set(['Search...', 'Search…', 'No results found.', 'No results found', 'Loading...', 'Loading…', 'Toggle sidebar', 'Open menu', 'Close menu', 'Select an option', 'Select workspace', 'Previous page', 'Next page'])
  if (locale === 'es') for (const file of await readdir(new NodeURL('en/', catalogRoot))) {
    if (!file.endsWith('.json')) continue
    const english = flatten(JSON.parse(await readFile(new NodeURL(`en/${file}`, catalogRoot), 'utf8')))
    const spanish = new Map(flatten(JSON.parse(await readFile(new NodeURL(`es/${file}`, catalogRoot), 'utf8'))))
    for (const [key, value] of english) if (value !== spanish.get(key) && !value.includes('{')) forbidden.add(value)
  }
  return forbidden
}

// Self-contained so Playwright can evaluate it in the browser, including page-owned portals.
export function mcpLocaleValues() {
  const elements = new Set<Element>()
  for (const root of document.querySelectorAll('.console-mcp-server-detail, .console-mcp-server-detail-announcements')) {
    elements.add(root)
    for (const element of root.querySelectorAll('*')) elements.add(element)
  }
  // Select popups escape the page container; include surfaces owned by its controls.
  for (const element of [...elements]) for (const attribute of ['aria-controls', 'aria-owns']) {
    for (const id of (element.getAttribute(attribute) ?? '').split(/\s+/)) {
      const popup = id ? document.getElementById(id) : null
      if (!popup) continue
      elements.add(popup)
      for (const child of popup.querySelectorAll('*')) elements.add(child)
    }
  }
  const values: string[] = []
  for (const element of elements) {
    const style = getComputedStyle(element)
    if (['SCRIPT', 'STYLE'].includes(element.tagName) || style.display === 'none' || style.visibility === 'hidden' || !element.getClientRects().length) continue
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
      if (element.hasAttribute(attribute)) values.push(element.getAttribute(attribute)!)
    }
    for (const id of (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)) if (id) values.push(document.getElementById(id)?.textContent ?? '')
    for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) values.push(child.textContent ?? '')
    if (element instanceof HTMLElement) values.push(element.innerText)
    if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type)) values.push(element.value)
  }
  return values.filter(Boolean).map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean)
}
