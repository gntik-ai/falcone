// @vitest-environment jsdom
import { it } from 'vitest'
import { iamMembershipCases } from './cases/iam-membership.mjs'

for (const [name, run] of iamMembershipCases) it(name, run)
