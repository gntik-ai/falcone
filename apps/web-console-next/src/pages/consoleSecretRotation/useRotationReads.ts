import { useEffect, useState } from 'react'
import { getSecretConsumerStatus, listSecretRotationHistory, type SecretConsumerStatus, type SecretRotationHistory } from './api'
import { failureOf, type Failure } from './state'

export function useHistory(path: string) {
  const [offset, setOffset] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ data?: SecretRotationHistory; failure?: Failure }>({})
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setState({})
    void Promise.resolve().then(async () => {
      if (!active) return
      try { const data = await listSecretRotationHistory(path, { limit: 20, offset }, controller.signal); if (active) setState({ data }) }
      catch (cause) { if (active) setState({ failure: failureOf(cause) }) }
    })
    return () => { active = false; controller.abort() }
  }, [path, offset, attempt])
  return { ...state, offset, setOffset, retry: () => setAttempt((value) => value + 1) }
}
export function useConsumers(path: string) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ data?: SecretConsumerStatus; failure?: Failure; updatedAt?: string }>({})
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const poll = async () => {
      let done = false
      try {
        const data = await getSecretConsumerStatus(path, controller.signal)
        if (!active) return
        setState({ data, updatedAt: new Date().toISOString() })
        done = data.consumers.length > 0 && data.consumers.every((item) => item.state === 'confirmed' || item.state === 'timeout')
      } catch (cause) {
        if (!active) return
        setState((previous) => ({ ...previous, failure: failureOf(cause) }))
      }
      if (active && !done) timer = setTimeout(() => void poll(), 5000)
    }
    void Promise.resolve().then(() => { if (active) void poll() })
    return () => { active = false; controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [path, attempt])
  return { ...state, retry: () => setAttempt((value) => value + 1) }
}
