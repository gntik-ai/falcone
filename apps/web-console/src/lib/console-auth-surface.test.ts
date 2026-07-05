import { describe, expect, it } from 'vitest'

import {
  AUTH_PANEL_ASIDE_CLASS_NAME,
  AUTH_PANEL_CLASS_NAME,
  AUTH_PANEL_HEADING_CLASS_NAME,
  AUTH_PANEL_INTRO_CLASS_NAME
} from './console-auth-surface'

// Guards the centralised unauth-funnel surface classes (#731). These constants exist so the six
// unauth screens share ONE coherent panel/heading/intro/aside treatment instead of hand-copied
// strings that drift; the assertions below pin the design decisions that coherence depends on.
describe('console auth surface class names [#731]', () => {
  const allConstants = {
    AUTH_PANEL_CLASS_NAME,
    AUTH_PANEL_HEADING_CLASS_NAME,
    AUTH_PANEL_INTRO_CLASS_NAME,
    AUTH_PANEL_ASIDE_CLASS_NAME
  }

  it.each(Object.entries(allConstants))('%s is a non-empty class string', (_name, value) => {
    expect(typeof value).toBe('string')
    expect(value.trim().length).toBeGreaterThan(0)
  })

  // Every surface must stay legible in the dark theme — no hardcoded light-mode escapes. Mirrors
  // the tree-wide guard in src/no-hardcoded-light-mode-colors.test.ts, scoped to these constants.
  it.each(Object.entries(allConstants))('%s uses only theme tokens (no light-mode literals)', (_name, value) => {
    expect(value).not.toMatch(/\bbg-white\b/)
    expect(value).not.toMatch(/\bbg-slate-\d+\b/)
    expect(value).not.toMatch(/\btext-slate-\d+\b/)
  })

  it('the panel is the elevated, token-based card the whole funnel shares', () => {
    for (const token of ['rounded-3xl', 'border-border/80', 'bg-card/80', 'shadow-2xl', 'backdrop-blur', 'lg:p-10']) {
      expect(AUTH_PANEL_CLASS_NAME).toContain(token)
    }
  })

  // The heading MUST carry the full responsive ramp so the h1 keeps one type scale across every
  // step of the funnel (the 404 had previously dropped the sm/lg steps).
  it('the heading carries the full responsive display ramp', () => {
    for (const token of ['text-3xl', 'sm:text-4xl', 'lg:text-5xl', 'font-semibold', 'leading-tight']) {
      expect(AUTH_PANEL_HEADING_CLASS_NAME).toContain(token)
    }
  })

  // The intro is a responsive ramp (base on mobile, larger from sm) — not a pinned size — so the
  // lede scales consistently with the heading.
  it('the intro is a responsive muted ramp, not a pinned size', () => {
    for (const token of ['text-base', 'leading-7', 'sm:text-lg', 'sm:leading-8', 'text-muted-foreground']) {
      expect(AUTH_PANEL_INTRO_CLASS_NAME).toContain(token)
    }
  })
})
