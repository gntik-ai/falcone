import { IntlMessageFormat } from 'intl-messageformat'
import es from '../../locales/es/pages.console-flow-designer-page.json'
import en from '../../locales/en/pages.console-flow-designer-page.json'

// Pure catalog access also works in the semantic worker, without the document-bound i18n host.
export function formatMessage(key: string, params: Record<string, string | number> = {}, locale = 'es'): string {
  const catalog = locale === 'en' ? en : es
  const value = key.split('.').reduce<unknown>((entry, part) => entry && typeof entry === 'object' ? (entry as Record<string, unknown>)[part] : undefined, catalog)
  return typeof value === 'string' ? String(new IntlMessageFormat(value, locale).format(params)) : key
}
