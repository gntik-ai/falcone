import { Button, type ButtonProps } from '@gntik-ai/ui'
export const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
// Every action uses the kit button with its props explicit and a visible keyboard focus.
export function RunButton({ variant = 'primary', size = 'sm', className = '', ...props }: ButtonProps) {
  return <Button variant={variant} size={size} loading={false} iconOnly={false} icon={undefined} trailingIcon={undefined} type="button" className={`${focus} ${className}`} {...props} />
}
