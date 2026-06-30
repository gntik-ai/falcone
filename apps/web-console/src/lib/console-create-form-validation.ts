export const MAX_FORM_INTEGER = Number.MAX_SAFE_INTEGER
export const INVALID_FORM_CONTROL_CLASS_NAME =
  'border-destructive bg-destructive/5 focus-visible:ring-destructive/40'
export const FORM_FIELD_ERROR_CLASS_NAME =
  'text-sm font-medium leading-5 text-destructive'

export function parseRequiredIntegerField(
  value: string | null | undefined,
  { label, min = 1, max = MAX_FORM_INTEGER }: { label: string; min?: number; max?: number }
) {
  const text = (value ?? '').trim()

  if (!text) {
    return { value: null, error: `${label} es obligatorio.` }
  }

  if (!/^-?\d+$/.test(text)) {
    return { value: null, error: `${label} debe ser un número entero.` }
  }

  const numeric = Number(text)
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
    return { value: null, error: `${label} debe estar entre ${min} y ${max}.` }
  }

  return { value: numeric, error: null }
}
