import { planDetailFixtures } from './parity/pages/console-plan-detail-page.manifest'

// Plain bodies for tests that mount the whole app on a plan id of their own.
export const planFor = (id: string) => (planDetailFixtures(id).detail.draft as { body: unknown }).body
export const limitsProfileFor = (id: string) => (planDetailFixtures(id).limits['profile-6'] as { body: unknown }).body
