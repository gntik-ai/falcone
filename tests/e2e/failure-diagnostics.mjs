#!/usr/bin/env node
// Print only Pod names/status, events and redacted logs, never Pod specs, Secret
// data, or process environments. Every free-form field uses the same redactor.
import { spawnSync } from 'node:child_process'
import { writeSync } from 'node:fs'

const deadline = Date.now() + 60_000
let remainingBytes = 64 * 1024
let remainingLines = 600
let remainingLogs = 18
let sectionBytes = Infinity
let sectionLines = Infinity
const sensitiveValues = Object.entries(process.env)
  .filter(([name, value]) => /password|secret|token|credential|private.?key|admin.?key/i.test(name) && value.length >= 8)
  .flatMap(([, value]) => [value, encodeURIComponent(value), Buffer.from(value).toString('base64')])
  .concat(['e2e-placeholder-secret', 'e2e-repl-secret'])
  .sort((a, b) => b.length - a.length)

function redact(value) {
  let text = String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  for (const secret of sensitiveValues) text = text.split(secret).join('[REDACTED]')
  // Exclude entire credential-bearing lines, including SQL, JSON and DSNs.
  if (/password|passwd|authorization|bearer\s|(?:secret|token|api.?key|access.?key|private.?key|unseal.?key)\s*["']?\s*[=:]|:\/\/[^\s/]+:[^\s/]+@|BEGIN .*PRIVATE KEY/i.test(text)) {
    return '[REDACTED credential-bearing line]'
  }
  return text.replace(/\b[A-Za-z0-9+/]{32,}={0,2}/g, '[REDACTED opaque value]')
}

function emit(value, budget = Infinity) {
  const text = redact(value).replace(/\n/g, '\\n').slice(0, Math.max(0, Math.min(512, budget - 1, sectionBytes - 1, remainingBytes - 1)))
  if (!text || sectionLines <= 0 || remainingLines <= 0 || remainingBytes < Buffer.byteLength(text) + 1 || sectionBytes < Buffer.byteLength(text) + 1) return 0
  writeSync(2, `${text}\n`)
  remainingBytes -= Buffer.byteLength(text) + 1
  remainingLines--
  sectionBytes -= Buffer.byteLength(text) + 1
  sectionLines--
  return Buffer.byteLength(text) + 1
}

function kubectl(args, readTimeout = 3) {
  // Allow client startup/discovery in addition to the API request deadline.
  // A busy kind node must not lose status evidence to a 3s process timeout.
  const timeout = Math.min((readTimeout + 3) * 1000, deadline - Date.now())
  if (timeout <= 0) return null
  const result = spawnSync('kubectl', [...args, `--request-timeout=${readTimeout}s`], {
    encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) return null // Never echo an unfiltered client error.
  return result.stdout
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

emit('>> Ephemeral up failure diagnostics (64 KiB / 600 lines total; 8 KiB per pod)')
// Fetch all namespace summaries before potentially slow log reads consume the
// deadline. Project names/status from PodList JSON: JSONPath unions return all
// names before all statuses, so they cannot be read as interleaved pod pairs.
const snapshots = [...new Set([process.argv[2], 'eso-system', 'secret-store'])]
  .filter((namespace) => namespace && /^[a-z0-9.-]+$/.test(namespace))
  .map((namespace) => ({
    namespace,
    pods: parseJson(kubectl(['get', 'pods', '-n', namespace, '-o', 'json'], 5))?.items
      ?.map(({ metadata, status }) => ({ name: metadata?.name, status })),
    events: parseJson(kubectl(['get', 'events', '-n', namespace, '-o', 'jsonpath-as-json={.items[*]}'], 5)),
  }))
const logCandidates = []
for (const { namespace, pods, events } of snapshots) {
  sectionBytes = Infinity
  sectionLines = Infinity
  emit(`>> Namespace ${namespace}: pods not Ready or not Completed (maximum 12)`)
  // Reserve space for every namespace and its events even during a large crash.
  sectionBytes = 12 * 1024
  sectionLines = 120
  let shown = 0
  for (const { name, status } of Array.isArray(pods) ? pods : []) {
    if (!/^[a-z0-9.-]+$/.test(name) || !status || status.phase === 'Succeeded') continue
    const containers = [...(status.initContainerStatuses ?? []), ...(status.containerStatuses ?? []), ...(status.ephemeralContainerStatuses ?? [])]
    const ready = status.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True')
    if (ready && !containers.some((container) => container.restartCount > 0)) continue
    if (++shown > 12 || sectionBytes < 150 || sectionLines < 3) { emit('Additional unhealthy pods omitted.'); break }
    let podBudget = 8 * 1024
    podBudget -= emit(`Pod ${name}: phase=${status.phase}, Ready=${Boolean(ready)}; reason=${status.reason ?? ''}; message=${status.message ?? ''}`, podBudget)
    for (const condition of (status.conditions ?? []).filter((condition) => condition.status !== 'True').slice(0, 8)) {
      podBudget -= emit(`  Condition ${condition.type}: ${condition.status}; reason=${condition.reason ?? ''}; message=${condition.message ?? ''}`, podBudget)
    }
    for (const container of containers.slice(0, 8)) {
      if (!/^[a-z0-9.-]+$/.test(container.name)) continue
      podBudget -= emit(`  Container ${container.name}: ready=${container.ready}, restarts=${container.restartCount ?? 0}`, podBudget)
      for (const [label, state] of [['current', container.state], ['previous', container.lastState]]) {
        for (const kind of ['waiting', 'terminated']) {
          if (state?.[kind]) podBudget -= emit(`    ${label} ${kind}: reason=${state[kind].reason ?? ''}; message=${state[kind].message ?? ''}; exitCode=${state[kind].exitCode ?? ''}`, podBudget)
        }
      }
    }
    if (containers.length > 8) podBudget -= emit('Additional container states omitted.', podBudget)
    logCandidates.push({ namespace, name, containers, podBudget })
  }
  if (!Array.isArray(pods)) emit('Pod status unavailable (bounded API/client read failed).')
  sectionBytes = Infinity
  sectionLines = Infinity
  emit(`>> Namespace ${namespace}: last 40 events sorted by time`)
  sectionBytes = 6 * 1024
  sectionLines = 40
  // Events contain no specs or Secret data; only select these safe fields for
  // output, even if an event references a Secret.
  if (!Array.isArray(events)) { emit('Events unavailable.'); continue }
  const time = (event) => event.lastTimestamp ?? event.series?.lastObservedTime ?? event.eventTime ?? event.metadata?.creationTimestamp ?? ''
  events.sort((a, b) => time(a).localeCompare(time(b)))
  for (const event of events.slice(-40)) {
    emit(`${time(event)} ${event.type ?? ''} ${event.involvedObject?.kind ?? ''}/${event.involvedObject?.name ?? ''} ${event.reason ?? ''}: ${event.message ?? ''}`, 150)
  }
}
// Emit every namespace's bounded status/event summary before logs. A verbose
// first pod must not hide another pod's scheduling or missing-Secret evidence.
for (const { namespace } of snapshots) {
  sectionBytes = Infinity
  sectionLines = Infinity
  emit(`>> Namespace ${namespace}: failing or restarting container logs`)
  sectionBytes = 12 * 1024
  sectionLines = 120
  for (const candidate of logCandidates.filter((pod) => pod.namespace === namespace)) {
    const { name, containers } = candidate
    let { podBudget } = candidate
    podBudget -= emit(`Pod ${name}: logs (shared 8 KiB status/log budget)`, podBudget)
    for (const container of containers.slice(0, 8)) {
      if (!/^[a-z0-9.-]+$/.test(container.name)) continue
      const failing = !container.ready || container.restartCount > 0 || container.state?.waiting || container.state?.terminated?.exitCode
      if (!failing) continue
      // Credential writers and OpenBao recovery workloads can echo generated
      // values unknown to this process. Do not retrieve their logs at all.
      if (namespace === 'secret-store' || /bootstrap|credential|keycloak|openbao|secret|auth-reconcile/i.test(`${name} ${container.name}`)) {
        podBudget -= emit('    Logs excluded for credential-handling workload.', podBudget)
        continue
      }
      for (const previous of [false, true]) {
        if (remainingLogs <= 0 || podBudget <= 0 || sectionBytes < 150 || sectionLines < 3 || remainingLines <= 0 || Date.now() >= deadline) break
        remainingLogs--
        podBudget -= emit(`    Logs ${name}/${container.name}${previous ? ' --previous' : ''} (last 75 lines):`, podBudget)
        const logs = kubectl(['logs', '-n', namespace, name, '-c', container.name, '--tail=75', '--limit-bytes=8192', ...(previous ? ['--previous'] : [])])
        if (logs === null) { podBudget -= emit('    Logs unavailable.', podBudget); continue }
        for (const line of logs.trimEnd().split('\n').slice(-75)) {
          if (sectionBytes < 150 || sectionLines < 3) break
          podBudget -= emit(line, podBudget)
        }
      }
    }
  }
}
