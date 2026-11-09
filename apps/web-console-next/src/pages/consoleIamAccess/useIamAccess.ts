import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addIamUserToGroup, assignIamUserRoles, removeIamUserFromGroup, removeIamUserRoles } from '@in-falcone/console-api/clients'
import {
  createIamGroup, createIamRole, createIamUser, deleteIamUser, listAllIamRealmUsers, listIamRealmGroups, listIamRealmRoles,
  listIamUserGroups, listIamUserRoles, setIamUserStatus, type IamCreateUserInput,
} from '@in-falcone/console-api/iam'
import { USERS_PAGE_SIZE, errorKey, failureOf, normalize, userIdOf, type Failure, type IamGroup, type IamRole, type IamUser } from './api'

export interface Catalog { users: IamUser[]; roles: IamRole[]; groups: IamGroup[]; total: number }
export interface DetailState { userId: string; status: 'loading' | 'ready' | 'error' | 'not-found'; roles: IamRole[]; groups: IamGroup[]; failure: Failure | null }
export type Notify = (key: string, values?: Record<string, string>) => void
export type ConfirmRequest =
  | { kind: 'deleteUser'; user: IamUser }
  | { kind: 'removeRole'; userId: string; username: string; roleName: string }
  | { kind: 'removeGroup'; userId: string; username: string; group: IamGroup }
export interface ConfirmState { request: ConfirmRequest; open: boolean; pending: boolean; error: string | null; opener: HTMLElement | null; successFocus: string | null }
interface LoadOptions { preserveSelection: boolean; preferredUserId?: string | null; focusKey?: string; success?: { key: string; values?: Record<string, string> } }

const focusWindowMs = 2000
const statusKey = (status: number | undefined) => (status === 401 ? 'confirm.errors.401' : status === 404 ? 'confirm.errors.404' : null)

// Looks a focus target up by its legacy key. Disabled controls cannot take focus, so the request waits for the next render.
export function findFocusTarget(key: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-focus-key]')).find((element) => element.dataset.focusKey === key) ?? null
}

export function useIamAccess(realm: string, notify: Notify) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailure, setLoadFailure] = useState<Failure | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [search, setSearchValue] = useState('')
  const [page, setPage] = useState(1)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ key: string; expires: number } | null>(null)
  const mounted = useRef(true)
  const catalogSeq = useRef(0)
  const detailSeq = useRef(0)
  const selectedRef = useRef<string | null>(null)
  const notifyRef = useRef(notify)
  notifyRef.current = notify
  selectedRef.current = selectedUserId

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const restoreFocus = useCallback((key: string | null | undefined) => {
    if (key) setFocusRequest({ key, expires: Date.now() + focusWindowMs })
  }, [])
  // Runs after every commit: the control may only become focusable once the mutation lock is released.
  useEffect(() => {
    if (!focusRequest) return
    if (Date.now() > focusRequest.expires) { setFocusRequest(null); return }
    const target = findFocusTarget(focusRequest.key)
    if (!target || (target as HTMLButtonElement).disabled || target.getAttribute('aria-disabled') === 'true') return
    target.focus()
    setFocusRequest(null)
  })

  const loadCatalog = useCallback(async (options: LoadOptions) => {
    const sequence = ++catalogSeq.current
    setLoading(true)
    setLoadFailure(null)
    setMutationError(null)
    if (!options.preserveSelection) { setSelectedUserId(null); detailSeq.current += 1; setDetail(null) }
    try {
      const [users, roles, groups] = await Promise.all([listAllIamRealmUsers(realm), listIamRealmRoles(realm), listIamRealmGroups(realm)])
      if (!mounted.current || sequence !== catalogSeq.current) return
      const next: Catalog = { users: users.items, roles: roles.items ?? [], groups: groups.items ?? [], total: users.total }
      setCatalog(next)
      const preferred = options.preferredUserId
      const known = (id: string | null | undefined) => Boolean(id) && next.users.some((user) => userIdOf(user) === id)
      const kept = options.preserveSelection && known(selectedRef.current) ? selectedRef.current : null
      const target = known(preferred) ? preferred! : kept
      if (!target && selectedRef.current) { detailSeq.current += 1; setDetail(null) }
      setSelectedUserId(target)
      if (known(preferred)) {
        // A created user is revealed even when a search or another page would hide its row.
        setSearchValue('')
        setPage(Math.floor(next.users.findIndex((user) => userIdOf(user) === preferred) / USERS_PAGE_SIZE) + 1)
      } else setPage((current) => Math.min(current, Math.max(1, Math.ceil(next.users.length / USERS_PAGE_SIZE))))
      if (options.success) notifyRef.current(options.success.key, options.success.values)
      restoreFocus(options.focusKey)
    } catch (cause) {
      if (mounted.current && sequence === catalogSeq.current) {
        // A failed load discards the previous collection so a retry never shows it as fresh; the selection id is kept separately.
        setCatalog(null)
        setLoadFailure(failureOf(cause))
      }
    } finally {
      if (mounted.current && sequence === catalogSeq.current) setLoading(false)
    }
  }, [realm, restoreFocus])

  // `silent` keeps the current roles and groups on screen while a membership change is re-read.
  const loadDetail = useCallback(async (userId: string, options: { silent?: boolean; focusKey?: string; success?: { key: string; values?: Record<string, string> } } = {}) => {
    const sequence = ++detailSeq.current
    setDetail((current) => (options.silent && current?.userId === userId && current.status === 'ready' ? current : { userId, status: 'loading', roles: [], groups: [], failure: null }))
    try {
      const [roles, groups] = await Promise.all([listIamUserRoles(realm, userId), listIamUserGroups(realm, userId)])
      if (!mounted.current || sequence !== detailSeq.current) return
      setDetail({ userId, status: 'ready', roles: roles.items ?? [], groups: groups.items ?? [], failure: null })
      if (options.success) notifyRef.current(options.success.key, options.success.values)
      restoreFocus(options.focusKey)
    } catch (cause) {
      if (!mounted.current || sequence !== detailSeq.current) return
      const failure = failureOf(cause)
      setDetail({ userId, status: failure.status === 404 ? 'not-found' : 'error', roles: [], groups: [], failure })
    }
  }, [realm, restoreFocus])

  // The load is deferred one microtask so a StrictMode remount cancels the first run before it sends a request.
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active) void loadCatalog({ preserveSelection: false }) })
    return () => { active = false }
  }, [loadCatalog])
  useEffect(() => {
    if (!selectedUserId) { detailSeq.current += 1; setDetail(null); return }
    let active = true
    void Promise.resolve().then(() => { if (active) void loadDetail(selectedUserId) })
    return () => { active = false }
  }, [selectedUserId, loadDetail])

  const filteredUsers = useMemo(() => {
    const users = catalog?.users ?? []
    const query = normalize(search)
    if (!query) return users
    return users.filter((user) => normalize(user.username).includes(query) || normalize(user.email).includes(query) || normalize(userIdOf(user)).includes(query))
  }, [catalog, search])
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pagedUsers = filteredUsers.slice((currentPage - 1) * USERS_PAGE_SIZE, currentPage * USERS_PAGE_SIZE)
  const selectedUser = catalog?.users.find((user) => userIdOf(user) === selectedUserId) ?? null

  const setSearch = useCallback((value: string) => { setSearchValue(value); setPage(1) }, [])
  const clearSearch = useCallback(() => { setSearchValue(''); setPage(1); restoreFocus('users-search') }, [restoreFocus])
  const selectUser = useCallback((userId: string) => { if (selectedRef.current !== userId) { selectedRef.current = userId; setMutationError(null); setSelectedUserId(userId) } }, [])
  const clearSelection = useCallback(() => { setSelectedUserId(null); restoreFocus('users-search') }, [restoreFocus])
  const reload = useCallback(() => loadCatalog({ preserveSelection: true, focusKey: 'users-search' }), [loadCatalog])
  const retryDetail = useCallback(() => { if (selectedRef.current) void loadDetail(selectedRef.current) }, [loadDetail])

  // Every write holds the lock until its refresh settles; a failure is shown inline and may be rethrown to a dialog.
  async function mutate(run: () => Promise<void>, fail: { fallback: string; focusKey?: string; rethrow?: boolean }) {
    setBusy(true)
    setMutationError(null)
    try { await run() }
    catch (cause) {
      if (fail.rethrow) throw cause
      if (mounted.current) { setMutationError(errorKey(failureOf(cause), fail.fallback)); restoreFocus(fail.focusKey) }
    } finally { if (mounted.current) setBusy(false) }
  }

  // Resolves true once the POST succeeded, so the form can clear its values; the reload outcome is shown by the catalogue.
  async function createUser(input: IamCreateUserInput): Promise<boolean> {
    const username = input.username.trim()
    if (!username) return false
    let created = false
    await mutate(async () => {
      const response = await createIamUser(realm, { username, email: input.email?.trim() || undefined, temporaryPassword: input.temporaryPassword?.trim() || undefined, role: input.role?.trim() || undefined })
      created = true
      const id = response?.userId ?? response?.id ?? null
      await loadCatalog({ preserveSelection: false, preferredUserId: id, focusKey: id ? `user-row-${id}` : 'create-user-username', success: { key: 'success.userCreated' } })
    }, { fallback: 'createUser', focusKey: 'create-user-username' })
    return created
  }
  async function createRole(input: string): Promise<boolean> {
    const name = input.trim()
    if (!name) return false
    let created = false
    await mutate(async () => {
      await createIamRole(realm, name)
      created = true
      await loadCatalog({ preserveSelection: true, focusKey: 'create-role-name', success: { key: 'success.roleCreated', values: { name } } })
    }, { fallback: 'createRole', focusKey: 'create-role-name' })
    return created
  }
  async function createGroup(input: string): Promise<boolean> {
    const name = input.trim()
    if (!name) return false
    let created = false
    await mutate(async () => {
      await createIamGroup(realm, name)
      created = true
      await loadCatalog({ preserveSelection: true, focusKey: 'create-group-name', success: { key: 'success.groupCreated', values: { name } } })
    }, { fallback: 'createGroup', focusKey: 'create-group-name' })
    return created
  }
  function setStatus(user: IamUser, enabled: boolean, focusKey: string) {
    return mutate(async () => {
      await setIamUserStatus(realm, userIdOf(user), enabled)
      await loadCatalog({ preserveSelection: true, focusKey, success: { key: enabled ? 'success.enabled' : 'success.suspended' } })
    }, { fallback: 'status', focusKey })
  }

  // Memberships re-read the user's roles and groups only while that user is still selected.
  function membership(run: () => Promise<unknown>, focusKey: string, success: { key: string; values: Record<string, string> }) {
    const userId = selectedRef.current
    if (!userId) return Promise.resolve()
    return mutate(async () => {
      await run()
      if (mounted.current && selectedRef.current === userId) await loadDetail(userId, { silent: true, focusKey, success })
    }, { fallback: 'membership', focusKey })
  }
  function assignRole(roleName: string) {
    const userId = selectedRef.current
    if (!roleName || !userId) return Promise.resolve()
    return membership(() => assignIamUserRoles(realm, userId, [roleName]), 'assign-role', { key: 'success.roleAssigned', values: { name: roleName } })
  }
  function addGroup(group: IamGroup) {
    const userId = selectedRef.current
    if (!userId) return Promise.resolve()
    return membership(() => addIamUserToGroup(realm, userId, group.id), 'assign-group', { key: 'success.groupAdded', values: { name: group.name } })
  }

  // The opener comes from the click itself: some browsers do not focus a button when it is clicked.
  const openConfirm = useCallback((request: ConfirmRequest, opener: HTMLElement | null) => {
    setConfirm({ request, open: true, pending: false, error: null, opener: opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null), successFocus: null })
  }, [])
  const closeConfirm = useCallback(() => { setConfirm((current) => (current && !current.pending ? { ...current, open: false } : current)) }, [])
  const dropConfirm = useCallback(() => { setConfirm((current) => (current && !current.open ? null : current)) }, [])

  async function submitConfirm() {
    const current = confirm
    if (!current || !current.open || current.pending) return
    const { request } = current
    setConfirm({ ...current, pending: true, error: null })
    try {
      let successFocus = 'users-search'
      if (request.kind === 'deleteUser') {
        await mutate(async () => {
          await deleteIamUser(realm, userIdOf(request.user))
          await loadCatalog({ preserveSelection: false, focusKey: 'users-search', success: { key: 'success.deleted' } })
        }, { fallback: 'delete', rethrow: true })
      } else if (request.kind === 'removeRole') {
        successFocus = 'assign-role'
        await mutate(async () => {
          await removeIamUserRoles(realm, request.userId, [request.roleName])
          if (selectedRef.current === request.userId) await loadDetail(request.userId, { silent: true, focusKey: 'assign-role', success: { key: 'success.roleRemoved', values: { name: request.roleName } } })
        }, { fallback: 'membership', rethrow: true })
      } else {
        successFocus = 'assign-group'
        await mutate(async () => {
          await removeIamUserFromGroup(realm, request.userId, request.group.id)
          if (selectedRef.current === request.userId) await loadDetail(request.userId, { silent: true, focusKey: 'assign-group', success: { key: 'success.groupRemoved', values: { name: request.group.name } } })
        }, { fallback: 'membership', rethrow: true })
      }
      if (mounted.current) setConfirm((latest) => (latest ? { ...latest, open: false, pending: false, successFocus } : latest))
    } catch (cause) {
      if (!mounted.current) return
      const failure = failureOf(cause)
      const fixed = statusKey(failure.status)
      const key = fixed ?? errorKey({ status: failure.status }, 'confirm')
      setConfirm((latest) => (latest ? { ...latest, pending: false, error: key } : latest))
    }
  }

  return {
    catalog, loading, loadFailure, busy, mutationError, search, filteredUsers, pagedUsers, pageCount, currentPage, selectedUser, selectedUserId, detail, confirm,
    setSearch, clearSearch, setPage, selectUser, clearSelection, reload, retryDetail, restoreFocus,
    createUser, createRole, createGroup, setStatus, assignRole, addGroup, openConfirm, closeConfirm, dropConfirm, submitConfirm,
  }
}
