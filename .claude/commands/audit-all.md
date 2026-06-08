---
description: Run the full code-only analysis pipeline (recon -> capabilities -> use-cases -> user-stories -> coverage -> bugs -> proposed features).
argument-hint: "[path to focus on]   (optional)"
allowed-tools: Read, Grep, Glob, Bash, Write
---
Run the whole analysis from source code only, in order, writing artifacts under `audit/`:
1. `/recon` -> audit/recon.md
2. `/capabilities` -> audit/capabilities.md, audit/functionalities.md
3. `/use-cases` -> audit/use-cases.md
4. `/user-stories` -> audit/user-stories.md
5. `/coverage` -> audit/coverage.md
6. `/audit-isolation` + `/find-bugs` -> audit/bugs.md
7. `/propose-features` -> audit/proposed-features.md
Focus (optional): $ARGUMENTS. Delegate each step to its subagent.
After all steps, print a consolidated summary (counts of capabilities, functionalities, user stories, uncovered items, bugs by severity, proposed features) and remind the user to run `/file-issues` to publish to GitHub and `/build-e2e` to generate the real-user E2E suite.
