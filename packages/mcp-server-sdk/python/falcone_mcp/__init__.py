"""Falcone MCP server SDK (Python) — change add-mcp-server-sdk, #401; epic #386.

Mirrors the unit-tested TypeScript contract (../../src): tenant-scoped db/storage/functions/events
clients injected into tool handlers over the official MCP SDK (FastMCP). The tenant/workspace are
fixed from the verified request credential and forced onto every client call; nested user data is
passed through untouched. A tool cannot escape its tenant scope (ADR-2; the executor applies RLS
from the attached tenant). `call` is the injected transport the host wires to the executor.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Optional

Call = Callable[[dict], Awaitable[Any]]


def _scoped(binding: dict, request: dict) -> dict:
    rest = {k: v for k, v in request.items() if k not in ("tenantId", "workspaceId")}
    return {**rest, "tenantId": binding["tenantId"], "workspaceId": binding["workspaceId"]}


class FalconeContext:
    """Tenant-scoped clients (db / storage / functions / events) for a tool invocation."""

    def __init__(self, tenant_id: str, workspace_id: Optional[str], call: Call):
        if not tenant_id:
            raise ValueError("FalconeContext requires a credential-derived tenant_id.")
        self.tenant_id = tenant_id
        self.workspace_id = workspace_id
        self._binding = {"tenantId": tenant_id, "workspaceId": workspace_id}
        self._call = call
        self.db = _Db(self)
        self.storage = _Storage(self)
        self.functions = _Functions(self)
        self.events = _Events(self)

    async def _send(self, capability: str, op: str, **params) -> Any:
        return await self._call(_scoped(self._binding, {"capability": capability, "op": op, **params}))


class _Db:
    def __init__(self, ctx: FalconeContext):
        self._ctx = ctx

    async def query(self, sql: str, values: Optional[list] = None) -> Any:
        return await self._ctx._send("postgres", "query", sql=sql, values=values or [])

    async def select(self, table: str, filter: Optional[dict] = None) -> Any:
        return await self._ctx._send("postgres", "select", table=table, filter=filter or {})

    async def insert(self, table: str, row: Optional[dict] = None) -> Any:
        return await self._ctx._send("postgres", "insert", table=table, row=row or {})


class _Storage:
    def __init__(self, ctx: FalconeContext):
        self._ctx = ctx

    async def get(self, key: str) -> Any:
        return await self._ctx._send("storage", "get", key=key)

    async def put(self, key: str, body: Any, options: Optional[dict] = None) -> Any:
        return await self._ctx._send("storage", "put", key=key, body=body, options=options or {})


class _Functions:
    def __init__(self, ctx: FalconeContext):
        self._ctx = ctx

    async def invoke(self, name: str, payload: Optional[dict] = None) -> Any:
        return await self._ctx._send("functions", "invoke", name=name, payload=payload or {})


class _Events:
    def __init__(self, ctx: FalconeContext):
        self._ctx = ctx

    async def publish(self, topic: str, event: Optional[dict] = None) -> Any:
        return await self._ctx._send("events", "publish", topic=topic, event=event or {})


def create_falcone_context(tenant_id: str, workspace_id: Optional[str], call: Call) -> FalconeContext:
    return FalconeContext(tenant_id, workspace_id, call)


def falcone_tool(mcp, *, resolve_tenant: Callable[[Any], dict], call: Call):
    """Decorator factory: register a FastMCP tool whose handler receives (args, ctx).

    The tenant is resolved from the verified request via ``resolve_tenant`` (never from tool args),
    and a fresh tenant-scoped context is built per invocation.
    """

    def decorator(handler):
        async def wrapper(args: dict, request: Any):
            scope = resolve_tenant(request) or {}
            ctx = create_falcone_context(scope.get("tenantId"), scope.get("workspaceId"), call)
            return await handler(args or {}, ctx)

        mcp.tool()(wrapper)
        return wrapper

    return decorator
