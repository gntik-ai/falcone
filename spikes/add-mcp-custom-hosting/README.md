# add-mcp-custom-hosting — throwaway verification (issue #394)

EPHEMERAL. Not production code. Evidence that the `buildCustomServerDeployment()` output
(apps/control-plane-executor/src/mcp-custom-hosting.mjs) deploys a tenant-provided image as an internal-only,
scale-to-zero MCP-server ksvc on test-cluster-b and serves MCP. See `evidence/byo-deploy.txt`.
Used the in-registry fixture image (localhost:30500/mcp-spike-fixture:v1) as a stand-in BYO server.
