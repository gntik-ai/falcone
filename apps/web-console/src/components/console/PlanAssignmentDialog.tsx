import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'

export interface AssignmentPlanChoice { id: string; displayName: string; status: 'draft' | 'active' | 'deprecated' | 'archived' }

export function PlanAssignmentDialog({ open, tenantId, activePlans, currentPlanId, onConfirm, onCancel }: { open: boolean; tenantId: string; activePlans: AssignmentPlanChoice[]; currentPlanId?: string | null; onConfirm: (planId: string) => void | Promise<void>; onCancel: () => void }) {
  const selectable = useMemo(() => activePlans.filter((plan) => plan.status === 'active'), [activePlans])
  const [selected, setSelected] = useState(currentPlanId ?? selectable[0]?.id ?? '')

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent>
        <DialogHeader><DialogTitle className="break-words">Asignar plan a {tenantId}</DialogTitle></DialogHeader>
        <label className="block space-y-2 text-sm">
          <span className="font-medium text-foreground">Plan activo</span>
          <Select aria-label="Seleccionar plan activo" value={selected} onChange={(event) => setSelected(event.currentTarget.value)}>
            {selectable.map((plan) => <option key={plan.id} value={plan.id}>{plan.displayName}</option>)}
          </Select>
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button type="button" onClick={() => onConfirm(selected)} disabled={!selected}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
