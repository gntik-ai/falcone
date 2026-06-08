---
description: Extract user stories from the use cases/functionalities - real-user flows over the BaaS. Writes audit/user-stories.md.
argument-hint: "[capability to focus on]   (optional)"
allowed-tools: Read, Grep, Glob, Bash, Write
---
Derive user stories (`us-…`) from `audit/use-cases.md` and `audit/functionalities.md` (run `/use-cases` first if missing). Focus: $ARGUMENTS.

Each story: "As a <actor: tenant admin / app developer / end user>, I want <goal> so that <value>", with acceptance criteria (Given/When/Then), the explicit tenant context, the linked `uc-…`/`fn-…`, and the step-by-step UI/API flow a REAL user would follow to accomplish it — the script a Playwright spec will replicate (sign in, create/query data, configure access rules, upload files, realtime, tenant admin, etc.).

Prefer delegating to the `use-case-writer` subagent. Write `audit/user-stories.md` grouped by capability. Output a short summary + path.
