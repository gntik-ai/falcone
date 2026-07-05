// Repo guard (change: add-console-brand-tokens, issue #734).
//
// Requirement: "The system SHALL define a branded primary color (navy #1B2D5B family), a card
// surface lifted from the page background, a defined brand typeface, accessible error-text
// contrast, and a visible focus ring — applied via tokens so all screens benefit."
// Scenario: "WHEN any screen renders its primary button THEN it uses the brand action color
// (clearly distinct from disabled/secondary) on a card surface visibly elevated from the
// background."
//
// This parses the raw CSS custom properties in globals.css (both :root and .dark — the console
// renders dark-root with no `.dark` class on <html>, but the tokens are kept in sync per the
// #744 idiom) and computes real WCAG 2.x contrast ratios from the HSL triplets, so the brand
// tokens can't silently regress to an unbranded hue or an inaccessible contrast in a future edit.
// --card/--popover elevation is already guarded by globals.test.ts (#744) and is NOT re-asserted
// here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const CSS_PATH = join(__dirname, 'globals.css')
const css = readFileSync(CSS_PATH, 'utf8')

function extractBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`selector "${selector}" not found in globals.css`)
  const end = css.indexOf('}', start)
  return css.slice(start, end)
}

function extractVar(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`))
  if (!match) throw new Error(`variable "${name}" not found in block`)
  return match[1].trim()
}

// -- Minimal HSL -> WCAG relative-luminance/contrast helpers (no external color library) --

type Hsl = [h: number, s: number, l: number]
type Rgb = [r: number, g: number, b: number]

function parseHslVar(value: string): Hsl {
  const [h, s, l] = value.trim().split(/\s+/)
  return [parseFloat(h), parseFloat(s), parseFloat(l)]
}

function hslToRgb([h, s, l]: Hsl): Rgb {
  const sN = s / 100
  const lN = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sN * Math.min(lN, 1 - lN)
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

function srgbToLinear(c: number): number {
  const cN = c / 255
  return cN <= 0.03928 ? cN / 12.92 : Math.pow((cN + 0.055) / 1.055, 2.4)
}

function relativeLuminance([r, g, b]: Rgb): number {
  const [rl, gl, bl] = [r, g, b].map(srgbToLinear)
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

function contrastRatioRgb(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

function contrastRatio(a: Hsl, b: Hsl): number {
  return contrastRatioRgb(hslToRgb(a), hslToRgb(b))
}

// Alpha-blend `fg` at `alpha` opacity over an opaque `bg` (both HSL), as `bg-destructive/10`
// etc. render in the real UI, and return the resulting RGB.
function blendOver(fg: Hsl, alpha: number, bg: Hsl): Rgb {
  const fgRgb = hslToRgb(fg)
  const bgRgb = hslToRgb(bg)
  return [0, 1, 2].map((i) => fgRgb[i] * alpha + bgRgb[i] * (1 - alpha)) as Rgb
}

const BLOCKS = {
  ':root': extractBlock(':root'),
  '.dark': extractBlock('\n.dark')
} as const

describe.each(Object.entries(BLOCKS))('[#734][Scenario: brand action color on an elevated card] %s brand tokens', (_selector, block) => {
  const primary = parseHslVar(extractVar(block, '--primary'))
  const primaryForeground = parseHslVar(extractVar(block, '--primary-foreground'))
  const destructive = parseHslVar(extractVar(block, '--destructive'))
  const destructiveForeground = parseHslVar(extractVar(block, '--destructive-foreground'))
  const background = parseHslVar(extractVar(block, '--background'))
  const secondary = parseHslVar(extractVar(block, '--secondary'))
  const ring = parseHslVar(extractVar(block, '--ring'))

  it('--primary hue is in the navy brand family (~215-230), not the legacy unbranded value', () => {
    const [hue] = primary
    expect(hue).toBeGreaterThanOrEqual(215)
    expect(hue).toBeLessThanOrEqual(230)
    // Legacy values this must never regress to: :root's old pale ice-blue (204 94% 94%) and
    // .dark's old near-white (210 40% 98%) — neither is brand-derived.
    expect(extractVar(block, '--primary')).not.toBe('204 94% 94%')
    expect(extractVar(block, '--primary')).not.toBe('210 40% 98%')
  })

  it('--primary is clearly distinct from --secondary (the disabled/inactive surface)', () => {
    expect(contrastRatio(primary, secondary)).toBeGreaterThanOrEqual(3)
  })

  it('--primary vs --background clears WCAG 1.4.11 non-text contrast (>=3:1) so the button surface is visible on the card/page', () => {
    expect(contrastRatio(primary, background)).toBeGreaterThanOrEqual(3)
  })

  it('--primary-foreground vs --primary clears WCAG 1.4.3 text contrast (>=4.5:1) for the primary button label', () => {
    expect(contrastRatio(primaryForeground, primary)).toBeGreaterThanOrEqual(4.5)
  })

  // Interaction state: the filled Button/Badge/Tabs variants dim on hover via `hover:opacity-90`,
  // which composites the WHOLE control (surface + label) toward the dark page — DARKENING both and
  // shrinking the label/surface contrast. The near-black brand foreground has little headroom, so
  // guard that the label still clears WCAG AA (>=4.5:1) in that hovered state, composited over the
  // bare --background (the worst case, e.g. the destructive confirm button inside a bg-background
  // dialog). `blendOver(color, 0.9, bg)` == the color rendered at 90% opacity over --background.
  it('--primary-foreground stays >=4.5:1 on --primary while the button is hovered (opacity-90 over --background)', () => {
    const hoveredLabel = blendOver(primaryForeground, 0.9, background)
    const hoveredSurface = blendOver(primary, 0.9, background)
    expect(contrastRatioRgb(hoveredLabel, hoveredSurface)).toBeGreaterThanOrEqual(4.5)
  })

  it('--destructive used as error TEXT clears WCAG AA (>=4.5:1) on the bare page background', () => {
    expect(contrastRatio(destructive, background)).toBeGreaterThanOrEqual(4.5)
  })

  it('--destructive used as error TEXT clears WCAG AA (>=4.5:1) on the bg-destructive/10 tint over the page background', () => {
    const tint = blendOver(destructive, 0.1, background)
    expect(contrastRatioRgb(hslToRgb(destructive), tint)).toBeGreaterThanOrEqual(4.5)
  })

  it('--destructive used as error TEXT clears WCAG AA (>=4.5:1) on the bg-destructive/20 tint over the page background', () => {
    const tint = blendOver(destructive, 0.2, background)
    expect(contrastRatioRgb(hslToRgb(destructive), tint)).toBeGreaterThanOrEqual(4.5)
  })

  it('--destructive-foreground vs --destructive clears WCAG AA (>=4.5:1) so the destructive Button label stays legible', () => {
    expect(contrastRatio(destructiveForeground, destructive)).toBeGreaterThanOrEqual(4.5)
  })

  // Same hovered-state guard as --primary above: the destructive confirm button (the app's most
  // consequential action, and one that renders on the bare --background inside dialogs) must keep
  // its label >=4.5:1 while dimmed on hover.
  it('--destructive-foreground stays >=4.5:1 on --destructive while the button is hovered (opacity-90 over --background)', () => {
    const hoveredLabel = blendOver(destructiveForeground, 0.9, background)
    const hoveredSurface = blendOver(destructive, 0.9, background)
    expect(contrastRatioRgb(hoveredLabel, hoveredSurface)).toBeGreaterThanOrEqual(4.5)
  })

  it('--ring vs --background stays a visible focus indicator (>=3:1, WCAG 1.4.11)', () => {
    expect(contrastRatio(ring, background)).toBeGreaterThanOrEqual(3)
  })
})

describe('[#734][Scenario: brand typeface] bundled brand font wiring', () => {
  const MAIN_ENTRY = readFileSync(join(__dirname, '..', 'main.tsx'), 'utf8')
  const TAILWIND_CONFIG = readFileSync(join(__dirname, '..', '..', 'tailwind.config.ts'), 'utf8')
  const PACKAGE_JSON = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'))

  it('the console entry point imports a bundled (self-hosted) brand font stylesheet, not a runtime CDN link', () => {
    expect(MAIN_ENTRY).toMatch(/import\s+['"]@fontsource-variable\/inter\/wght\.css['"]/)
  })

  it('the font package is a real, installed dependency (bundled into the build, works offline)', () => {
    expect(PACKAGE_JSON.dependencies?.['@fontsource-variable/inter']).toBeTruthy()
    const fontCssPath = join(
      __dirname,
      '..',
      '..',
      'node_modules',
      '@fontsource-variable',
      'inter',
      'wght.css'
    )
    const fontCss = readFileSync(fontCssPath, 'utf8')
    expect(fontCss).toMatch(/@font-face/)
    expect(fontCss).toMatch(/font-family:\s*'Inter Variable'/)
    // Self-hosted: font files are relative package assets, never a fonts.googleapis.com (or any
    // other) remote URL — required for the fully offline/air-gapped deployment target.
    expect(fontCss).not.toMatch(/https?:\/\//)
  })

  it('tailwind.config.ts wires fontFamily.sans to start with the brand face (system stack as fallback)', () => {
    const sansMatch = TAILWIND_CONFIG.match(/sans:\s*\[([^\]]+)\]/)
    expect(sansMatch, 'expected a theme.extend.fontFamily.sans array in tailwind.config.ts').toBeTruthy()
    const sansStack = sansMatch![1]
    const firstEntry = sansStack.trim().split(',')[0].trim()
    expect(firstEntry).toBe('\'"Inter Variable"\'')
    expect(sansStack).toMatch(/ui-sans-serif/)
    expect(sansStack).toMatch(/system-ui/)
  })
})
