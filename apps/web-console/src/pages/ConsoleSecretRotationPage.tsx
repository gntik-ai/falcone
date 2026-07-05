// #744: converged onto the shared Card/Table/Badge/Input/Textarea/Button/Label primitives. This
// page previously rendered three hard-coded solid-white panels (a light-mode card leaking onto the
// dark console theme, the worst offender in the #744 verification census) and a hand-rolled
// <table> with its own one-off header styling.
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { getConsumerStatus, initiateRotation, listRotationHistory } from '@/actions/secretRotationActions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

const STATUS_TONE: Record<string, string> = {
  confirmed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  timeout: 'border-red-500/30 bg-red-500/10 text-red-300',
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-300'
}

function StatusBadge({ state }: { state: string }) {
  const tone = useMemo(() => STATUS_TONE[state] ?? 'border-border bg-muted/40 text-muted-foreground', [state])

  return <Badge className={tone}>{state}</Badge>
}

export function ConsoleSecretRotationPage() {
  const { encodedSecretPath = '' } = useParams()
  const secretPath = decodeURIComponent(encodedSecretPath)
  const [gracePeriodSeconds, setGracePeriodSeconds] = useState(1800)
  const [justification, setJustification] = useState('')
  const [newValue, setNewValue] = useState('')
  const [history, setHistory] = useState<any[]>([])
  const [consumers, setConsumers] = useState<any[]>([])

  useEffect(() => {
    let cancelled = false
    listRotationHistory(secretPath, { limit: 20, offset: 0 }).then((data) => {
      if (!cancelled) setHistory(data.items ?? [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [secretPath])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const data = await getConsumerStatus(secretPath)
        if (!active) return
        setConsumers(data.consumers ?? [])
        const done = (data.consumers ?? []).length > 0 && (data.consumers ?? []).every((item) => item.state === 'confirmed' || item.state === 'timeout')
        if (!done) timer = setTimeout(tick, 5000)
      } catch {
        if (active) timer = setTimeout(tick, 5000)
      }
    }
    void tick()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [secretPath])

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Rotar secreto</h1>
        <p className="mt-2 text-sm text-muted-foreground">{secretPath}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Formulario de rotación</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-foreground">Periodo de gracia (segundos)</span>
            <input
              aria-label="Selector de periodo de gracia"
              type="range"
              min={300}
              max={86400}
              value={gracePeriodSeconds}
              onChange={(event) => setGracePeriodSeconds(Number(event.target.value))}
            />
            <Input
              aria-label="Entrada de periodo de gracia"
              type="number"
              min={300}
              max={86400}
              value={gracePeriodSeconds}
              onChange={(event) => setGracePeriodSeconds(Number(event.target.value))}
            />
          </label>
          <label className="grid gap-2">
            <Label htmlFor="rotation-justification">Justificación</Label>
            <Textarea
              id="rotation-justification"
              aria-label="Justificación"
              required
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
            />
          </label>
          <label className="grid gap-2">
            <Label htmlFor="rotation-new-value">Valor nuevo</Label>
            <Input
              id="rotation-new-value"
              aria-label="Valor nuevo"
              type="password"
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
            />
          </label>
          <div>
            <Button
              type="button"
              onClick={async () => {
                await initiateRotation(secretPath, { gracePeriodSeconds, justification, newValue })
              }}
            >
              Enviar rotación
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de rotación</CardTitle>
        </CardHeader>
        <CardContent className="mt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Evento</TableHead>
                <TableHead scope="col">Actor</TableHead>
                <TableHead scope="col">Marca temporal</TableHead>
                <TableHead scope="col">Versión nueva</TableHead>
                <TableHead scope="col">Versión anterior</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>{String(item.event_type ?? item.eventType ?? '—')}</TableCell>
                  <TableCell>{String(item.actor_id ?? item.actorId ?? '—')}</TableCell>
                  <TableCell>{String(item.occurred_at ?? item.occurredAt ?? '—')}</TableCell>
                  <TableCell>{String(item.vault_version_new ?? item.vaultVersionNew ?? '—')}</TableCell>
                  <TableCell>{String(item.vault_version_old ?? item.vaultVersionOld ?? '—')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Estado de consumidores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {consumers.map((consumer) => (
            <div key={consumer.consumer_id} className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/50 p-3 text-sm">
              <div>
                <div className="font-medium text-foreground">{consumer.consumer_id}</div>
                <div className="text-muted-foreground">{consumer.reload_mechanism}</div>
              </div>
              <StatusBadge state={consumer.state} />
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}

export { StatusBadge }
