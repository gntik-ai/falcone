-- Busted spec for scope-enforcement plan-quota-driven rate-limit resolution (#277,
-- fix-gateway-ratelimit-resolve-plan-live). Mirrors the mocking style of the other
-- scope-enforcement specs in this directory.
--
-- NOTE: this repo's local environment has no lua/busted runner available, so this
-- spec was authored and verified by inspection against the plugin source; it is
-- intended to run in the gateway-config Lua test pipeline / CI alongside the
-- sibling *_spec.lua files.

-- Per-test controls (upvalues the resty.http mock reads)
local http_response      -- { status = <int>, body = <string> } returned by request_uri; nil => transport error
local decoded_response   -- table that core.json.decode returns for the response body
local last_request       -- captures { url, opts } of the most recent request_uri call

package.loaded["apisix.core"] = {
  json = {
    encode = function(payload) return payload end,
    -- Decode is decoupled from the body string: tests set `decoded_response`.
    decode = function(_) return decoded_response end
  },
  schema = { check = function() return true end },
  response = { set_header = function() end, exit = function(status, body) return { status = status, body = body } end },
  request = { set_header = function(ctx, name, value) ctx.headers = ctx.headers or {}; ctx.headers[name] = value end },
  table = { clone = function(tbl) return tbl end }
}

package.loaded["resty.lrucache"] = {
  new = function()
    local data = {}
    return {
      get = function(_, k) return data[k] end,
      set = function(_, k, v) data[k] = v end,
      flush_all = function() data = {} end
    }
  end
}

package.loaded["resty.http"] = {
  new = function()
    return {
      set_timeout = function() end,
      -- client:request_uri(url, opts) -> self is first positional arg
      request_uri = function(_, url, opts)
        last_request = { url = url, opts = opts }
        if http_response == nil then
          error("connection refused")
        end
        return http_response
      end
    }
  end
}

ngx = { timer = { at = function() end } }

-- Resolve the plugin path relative to this spec file so the suite is not tied to
-- any absolute checkout location.
local here = debug.getinfo(1, "S").source:match("@(.*/)") or "./"
local plugin = dofile(here .. "../../plugins/scope-enforcement.lua")

local METRIC = "tenant.api_requests_per_minute.max"

describe("scope-enforcement plan-quota rate limit", function()
  before_each(function()
    http_response = nil
    decoded_response = nil
    last_request = nil
  end)

  it("fetch returns the numeric ceiling from a 200 plan-quota response", function()
    decoded_response = { requests_per_minute = 2400 }
    http_response = { status = 200, body = '{"requests_per_minute":2400}' }
    assert.equals(2400, plugin.fetch_plan_requests_per_minute("pln_01enterprise", METRIC))
    assert.is_not_nil(last_request)
  end)

  it("fetch returns nil for a missing plan id", function()
    assert.is_nil(plugin.fetch_plan_requests_per_minute(nil, METRIC))
  end)

  it("fetch returns nil on a non-200 response", function()
    http_response = { status = 503, body = "" }
    assert.is_nil(plugin.fetch_plan_requests_per_minute("pln_01starter", METRIC))
  end)

  it("fetch returns nil on a transport error (fail closed)", function()
    http_response = nil -- request_uri raises
    assert.is_nil(plugin.fetch_plan_requests_per_minute("pln_01starter", METRIC))
  end)

  it("resolve returns the live plan ceiling when it exceeds the static floor", function()
    decoded_response = { requests_per_minute = 2400 }
    http_response = { status = 200, body = '{"requests_per_minute":2400}' }
    local rpm = plugin.resolve_tenant_rate_limit(
      { static_requests_per_minute = 120, rate_limit_metric_key = METRIC },
      { plan_id = "pln_01enterprise" }
    )
    assert.equals(2400, rpm)
  end)

  it("resolve falls back to the static floor when the plan quota is unresolvable", function()
    http_response = { status = 500, body = "" }
    local rpm = plugin.resolve_tenant_rate_limit(
      { static_requests_per_minute = 120, rate_limit_metric_key = METRIC },
      { plan_id = "pln_unknown" }
    )
    assert.equals(120, rpm)
  end)

  it("resolve keeps the static floor when it exceeds the plan ceiling (grace floor)", function()
    decoded_response = { requests_per_minute = 100 }
    http_response = { status = 200, body = '{"requests_per_minute":100}' }
    local rpm = plugin.resolve_tenant_rate_limit(
      { static_requests_per_minute = 600, rate_limit_metric_key = METRIC },
      { plan_id = "pln_01starter" }
    )
    assert.equals(600, rpm)
  end)

  it("resolve caches the resolved ceiling and does not refetch", function()
    decoded_response = { requests_per_minute = 2400 }
    http_response = { status = 200, body = '{"requests_per_minute":2400}' }
    local conf = { static_requests_per_minute = 120, rate_limit_metric_key = METRIC }
    local claims = { plan_id = "pln_01enterprise" }
    assert.equals(2400, plugin.resolve_tenant_rate_limit(conf, claims))
    -- A subsequent transport error would surface if the cache were bypassed.
    http_response = nil
    assert.equals(2400, plugin.resolve_tenant_rate_limit(conf, claims))
  end)
end)
