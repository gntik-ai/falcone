import type { Page } from '@playwright/test'

export function collectMongoDataLocaleValues(): string[]
export function assertMongoDataLocale(parity: { page: Page; locale: string }): Promise<void>
