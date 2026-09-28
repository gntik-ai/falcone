# Proposal: Build release images on version-tag pushes with immutable SHA tags

## Why

Hermes waits for a release-images workflow run for the merge commit that receives a version tag.
The workflow currently starts only after a GitHub Release is published and publishes only a mutable
version tag, so the required run and immutable `sha-<commit>` image references do not exist.

## What changes

- Trigger release-image publication from `v*.*.*` tag pushes while retaining published-release and
  manual triggers.
- Resolve strict semantic versions from the event tag, publish the version and `sha-<github.sha[:7]>`
  tags in one build action, and publish `latest` only for stable tag-triggered releases.
- Serialize same-tag push and release events. Release/tag replays skip only after both tags are
  present and resolve to the same digest; partial, conflicting, or inspection-error states fail.
- Verify the two pushed tags resolve to one digest and record that digest in the job summary.

## Non-goals

- Change Dockerfiles, build contexts, platforms, provenance settings, the six-image matrix, chart
  image pins, or the release/tag creation automation.
- Add runners, credentials, secrets, or publish any image during this repository change.

## Impact and rollback

This is an R1 CI-only workflow change. Reverting the workflow restores the prior trigger behavior;
immutable SHA tags already published are additive and do not require deletion.
