import { Badge } from '@/components/ui/badge'

const resultLabels: Record<string, string> = {
  succeeded: 'Correcto',
  success: 'Correcto',
  failed: 'Fallido',
  failure: 'Fallido',
  error: 'Error',
  unknown: 'Desconocido'
}

export function ConsoleAuditResultBadge({ result }: { result: string }) {
  const className = result === 'succeeded' || result === 'success'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
    : 'border-red-500/40 bg-red-500/10 text-red-700'
  return <Badge className={className}>{resultLabels[result] ?? result.replace(/_/g, ' ')}</Badge>
}
