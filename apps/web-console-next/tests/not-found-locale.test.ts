import { beforeEach, expect, test, vi } from 'vitest'
// @ts-expect-error The browser harness intentionally uses native JavaScript modules.
import { allowedNotFoundCopy } from './parity/pages/not-found-locale.mjs'
// @ts-expect-error The browser harness intentionally uses native JavaScript modules.
import { unexpectedWelcomeCopy } from './parity/pages/welcome-locale.mjs'
import es from '../src/locales/es/pages.not-found-page.json'
import en from '../src/locales/en/pages.not-found-page.json'
import commonEs from '../src/locales/es/common.json'
import commonEn from '../src/locales/en/common.json'

beforeEach(() => {
  // jsdom has no layout; expose the fixture nodes to the browser collector.
  const rect = new DOMRect()
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue(Object.assign([rect], { item: (index: number) => index === 0 ? rect : null }))
  document.body.innerHTML = ''
})

for (const locale of ['es', 'en'] as const) {
  const copy = locale === 'es' ? es : en
  const common = locale === 'es' ? commonEs : commonEn
  const other = locale === 'es' ? commonEn : commonEs
  const allowed = allowedNotFoundCopy(copy, common)
  const loading = `${common.states.loading.title}. ${common.states.loading.body}`

  test(`${locale} accepts the retained loading announcement alongside the 404 content`, () => {
    document.body.innerHTML = `<main><h1>${copy.title}</h1><p>${copy.description}</p><a>${copy.login}</a><a>${copy.home}</a></main><div role="status" class="sr-only">${loading}</div>`
    // page.evaluate serializes the collector without its module scope.
    const collect = new Function(`return (${unexpectedWelcomeCopy.toString()})`)()
    expect(collect(allowed)).toEqual([])
  })

  test.each([
    `${other.states.loading.title}. ${other.states.loading.body}`,
    `${loading} Unexpected copy`,
    'Loading...',
    'pages.not-found-page.missing',
  ])(`${locale} still rejects unexpected announcement %s`, (text) => {
    const status = document.createElement('div')
    status.setAttribute('role', 'status')
    status.className = 'sr-only'
    status.textContent = text
    document.body.append(status)
    expect(unexpectedWelcomeCopy(allowed)).toEqual([text])
  })
}
