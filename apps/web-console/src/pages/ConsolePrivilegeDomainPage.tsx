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
      .catch((err) => { if (active) setError(err?.message ?? 'No se pudo cargar'); })
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
        ? 'Este miembro es el único administrador estructural. Asigna otro administrador estructural antes de revocar este privilegio.'
        : (err?.message ?? 'No se pudieron actualizar los dominios de privilegio'));
      setConfirming(null);
    }
  }

  if (loading) return <div data-testid="loading-skeleton">Cargando dominios de privilegio…</div>;
  if (error && !assignment) return <div role="alert">{error}</div>;
  if (!assignment) return <div role="alert">Asignación no encontrada.</div>;

  const lastAdminGuard = assignment.structural_admin && error?.includes('único administrador estructural');

  return (
    <div>
      <h1>Dominios de privilegio</h1>
      {error ? <div role="alert">{error}</div> : null}
      <section>
        <h2>Administración estructural</h2>
        <p>Gestiona ciclo de vida, configuración, esquema y despliegue de recursos.</p>
        <button
          title={lastAdminGuard ? 'Este miembro es el único administrador estructural. Asigna otro administrador estructural antes de revocar este privilegio.' : 'Alternar administración estructural'}
          disabled={lastAdminGuard}
          onClick={() => assignment.structural_admin ? setConfirming('structural_admin') : applyUpdate({ structural_admin: true, data_access: assignment.data_access })}
        >
          {assignment.structural_admin ? 'Revocar administración estructural' : 'Conceder administración estructural'}
        </button>
      </section>
      <section>
        <h2>Acceso a datos</h2>
        <p>Gestiona privilegios de lectura, escritura, consulta y eliminación para datos de la organización.</p>
        <button onClick={() => assignment.data_access ? setConfirming('data_access') : applyUpdate({ structural_admin: assignment.structural_admin, data_access: true })}>
          {assignment.data_access ? 'Revocar acceso a datos' : 'Conceder acceso a datos'}
        </button>
      </section>
      {confirming ? (
        <div role="dialog" aria-modal="true">
          <p>¿Seguro que quieres revocar los privilegios de {confirming === 'structural_admin' ? 'administración estructural' : 'acceso a datos'} para {memberName}?</p>
          <button onClick={() => setConfirming(null)}>Cancelar</button>
          <button onClick={() => applyUpdate({
            structural_admin: confirming === 'structural_admin' ? false : assignment.structural_admin,
            data_access: confirming === 'data_access' ? false : assignment.data_access
          })}>Confirmar</button>
        </div>
      ) : null}
    </div>
  );
}
