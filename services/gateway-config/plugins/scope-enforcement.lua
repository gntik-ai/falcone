local core = require("apisix.core")
local lrucache = require("resty.lrucache")

local plugin_name = "scope-enforcement"
local _M = { version = 0.1, priority = 2900, name = plugin_name }
local requirements_cache = lrucache.new(200)
local privilege_domain_cache = lrucache.new(200)

local schema = {
  type = "object",
  properties = {
    required_scopes = { type = "array", items = { type = "string" } },
    required_entitlements = { type = "array", items = { type = "string" } },
    workspace_scoped = { type = "boolean", default = true }
  }
}

_M.schema = schema

local function split_scopes(scope_claim)
  if type(scope_claim) == "table" then return scope_claim end
  local scopes = {}
  if type(scope_claim) ~= "string" then return scopes end
  for token in string.gmatch(scope_claim, "%S+") do table.insert(scopes, token) end
  return scopes
end

local function get_claims(ctx)
  local claims = (ctx.var and ctx.var.jwt_claims) or ctx.jwt_auth_payload or ctx.authenticated_consumer and ctx.authenticated_consumer.claims
  if not claims then return nil end
  return {
    scopes = split_scopes(claims.scope or claims.scp or {}),
    workspace_id = claims.workspace_id,
    tenant_id = claims.tenant_id,
    plan_id = claims.plan_id,
    role = claims.role,
    actor_id = claims.sub or claims.client_id or "anonymous",
    actor_type = claims.actor_type or "user",
    privilege_domain = claims.privilege_domain
  }
end

local function array_to_set(items)
  local set = {}
  for _, item in ipairs(items or {}) do set[item] = true end
  return set
end

local function missing_items(have_items, need_items)
  local set = array_to_set(have_items)
  local missing = {}
  for _, item in ipairs(need_items or {}) do if not set[item] then table.insert(missing, item) end end
  return missing
end

local function extract_workspace_id(ctx)
  local uri = (ctx.var and ctx.var.uri) or ""
  return string.match(uri, "/workspaces/([^/]+)")
end

local function deny(ctx, status, code, detail)
  core.response.set_header("Content-Type", "application/json")
  return status, {
    status = status,
    code = code,
    message = detail and detail.message or code,
    detail = detail or {},
    requestId = (ctx.var and ctx.var.request_id) or "",
    correlationId = (ctx.var and (ctx.var.http_x_correlation_id or ctx.var.request_id)) or "",
    timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    resource = (ctx.var and ctx.var.uri) or ""
  }
end

local function resolve_requirements(conf, ctx)
  if conf.required_scopes and #conf.required_scopes > 0 then return conf end
  local cache_key = ((ctx.var and ctx.var.request_method) or "GET") .. ":" .. ((ctx.var and ctx.var.uri) or "")
  local cached = requirements_cache:get(cache_key)
  if cached then return cached end
  return nil
end

local function emit_denial_event(_, payload)
  local http = require("resty.http")
  local client = http.new()
  client:set_timeout(200)
  client:request_uri(os.getenv("SCOPE_ENFORCEMENT_SIDECAR_URL") or "http://127.0.0.1:19092/denials", { method = "POST", body = core.json.encode(payload), headers = { ["Content-Type"] = "application/json" } })
end

local function emit_privilege_domain_denied_event(_, payload)
  local http = require("resty.http")
  local client = http.new()
  client:set_timeout(200)
  client:request_uri(os.getenv("SCOPE_ENFORCEMENT_SIDECAR_URL") or "http://127.0.0.1:19092/denials", { method = "POST", body = core.json.encode(payload), headers = { ["Content-Type"] = "application/json" } })
end

local function env_bool(name, default)
  local value = os.getenv(name)
  if value == nil then return default end
  return tostring(value) == "true"
end

local function cache_ttl_seconds()
  return tonumber(os.getenv("PRIVILEGE_DOMAIN_CACHE_TTL_SECONDS") or "60") or 60
end

function _M.fetch_endpoint_privilege_domain(_, _)
  return nil
end

function _M.invalidate_privilege_domain_cache()
  privilege_domain_cache:flush_all()
end

function _M.resolve_required_domain(method, path)
  local cache_key = method .. ":" .. path
  local cached = privilege_domain_cache:get(cache_key)
  if cached then return cached, true end
  local required_domain = _M.fetch_endpoint_privilege_domain(method, path)
  if required_domain then privilege_domain_cache:set(cache_key, required_domain, cache_ttl_seconds()) end
  return required_domain, false
end

function _M.evaluate_privilege_domain(ctx, claims)
  local method = ctx.var.request_method
  local path = ctx.var.uri
  local credential_domain = (ctx.var and ctx.var.http_x_api_key_domain) or (claims and claims.privilege_domain) or "none"
  local required_domain = nil
  local _, cache_hit = nil, false
  required_domain, cache_hit = _M.resolve_required_domain(method, path)
  local enforcement_enabled = env_bool("PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED", false)

  if claims.role == "platform_admin" then
    core.request.set_header(ctx, "X-Privilege-Domain", "platform_admin")
    return nil, { bypassed = true, cache_hit = cache_hit }
  end

  if required_domain == nil then
    if enforcement_enabled then
      return core.response.exit(403, {
        error = "CONFIG_ERROR",
        requiredDomain = nil,
        credentialDomain = credential_domain
      })
    end
    core.request.set_header(ctx, "X-Privilege-Domain", credential_domain)
    return nil, { bypassed = false, cache_hit = cache_hit }
  end

  if credential_domain ~= required_domain then
    ngx.timer.at(0, emit_privilege_domain_denied_event, {
      eventType = "privilege_domain_denied",
      tenantId = claims.tenant_id,
      workspaceId = claims.workspace_id,
      actorId = claims.actor_id,
      actorType = claims.actor_type,
      credentialDomain = credential_domain,
      requiredDomain = required_domain,
      httpMethod = method,
      requestPath = path,
      correlationId = (ctx.var.http_x_correlation_id or ctx.var.request_id),
      occurredAt = os.date("!%Y-%m-%dT%H:%M:%SZ")
    })
    if enforcement_enabled then
      return core.response.exit(403, {
        error = "PRIVILEGE_DOMAIN_MISMATCH",
        requiredDomain = required_domain,
        credentialDomain = credential_domain
      })
    end
  end

  core.request.set_header(ctx, "X-Privilege-Domain", credential_domain)
  return nil, { bypassed = false, cache_hit = cache_hit }
end

function _M.check_schema(conf)
  return core.schema.check(schema, conf)
end

function _M.access(conf, ctx)
  local claims = get_claims(ctx)
  if not claims then
    return core.response.exit(401, deny(ctx, 401, "UNAUTHENTICATED", { message = "Authentication claims missing" }))
  end

  local req = resolve_requirements(conf, ctx)
  if not req then
    local payload = { denial_type = "CONFIG_ERROR", tenant_id = claims.tenant_id, actor_id = claims.actor_id, actor_type = claims.actor_type, http_method = ctx.var.request_method, request_path = ctx.var.uri, presented_scopes = claims.scopes, source_ip = ctx.var.remote_addr, correlation_id = ctx.var.http_x_correlation_id or ctx.var.request_id, denied_at = os.date("!%Y-%m-%dT%H:%M:%SZ") }
    ngx.timer.at(0, emit_denial_event, payload)
    return core.response.exit(403, deny(ctx, 403, "CONFIG_ERROR", { message = "Endpoint scope requirements not declared" }))
  end

  local missing_scopes = missing_items(claims.scopes, req.required_scopes or {})
  if #missing_scopes > 0 then
    ngx.timer.at(0, emit_denial_event, { denial_type = "SCOPE_INSUFFICIENT", tenant_id = claims.tenant_id, workspace_id = claims.workspace_id, actor_id = claims.actor_id, actor_type = claims.actor_type, http_method = ctx.var.request_method, request_path = ctx.var.uri, required_scopes = req.required_scopes or {}, presented_scopes = claims.scopes, missing_scopes = missing_scopes, source_ip = ctx.var.remote_addr, correlation_id = ctx.var.http_x_correlation_id or ctx.var.request_id, denied_at = os.date("!%Y-%m-%dT%H:%M:%SZ") })
    return core.response.exit(403, deny(ctx, 403, "SCOPE_INSUFFICIENT", { required_scopes = req.required_scopes or {}, presented_scopes = claims.scopes, missing_scopes = missing_scopes, message = "Token scopes do not satisfy the requirements for this resource." }))
  end

  if req.workspace_scoped ~= false then
    local requested_workspace_id = extract_workspace_id(ctx)
    if requested_workspace_id and claims.role ~= "platform_admin" and claims.workspace_id and requested_workspace_id ~= claims.workspace_id then
      ngx.timer.at(0, emit_denial_event, { denial_type = "WORKSPACE_SCOPE_MISMATCH", tenant_id = claims.tenant_id, workspace_id = requested_workspace_id, actor_id = claims.actor_id, actor_type = claims.actor_type, http_method = ctx.var.request_method, request_path = ctx.var.uri, presented_scopes = claims.scopes, source_ip = ctx.var.remote_addr, correlation_id = ctx.var.http_x_correlation_id or ctx.var.request_id, denied_at = os.date("!%Y-%m-%dT%H:%M:%SZ") })
      return core.response.exit(403, deny(ctx, 403, "WORKSPACE_SCOPE_MISMATCH", { token_workspace_id = claims.workspace_id, requested_workspace_id = requested_workspace_id, message = "Token is not authorized for the requested workspace." }))
    end
  end

  local plan_entitlements = core.table.clone((ctx.scope_plan_entitlements or {}))
  local missing_entitlements = missing_items(plan_entitlements, req.required_entitlements or {})
  if #missing_entitlements > 0 then
    ngx.timer.at(0, emit_denial_event, { denial_type = "PLAN_ENTITLEMENT_DENIED", tenant_id = claims.tenant_id, workspace_id = claims.workspace_id, actor_id = claims.actor_id, actor_type = claims.actor_type, http_method = ctx.var.request_method, request_path = ctx.var.uri, required_scopes = req.required_scopes or {}, presented_scopes = claims.scopes, required_entitlement = missing_entitlements[1], current_plan_id = claims.plan_id, source_ip = ctx.var.remote_addr, correlation_id = ctx.var.http_x_correlation_id or ctx.var.request_id, denied_at = os.date("!%Y-%m-%dT%H:%M:%SZ") })
    return core.response.exit(403, deny(ctx, 403, "PLAN_ENTITLEMENT_DENIED", { required_entitlement = missing_entitlements[1], current_plan_id = claims.plan_id, message = "Your current plan does not include this capability." }))
  end

  local domain_result = _M.evaluate_privilege_domain(ctx, claims)
  if domain_result then return domain_result end

  core.request.set_header(ctx, "X-Enforcement-Verified", "true")
  core.request.set_header(ctx, "X-Verified-Tenant-Id", claims.tenant_id or "")
  core.request.set_header(ctx, "X-Verified-Workspace-Id", claims.workspace_id or "")
end

return _M
