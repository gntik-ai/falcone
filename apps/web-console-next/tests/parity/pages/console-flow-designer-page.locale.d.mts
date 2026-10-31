import type { Page } from '@playwright/test'

export function collectDesignerLocaleValues(apiVersion: string): string[]
export function assertDesignerLocale(parity: { page: Page; locale: string }): Promise<void>
