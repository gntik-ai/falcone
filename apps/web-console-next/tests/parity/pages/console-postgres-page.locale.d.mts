import type { Page } from '@playwright/test'

export function collectPostgresLocaleValues(data: {
  stateLabel: string
  activeLabel: string
  lockTargetsLabel: string
  inventoryIds: string[]
  lockTargets: string[]
  defaultLabel: string
  columnsId: string
  warningCategories: string[]
  statementCategories: string[]
}): string[]
export function assertPostgresLocale(parity: { page: Page; locale: string }): Promise<void>
