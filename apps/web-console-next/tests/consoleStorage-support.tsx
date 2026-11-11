import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import ConsoleStoragePage from '../src/pages/consoleStorage'
import { strictFetch, login } from './shell-support'
import { bucket, bucketsPath, createPath, deletePath, endpoints, exportPath, manifestBody, metadataPath, mockBuckets, mockObjectMetadata, mockObjects, mockUsage, nextPath, objectsPath, page2, presignPath, presigned, uploadPath, usagePath } from './parity/pages/console-storage-page.manifest'

// A failed DOM query must not print the rendered presigned result.
process.env.DEBUG_PRINT_LIMIT = '0'
const context = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
export const setContext = (patch: Record<string, unknown> = {}) => { context.value = { activeTenantId: 'synthetic-tenant', activeWorkspaceId: 'synthetic-workspace', tenants: [], workspaces: [], selectWorkspace: vi.fn(), loading: false, error: null, ...patch } }
export function setup(extra: Record<string, unknown> = {}) {
  login(['tenant_viewer'], ['synthetic-tenant']); setContext()
  return strictFetch({ [`GET ${bucketsPath}`]: mockBuckets(), [`GET ${usagePath}`]: mockUsage(), [`GET ${objectsPath}`]: mockObjects(), [`GET ${nextPath}`]: page2, [`GET ${metadataPath}`]: mockObjectMetadata(), [`POST ${presignPath}`]: presigned, [`POST ${createPath}`]: { bucket }, [`PUT ${uploadPath}`]: { objectKey: 'hello.txt', sizeBytes: 5 }, [`POST ${exportPath}`]: manifestBody, [`DELETE ${deletePath}`]: {}, ...extra })
}
export const element = () => <MemoryRouter><ConsoleStoragePage /></MemoryRouter>
export const open = () => render(element())
export const click = (name: string | RegExp, scope: HTMLElement = document.body) => fireEvent.click(within(scope).getByRole('button', { name }))
export const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
export const ready = async () => { await screen.findByRole('button', { name: 'media-assets' }) }
export const selectBucket = async () => { await ready(); click('media-assets'); await screen.findByRole('button', { name: 'media/hero.png' }) }
export const selectObject = async () => { await selectBucket(); click('media/hero.png'); await screen.findByText('abcdef1234567890abcdef1234567890') }
export const create = (name = 'media') => { click('Nuevo bucket'); set('Nombre del bucket (opcional)', name); click('Crear') }
export const upload = () => { click('Subir objeto'); fireEvent.change(screen.getByLabelText('Archivo'), { target: { files: [new File(['hello'], 'hello.txt')] } }); click('Subir') }
export const remove = () => { click('Eliminar media-assets'); set('Escribe exactamente el nombre del bucket para confirmar.', bucket.bucketName); click('Eliminar', screen.getByRole('alertdialog')) }
export const fail = (status: number) => () => Response.json({ status, requestId: 'req_synthetic_storage', code: `HTTP_${status}` }, { status })
