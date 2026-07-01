import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import ConsolePrivilegeDomainPage from './ConsolePrivilegeDomainPage';
import * as api from '../services/privilege-domain-api';

vi.mock('../services/privilege-domain-api');

const assignment = {
  memberId: 'member-1',
  workspaceId: 'ws-1',
  tenantId: 'tenant-1',
  structural_admin: true,
  data_access: true,
  assignedAt: '2026-03-31T00:00:00Z',
  updatedAt: '2026-03-31T00:00:00Z'
};

afterEach(() => {
  cleanup();
});

describe('ConsolePrivilegeDomainPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.getPrivilegeDomainAssignment).mockResolvedValue(assignment as any);
    vi.mocked(api.updatePrivilegeDomainAssignment).mockResolvedValue(assignment as any);
  });

  it('renders two separate sections', async () => {
    render(<ConsolePrivilegeDomainPage workspaceId="ws-1" memberId="member-1" />);
    expect(screen.getByTestId('loading-skeleton')).toBeTruthy();
    await screen.findByText('Administración estructural');
    expect(screen.getByText('Acceso a datos')).toBeTruthy();
  });

  it('toggle calls update with correct payload', async () => {
    render(<ConsolePrivilegeDomainPage workspaceId="ws-1" memberId="member-1" />);
    await screen.findByText('Administración estructural');
    fireEvent.click(screen.getByText('Revocar acceso a datos'));
    fireEvent.click(screen.getByText('Confirmar'));
    await waitFor(() => expect(api.updatePrivilegeDomainAssignment).toHaveBeenCalledWith('ws-1', 'member-1', { structural_admin: true, data_access: false }));
  });

  it('shows confirmation dialog before revocation', async () => {
    render(<ConsolePrivilegeDomainPage workspaceId="ws-1" memberId="member-1" memberName="Alice" />);
    await screen.findByText('Administración estructural');
    fireEvent.click(screen.getByText('Revocar administración estructural'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Alice/)).toBeTruthy();
  });

  it('last-admin guard shows error alert on API failure', async () => {
    vi.mocked(api.updatePrivilegeDomainAssignment).mockRejectedValue({ error: 'LAST_STRUCTURAL_ADMIN' });
    render(<ConsolePrivilegeDomainPage workspaceId="ws-1" memberId="member-1" />);
    await screen.findByText('Administración estructural');
    fireEvent.click(screen.getByText('Revocar administración estructural'));
    fireEvent.click(screen.getByText('Confirmar'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('loading skeleton visible while request in flight', () => {
    vi.mocked(api.getPrivilegeDomainAssignment).mockReturnValue(new Promise(() => {}) as any);
    render(<ConsolePrivilegeDomainPage workspaceId="ws-1" memberId="member-1" />);
    expect(screen.getByTestId('loading-skeleton')).toBeTruthy();
  });
});
