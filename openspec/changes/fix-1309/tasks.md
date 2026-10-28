# Tasks

- [x] Run the 3072 MiB Dockerfile contract against the original 1536 MiB RUN instructions and observe the mismatch before changing source.
- [x] Set both Vite RUN instructions to 3072 MiB while preserving exactly three builder RUN layers.
- [x] Cover 512, 768, and 1536 MiB mutations independently for both builds and retain the combined install/build rejection.
- [x] Record the paired 3072 MiB heap / 4Gi BuildConfig limit and changed existing test expectations.
- [ ] Run the complete root-context black-box suite successfully (sandbox subprocess restrictions prevent the service-catalog check).
- [x] Measure `/next/` peak RSS: 2354.2 MiB, 717.8 MiB below 3072 MiB (RSS comparison, not V8 heap margin).
- [ ] Deployment maker: change only the web-console default BuildConfig limit to 4Gi, retain 512Mi request, and use a non-default isolation-test override.
- [ ] Deployment maker: pass chart tests and prove Helm rendering changes only the web-console BuildConfig limit.
- [ ] Hermes: pair the immutable deployment commit in both workflow pins after the deployment change.
- [ ] PR CI: pass the web-console-next job, including the legacy console image build.
