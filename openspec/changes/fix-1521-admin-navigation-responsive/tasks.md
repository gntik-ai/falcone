# Tasks

- [x] Replace the stale-menu responsive loop with per-width close, resize, reopen and measure steps.
- [x] Cover superadmin and tenant_owner on `console/overview` and `admin` in en and es at 375, 768 and 1280 px.
- [x] Keep the closed-menu axe gate, the open-menu baseline comparison and the `touchesEntry` check unchanged.
- [x] Persist the Playwright HTML and JSON reports and the attachments, and upload them as the `shell-playwright-report` CI artifact.
- [ ] In PR CI, confirm the shell suite passes and record the measured scrollWidth/clientWidth from the `shell-playwright-report` artifact in the PR.
- [ ] If CI shows a real overflow, apply a minimal shell fix that preserves the accessible names.
