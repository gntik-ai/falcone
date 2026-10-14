# Serve the next console beside the legacy console

## Why

The next console builds with a `/next/` base but the released web-console image contains only
the legacy bundle. Its static server consequently returns legacy HTML at `/next`. Issue #1070
is the foundation for subsequent page migrations, with risk R2 because serving and image release
are shared by both consoles.

## What changes

- Build both consoles from the existing workspace lockfile in the single `in-falcone-web-console`
  image. Keep `NODE_BASE_IMAGE`, UID 1000, the zero-write server and its command.
- Serve `/next` directly and `/next/*` from `/app/dist-next`, overridable with
  `WEB_CONSOLE_NEXT_STATIC_ROOT`. Reuse the legacy CSP and security headers, isolate the next
  SPA fallback, cache next assets immutably and reject traversal before normalizing paths.
- Mirror next serving in nginx; keep `/healthz`, `/v1` proxying and legitimate legacy routes.
- Validate and inject the same release version and source SHA into both production builds.
  Add a Spanish About entry to the next shell showing the version and seven-character SHA.
- Build both bundles on the release host, verify both HTML version metas in the published image
  at its verified digest, and record the digest-pinned reference in the existing step summary.
  Replays verify existing images too. Keep PR CI equivalent to the release build commands.

## Boundaries and rollback

No dependencies, registry credentials, package-access configuration, chart keys, image names,
Services or Ingresses are added. No page migrations or legacy cutover are included. The release
build disables the CSP harness. The image digest is evidence, never an embedded build value.
Deployment-side digest updates belong to the deterministic Helm adapter; no deployment is
performed here. Roll back by selecting the previous web-console digest through that adapter.

The existing release evidence channel is `GITHUB_STEP_SUMMARY`; the verified digest and image
reference are also exposed as step outputs. No separate evidence channel is introduced.
