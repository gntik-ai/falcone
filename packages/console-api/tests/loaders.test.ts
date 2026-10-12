// @vitest-environment jsdom
import { it } from 'vitest'
import { loaderCases } from './cases/loaders.mjs'

for (const [name, run] of loaderCases) it(name, run)
