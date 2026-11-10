// @vitest-environment jsdom
import { it } from 'vitest'
import { iamAccessCases } from './cases/iam-access.mjs'

for (const [name, run] of iamAccessCases) it(name, run)
