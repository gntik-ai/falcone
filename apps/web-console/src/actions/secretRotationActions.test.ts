import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getConsumerStatus, initiateRotation, listRotationHistory, revokeSecretVersion } from './secretRotationActions'

const request = vi.hoisted(() => vi.fn().mockResolvedValue({}))
vi.mock('@in-falcone/console-api/session', () => ({ requestConsoleSessionJson: request }))

beforeEach(() => request.mockClear())

describe('authenticated secret rotation actions', () => {
  for (const [path, domain, name] of [['platform/app-password', 'platform', 'app-password'], ['tenant/t1/db-password', 'tenant', 'db-password']]) {
    it(`uses URL identity without sending tenant or secretPath for ${path}`, async () => {
      const base = `/v1/platform/secrets/${domain}/${name}`
      await initiateRotation(path, { newValue: 'fixture-value', gracePeriodSeconds: 1800, justification: 'fixture' })
      expect(request).toHaveBeenLastCalledWith(`${base}/rotate`, { method: 'POST', body: { newValue: 'fixture-value', gracePeriodSeconds: 1800, justification: 'fixture' } })
      await revokeSecretVersion(path, 1, { justification: 'fixture', forceRevoke: true })
      expect(request).toHaveBeenLastCalledWith(`${base}/versions/1/revoke`, { method: 'POST', body: { justification: 'fixture', forceRevoke: true } })
      await listRotationHistory(path, { limit: 2, offset: 1 })
      expect(request).toHaveBeenLastCalledWith(`${base}/history?limit=2&offset=1`)
      await getConsumerStatus(path, 2)
      expect(request).toHaveBeenLastCalledWith(`${base}/consumer-status?vaultVersion=2`)
      await getConsumerStatus(path)
      expect(request).toHaveBeenLastCalledWith(`${base}/consumer-status`)
    })
  }
  for (const path of ['platform/postgresql/app-password', 'platform/app password', 'tenant/x', 'unknown/x', 'tenant//db-password', 'platform/.hidden']) {
    it(`rejects ${path} before a request`, async () => {
      await expect(initiateRotation(path, { newValue: 'fixture', gracePeriodSeconds: 1800, justification: '' })).rejects.toThrow('INVALID_SECRET_PATH')
      await expect(revokeSecretVersion(path, 1, { justification: '' })).rejects.toThrow('INVALID_SECRET_PATH')
      await expect(listRotationHistory(path, {})).rejects.toThrow('INVALID_SECRET_PATH')
      await expect(getConsumerStatus(path)).rejects.toThrow('INVALID_SECRET_PATH')
      expect(request).not.toHaveBeenCalled()
    })
  }
})
