import { Plus, Trash2, UserCheck, UserMinus, X, type LucideIcon } from 'lucide-react'

// The kit icon slots take a plain component; the installed lucide icons carry stricter prop types.
interface KitIconProps { size?: number; className?: string; 'aria-hidden'?: boolean }
const adapt = (Icon: LucideIcon) => function KitIcon(props: KitIconProps) { return <Icon {...props} /> }
export const TrashIcon = adapt(Trash2)
export const EnableIcon = adapt(UserCheck)
export const SuspendIcon = adapt(UserMinus)
export const RemoveIcon = adapt(X)
export const AddIcon = adapt(Plus)
