// Node detail panel for the flow run view (change: add-console-flow-monitoring / #366).
//
// Opens when a node is clicked on the run canvas. Shows the activity input/output payloads (each
// truncated at 4 KB for display, with a visible indicator — design.md "Payload display size cap"),
// the final error message + stack excerpt when the node failed, and a chronological attempt list.
// Purely presentational: the caller supplies the merged node detail + live status snapshot.
import { Badge } from '@/components/ui/badge'
import { NodeStatusBadge } from '@/components/flows/NodeStatusBadge'
import type { JsonValue } from '@/lib/http'
import type { ExecutionNodeDetail } from '@/services/flowsMonitoringApi'
import type { NodeStatusSnapshot } from '@/lib/hooks/use-flow-execution'

const PAYLOAD_DISPLAY_CAP = 4096

// Render a JSON value as pretty text, truncated at the 4 KB display cap. Returns the text plus a
// `truncated` flag so the panel can show an indicator (the backend emits the full payload).
export function renderCappedPayload(value: JsonValue | null | undefined): {
  text: string
  truncated: boolean
} {
  if (value == null) return { text: '', truncated: false }
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  if (text.length > PAYLOAD_DISPLAY_CAP) {
    return { text: `${text.slice(0, PAYLOAD_DISPLAY_CAP)}…`, truncated: true }
  }
  return { text, truncated: false }
}

export interface RunNodeDetailPanelProps {
  nodeId: string
  detail?: ExecutionNodeDetail | null
  liveStatus?: NodeStatusSnapshot | null
  onClose?: () => void
}

function PayloadBlock({ label, value }: { label: string; value: JsonValue | null | undefined }) {
  const { text, truncated } = renderCappedPayload(value)
  return (
    <section className="space-y-1" data-testid={`run-node-payload-${label.toLowerCase()}`}>
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</h4>
        {truncated ? (
          <Badge variant="outline" className="text-[9px]" data-testid={`run-node-${label.toLowerCase()}-truncated`}>
            truncado · límite visual de 4 KB
          </Badge>
        ) : null}
      </div>
      <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-[11px] leading-snug">
        {text || <span className="text-muted-foreground">—</span>}
      </pre>
    </section>
  )
}

export function RunNodeDetailPanel({ nodeId, detail, liveStatus, onClose }: RunNodeDetailPanelProps) {
  const status = liveStatus?.status ?? detail?.status ?? null
  const error = liveStatus?.error ?? detail?.error ?? null
  const attempts = detail?.attempts ?? []

  return (
    <aside
      className="w-80 shrink-0 space-y-4 overflow-y-auto border-l border-border p-4"
      data-testid="run-node-detail-panel"
    >
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold" title={nodeId}>
            {nodeId}
          </h3>
          {status ? (
            <NodeStatusBadge
              status={status}
              attemptNumber={liveStatus?.attemptNumber}
              startedAt={liveStatus?.startedAt}
              completedAt={liveStatus?.completedAt}
            />
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={onClose}
            data-testid="run-node-detail-close"
          >
            Cerrar
          </button>
        ) : null}
      </header>

      <PayloadBlock label="Entrada" value={detail?.input ?? null} />
      <PayloadBlock label="Salida" value={detail?.output ?? null} />

      {error ? (
        <section className="space-y-1" data-testid="run-node-error">
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-destructive">Error</h4>
          <p className="text-xs text-destructive">{error.message}</p>
          {error.stack ? (
            <pre className="max-h-32 overflow-auto rounded-md bg-destructive/10 p-2 text-[10px] leading-snug text-destructive">
              {error.stack}
            </pre>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-1" data-testid="run-node-attempts">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Intentos</h4>
        {attempts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay intentos registrados.</p>
        ) : (
          <ol className="space-y-1">
            {attempts.map((attempt, index) => (
              <li
                key={`${attempt.attemptNumber ?? index}-${attempt.startedAt ?? index}`}
                className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-[11px]"
                data-testid="run-node-attempt-row"
              >
                <span>#{attempt.attemptNumber ?? index + 1}</span>
                <span className="text-muted-foreground">{attempt.status}</span>
                <span className="text-muted-foreground">{attempt.completedAt ?? attempt.startedAt ?? ''}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  )
}
