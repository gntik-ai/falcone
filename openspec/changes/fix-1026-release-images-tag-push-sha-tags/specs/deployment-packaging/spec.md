## ADDED Requirements

### Requirement: Release images publish from version tag pushes with immutable commit tags

The release-images workflow SHALL run for a pushed strict `vX.Y.Z` tag, a published GitHub Release,
and its existing manual dispatch. It SHALL keep the `build-push` job and its six-image matrix on
GitHub-hosted Ubuntu runners. For every published image it SHALL emit `<version>` and
`sha-<github.sha[:7]>` tags through one build-push action, and it SHALL verify those references
resolve to the same manifest digest. Stable tag-triggered builds SHALL additionally publish
`latest`.

#### Scenario: A version tag starts one immutable release image build

- **WHEN** `vX.Y.Z` is pushed for commit `C`
- **THEN** the workflow builds each matrix image with event `push`, head SHA `C`, a `X.Y.Z` tag, and
  a `sha-<C[:7]>` tag that resolves to the same digest

#### Scenario: A following published release reuses the existing images

- **WHEN** a published GitHub Release refers to a tag whose version and SHA tags already resolve to
  the same manifest digest
- **THEN** its serialized run skips the build for that image and succeeds without changing either
  digest

#### Scenario: Existing images are unsafe to reuse

- **WHEN** either existing tag is missing, inspection errors for a reason other than not-found, or
  the two existing tags resolve to different digests
- **THEN** the workflow fails before it can overwrite a release tag

#### Scenario: Invalid tags cannot publish an image

- **WHEN** the resolved tag is empty or does not match `v?X.Y.Z` with numeric components
- **THEN** the workflow fails before a build or image push occurs
