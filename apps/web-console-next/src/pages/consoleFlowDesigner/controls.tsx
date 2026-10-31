import { Button, type ButtonProps } from '@gntik-ai/ui'
export const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
// The port keeps the legacy event handlers and gives every action the kit's common controls.
export function DesignerButton({ variant = 'primary', size = 'sm', className = '', ...props }: Omit<ButtonProps, 'variant'> & { variant?: ButtonProps['variant'] | 'outline' | 'default' }) {
  return <Button variant={variant === 'outline' ? 'secondary' : variant === 'default' ? 'primary' : variant} size={size} loading={false} iconOnly={false} icon={undefined} trailingIcon={undefined} type="button" className={`${focus} ${className}`} {...props} />
}
