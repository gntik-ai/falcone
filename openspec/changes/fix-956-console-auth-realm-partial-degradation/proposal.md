# fix-956-console-auth-realm-partial-degradation

## Why

The Auth/IAM console currently treats the users, roles, scopes, and clients inventory as one
request. A failure from one endpoint hides all successful realm data and offers a retry that
unnecessarily reloads healthy resources.

## What Changes

- Load each realm inventory section independently and preserve successful section data.
- Attribute localized errors to their Spanish section names, without exposing transport errors.
- Offer a retry only for retryable section failures and scope it to that endpoint.
- Preserve the first available compatibility response while resetting all section state on a
  tenant or realm change.

## Non-Goals

- Add the missing IAM scopes endpoint or change backend, gateway, OpenAPI, or generated clients.
- Change application/provider loading or mutation workflows.

## Risks and Rollback

This is a presentation-only change. A partial inventory is clearly marked per failed section.
Rollback is a revert of the page, focused tests, and this change record.
