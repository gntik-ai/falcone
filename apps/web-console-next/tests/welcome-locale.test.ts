import { beforeEach, expect, test, vi } from 'vitest'
// @ts-expect-error The browser harness intentionally uses native JavaScript modules.
import { unexpectedWelcomeCopy } from './parity/pages/welcome-locale.mjs'
import es from '../src/locales/es/pages.welcome-page.json'
import en from '../src/locales/en/pages.welcome-page.json'

beforeEach(() => {
  // jsdom has no layout; expose the fixture nodes to the browser collector.
  const rect = new DOMRect()
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue(Object.assign([rect], { item: (index: number) => index === 0 ? rect : null }))
  document.body.innerHTML = ''
})

for (const locale of ['es', 'en'] as const) {
  const copy = locale === 'es' ? es : en
  const other = locale === 'es' ? en : es
  const allowed = Object.values(copy)

  test(`${locale} accepts the required product title as text and an accessible name`, () => {
    document.body.innerHTML = `<section aria-labelledby="welcome-title"><h1 id="welcome-title">${copy.title}</h1><p>${copy.intro}</p><img alt="${copy.logo}"></section>`
    expect(unexpectedWelcomeCopy(allowed)).toEqual([])
  })

  for (const [source, attribute] of [
    ['text', null], ['accessible name', 'aria-label'], ['title', 'title'],
    ['placeholder', 'placeholder'], ['image description', 'alt'],
  ] as const) {
    test(`${locale} rejects untranslated ${source} while retaining the product title`, () => {
      const heading = document.createElement('h1')
      heading.textContent = copy.title
      const node = document.createElement('button')
      if (attribute) node.setAttribute(attribute, other.login)
      else node.textContent = other.login
      document.body.append(heading, node)
      expect(unexpectedWelcomeCopy(allowed)).toContain(other.login)
    })
  }

  test.each(['pages.welcome-page.missing', 'Search...', 'This page will be available soon.'])(`${locale} rejects unexpected copy %s`, (text) => {
    const node = document.createElement('p')
    node.textContent = text
    document.body.append(node)
    expect(unexpectedWelcomeCopy(allowed)).toContain(text)
  })

  test(`${locale} rejects untranslated referenced names and input button values`, () => {
    const label = document.createElement('span')
    label.id = 'untranslated-label'
    label.textContent = other.login
    label.style.display = 'none'
    const button = document.createElement('button')
    button.setAttribute('aria-labelledby', label.id)
    const input = document.createElement('input')
    input.type = 'submit'
    input.value = other.signup
    document.body.append(label, button, input)
    expect(unexpectedWelcomeCopy(allowed)).toEqual([other.login, other.signup])
  })
}
