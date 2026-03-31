export interface PrivilegeDomainAssignment {
  memberId: string;
  workspaceId: string;
  tenantId: string;
  structural_admin: boolean;
  data_access: boolean;
  assignedAt: string;
  updatedAt: string;
}

export interface DenialRecord {
  id: string;
  tenantId: string;
  workspaceId: string | null;
  actorId: string;
  actorType: 'user' | 'api_key' | 'service_account' | 'anonymous';
  credentialDomain: 'structural_admin' | 'data_access' | 'none' | null;
  requiredDomain: 'structural_admin' | 'data_access';
  httpMethod: string;
  requestPath: string;
  sourceIp: string | null;
  correlationId: string;
  deniedAt: string;
}

export interface DenialsResponse {
  denials: DenialRecord[];
  total: number;
  limit: number;
  offset: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const payload = await response.json();
  if (!response.ok) throw payload;
  return payload;
}

export async function getPrivilegeDomainAssignment(workspaceId: string, memberId: string): Promise<PrivilegeDomainAssignment> {
  return request(`/api/workspaces/${workspaceId}/members/${memberId}/privilege-domains`);
}

export async function listPrivilegeDomainAssignments(workspaceId: string): Promise<PrivilegeDomainAssignment[]> {
  return request(`/api/workspaces/${workspaceId}/members/privilege-domains`);
}

export async function updatePrivilegeDomainAssignment(workspaceId: string, memberId: string, assignment: Pick<PrivilegeDomainAssignment, 'structural_admin' | 'data_access'>): Promise<PrivilegeDomainAssignment> {
  return request(`/api/workspaces/${workspaceId}/members/${memberId}/privilege-domains`, { method: 'PUT', body: JSON.stringify(assignment) });
}

export async function queryPrivilegeDomainDenials(params: { tenantId?: string; workspaceId?: string; requiredDomain?: string; actorId?: string; from?: string; to?: string; limit?: number; offset?: number }): Promise<DenialsResponse> {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  return request(`/api/security/privilege-domains/denials?${search.toString()}`);
}
