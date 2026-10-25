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

  test.each([
    'dev', 'dev · abc1234', '1.2.3', '1.2.3 · abc1234',
    '1.2.3-rc.1+build.42 · abc1234', ' \n 1.2.3\t ·  abc1234 \n ',
  ])(`${locale} accepts build metadata %s after whitespace normalization`, (version) => {
    const node = document.createElement('p')
    node.textContent = version
    document.body.append(node)
    expect(unexpectedWelcomeCopy(allowed)).toEqual([])
  })

  test(`${locale} accepts adjacent version and commit text nodes after serialization`, () => {
    const node = document.createElement('p')
    node.append(document.createTextNode('1.2.3'), document.createTextNode(' · abc1234'))
    document.body.append(node)
    // page.evaluate serializes the collector without its module scope.
    const collect = new Function(`return (${unexpectedWelcomeCopy.toString()})`)()
    expect(collect(allowed)).toEqual([])
    node.setAttribute('aria-label', other.login)
    expect(collect(allowed)).toEqual([other.login])
  })

  test.each([
    'Dev', 'v1.2.3', '1.2 · abc1234', '1.2.3 · ABC1234', '1.2.3 · abc12345',
    'version 1.2.3', '1.2.3 untranslated copy', '1.2.3 · abc1234 extra',
    '· ABC1234', '· abc12345', 'abc1234',
  ])(`${locale} rejects near-miss build metadata %s`, (text) => {
    const node = document.createElement('p')
    node.textContent = text
    document.body.append(node)
    expect(unexpectedWelcomeCopy(allowed)).toEqual([text])
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
