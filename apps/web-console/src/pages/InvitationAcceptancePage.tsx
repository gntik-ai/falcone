import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requestJson } from '@/lib/http'
import { readConsoleShellSession, requestConsoleSessionJson } from '@/lib/console-session'

export function InvitationAcceptancePage() {
  const { tenantId, invitationId } = useParams()
  const location = useLocation()
  const [token, setToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'busy' | 'accepted' | 'error'>('idle')
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token) && !!tenantId && !!invitationId
  // Remove proof from browser history without persisting it in session/local storage.
  useEffect(() => { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search) }, [])
  async function accept(event: FormEvent) {
    event.preventDefault()
    if (!valid || status === 'busy' || status === 'accepted') return
    setStatus('busy')
    try {
      const request = readConsoleShellSession() ? requestConsoleSessionJson : requestJson
      await request(`/v1/tenants/${encodeURIComponent(tenantId!)}/invitations/${encodeURIComponent(invitationId!)}/acceptance`, {
        method: 'POST', body: { token, email, ...(password ? { password } : {}) }
      })
      setStatus('accepted'); setToken(''); setPassword(''); setEmail('')
    } catch { setStatus('error') }
  }
  if (status === 'accepted') return <div role="status">Invitación aceptada. <Link to="/login">Iniciar sesión</Link></div>
  if (!valid) return <p role="alert">Enlace de invitación no válido. Solicita uno nuevo al administrador.</p>
  return <section className="space-y-4"><h1>Aceptar invitación</h1>
    <p>Si ya tienes una cuenta, inicia sesión con ella y vuelve a abrir este enlace. Para una cuenta nueva, elige una contraseña.</p>
    <Link to="/login">Iniciar sesión</Link>
    <form className="space-y-3" onSubmit={event => void accept(event)}>
      <Label htmlFor="accept-email">Email</Label><Input id="accept-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
      <Label htmlFor="accept-password">Contraseña</Label><Input id="accept-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} />
      <Button type="submit" disabled={status === 'busy'}>Aceptar invitación</Button>
      {status === 'error' ? <p role="alert">No se pudo aceptar la invitación. Comprueba el enlace y tus datos o solicita un enlace nuevo.</p> : null}
    </form>
  </section>
}
