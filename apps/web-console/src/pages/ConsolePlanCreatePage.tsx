import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FORM_FIELD_ERROR_CLASS_NAME, INVALID_FORM_CONTROL_CLASS_NAME } from '@/lib/console-create-form-validation'
import { describeConsoleError } from '@/lib/console-errors'
import * as api from '@/services/planManagementApi'

export function ConsolePlanCreatePage() {
  const navigate = useNavigate()
  const [slug, setSlug] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const displayNameInputRef = useRef<HTMLInputElement>(null)
  function handleDisplayNameChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextDisplayName = event.currentTarget.value
    setDisplayName(nextDisplayName)
    if (displayNameError && nextDisplayName.trim()) {
      setDisplayNameError(null)
    }
  }
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedDisplayName = displayName.trim()
    const nextDisplayNameError = trimmedDisplayName ? null : 'El nombre visible es obligatorio'
    setError(null)
    setDisplayNameError(nextDisplayNameError)
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(slug)) { setError('El formato del slug no es válido'); return }
    if (nextDisplayNameError) { displayNameInputRef.current?.focus(); return }
    try {
      const created = await api.createPlan({ slug, displayName: trimmedDisplayName, description, capabilities: {}, quotaDimensions: {} }) as api.PlanRecord
      navigate(`/console/plans/${created.id}`)
    } catch (fetchError) {
      setError(describeConsoleError(fetchError, 'No se pudo crear el plan'))
    }
  }
  return (
    <section className="space-y-6" aria-labelledby="plan-create-heading">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <h1 id="plan-create-heading" className="text-2xl font-semibold">Crear plan</h1>
      </header>
      <form onSubmit={handleSubmit} className="space-y-5 rounded-3xl border border-border bg-card/70 p-6">
        <div className="space-y-2">
          <Label htmlFor="plan-slug">Slug</Label>
          <Input id="plan-slug" aria-label="Slug" value={slug} onChange={(e) => setSlug(e.currentTarget.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="plan-display-name">Nombre visible</Label>
          <Input
            ref={displayNameInputRef}
            id="plan-display-name"
            aria-label="Nombre visible"
            aria-invalid={Boolean(displayNameError) || undefined}
            aria-describedby={displayNameError ? 'display-name-error' : undefined}
            className={displayNameError ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
            value={displayName}
            onChange={handleDisplayNameChange}
          />
          {displayNameError ? (
            <span id="display-name-error" role="alert" className={`block ${FORM_FIELD_ERROR_CLASS_NAME}`}>
              {displayNameError}
            </span>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="plan-description">Descripción</Label>
          <Textarea id="plan-description" aria-label="Descripción" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
        </div>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Button type="submit">Crear</Button>
      </form>
    </section>
  )
}
