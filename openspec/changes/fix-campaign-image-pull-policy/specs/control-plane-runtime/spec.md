# control-plane-runtime — spec delta for fix-campaign-image-pull-policy

## ADDED Requirements

### Requirement: Install runs stale node-cached images (tag reuse + IfNotPresent)

The system SHALL ensure that install runs stale node-cached images (tag reuse + IfNotPresent) is corrected: Use unique per-build tags (or `imagePullPolicy: Always`) in install.sh/executor-demo.yaml/values; drop the gateway-secret pre-create (chart owns it).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A rebuild always runs the new code on the next deploy
