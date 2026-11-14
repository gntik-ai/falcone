import type { Page } from '@playwright/test'

export function collectPostgresDataLocaleValues(): string[]
export function assertPostgresDataLocale(parity: { page: Page; locale: string }): Promise<void>
