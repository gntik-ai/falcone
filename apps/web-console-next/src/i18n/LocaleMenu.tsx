import { MenuSub, MenuSubTrigger, MenuSubContent, MenuRadioGroup, MenuRadioItem } from '@gntik-ai/ui'
import { useTranslation } from 'react-i18next'
import { loadLocale, useLocaleLoader } from './locale-loader'

export function LocaleMenu() {
  const { t, i18n } = useTranslation('common')
  const { pending } = useLocaleLoader()
  return <MenuSub>
    <MenuSubTrigger>{t('locale.label')}</MenuSubTrigger>
    <MenuSubContent>
      <MenuRadioGroup value={i18n.language} onValueChange={(value) => {
        if (!pending && value !== i18n.language && (value === 'es' || value === 'en')) void loadLocale(value)
      }}>
        <MenuRadioItem value="es" disabled={pending}>{t('locale.es')}</MenuRadioItem>
        <MenuRadioItem value="en" disabled={pending}>{t('locale.en')}</MenuRadioItem>
      </MenuRadioGroup>
    </MenuSubContent>
  </MenuSub>
}
