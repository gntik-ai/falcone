# Tasks — US-BKP-01-T04: Confirmaciones reforzadas y prechecks antes de restauraciones destructivas

| Campo            | Valor                                               |
|------------------|-----------------------------------------------------|
| **Task ID**      | US-BKP-01-T04                                       |
| **Spec**         | `specs/112-backup-restore-confirmations/spec.md`    |
| **Plan**         | `specs/112-backup-restore-confirmations/plan.md`    |
| **Rama**         | `112-backup-restore-confirmations`                  |
| **Generado**     | 2026-04-01                                          |

---

## Reglas de lectura para el agente de implementación

> ⚠️ **OBLIGATORIO**: El agente que implemente estas tareas **solo debe leer** los archivos explícitamente referenciados en cada tarea o en este documento. **Está prohibido** navegar el repositorio libremente, leer OpenAPI specs completos o leer archivos no mencionados aquí.
>
> Archivos de referencia global autorizados (leer solo cuando se indique):
> - `specs/112-backup-restore-confirmations/spec.md`
> - `specs/112-backup-restore-confirmations/plan.md`
> - `services/backup-status/package.json` (solo para verificar dependencias disponibles)
> - `services/backup-status/src/db/migrations/003_*.sql` (solo para entender la estructura existente del ENUM `backup_audit_event_type`)
> - `services/backup-status/src/audit/audit-trail.ts` (solo para entender la firma de `emitAuditEvent`)
> - `services/backup-status/src/operations/trigger-restore.action.ts` (solo en TASK-06 y TASK-07)
> - `apps/web-console/src/hooks/useTriggerRestore.ts` (solo en TASK-10)
> - `apps/web-console/src/services/backupOperationsApi.ts` (solo en TASK-09)
> - `apps/web-console/src/components/backup/BackupStatusDetail.tsx` (solo en TASK-11)

---

## TASK-01 — Migración de base de datos: tabla `restore_confirmation_requests` y nuevos tipos de auditoría

**Dependencias:** ninguna

**Archivos a crear:**
- `services/backup-status/src/db/migrations/004_restore_confirmations.sql`

**Archivos a leer antes de implementar:**
- `services/backup-status/src/db/migrations/003_*.sql` (para entender el ENUM existente `backup_audit_event_type` y el estilo de migraciones del proyecto)
- `specs/112-backup-restore-confirmations/plan.md` — sección 2 (Migración de base de datos)

**Qué hacer:**

Crear el archivo `services/backup-status/src/db/migrations/004_restore_confirmations.sql` con el contenido exacto definido en `plan.md` sección 2. El archivo debe:

1. Añadir al ENUM `backup_audit_event_type` los cuatro nuevos valores con `ALTER TYPE ... ADD VALUE IF NOT EXISTS`:
   - `'restore.confirmation_pending'`
   - `'restore.confirmed'`
   - `'restore.aborted'`
   - `'restore.confirmation_expired'`

2. Crear los tres nuevos tipos ENUM:
   - `restore_confirmation_status` con valores: `'pending_confirmation'`, `'confirmed'`, `'aborted'`, `'expired'`, `'rejected'`
   - `restore_risk_level` con valores: `'normal'`, `'elevated'`, `'critical'`
   - `restore_confirmation_decision` con valores: `'confirmed'`, `'aborted'`, `'expired'`

3. Crear la tabla `restore_confirmation_requests` con todas las columnas especificadas en `plan.md` sección 2 (incluyendo `id`, `token_hash`, `tenant_id`, `component_type`, `instance_id`, `snapshot_id`, `requester_id`, `requester_role`, `scope`, `risk_level`, `status`, `prechecks_result`, `warnings_shown`, `available_second_factors`, `decision`, `decision_at`, `second_factor_type`, `second_actor_id`, `operation_id`, `expires_at`, `created_at`).

4. Crear los cuatro índices: `idx_rcr_token_hash`, `idx_rcr_tenant_pending`, `idx_rcr_requester`, `idx_rcr_expires_pending`.

5. Incluir al final el bloque de rollback comentado tal como aparece en `plan.md` sección 9.2.

**Criterios de aceptación referenciados:** CA-02, CA-07, CA-09
**No hacer:** no ejecutar la migración; no modificar otros archivos.

---

## TASK-02 — Tipos TypeScript del módulo de confirmaciones

**Dependencias:** TASK-01 (los tipos reflejan el esquema de DB)

**Archivos a crear:**
- `services/backup-status/src/confirmations/confirmations.types.ts`
- `services/backup-status/src/confirmations/prechecks/precheck.types.ts`

**Archivos a leer antes de implementar:**
- `specs/112-backup-restore-confirmations/plan.md` — secciones 1, 3 y 4 (estructura de módulos y contrato de API)
- `specs/112-backup-restore-confirmations/spec.md` — sección 4 (RFs) y sección 6 (CAs)

**Qué hacer:**

**`confirmations.types.ts`** — Definir y exportar los siguientes tipos TypeScript:

```typescript
// Nivel de riesgo
export type RiskLevel = 'normal' | 'elevated' | 'critical';

// Estado de la solicitud de confirmación
export type ConfirmationStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'aborted'
  | 'expired'
  | 'rejected';

// Decisión del actor
export type ConfirmationDecision = 'confirmed' | 'aborted' | 'expired';

// Alcance del restore
export type RestoreScope = 'partial' | 'full';

// Segundo factor disponible
export type SecondFactorType = 'otp' | 'second_actor';

// Registro de solicitud de confirmación (representa una fila de restore_confirmation_requests)
export interface ConfirmationRequest {
  id: string;
  tokenHash: string;
  tenantId: string;
  componentType: string;
  instanceId: string;
  snapshotId: string;
  requesterId: string;
  requesterRole: string;
  scope: RestoreScope;
  riskLevel: RiskLevel;
  status: ConfirmationStatus;
  prechecksResult: PrecheckResult[];          // importado de precheck.types.ts
  warningsShown: string[];
  availableSecondFactors: SecondFactorType[];
  decision?: ConfirmationDecision;
  decisionAt?: Date;
  secondFactorType?: SecondFactorType;
  secondActorId?: string;
  operationId?: string;
  expiresAt: Date;
  createdAt: Date;
}

// Datos de destino del restore (para presentar al actor)
export interface RestoreTarget {
  tenantId: string;
  tenantName: string;
  componentType: string;
  instanceId: string;
  snapshotId: string;
  snapshotCreatedAt: Date;
  snapshotAgeHours: number;
}

// Respuesta del Paso 1 (initiate)
export interface InitiateRestoreResponse {
  schemaVersion: '2';
  confirmationToken: string;
  confirmationRequestId: string;
  expiresAt: Date;
  ttlSeconds: number;
  riskLevel: RiskLevel;
  availableSecondFactors: SecondFactorType[];
  prechecks: PrecheckResult[];
  warnings: string[];
  target: RestoreTarget;
}

// Body para confirmar (Paso 2)
export interface ConfirmRestoreBody {
  confirmationToken: string;
  confirmed: boolean;
  tenantNameConfirmation?: string;
  acknowledgeWarnings?: boolean;
  secondFactorType?: SecondFactorType;
  otpCode?: string;
  secondActorToken?: string;
}
```

**`precheck.types.ts`** — Definir y exportar:

```typescript
export type PrecheckResultStatus = 'ok' | 'warning' | 'blocking_error';

export type PrecheckCode =
  | 'active_restore_check'
  | 'snapshot_exists_check'
  | 'snapshot_age_check'
  | 'newer_snapshots_check'
  | 'active_connections_check'
  | 'operational_hours_check'
  | 'precheck_timeout';

export interface PrecheckResult {
  code: PrecheckCode | string;
  result: PrecheckResultStatus;
  message: string;
  metadata?: Record<string, unknown>;
}

// Función de precheck: firma estándar
export type PrecheckFn = (ctx: PrecheckContext) => Promise<PrecheckResult>;

export interface PrecheckContext {
  tenantId: string;
  componentType: string;
  instanceId: string;
  snapshotId: string;
  scope: RestoreScope;   // importado de confirmations.types.ts
  requestedAt: Date;
}
```

**Criterios de aceptación referenciados:** CA-01 a CA-12 (los tipos sustentan toda la implementación)
**No hacer:** no implementar lógica; solo tipos e interfaces.

---

## TASK-03 — Prechecks individuales y orquestador de prechecks

**Dependencias:** TASK-02

**Archivos a crear:**
- `services/backup-status/src/confirmations/prechecks/active-restore.precheck.ts`
- `services/backup-status/src/confirmations/prechecks/snapshot-exists.precheck.ts`
- `services/backup-status/src/confirmations/prechecks/snapshot-age.precheck.ts`
- `services/backup-status/src/confirmations/prechecks/newer-snapshots.precheck.ts`
- `services/backup-status/src/confirmations/prechecks/active-connections.precheck.ts`
- `services/backup-status/src/confirmations/prechecks/operational-hours.precheck.ts`
- `services/backup-status/src/confirmations/prechecks/index.ts`

**Archivos a leer antes de implementar:**
- `specs/112-backup-restore-confirmations/plan.md` — secciones 1.3, 5.1 (variables de entorno) y 3 (estructura de módulos)
- `specs/112-backup-restore-confirmations/spec.md` — sección 3 (reglas de negocio RN-02, RN-07) y sección 4 (RF-T04-01)

**Qué hacer:**

Cada precheck individual exporta una función con la firma `PrecheckFn` definida en TASK-02. Todos los mensajes descriptivos deben estar en español.

**`active-restore.precheck.ts`**
- Consulta la tabla `backup_operations` (o `restore_confirmation_requests` según el modelo existente de T02) para verificar si hay una operación de restore activa (estado `in_progress` o similar) para el mismo `tenantId + componentType + instanceId`.
- Retorna `blocking_error` con código `active_restore_check` si existe conflicto, incluyendo en `metadata` el `conflict_operation_id`.
- Retorna `ok` si no hay conflicto.
- El acceso a la DB debe hacerse a través de un repositorio o pool inyectado (no instanciar conexiones directamente).

**`snapshot-exists.precheck.ts`**
- Verifica que el `snapshotId` existe, está en estado disponible (`available` o equivalente) y pertenece al `tenantId + componentType + instanceId` de la solicitud.
- Retorna `blocking_error` con código `snapshot_exists_check` si el snapshot no existe, no está disponible o no pertenece al target.
- Retorna `ok` en caso contrario.
- Si el adaptador no puede ser consultado (error de red, timeout), retorna `warning` con código `snapshot_exists_check` y mensaje indicando que la verificación no pudo completarse.

**`snapshot-age.precheck.ts`**
- Obtiene el `created_at` del snapshot e calcula la antigüedad en horas: `(Date.now() - snapshot.createdAt.getTime()) / 3600_000`.
- Lee el umbral de `process.env.PRECHECK_SNAPSHOT_AGE_WARNING_HOURS` (default `48`).
- Retorna `warning` con código `snapshot_age_check` si `ageHours > threshold`, incluyendo en `metadata`: `{ age_hours, threshold_hours }`.
- Retorna `ok` si está dentro del umbral.

**`newer-snapshots.precheck.ts`**
- Consulta si existen snapshots con `created_at > snapshotId.created_at` para el mismo `tenantId + componentType + instanceId`.
- Retorna `warning` con código `newer_snapshots_check` e incluye en `metadata`: `{ newer_count }` si existen snapshots más recientes.
- Retorna `ok` si el snapshot seleccionado es el más reciente.

**`active-connections.precheck.ts`**
- Consulta al adaptador del componente si hay operaciones activas (conexiones, jobs). Implementar como llamada HTTP al adaptador con timeout de 3 segundos.
- Si el adaptador no está disponible o falla, retorna `warning` con código `active_connections_check` y mensaje "Verificación de conexiones activas no disponible para este componente." (degradado gracioso, RN-07).
- Retorna `warning` con código `active_connections_check` si hay conexiones activas, con `metadata`: `{ active_connections_count }`.
- Retorna `ok` si no hay conexiones activas.

**`operational-hours.precheck.ts`**
- Lee `process.env.PRECHECK_OPERATIONAL_HOURS_ENABLED` (default `true`), `PRECHECK_OPERATIONAL_HOURS_START` (default `"08:00"`) y `PRECHECK_OPERATIONAL_HOURS_END` (default `"20:00"`).
- Si el flag está deshabilitado, retorna `ok` directamente.
- Compara `requestedAt` (UTC) con el rango de horas operativas.
- Retorna `warning` con código `operational_hours_check` si la solicitud está fuera del horario configurado.
- Retorna `ok` si está dentro del horario.

**`prechecks/index.ts`** — Orquestador `runAllPrechecks`:
- Exporta la función `runAllPrechecks(ctx: PrecheckContext, deps: PrecheckDeps): Promise<PrecheckResult[]>`.
- Ejecuta todos los prechecks en paralelo con `Promise.allSettled`.
- Aplica un timeout global configurable desde `process.env.PRECHECK_TIMEOUT_MS` (default `10000` ms) usando `Promise.race` contra un temporizador.
- Cualquier precheck cuya promesa no resuelva dentro del timeout se registra como `{ code: 'precheck_timeout', result: 'warning', message: 'El precheck no respondió dentro del tiempo límite configurado.' }`.
- Retorna el array de `PrecheckResult[]` con todos los resultados (resueltos + timeouts).

**Criterios de aceptación referenciados:** CA-01, CA-02, CA-03, CA-04, CA-11
**No hacer:** no conectar a DB directamente; usar repositorios inyectados. No hardcodear umbrales.

---

## TASK-04 — Calculadora de nivel de riesgo

**Dependencias:** TASK-02

**Archivos a crear:**
- `services/backup-status/src/confirmations/risk-calculator.ts`

**Archivos a leer antes de implementar:**
- `specs/112-backup-restore-confirmations/plan.md` — sección 1.4 (Cálculo del nivel de riesgo)
- `specs/112-backup-restore-confirmations/spec.md` — sección 3.3 (RN-03, RN-04)

**Qué hacer:**

Implementar la función pura `calculateRiskLevel` (sin efectos secundarios, sin acceso a DB ni a variables de entorno — todos los parámetros se pasan explícitamente):

```typescript
export interface RiskCalculatorConfig {
  criticalMultiWarningThreshold: number;   // process.env.CRITICAL_RISK_MULTI_WARNING_THRESHOLD, default 3
  snapshotAgeWarningHours: number;         // process.env.PRECHECK_SNAPSHOT_AGE_WARNING_HOURS, default 48
}

export function calculateRiskLevel(
  scope: RestoreScope,
  precheckResults: PrecheckResult[],
  snapshotAgeHours: number,
  isOutsideOperationalHours: boolean,
  config: RiskCalculatorConfig,
): RiskLevel
```

Lógica de clasificación (en este orden de prioridad):

1. **`critical`**: si `scope === 'full'` O si el número de advertencias (`result === 'warning'`) es ≥ `config.criticalMultiWarningThreshold`.
2. **`elevated`**: si `snapshotAgeHours > config.snapshotAgeWarningHours` O si hay al menos una advertencia (`result === 'warning'`) O si `isOutsideOperationalHours === true` O si algún resultado es `precheck_timeout`.
3. **`normal`**: todo lo demás (solo si no se cumplen las condiciones anteriores).

Exportar también la función auxiliar `hasBlockingErrors(results: PrecheckResult[]): boolean` que retorna `true` si algún resultado tiene `result === 'blocking_error'`.

Exportar `extractWarnings(results: PrecheckResult[]): string[]` que retorna los mensajes de los prechecks con `result === 'warning'` o `result === 'blocking_error'`.

**Criterios de aceptación referenciados:** CA-01, CA-02, CA-03, CA-04, CA-06
**No hacer:** no leer variables de entorno dentro de la función; recibirlas como parámetro `config`.

---

## TASK-05 — Repositorio de solicitudes de confirmación

**Dependencias:** TASK-01, TASK-02

**Archivos a crear:**
- `services/backup-status/src/confirmations/confirmations.repository.ts`

**Archivos a leer antes de implementar:**
- `specs/112-backup-restore-confirmations/plan.md` — sección 2 (esquema DB) y sección 1.2 (persistencia del token)
- `services/backup-status/src/audit/audit-trail.ts` (solo para ver el patrón de acceso a DB utilizado en el proyecto — leer solo las primeras 60 líneas)

**Qué hacer:**

Implementar el repositorio con las siguientes operaciones (usar el pool de DB del proyecto, no crear conexiones nuevas):

```typescript
export class ConfirmationsRepository {
  // Crear una nueva solicitud pendiente de confirmación
  create(data: CreateConfirmationRequestDto): Promise<ConfirmationRequest>

  // Buscar solicitud por hash del token (SHA-256 hex del token en texto plano)
  findByTokenHash(tokenHash: string): Promise<ConfirmationRequest | null>

  // Buscar solicitud por ID
  findById(id: string): Promise<ConfirmationRequest | null>

  // Actualizar el estado y la decisión de una solicitud
  updateDecision(
    id: string,
    decision: ConfirmationDecision,
    updates: Partial<Pick<ConfirmationRequest, 'operationId' | 'secondFactorType' | 'secondActorId'>>
  ): Promise<ConfirmationRequest>

  // Obtener todas las solicitudes expiradas pendientes (para el job de expiración)
  findExpiredPending(): Promise<ConfirmationRequest[]>

  // Obtener solicitudes pendientes de un tenant (para prechecks de conflicto activo)
  findActivePendingByTarget(
    tenantId: string, componentType: string, instanceId: string
  ): Promise<ConfirmationRequest[]>
}
```

Implementación de seguridad del token (sección 1.2 del plan):
- El token en texto plano **nunca** se almacena en DB.
- La función `hashToken(token: string): string` debe calcular `SHA-256` del token y retornarlo en hexadecimal.
- Al crear una solicitud, la llamada recibe el token en texto plano, calcula el hash y almacena solo el hash.
- Al buscar por token, la llamada recibe el token en texto plano, calcula el hash y busca por él.

`CreateConfirmationRequestDto` debe incluir todos los campos requeridos para insertar en `restore_confirmation_requests` (sin `id` ni `created_at`, que se generan en DB).

**Criterios de aceptación referenciados:** CA-02, CA-07, CA-08, CA-09, CA-10
**No hacer:** no exponer el token en texto plano en ningún log ni error.

---

## TASK-06 — Verificadores de segundo factor (OTP y segundo actor)

**Dependencias:** TASK-02

**Archivos a crear:**
- `services/backup-status/src/confirmations/second-factor/otp-verifier.ts`
- `services/backup-status/src/confirmations/second-factor/second-actor-verifier.ts`

**Archivos a leer antes de implementar:**
- `specs/112-backup-restore-confirmations/plan.md` — sección 1.6 (Riesgo crítico — segundo actor) y sección 5.1 (variables de entorno)
- `specs/112-backup-restore-confirmations/spec.md` — sección 5.1 (permisos) y sección 7.2 (supuestos)

**Qué hacer:**

**`otp-verifier.ts`**

```typescript
export interface OtpVerificationResult {
  valid: boolean;
  error?: 'otp_invalid' | 'keycloak_unavailable' | 'mfa_not_enabled';
}

export async function verifyOtp(
  otpCode: string,
  requesterId: string,
  keycloakOtpVerifyUrl: string,   // process.env.KEYCLOAK_OTP_VERIFY_URL
  mfaEnabled: boolean,            // process.env.MFA_ENABLED
): Promise<OtpVerificationResult>
```

- Si `mfaEnabled === false`, retornar `{ valid: false, error: 'mfa_not_enabled' }` inmediatamente.
- Llamar al endpoint de Keycloak `keycloakOtpVerifyUrl` con el OTP code. Implementar con `fetch` nativo (Node 18+) o el cliente HTTP disponible en el proyecto.
- Timeout de 5 segundos. Si Keycloak no responde, retornar `{ valid: false, error: 'keycloak_unavailable' }`.
- Si el código es inválido, retornar `{ valid: false, error: 'otp_invalid' }`.
- Si el código es válido, retornar `{ valid: true }`.

**`second-actor-verifier.ts`**

```typescript
export interface SecondActorVerificationResult {
  valid: boolean;
  secondActorId?: string;
  error?: 'invalid_token' | 'insufficient_role' | 'same_actor' | 'no_tenant_access';
}

export async function verifySecondActor(
  secondActorToken: string,   // JWT Bearer del segundo actor
  requesterId: string,        // ID del actor que inició la solicitud (no puede ser el mismo)
  tenantId: string,           // Tenant sobre el que opera la restauración
): Promise<SecondActorVerificationResult>
```

- Verificar que el JWT es válido (firma, expiración).
- Extraer el `sub` (actor ID) y los roles del JWT.
- Si `sub === requesterId`, retornar `{ valid: false, error: 'same_actor' }`.
- Si el actor no tiene rol `superadmin`, retornar `{ valid: false, error: 'insufficient_role' }`.
- Si el actor no tiene acceso al `tenantId` (verificar en los claims del JWT), retornar `{ valid: false, error: 'no_tenant_access' }`.
- Si todo es correcto, retornar `{ valid: true, secondActorId: sub }`.
- Para la verificación de firma del JWT, usar la librería de verificación JWT ya disponible en el proyecto (no añadir dependencias nuevas; usar la misma que usa `backup-status.auth.ts`).

**Criterios de aceptación referenciados:** CA-06
**No hacer:** no loguear el contenido del OTP ni del token JWT. No añadir dependencias nuevas.

---

## TASK-07 — Servicio de confirmaciones (orquestador principal)

**Dependencias:** TASK-02, TASK-03, TASK-04, TASK-05, TASK-06

**Archivos a crear:**
- `services/backup-status/src/confirmations/confirmations.service.ts`

**Archivos a leer antes de implementar:**
- `specs/112-backup-restore-confirmations/plan.md` — secciones 1.1 a 1.9 (todas las decisiones de arquitectura)
- `specs/112-backup-restore-confirmations/spec.md` — secciones 3.3 (todas las RN) y 4 (todos los RFs)
- `services/backup-status/src/audit/audit-trail.ts` (completo: necesario para saber cómo llamar a `emitAuditEvent`)
- `services/backup-status/src/operations/trigger-restore.action.ts` (completo: necesario para entender cómo despachar al adaptador tras la confirmación)

**Qué hacer:**

Implementar la clase `ConfirmationsService` con los siguientes métodos:

```typescript
export class ConfirmationsService {
  constructor(
    private readonly repo: ConfirmationsRepository,
    private readonly auditTrail: AuditTrail,         // servicio de auditoría existente
    private readonly adapterDispatcher: AdapterDispatcher,  // despachador al adaptador (de T02)
    private readonly config: ConfirmationsConfig,
  )

  // Paso 1: ejecutar prechecks, calcular riesgo, crear solicitud pendiente, retornar token
  async initiate(body: InitiateRestoreBody, actor: Actor): Promise<InitiateRestoreResponse>

  // Paso 2: confirmar o abortar una solicitud pendiente
  async confirm(body: ConfirmRestoreBody, actor: Actor): Promise<ConfirmRestoreResult>

  // Marcar como expiradas las solicitudes vencidas (para el job de expiración)
  async expireStale(): Promise<number>  // retorna el número de solicitudes expiradas
}
```

**Implementación de `initiate()`:**

1. Ejecutar `runAllPrechecks(ctx, deps)`.
2. Si algún resultado es `blocking_error`, emitir evento de auditoría `restore.confirmation_pending` con `decision: null` y `blocking_checks` en el `detail`, y **lanzar error** (no generar token). Retornar respuesta 422 al endpoint.
3. Calcular el nivel de riesgo con `calculateRiskLevel()`.
4. Generar token: `crypto.randomBytes(32)` → `base64url`. Calcular hash SHA-256 del token.
5. Determinar `availableSecondFactors`: si `config.mfaEnabled`, incluir `'otp'`; siempre incluir `'second_actor'`.
6. Persistir solicitud en DB con `repo.create(...)`.
7. Emitir evento de auditoría `restore.confirmation_pending` con todos los campos del plan (sección 5.3 de spec.md).
8. Retornar `InitiateRestoreResponse` con el token en texto plano (solo esta vez), los prechecks, advertencias, nivel de riesgo y target.

**Implementación de `confirm()`:**

1. Calcular hash del token recibido. Buscar solicitud en DB con `repo.findByTokenHash(hash)`.
2. Si no existe → error 404.
3. Si `status !== 'pending_confirmation'` → error 409 con el status actual.
4. Si `expiresAt < new Date()` → actualizar status a `expired`, emitir evento `restore.confirmation_expired`, retornar error 410.
5. Si `body.confirmed === false` → abortar: actualizar status a `aborted`, emitir evento `restore.aborted` con las advertencias que se mostraron, retornar 200.
6. Si `body.confirmed === true`:
   a. Validar que `body.tenantNameConfirmation` coincide exactamente con el nombre del tenant de la solicitud → si no coincide, error 422 `tenant_name_confirmation_mismatch`.
   b. Si `riskLevel === 'elevated'` o `critical`, validar que `body.acknowledgeWarnings === true`.
   c. Si `riskLevel === 'critical'`, verificar segundo factor:
      - Si `body.secondFactorType === 'otp'`: llamar a `verifyOtp()`. Si falla → error 422.
      - Si `body.secondFactorType === 'second_actor'`: llamar a `verifySecondActor()`. Si falla → error 422.
      - Si no se proporcionó ningún segundo factor → error 422.
   d. **Revalidar snapshot**: llamar a `snapshot-exists.precheck` con el contexto original. Si retorna `blocking_error` → error 422 `snapshot_no_longer_available`.
   e. Despachar operación al adaptador (usando el `adapterDispatcher` de T02).
   f. Actualizar solicitud en DB con `decision: 'confirmed'`, `operationId`, `secondFactorType`, `secondActorId` si aplica.
   g. Emitir evento de auditoría `restore.confirmed` con todos los campos requeridos (plan sección 5.3).
   h. Retornar 202 con `{ operation_id, status: 'accepted', accepted_at }`.

**Implementación de `expireStale()`:**

1. Obtener todas las solicitudes con `status = 'pending_confirmation'` y `expires_at < NOW()` usando `repo.findExpiredPending()`.
2. Para cada solicitud: actualizar `status = 'expired'`, emitir evento `restore.confirmation_expired`.
3. Retornar el número de solicitudes procesadas.

**Criterios de aceptación referenciados:** CA-01 a CA-12
**No hacer:** no importar lógica de adaptadores directamente; usar el `adapterDispatcher` inyectado. No hardcodear nombres de tenant.

---

## TASK-08 — Endpoints HTTP: initiate-restore y confirm-restore

**Dependencias:** TASK-07

**Archivos a crear:**
- `services/backup-status/src/api/initiate-restore.action.ts`
- `services/backup-status/src/api/confirm-restore.action.ts`

**Archivos a modificar:**
- `services/backup-status/src/audit/audit-trail.types.ts` — añadir los 4 nuevos `AuditEventType`

**Archivos a leer antes de implementar:**
- `specs/112-backup-restore-confirmations/plan.md` — sección 4 (contrato completo de API: request/response bodies, códigos HTTP, schema_version)
- `services/backup-status/src/api/backup-status.action.ts` (solo las primeras 40 líneas: patrón de endpoint del proyecto)
- `services/backup-status/src/api/backup-status.schema.ts` (solo para verificar el patrón de validación de esquemas utilizado)

**Qué hacer:**

**`audit-trail.types.ts`** — Modificar añadiendo los 4 nuevos valores al tipo `AuditEventType` (o al enum equivalente):
- `'restore.confirmation_pending'`
- `'restore.confirmed'`
- `'restore.aborted'`
- `'restore.confirmation_expired'`

**`initiate-restore.action.ts`** — Endpoint `POST /v1/backup/restore`:

- Validar el body de entrada con el esquema correspondiente (campos: `tenant_id`, `component_type`, `instance_id`, `snapshot_id`, `scope?`).
- Verificar autenticación/autorización: solo roles `sre` y `superadmin` (mismo modelo de permisos que T02).
- Llamar a `confirmationsService.initiate(body, actor)`.
- Si hay `blocking_error` → responder 422 con el formato definido en `plan.md` sección 4.1.
- Si éxito → responder 202 con `InitiateRestoreResponse` serializada con `schema_version: "2"` y fechas en ISO 8601.
- Manejar errores 400 (validación), 401, 403, 500.

**`confirm-restore.action.ts`** — Endpoint `POST /v1/backup/restore/confirm`:

- Validar el body de entrada: `confirmation_token` (requerido), `confirmed` (boolean, requerido), y campos opcionales según el nivel de riesgo.
- Verificar autenticación: el actor debe estar autenticado (el token de confirmación está vinculado al solicitante original — validar en el servicio).
- Llamar a `confirmationsService.confirm(body, actor)`.
- Mapear los errores del servicio a los códigos HTTP correctos:
  - `status_not_pending` → 409
  - `token_expired` → 410
  - `snapshot_no_longer_available` → 422
  - `tenant_name_confirmation_mismatch` → 422
  - `second_factor_verification_failed` → 422
- Si abort (`confirmed: false`) → responder 200.
- Si confirmación exitosa → responder 202 con `{ schema_version: "2", operation_id, status: "accepted", accepted_at }`.

Añadir también el endpoint `GET /v1/backup/restore/confirm/:confirmation_request_id` (plan sección 4.3):
- Verificar que el actor es el solicitante original o un superadmin con acceso al tenant.
- Retornar el estado actual de la solicitud (solo campos públicos: `id`, `status`, `risk_level`, `expires_at`, `created_at`).

**Criterios de aceptación referenciados:** CA-01, CA-02, CA-03, CA-04, CA-05, CA-06, CA-07, CA-08, CA-09, CA-10
**No hacer:** no leer el archivo completo de OpenAPI ni los archivos de rutas existentes; solo los archivos de referencia listados arriba.

---

## TASK-09 — Modificar `trigger-restore.action.ts` y actualizar `backupOperationsApi.ts`

**Dependencias:** TASK-08

**Archivos a modificar:**
- `services/backup-status/src/operations/trigger-restore.action.ts`
- `apps/web-console/src/services/backupOperationsApi.ts`

**Archivos a leer antes de implementar:**
- `services/backup-status/src/operations/trigger-restore.action.ts` (completo)
- `apps/web-console/src/services/backupOperationsApi.ts` (completo)
- `specs/112-backup-restore-confirmations/plan.md` — sección 3 (estructura de módulos) y sección 4 (contratos de API)

**Qué hacer:**

**`trigger-restore.action.ts`** — Refactorizar para delegar al flujo de confirmación:
- El handler ya **no** despacha directamente al adaptador.
- En lugar de eso, extrae los parámetros de la solicitud y llama a `confirmationsService.initiate(body, actor)`.
- Retorna la respuesta `InitiateRestoreResponse` (202) o el error 422 si hay precheck bloqueante.
- Mantener los mismos permisos y validaciones de entrada que tenía antes.
- Si la variable de entorno `RESTORE_CONFIRMATION_ENABLED=false`, mantener el comportamiento original (bypass de emergencia, plan sección 9.3). En ese caso, añadir `confirmation_bypassed: true` al evento de auditoría.
- **No eliminar** el archivo; modificarlo in-situ para que actúe como adaptador hacia el nuevo servicio.

**`backupOperationsApi.ts`** — Añadir los nuevos métodos de cliente:

```typescript
// Nuevo: Paso 1 — iniciar solicitud de restore (ya no despacha directamente)
initiateRestore(body: InitiateRestoreBody, authToken: string): Promise<InitiateRestoreResponse>

// Nuevo: Paso 2 — confirmar o abortar
confirmRestore(body: ConfirmRestoreBody, authToken: string): Promise<ConfirmRestoreResult>

// Nuevo: abort explícito (shorthand de confirmRestore con confirmed: false)
abortRestore(confirmationToken: string, authToken: string): Promise<void>

// Nuevo: consultar estado de solicitud pendiente
getConfirmationStatus(confirmationRequestId: string, authToken: string): Promise<ConfirmationStatusResponse>
```

- Mantener los métodos existentes sin cambios.
- Los tipos de los cuerpos de request/response deben coincidir con los tipos definidos en TASK-02 (importar desde el paquete compartido o definir localmente si no hay paquete compartido — seguir el patrón del proyecto).

**Criterios de aceptación referenciados:** CA-01, CA-02, CA-12
**No hacer:** no modificar `trigger-backup.action.ts` (CA-12 requiere que los backups no pasen por el flujo de confirmación).

---

## TASK-10 — Hooks de React: `useTriggerRestore`, `useConfirmRestore`, `useAbortRestore`

**Dependencias:** TASK-09

**Archivos a modificar:**
- `apps/web-console/src/hooks/useTriggerRestore.ts`

**Archivos a crear:**
- `apps/web-console/src/hooks/useConfirmRestore.ts`
- `apps/web-console/src/hooks/useAbortRestore.ts`

**Archivos a leer antes de implementar:**
- `apps/web-console/src/hooks/useTriggerRestore.ts` (completo)
- `specs/112-backup-restore-confirmations/plan.md` — sección 6.6 (modificación de `useTriggerRestore.ts`)

**Qué hacer:**

**`useTriggerRestore.ts`** — Refactorizar para manejar el flujo de dos pasos:

Exponer la interfaz definida en `plan.md` sección 6.6:

```typescript
interface UseTriggerRestoreResult {
  initiate: (body: InitiateRestoreBody, token: string) => Promise<void>
  confirm: (opts: ConfirmRestoreOpts) => Promise<void>
  abort: () => Promise<void>
  phase: 'idle' | 'loading' | 'pending_confirmation' | 'confirming' | 'dispatched' | 'error'
  precheckResponse: InitiateRestoreResponse | null
  operationId: string | null
  error: Error | null
}
```

- `initiate()` llama a `backupOperationsApi.initiateRestore()`, pone el estado en `pending_confirmation` y almacena el `precheckResponse` (que contiene el token).
- `confirm()` llama a `backupOperationsApi.confirmRestore()` con el token almacenado internamente (no exponer el token al componente directamente; el hook lo gestiona).
- `abort()` llama a `backupOperationsApi.abortRestore()` con el token almacenado.
- El token en texto plano **solo existe en memoria dentro del hook** durante el tiempo de vida de la solicitud. No persistir en `localStorage` ni en estado global.

**`useConfirmRestore.ts`** — Hook dedicado para el Paso 2 (alternativa si se prefiere separar responsabilidades):

```typescript
export function useConfirmRestore(confirmationToken: string | null): {
  confirm: (opts: ConfirmRestoreOpts) => Promise<ConfirmRestoreResult>
  abort: () => Promise<void>
  isLoading: boolean
  error: Error | null
}
```

**`useAbortRestore.ts`** — Hook simple para abortar desde contextos sin acceso al hook principal:

```typescript
export function useAbortRestore(): {
  abort: (confirmationToken: string) => Promise<void>
  isLoading: boolean
  error: Error | null
}
```

**Criterios de aceptación referenciados:** CA-01, CA-05, CA-10
**No hacer:** no persistir el token fuera de la memoria del hook. No exponer el token raw a los componentes de UI.

---

## TASK-11 — Componentes React del modal de confirmación

**Dependencias:** TASK-10

**Archivos a crear:**
- `apps/web-console/src/components/backup/RestoreConfirmationDialog.tsx`
- `apps/web-console/src/components/backup/PrecheckResultList.tsx`
- `apps/web-console/src/components/backup/RiskLevelBadge.tsx`
- `apps/web-console/src/components/backup/TenantNameInput.tsx`
- `apps/web-console/src/components/backup/CriticalConfirmationPanel.tsx`

**Archivos a modificar:**
- `apps/web-console/src/components/backup/BackupStatusDetail.tsx`

**Archivos a leer antes de implementar:**
- `apps/web-console/src/components/backup/BackupStatusDetail.tsx` (completo)
- `specs/112-backup-restore-confirmations/plan.md` — secciones 6.1 a 6.7 (especificaciones detalladas de cada componente)
- `specs/112-backup-restore-confirmations/spec.md` — sección 4 (RF-T04-03, RF-T04-06) y sección 6 (CA-01, CA-03, CA-04, CA-05, CA-06)

**Qué hacer:**

**`RiskLevelBadge.tsx`**
- Props: `riskLevel: RiskLevel`
- `normal` → badge gris/verde sin icono de alerta
- `elevated` → badge naranja/ámbar con icono ⚠️
- `critical` → badge rojo con icono 🚫
- Usar el sistema de diseño/componentes existente en el proyecto (no importar librerías UI nuevas).

**`PrecheckResultList.tsx`**
- Props: `prechecks: PrecheckResult[]`
- Cada ítem muestra: icono de estado (✅ OK / ⚠️ warning / 🚫 blocking_error), mensaje localizado del precheck, y metadata adicional cuando esté presente (p.ej., "72 horas / umbral 48 horas").
- Los ítems con `result: 'blocking_error'` se destacan visualmente (fondo rojo claro o borde rojo).
- Todos los textos en español.

**`TenantNameInput.tsx`**
- Props: `tenantName: string` (nombre esperado), `value: string`, `onChange: (v: string) => void`, `disabled?: boolean`
- Muestra un campo de texto controlado.
- Valida en tiempo real si `value === tenantName` (comparación exacta, case-sensitive).
- Muestra un icono ✅ verde cuando coincide, sin icono o icono ❌ cuando no coincide.
- El `placeholder` debe indicar al usuario qué debe escribir (p.ej., "Escribe el nombre del tenant para confirmar").

**`CriticalConfirmationPanel.tsx`**
- Props: `availableSecondFactors: SecondFactorType[]`, `onOtpChange: (v: string) => void`, `onSecondActorTokenChange: (v: string) => void`, `otpValue: string`, `secondActorTokenValue: string`
- Solo se renderiza si `riskLevel === 'critical'`.
- Si `availableSecondFactors` incluye `'otp'`: mostrar tab "Código MFA (OTP)" con un campo numérico de 6 dígitos.
- Siempre mostrar tab "Aprobación de segundo administrador" con un campo de texto para el token JWT del segundo actor.
- Instrucciones en español explicando qué debe hacer el actor.

**`RestoreConfirmationDialog.tsx`**
- Props: `precheckResponse: InitiateRestoreResponse`, `onConfirm: (opts: ConfirmRestoreOpts) => Promise<void>`, `onAbort: () => Promise<void>`, `isConfirming: boolean`
- Modal bloqueante (no se puede cerrar con click fuera o Escape hasta tomar una decisión).
- **Cabecera**: "Confirmar restauración destructiva" + `<RiskLevelBadge>`.
- **Bloque de objetivo**: tenant, componente, instancia, snapshot con timestamp en formato legible, antigüedad en horas.
- **Bloque de prechecks**: `<PrecheckResultList>`.
- **Bloque de confirmación**:
  - Siempre: `<TenantNameInput>` con `tenantName = precheckResponse.target.tenant_name`
  - Si `riskLevel !== 'normal'`: checkbox "He revisado y entiendo las advertencias mostradas"
  - Si `riskLevel === 'critical'`: `<CriticalConfirmationPanel>`
- **Pie**:
  - Botón "Cancelar" → llama `onAbort()` (siempre activo).
  - Botón "Confirmar restauración" → deshabilitado mientras:
    - hay algún `result === 'blocking_error'` en los prechecks
    - el nombre del tenant no coincide exactamente
    - si `riskLevel !== 'normal'`: el checkbox de advertencias no está marcado
    - si `riskLevel === 'critical'`: no se ha introducido OTP o token de segundo actor

**`BackupStatusDetail.tsx`** — Modificación mínima:
- Importar `useTriggerRestore` refactorizado y `RestoreConfirmationDialog`.
- Cuando el hook exponga `phase === 'pending_confirmation'`, renderizar `<RestoreConfirmationDialog>` superpuesto al contenido existente.
- Cuando `phase === 'dispatched'`, cerrar el modal y mostrar notificación de éxito con el `operationId`.
- No modificar ninguna otra lógica de navegación o estado del componente.

**Criterios de aceptación referenciados:** CA-01, CA-03, CA-04, CA-05, CA-06, CA-10, CA-12
**No hacer:** no añadir librerías UI externas. No modificar `TriggerBackupButton.tsx`.

---

## TASK-12 — Job de expiración de solicitudes pendientes

**Dependencias:** TASK-07

**Archivos a crear:**
- `services/backup-status/src/confirmations/expiry-job.action.ts`

**Archivos a leer antes de implementar:**
- `specs/112-backup-restore-confirmations/plan.md` — secciones 1.7 y 5.3 (job de expiración y configuración del scheduling-engine)
- Cualquier archivo `*.action.ts` existente en `services/backup-status/src/` que sea un job periódico (para seguir el mismo patrón — leer solo el primero que encuentres, máximo 50 líneas)

**Qué hacer:**

Implementar `expiry-job.action.ts` como una acción OpenWhisk compatible con el patrón del proyecto:

```typescript
// Handler principal de la acción OpenWhisk
export async function main(params: Record<string, unknown>) {
  const expiredCount = await confirmationsService.expireStale();
  return {
    statusCode: 200,
    body: { expired_count: expiredCount, executed_at: new Date().toISOString() }
  };
}
```

- Instanciar `ConfirmationsService` con las dependencias necesarias al inicio de la función (o usar inyección de dependencias si el proyecto lo soporta).
- Leer `process.env.EXPIRY_JOB_ENABLED` (default `true`). Si es `false`, retornar inmediatamente sin hacer nada.
- Manejar errores internamente: si `expireStale()` lanza, capturar el error, loguearlo y retornar `{ statusCode: 500, body: { error: message } }`.

**No hace falta** registrar el job en el scheduling-engine en este ticket; eso se documenta como paso operativo en el CHANGELOG.

**Criterios de aceptación referenciados:** CA-07, CA-09
**No hacer:** no modificar archivos del scheduling-engine.

---

## TASK-13 — Tests: unitarios, de integración y E2E

**Dependencias:** TASK-03, TASK-04, TASK-05, TASK-06, TASK-07, TASK-08, TASK-11

**Archivos a crear:**

*Tests unitarios (backend):*
- `services/backup-status/test/confirmations/risk-calculator.test.ts`
- `services/backup-status/test/confirmations/prechecks/active-restore.test.ts`
- `services/backup-status/test/confirmations/prechecks/snapshot-exists.test.ts`
- `services/backup-status/test/confirmations/prechecks/snapshot-age.test.ts`
- `services/backup-status/test/confirmations/prechecks/newer-snapshots.test.ts`
- `services/backup-status/test/confirmations/prechecks/operational-hours.test.ts`
- `services/backup-status/test/confirmations/prechecks/index.test.ts`
- `services/backup-status/test/confirmations/confirmations.service.test.ts`
- `services/backup-status/test/confirmations/second-factor/otp-verifier.test.ts`
- `services/backup-status/test/confirmations/second-factor/second-actor-verifier.test.ts`

*Tests de integración (backend):*
- `services/backup-status/test/integration/restore-confirmation-flow.test.ts`

*Tests E2E (frontend):*
- `apps/web-console/test/e2e/restore-confirmation-dialog.spec.ts`

**Archivos a leer antes de implementar:**
- `specs/112-backup-restore-confirmations/plan.md` — sección 7 (estrategia de tests completa: 7.1, 7.2, 7.3, 7.4)
- `specs/112-backup-restore-confirmations/spec.md` — sección 6 (criterios de aceptación CA-01 a CA-12)

**Qué hacer:**

### Tests unitarios

**`risk-calculator.test.ts`** — Cubrir `calculateRiskLevel()` y helpers:
- `scope='full'` → siempre `critical` (CA-06)
- `warnings >= threshold` → `critical`
- `snapshotAgeHours > threshold` → `elevated`
- `isOutsideOperationalHours=true` → `elevated`
- Sin ninguna condición de riesgo → `normal`
- `hasBlockingErrors()` con y sin blocking errors (CA-03)
- `extractWarnings()` extrae solo los mensajes de warning/blocking

**`active-restore.test.ts`** — Mockear el repositorio:
- Sin restore activo → `ok`
- Con restore activo → `blocking_error` con `conflict_operation_id` en metadata (CA-03)

**`snapshot-exists.test.ts`**:
- Snapshot existe y pertenece al tenant → `ok` (CA-02)
- Snapshot no existe → `blocking_error` (CA-03, CA-08)
- Snapshot de otro tenant → `blocking_error` (CA-11)
- Adaptador no disponible → `warning` (RN-07)

**`snapshot-age.test.ts`**:
- Antigüedad < umbral → `ok`
- Antigüedad > umbral → `warning` con `age_hours` y `threshold_hours` en metadata (CA-04)

**`newer-snapshots.test.ts`**:
- Sin snapshots más recientes → `ok`
- Con snapshots más recientes → `warning` con `newer_count` (CA-04)

**`operational-hours.test.ts`**:
- Dentro del horario → `ok`
- Fuera del horario → `warning` (CA-04)
- Feature flag desactivado → `ok` siempre

**`prechecks/index.test.ts`**:
- Todos los prechecks resuelven → array completo de resultados
- Un precheck hace timeout → se registra como `warning` con código `precheck_timeout` (edge case de plan sección 3.2)

**`confirmations.service.test.ts`** — Mockear repo, auditTrail y adapterDispatcher:
- `initiate()` con prechecks ok → crea solicitud pendiente, retorna token y prechecks (CA-02)
- `initiate()` con blocking_error → no crea solicitud, no retorna token (CA-03)
- `confirm()` con token válido, nombre correcto → despacha operación (CA-01, CA-02)
- `confirm()` con token expirado → error token_expired (CA-07)
- `confirm()` con nombre de tenant incorrecto → error tenant_name_mismatch (CA-05)
- `confirm()` con riesgo critical sin segundo factor → error (CA-06)
- `confirm()` con abort → decision=aborted, emit auditoría (CA-10)
- `expireStale()` → marca expiradas las solicitudes vencidas, emite auditoría (CA-07, CA-09)

**`otp-verifier.test.ts`**:
- MFA deshabilitado → `mfa_not_enabled`
- OTP válido → `valid: true` (CA-06)
- OTP inválido → `otp_invalid`
- Keycloak no disponible → `keycloak_unavailable`

**`second-actor-verifier.test.ts`**:
- Segundo actor válido → `valid: true, secondActorId` (CA-06)
- Mismo actor → `same_actor`
- Rol insuficiente → `insufficient_role`
- Sin acceso al tenant → `no_tenant_access` (CA-11)

---

### Tests de integración

**`restore-confirmation-flow.test.ts`** — Requiere PostgreSQL de test. Cubrir los escenarios de la sección 7.2 del plan:

Cada escenario de test debe:
1. Preparar el estado de la DB (insertar datos de test).
2. Ejecutar las llamadas HTTP al servicio.
3. Verificar el estado resultante en DB y los eventos de auditoría.
4. Limpiar los datos de test.

Escenarios requeridos (mapeo a CAs):

| Escenario | CAs cubiertos |
|-----------|--------------|
| Flujo completo: initiate → confirm (riesgo normal) — verificar que la operación se despacha | CA-01, CA-02, CA-05 |
| Initiate con precheck bloqueante (restore activo) → 422 sin token | CA-03 |
| Initiate con snapshot antiguo → advertencia, confirm con `acknowledge_warnings=true` | CA-04 |
| Confirm con token expirado → 410 `confirmation_token_expired` | CA-07 |
| Confirm → eliminar snapshot entre Paso 1 y Paso 2 → 422 `snapshot_no_longer_available` | CA-08 |
| Flujo completo con riesgo critical (scope=full) → confirm requiere segundo factor | CA-06 |
| Initiate → abort (`confirmed: false`) → auditoría con `decision: 'aborted'` y warnings | CA-10 |
| Verificar que los prechecks de tenant A no revelan datos de tenant B | CA-11 |
| Trigger backup bajo demanda → no genera token de confirmación | CA-12 |
| Flujo completo → verificar que el evento de auditoría contiene: `prechecks_result`, `risk_level`, `warnings_shown`, `confirmation_decision`, `confirmation_timestamp` | CA-09 |

---

### Tests E2E

**`restore-confirmation-dialog.spec.ts`** — Usar MSW (o el mock de API del proyecto) para simular respuestas de prechecks:

| Escenario | CAs cubiertos |
|-----------|--------------|
| Iniciar restore → modal aparece antes del despacho (verificar que el adaptador no fue llamado) | CA-01 |
| Campo de nombre de tenant vacío → botón "Confirmar" deshabilitado | CA-05 |
| Campo de nombre de tenant incorrecto → botón sigue deshabilitado | CA-05 |
| Campo de nombre de tenant correcto → botón se habilita | CA-05 |
| Respuesta con `blocking_error` → botón "Confirmar" deshabilitado, error visible | CA-03 |
| Respuesta con warnings → advertencias visibles, se puede proceder tras marcar checkbox | CA-04 |
| Click en "Cancelar" → modal se cierra, se llama al endpoint de abort | CA-10 |
| Abort → evento de auditoría registrado (verificar en la respuesta del mock) | CA-10 |
| Iniciar backup bajo demanda → modal de confirmación NO aparece | CA-12 |

---

### Cobertura mínima requerida

- Módulo `confirmations/` (backend): ≥ 90% de líneas
- Módulo `api/` (endpoints nuevos, backend): ≥ 85% de líneas
- Componentes React nuevos (`RestoreConfirmationDialog`, `PrecheckResultList`, `RiskLevelBadge`, `TenantNameInput`, `CriticalConfirmationPanel`): ≥ 80% de líneas

**Criterios de aceptación referenciados:** CA-01, CA-02, CA-03, CA-04, CA-05, CA-06, CA-07, CA-08, CA-09, CA-10, CA-11, CA-12
**No hacer:** no leer archivos de test existentes no relacionados. No modificar tests de T01, T02 o T03.

---

## Resumen de orden de implementación

| Orden | Task    | Puede comenzar tras     |
|-------|---------|-------------------------|
| 1     | TASK-01 | —                       |
| 2     | TASK-02 | TASK-01                 |
| 3     | TASK-03 | TASK-02                 |
| 4     | TASK-04 | TASK-02                 |
| 5     | TASK-05 | TASK-01, TASK-02        |
| 6     | TASK-06 | TASK-02                 |
| 7     | TASK-07 | TASK-03, TASK-04, TASK-05, TASK-06 |
| 8     | TASK-08 | TASK-07                 |
| 9     | TASK-09 | TASK-08                 |
| 10    | TASK-10 | TASK-09                 |
| 11    | TASK-11 | TASK-10                 |
| 12    | TASK-12 | TASK-07                 |
| 13    | TASK-13 | TASK-03, TASK-04, TASK-05, TASK-06, TASK-07, TASK-08, TASK-11 |

Las tareas TASK-03, TASK-04, TASK-05 y TASK-06 pueden desarrollarse en paralelo (todas dependen solo de TASK-02). TASK-12 puede desarrollarse en paralelo con TASK-08 a TASK-11.
