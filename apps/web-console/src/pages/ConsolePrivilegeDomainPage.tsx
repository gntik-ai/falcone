import React, { useEffect, useState } from 'react';
import { getPrivilegeDomainAssignment, updatePrivilegeDomainAssignment, type PrivilegeDomainAssignment } from '../services/privilege-domain-api';

type Props = { workspaceId: string; memberId: string; memberName?: string };

export default function ConsolePrivilegeDomainPage({ workspaceId, memberId, memberName = 'member' }: Props) {
  const [assignment, setAssignment] = useState<PrivilegeDomainAssignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | 'structural_admin' | 'data_access'>(null);

  useEffect(() => {
    let active = true;
    getPrivilegeDomainAssignment(workspaceId, memberId)
      .then((data) => { if (active) setAssignment(data); })
      .catch((err) => { if (active) setError(err?.message ?? 'Failed to load'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, memberId]);

  async function applyUpdate(next: Pick<PrivilegeDomainAssignment, 'structural_admin' | 'data_access'>) {
    try {
      setError(null);
      const updated = await updatePrivilegeDomainAssignment(workspaceId, memberId, next);
      setAssignment(updated);
      setConfirming(null);
    } catch (err: any) {
      setError(err?.error === 'LAST_STRUCTURAL_ADMIN'
        ? 'This member is the only Structural Admin. Assign another Structural Admin before revoking this privilege.'
        : (err?.message ?? 'Failed to update privilege domains'));
      setConfirming(null);
    }
  }

  if (loading) return <div data-testid="loading-skeleton">Loading privilege domains…</div>;
  if (error && !assignment) return <div role="alert">{error}</div>;
  if (!assignment) return <div role="alert">Assignment not found.</div>;

  const lastAdminGuard = assignment.structural_admin && error?.includes('only Structural Admin');

  return (
    <div>
      <h1>Privilege Domains</h1>
      {error ? <div role="alert">{error}</div> : null}
      <section>
        <h2>Structural Administration</h2>
        <p>Manage resource lifecycle, configuration, schema and deployment.</p>
        <button
          title={lastAdminGuard ? 'This member is the only Structural Admin. Assign another Structural Admin before revoking this privilege.' : 'Toggle structural admin'}
          disabled={lastAdminGuard}
          onClick={() => assignment.structural_admin ? setConfirming('structural_admin') : applyUpdate({ structural_admin: true, data_access: assignment.data_access })}
        >
          {assignment.structural_admin ? 'Revoke Structural Administration' : 'Grant Structural Administration'}
        </button>
      </section>
      <section>
        <h2>Data Access</h2>
        <p>Manage read, write, query and delete privileges for tenant data.</p>
        <button onClick={() => assignment.data_access ? setConfirming('data_access') : applyUpdate({ structural_admin: assignment.structural_admin, data_access: true })}>
          {assignment.data_access ? 'Revoke Data Access' : 'Grant Data Access'}
        </button>
      </section>
      {confirming ? (
        <div role="dialog" aria-modal="true">
          <p>Are you sure you want to revoke {confirming} privileges for {memberName}?</p>
          <button onClick={() => setConfirming(null)}>Cancel</button>
          <button onClick={() => applyUpdate({
            structural_admin: confirming === 'structural_admin' ? false : assignment.structural_admin,
            data_access: confirming === 'data_access' ? false : assignment.data_access
          })}>Confirm</button>
        </div>
      ) : null}
    </div>
  );
}
