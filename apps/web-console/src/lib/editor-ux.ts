// Shared, pure helpers for the executor data editors (change: add-console-richer-data-editors).
// Kept framework-free so they are unit-testable without a DOM.
import type { JsonValue } from '@/lib/http'

export type JsonObject = Record<string, JsonValue>

// Render a cell/value for display: objects as compact JSON, null/undefined as empty.
export function formatCell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// Stable union of keys across a set of rows/documents (column discovery).
export function collectColumns(rows: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key)
  return Array.from(seen)
}

export type ParseResult = { ok: true; value: JsonObject } | { ok: false; error: string }

// Parse a JSON-object textarea, with a precise, user-facing error (not a raw SyntaxError).
export function parseJsonObject(text: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Not valid JSON' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Expected a JSON object' }
  }
  return { ok: true, value: parsed as JsonObject }
}

// Pretty-print a value for an editable textarea.
export function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

// Copy text to the clipboard, returning whether it succeeded (no throw when unavailable).
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to false */
  }
  return false
}
