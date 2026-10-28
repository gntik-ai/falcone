# Tasks

- [x] Run the 3072 MiB Dockerfile contract against the original 1536 MiB RUN instructions and observe the mismatch before changing source.
- [x] Set both Vite RUN instructions to 3072 MiB while preserving exactly three builder RUN layers.
- [x] Cover 512, 768, and 1536 MiB mutations independently for both builds and retain the combined install/build rejection.
- [x] Record the paired 3072 MiB heap / 4Gi BuildConfig limit and changed existing test expectations.
- [ ] Run the complete root-context black-box suite successfully (sandbox subprocess restrictions prevent the service-catalog check).
- [x] Measure `/next/` peak RSS: 2354.2 MiB, 717.8 MiB below 3072 MiB (RSS comparison, not V8 heap margin).
- [ ] Deployment maker: change only the web-console default BuildConfig limit to 4Gi, retain 512Mi request, and use a non-default isolation-test override.
- [ ] Deployment maker: pass chart tests and prove Helm rendering changes only the web-console BuildConfig limit.
- [x] Hermes: pair the immutable deployment commit in both workflow pins after the deployment change (`d9f6dd828207c4f2ae6f51f427775aff206e3ee1`).
- [ ] PR CI: pass the web-console-next job, including the legacy console image build.
- [x] Review the reported welcome focus failure against the immutable base and record why its execution path is outside this ChangeSet.
- [x] Recheck both independent heap mutations and the existing CI structure and parity-tool tests without changing assertions or gates.
- [ ] PR CI: rerun parity shard 4 and the aggregate; local browser verification is unavailable in the maker sandbox.
