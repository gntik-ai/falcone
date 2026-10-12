# Safe repository separation design

## Decision, options and boundaries

Operator-approved decision: **(d) + (a)**. Keep `openspec/` at the root; eventually
group loop state, spikes and process snapshots under `.engineering/`. No symlinks.
Phase 1 only removes accidental IDE files and adds documentation; no path moves,
runtime changes, workflow edits, Helm changes or deployment-repository edits.

| Option | Benefits | Costs / decision |
| --- | --- | --- |
| (a) One .engineering/ directory | Single checkout; git mv preserves traceability; clear public root | Readers and Hermes must migrate together; selected for non-OpenSpec material |
| (b) Companion repository | Clean source root; independent process access policy | Cross-repo revisions, missing evidence in checkouts, delivery coordination; rejected |
| (c) Git submodule | Pinned external revision | Recursive checkout/auth friction; fragmented history and atomicity; rejected |
| (d) OpenSpec at root | Preserves OpenSpec convention and maker workflows | One documented agent-memory root remains; selected with (a) |

`docs/track-f/**` is process (triage, delivery plans and agent prompts), so it is a
phase-2 move candidate with its own Hermes confirmation gate. It is not part of
the docs-site build input (`docs-site/` remains product). Keep `internal-contracts/`,
`packages/internal-contracts/` and `packages/internal-contracts/src/public-route-catalog.json`
in place. `internal-contracts/secrets/` remains a schema baseline even though its
inventory class is process. Retain original logo pending owner decision. README
translations remain unchanged; translation work is optional and deferred.

## Phase-2 map and ordering

| Old prefix | New prefix | Condition |
| --- | --- | --- |
| `falcone-loop-state/` | `.engineering/falcone-loop-state/` | Hermes loop-state read/write and in-flight gates verified |
| `spikes/` | `.engineering/spikes/` | Hermes baseline scope and all source readers verified |
| `delivery-adapter/` | `.engineering/delivery-adapter/` | Hermes owner confirms consumers and retention; unresolved blocks phase 2 |
| `docs/track-f/` | `.engineering/docs/track-f/` | Process classification established; Hermes owner confirms consumers; unresolved blocks this move |
| `openspec/` | `openspec/` (identity) | Never moved in this design |
| `internal-contracts/` | `internal-contracts/` (identity) | Never moved in this design |

Phase 2 is a separate ChangeSet after deployed dual-layout Hermes is verified.
Its first commit is pure `git mv`; compare every new-path blob with its old-path
baseline blob, equal per-directory file counts, and `git log --follow` for RUNLOG.
Its second commit updates only the reader locations below and introduces
`scripts/check-old-paths.sh` and `.engineering/old-path-allowlist.txt`.
Re-run discovery at the immutable phase-1 head, accounting for README/CONTRIBUTING
and this change's new planning references, before authorizing phase 2.

Do not add moved spike package files to `pnpm-workspace.yaml`: current workspace
globs include apps, packages, tools, tests and docs-site only. Moving to
`.engineering/spikes/` must keep the experiment packages and their lockfiles outside
workspace installation/publishing. Keep GAP-001/FILE-SHA256SUMS byte-identical;
relative manifest entries still resolve under its moved GAP-001 root. Verify the
11-file present subset in inventory.md; missing 142 files remain missing.

## Exhaustive input reader table by target being moved

Discovery command (tracked input, including ignored OpenSpec):

```sh
git grep -n -I -e 'spikes/' -e 'falcone-loop-state' -e 'delivery-adapter' -e 'track-f' dead4806656a400a0d6db86a74e0f210c6aee6e9 --
```

The table contains every one of its 41 hit locations (15 spikes, 4 loop-state,
3 delivery-adapter, 19 track-f). Source text is intentionally omitted for credential
safety; citations and expected transformations are enough to reproduce the review.
Conditions follow the **target** path: a loop-state reference in track-f must
change even if track-f stays at its old location. For a moved reader file, apply
the edit at its mapped new location. Never use a global blind replacement.

| Target | Reader file:line | Move condition | Status | Expected diff or exemption |
| --- | --- | --- | --- | --- |
| delivery-adapter | `delivery-adapter/GAP-001/README.md:3` | delivery-adapter moves | live | No diff: descriptive `delivery-adapter` name is not a filesystem path; relocated README still describes snapshot. |
| delivery-adapter | `delivery-adapter/GAP-001/test-fixtures/falcone/staging-backup-evidence-contract.json:6` | delivery-adapter moves | live evidence scope identifier | No diff: `delivery-adapter` scope identifier is not a path; retain contract compatibility. Checker recognizes path tokens, not bare scope names. |
| spikes/ | `docs-site/architecture/adrs.md:98` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. Preserve existing stale service references; broader ADR correction is out of scope. |
| spikes/ | `docs-site/architecture/adrs.md:116` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |
| falcone-loop-state | `docs/track-f/falcone-track-getting-started.md:34` | loop state moves (regardless of track-f move) | live | Replace root `falcone-loop-state/` with `.engineering/falcone-loop-state/`; retain filename. |
| track-f | `docs/track-f/falcone-track-getting-started.md:36` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| track-f | `docs/track-f/falcone-track-getting-started.md:45` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| track-f | `docs/track-f/falcone-track-getting-started.md:46` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| track-f | `docs/track-f/falcone-track-getting-started.md:99` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| track-f | `docs/track-f/falcone-track-getting-started.md:124` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| track-f | `docs/track-f/falcone-track-getting-started.md:147` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| track-f | `docs/track-f/prompts/f0-verification.md:5` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| falcone-loop-state | `docs/track-f/prompts/f0-verification.md:16` | loop state moves (regardless of track-f move) | live | Replace root `falcone-loop-state/` with `.engineering/falcone-loop-state/`; retain filename. |
| track-f | `docs/track-f/prompts/w1-fal-001-spec.md:5` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| track-f | `docs/track-f/prompts/w1-fal-012-spec.md:4` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| track-f | `docs/track-f/prompts/w1-fal-012-spec.md:6` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| falcone-loop-state | `docs/track-f/triage.md:332` | loop state moves (regardless of track-f move) | live | Replace root `falcone-loop-state/` with `.engineering/falcone-loop-state/`; retain filename. |
| falcone-loop-state | `docs/track-f/triage.md:334` | loop state moves (regardless of track-f move) | live | Replace root `falcone-loop-state/` with `.engineering/falcone-loop-state/`; retain filename. |
| track-f | `falcone-loop-state/CAPABILITIES.md:349` | track-f moves only | live | Update track-f source-of-truth directory reference to `.engineering/docs/track-f/`. |
| track-f | `falcone-loop-state/COVERAGE.md:199` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| track-f | `falcone-loop-state/FINDINGS.md:923` | track-f moves only | historical ledger | No edit to recorded observation: baseline-pinned RUNLOG/FINDINGS exemption; new added lines still checked. |
| track-f | `falcone-loop-state/FINDINGS.md:1591` | track-f moves only | historical ledger | No edit to recorded observation: baseline-pinned RUNLOG/FINDINGS exemption; new added lines still checked. |
| track-f | `falcone-loop-state/RUNLOG.md:6` | track-f moves only | historical ledger | No edit to recorded observation: baseline-pinned RUNLOG/FINDINGS exemption; new added lines still checked. |
| track-f | `falcone-loop-state/RUNLOG.md:417` | track-f moves only | historical ledger | No edit to recorded observation: baseline-pinned RUNLOG/FINDINGS exemption; new added lines still checked. |
| track-f | `falcone-loop-state/RUNLOG.md:666` | track-f moves only | historical ledger | No edit to recorded observation: baseline-pinned RUNLOG/FINDINGS exemption; new added lines still checked. |
| track-f | `falcone-loop-state/RUNLOG.md:667` | track-f moves only | historical ledger | No edit to recorded observation: baseline-pinned RUNLOG/FINDINGS exemption; new added lines still checked. |
| track-f | `falcone-loop-state/TEST-PLAN.md:20` | track-f moves only | live | Replace root `docs/track-f/` with `.engineering/docs/track-f/`; retain suffix. |
| spikes/ | `packages/adapters/src/seaweedfs-iam-client.mjs:8` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |
| spikes/ | `packages/provisioning-orchestrator/src/config/seaweedfs-compat-matrix.json:2` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |
| delivery-adapter | `scripts/operations/staging-backup-evidence-contract.json:6` | delivery-adapter moves | live evidence scope identifier | No diff: `delivery-adapter` scope identifier is not a path; retain contract compatibility. Checker recognizes path tokens, not bare scope names. |
| spikes/ | `spikes/add-flows-adr-temporal-spikes/README.md:23` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |
| spikes/ | `spikes/add-flows-adr-temporal-spikes/spike-a/evidence/kill-resume-history.json:325` | spikes moves | historical captured history | No edit: embedded captured stack path; baseline-pinned historical exemption. |
| spikes/ | `spikes/add-flows-adr-temporal-spikes/spike-a/evidence/notes.md:6` | spikes moves | live evidence commentary | Update executable/root-relative example to `.engineering/spikes/`; notes.md is not allowlisted. |
| spikes/ | `spikes/add-mcp-hosting-adr-spikes/README.md:4` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |
| spikes/ | `spikes/add-mcp-hosting-adr-spikes/README.md:19` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |
| spikes/ | `spikes/add-mcp-workflows-as-tools/README.md:27` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |
| spikes/ | `spikes/add-mcp-workflows-as-tools/README.md:32` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |
| spikes/ | `tests/blackbox/flows-adr-spike-artifacts.test.mjs:19` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |
| spikes/ | `tests/env/seaweedfs/run.sh:14` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |
| spikes/ | `tests/unit/storage-handlers-xml-parsing.test.mjs:14` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |
| spikes/ | `tools/migration/compat-gate.sh:6` | spikes moves | live | Replace root `spikes/` with `.engineering/spikes/`; retain suffix. |

The only historical exemptions in this input table are captured Temporal history
and RUNLOG/FINDINGS observations. CAPABILITIES:349, COVERAGE:199 and TEST-PLAN:20
are live instructions and must change if track-f moves. Neither an evidence folder
nor a .md extension alone makes a file historical.

## Readers and declarations added by phase 1

The original reader table is anchored to the pre-change input. Re-running its
tracked-file grep at the literal completed phase-1 baseline B finds **272** hit
locations: the original 41 plus these **231** added locations. The additional
8 contributor-document references are live readers. The remaining 223 locations
are this change's inventory and migration declarations, not external consumers;
they are nevertheless listed exhaustively below and are never allowlisted.
Locations in this supplemental table refer to B, so editing this design does not
silently redefine the evidence. Resolve a moved reader at its mapped location.

```sh
git grep -n -I -e 'spikes/' -e 'falcone-loop-state' -e 'delivery-adapter' -e 'track-f' 5ce1715d68cbdd5f72ce157a23fb88f5f28bd3ab --
```

| Target / condition | Reader or declaration file:line at B | Status | Expected phase-2 diff |
| --- | --- | --- | --- |
| track-f moves | `CONTRIBUTING.md:19`, `README.md:289` | live layout documentation | Replace docs/track-f/ with .engineering/docs/track-f/. |
| loop state moves | `CONTRIBUTING.md:16`, `README.md:294` | live layout documentation | Replace falcone-loop-state/ with .engineering/falcone-loop-state/. |
| spikes moves | `CONTRIBUTING.md:17`, `README.md:295` | live layout documentation | Replace spikes/ with .engineering/spikes/. |
| delivery-adapter moves | `CONTRIBUTING.md:18`, `README.md:296` | live layout documentation | Replace delivery-adapter/ with .engineering/delivery-adapter/. |
| Each referenced target moves; OpenSpec itself stays | `openspec/changes/restructure-repository-agent-material/design.md:17`, `openspec/changes/restructure-repository-agent-material/design.md:29`, `openspec/changes/restructure-repository-agent-material/design.md:30`, `openspec/changes/restructure-repository-agent-material/design.md:31`, `openspec/changes/restructure-repository-agent-material/design.md:32`, `openspec/changes/restructure-repository-agent-material/design.md:46`, `openspec/changes/restructure-repository-agent-material/design.md:56`, `openspec/changes/restructure-repository-agent-material/design.md:60`, `openspec/changes/restructure-repository-agent-material/design.md:62`, `openspec/changes/restructure-repository-agent-material/design.md:63`, `openspec/changes/restructure-repository-agent-material/design.md:68`, `openspec/changes/restructure-repository-agent-material/design.md:69`, `openspec/changes/restructure-repository-agent-material/design.md:70`, `openspec/changes/restructure-repository-agent-material/design.md:71`, `openspec/changes/restructure-repository-agent-material/design.md:72`, `openspec/changes/restructure-repository-agent-material/design.md:73`, `openspec/changes/restructure-repository-agent-material/design.md:74`, `openspec/changes/restructure-repository-agent-material/design.md:75`, `openspec/changes/restructure-repository-agent-material/design.md:76`, `openspec/changes/restructure-repository-agent-material/design.md:77`, `openspec/changes/restructure-repository-agent-material/design.md:78`, `openspec/changes/restructure-repository-agent-material/design.md:79`, `openspec/changes/restructure-repository-agent-material/design.md:80`, `openspec/changes/restructure-repository-agent-material/design.md:81`, `openspec/changes/restructure-repository-agent-material/design.md:82`, `openspec/changes/restructure-repository-agent-material/design.md:83`, `openspec/changes/restructure-repository-agent-material/design.md:84`, `openspec/changes/restructure-repository-agent-material/design.md:85`, `openspec/changes/restructure-repository-agent-material/design.md:86`, `openspec/changes/restructure-repository-agent-material/design.md:87`, `openspec/changes/restructure-repository-agent-material/design.md:88`, `openspec/changes/restructure-repository-agent-material/design.md:89`, `openspec/changes/restructure-repository-agent-material/design.md:90`, `openspec/changes/restructure-repository-agent-material/design.md:91`, `openspec/changes/restructure-repository-agent-material/design.md:92`, `openspec/changes/restructure-repository-agent-material/design.md:93`, `openspec/changes/restructure-repository-agent-material/design.md:94`, `openspec/changes/restructure-repository-agent-material/design.md:95`, `openspec/changes/restructure-repository-agent-material/design.md:96`, `openspec/changes/restructure-repository-agent-material/design.md:97`, `openspec/changes/restructure-repository-agent-material/design.md:98`, `openspec/changes/restructure-repository-agent-material/design.md:99`, `openspec/changes/restructure-repository-agent-material/design.md:100`, `openspec/changes/restructure-repository-agent-material/design.md:101`, `openspec/changes/restructure-repository-agent-material/design.md:102`, `openspec/changes/restructure-repository-agent-material/design.md:103`, `openspec/changes/restructure-repository-agent-material/design.md:104`, `openspec/changes/restructure-repository-agent-material/design.md:105`, `openspec/changes/restructure-repository-agent-material/design.md:106`, `openspec/changes/restructure-repository-agent-material/design.md:107`, `openspec/changes/restructure-repository-agent-material/design.md:108`, `openspec/changes/restructure-repository-agent-material/design.md:112`, `openspec/changes/restructure-repository-agent-material/design.md:136`, `openspec/changes/restructure-repository-agent-material/design.md:137`, `openspec/changes/restructure-repository-agent-material/design.md:158`, `openspec/changes/restructure-repository-agent-material/design.md:159`, `openspec/changes/restructure-repository-agent-material/design.md:184`, `openspec/changes/restructure-repository-agent-material/design.md:185`, `openspec/changes/restructure-repository-agent-material/design.md:207` | live inventory/design declarations | Refresh the inventory and migration prose to the mapped layout; retain original observations in Git history. Canonical old prefixes belong only to the checker/map header. No historical exemption. |
| Each referenced target moves; OpenSpec itself stays | `openspec/changes/restructure-repository-agent-material/inventory.md:55`, `openspec/changes/restructure-repository-agent-material/inventory.md:72`, `openspec/changes/restructure-repository-agent-material/inventory.md:82`, `openspec/changes/restructure-repository-agent-material/inventory.md:83`, `openspec/changes/restructure-repository-agent-material/inventory.md:84`, `openspec/changes/restructure-repository-agent-material/inventory.md:95`, `openspec/changes/restructure-repository-agent-material/inventory.md:97`, `openspec/changes/restructure-repository-agent-material/inventory.md:99`, `openspec/changes/restructure-repository-agent-material/inventory.md:133`, `openspec/changes/restructure-repository-agent-material/inventory.md:134`, `openspec/changes/restructure-repository-agent-material/inventory.md:135`, `openspec/changes/restructure-repository-agent-material/inventory.md:152`, `openspec/changes/restructure-repository-agent-material/inventory.md:163`, `openspec/changes/restructure-repository-agent-material/inventory.md:167`, `openspec/changes/restructure-repository-agent-material/inventory.md:169`, `openspec/changes/restructure-repository-agent-material/inventory.md:171`, `openspec/changes/restructure-repository-agent-material/inventory.md:172`, `openspec/changes/restructure-repository-agent-material/inventory.md:173`, `openspec/changes/restructure-repository-agent-material/inventory.md:174`, `openspec/changes/restructure-repository-agent-material/inventory.md:175`, `openspec/changes/restructure-repository-agent-material/inventory.md:176`, `openspec/changes/restructure-repository-agent-material/inventory.md:189`, `openspec/changes/restructure-repository-agent-material/inventory.md:191`, `openspec/changes/restructure-repository-agent-material/inventory.md:210`, `openspec/changes/restructure-repository-agent-material/inventory.md:239`, `openspec/changes/restructure-repository-agent-material/inventory.md:243`, `openspec/changes/restructure-repository-agent-material/inventory.md:244`, `openspec/changes/restructure-repository-agent-material/inventory.md:245`, `openspec/changes/restructure-repository-agent-material/inventory.md:246`, `openspec/changes/restructure-repository-agent-material/inventory.md:247`, `openspec/changes/restructure-repository-agent-material/inventory.md:248`, `openspec/changes/restructure-repository-agent-material/inventory.md:249`, `openspec/changes/restructure-repository-agent-material/inventory.md:250`, `openspec/changes/restructure-repository-agent-material/inventory.md:265`, `openspec/changes/restructure-repository-agent-material/inventory.md:278`, `openspec/changes/restructure-repository-agent-material/inventory.md:279`, `openspec/changes/restructure-repository-agent-material/inventory.md:280`, `openspec/changes/restructure-repository-agent-material/inventory.md:281`, `openspec/changes/restructure-repository-agent-material/inventory.md:283`, `openspec/changes/restructure-repository-agent-material/inventory.md:284`, `openspec/changes/restructure-repository-agent-material/inventory.md:285`, `openspec/changes/restructure-repository-agent-material/inventory.md:286`, `openspec/changes/restructure-repository-agent-material/inventory.md:287`, `openspec/changes/restructure-repository-agent-material/inventory.md:288`, `openspec/changes/restructure-repository-agent-material/inventory.md:289`, `openspec/changes/restructure-repository-agent-material/inventory.md:290`, `openspec/changes/restructure-repository-agent-material/inventory.md:292`, `openspec/changes/restructure-repository-agent-material/inventory.md:300`, `openspec/changes/restructure-repository-agent-material/inventory.md:310`, `openspec/changes/restructure-repository-agent-material/inventory.md:548`, `openspec/changes/restructure-repository-agent-material/inventory.md:576`, `openspec/changes/restructure-repository-agent-material/inventory.md:603`, `openspec/changes/restructure-repository-agent-material/inventory.md:607`, `openspec/changes/restructure-repository-agent-material/inventory.md:647`, `openspec/changes/restructure-repository-agent-material/inventory.md:666`, `openspec/changes/restructure-repository-agent-material/inventory.md:667`, `openspec/changes/restructure-repository-agent-material/inventory.md:668`, `openspec/changes/restructure-repository-agent-material/inventory.md:669`, `openspec/changes/restructure-repository-agent-material/inventory.md:670`, `openspec/changes/restructure-repository-agent-material/inventory.md:671`, `openspec/changes/restructure-repository-agent-material/inventory.md:738`, `openspec/changes/restructure-repository-agent-material/inventory.md:739`, `openspec/changes/restructure-repository-agent-material/inventory.md:740`, `openspec/changes/restructure-repository-agent-material/inventory.md:741`, `openspec/changes/restructure-repository-agent-material/inventory.md:742`, `openspec/changes/restructure-repository-agent-material/inventory.md:743`, `openspec/changes/restructure-repository-agent-material/inventory.md:744`, `openspec/changes/restructure-repository-agent-material/inventory.md:745`, `openspec/changes/restructure-repository-agent-material/inventory.md:1540`, `openspec/changes/restructure-repository-agent-material/inventory.md:1541`, `openspec/changes/restructure-repository-agent-material/inventory.md:1542`, `openspec/changes/restructure-repository-agent-material/inventory.md:1543`, `openspec/changes/restructure-repository-agent-material/inventory.md:1544`, `openspec/changes/restructure-repository-agent-material/inventory.md:1545`, `openspec/changes/restructure-repository-agent-material/inventory.md:1546`, `openspec/changes/restructure-repository-agent-material/inventory.md:1547`, `openspec/changes/restructure-repository-agent-material/inventory.md:1548`, `openspec/changes/restructure-repository-agent-material/inventory.md:1549`, `openspec/changes/restructure-repository-agent-material/inventory.md:1550`, `openspec/changes/restructure-repository-agent-material/inventory.md:1551`, `openspec/changes/restructure-repository-agent-material/inventory.md:1552`, `openspec/changes/restructure-repository-agent-material/inventory.md:1754`, `openspec/changes/restructure-repository-agent-material/inventory.md:1755`, `openspec/changes/restructure-repository-agent-material/inventory.md:1756`, `openspec/changes/restructure-repository-agent-material/inventory.md:1757`, `openspec/changes/restructure-repository-agent-material/inventory.md:1758`, `openspec/changes/restructure-repository-agent-material/inventory.md:1759`, `openspec/changes/restructure-repository-agent-material/inventory.md:1760`, `openspec/changes/restructure-repository-agent-material/inventory.md:1761`, `openspec/changes/restructure-repository-agent-material/inventory.md:1762`, `openspec/changes/restructure-repository-agent-material/inventory.md:1763`, `openspec/changes/restructure-repository-agent-material/inventory.md:1764`, `openspec/changes/restructure-repository-agent-material/inventory.md:1765`, `openspec/changes/restructure-repository-agent-material/inventory.md:1766`, `openspec/changes/restructure-repository-agent-material/inventory.md:1767`, `openspec/changes/restructure-repository-agent-material/inventory.md:1768`, `openspec/changes/restructure-repository-agent-material/inventory.md:1769`, `openspec/changes/restructure-repository-agent-material/inventory.md:2728`, `openspec/changes/restructure-repository-agent-material/inventory.md:2729`, `openspec/changes/restructure-repository-agent-material/inventory.md:2730`, `openspec/changes/restructure-repository-agent-material/inventory.md:2731`, `openspec/changes/restructure-repository-agent-material/inventory.md:2732`, `openspec/changes/restructure-repository-agent-material/inventory.md:2733`, `openspec/changes/restructure-repository-agent-material/inventory.md:2734`, `openspec/changes/restructure-repository-agent-material/inventory.md:2735`, `openspec/changes/restructure-repository-agent-material/inventory.md:2736`, `openspec/changes/restructure-repository-agent-material/inventory.md:2737`, `openspec/changes/restructure-repository-agent-material/inventory.md:2738`, `openspec/changes/restructure-repository-agent-material/inventory.md:2739`, `openspec/changes/restructure-repository-agent-material/inventory.md:2740`, `openspec/changes/restructure-repository-agent-material/inventory.md:2741`, `openspec/changes/restructure-repository-agent-material/inventory.md:2742`, `openspec/changes/restructure-repository-agent-material/inventory.md:2743`, `openspec/changes/restructure-repository-agent-material/inventory.md:2744`, `openspec/changes/restructure-repository-agent-material/inventory.md:2745`, `openspec/changes/restructure-repository-agent-material/inventory.md:2746`, `openspec/changes/restructure-repository-agent-material/inventory.md:2747`, `openspec/changes/restructure-repository-agent-material/inventory.md:2748`, `openspec/changes/restructure-repository-agent-material/inventory.md:2749`, `openspec/changes/restructure-repository-agent-material/inventory.md:2750`, `openspec/changes/restructure-repository-agent-material/inventory.md:2751`, `openspec/changes/restructure-repository-agent-material/inventory.md:2752`, `openspec/changes/restructure-repository-agent-material/inventory.md:2753`, `openspec/changes/restructure-repository-agent-material/inventory.md:2754`, `openspec/changes/restructure-repository-agent-material/inventory.md:2755`, `openspec/changes/restructure-repository-agent-material/inventory.md:2756`, `openspec/changes/restructure-repository-agent-material/inventory.md:2757`, `openspec/changes/restructure-repository-agent-material/inventory.md:2758`, `openspec/changes/restructure-repository-agent-material/inventory.md:2759`, `openspec/changes/restructure-repository-agent-material/inventory.md:2760`, `openspec/changes/restructure-repository-agent-material/inventory.md:2761`, `openspec/changes/restructure-repository-agent-material/inventory.md:2762`, `openspec/changes/restructure-repository-agent-material/inventory.md:2763`, `openspec/changes/restructure-repository-agent-material/inventory.md:2764`, `openspec/changes/restructure-repository-agent-material/inventory.md:2765`, `openspec/changes/restructure-repository-agent-material/inventory.md:2766`, `openspec/changes/restructure-repository-agent-material/inventory.md:2767`, `openspec/changes/restructure-repository-agent-material/inventory.md:2768`, `openspec/changes/restructure-repository-agent-material/inventory.md:2769`, `openspec/changes/restructure-repository-agent-material/inventory.md:2770`, `openspec/changes/restructure-repository-agent-material/inventory.md:2771`, `openspec/changes/restructure-repository-agent-material/inventory.md:2772`, `openspec/changes/restructure-repository-agent-material/inventory.md:2773`, `openspec/changes/restructure-repository-agent-material/inventory.md:2774`, `openspec/changes/restructure-repository-agent-material/inventory.md:2775`, `openspec/changes/restructure-repository-agent-material/inventory.md:2776`, `openspec/changes/restructure-repository-agent-material/inventory.md:2777`, `openspec/changes/restructure-repository-agent-material/inventory.md:2778`, `openspec/changes/restructure-repository-agent-material/inventory.md:2779`, `openspec/changes/restructure-repository-agent-material/inventory.md:2780`, `openspec/changes/restructure-repository-agent-material/inventory.md:2781`, `openspec/changes/restructure-repository-agent-material/inventory.md:2782`, `openspec/changes/restructure-repository-agent-material/inventory.md:2783`, `openspec/changes/restructure-repository-agent-material/inventory.md:2784`, `openspec/changes/restructure-repository-agent-material/inventory.md:2785`, `openspec/changes/restructure-repository-agent-material/inventory.md:2786`, `openspec/changes/restructure-repository-agent-material/inventory.md:2787`, `openspec/changes/restructure-repository-agent-material/inventory.md:2788`, `openspec/changes/restructure-repository-agent-material/inventory.md:2789`, `openspec/changes/restructure-repository-agent-material/inventory.md:2790`, `openspec/changes/restructure-repository-agent-material/inventory.md:2791`, `openspec/changes/restructure-repository-agent-material/inventory.md:2792`, `openspec/changes/restructure-repository-agent-material/inventory.md:2793` | live inventory/design declarations | Refresh the inventory and migration prose to the mapped layout; retain original observations in Git history. Canonical old prefixes belong only to the checker/map header. No historical exemption. |
| Each referenced target moves; OpenSpec itself stays | `openspec/changes/restructure-repository-agent-material/proposal.md:24` | live inventory/design declarations | Refresh the inventory and migration prose to the mapped layout; retain original observations in Git history. Canonical old prefixes belong only to the checker/map header. No historical exemption. |

Re-run discovery before phase 2 to catch later live reader changes. Do not treat
these frozen citations as permission to ignore new references or allowlist a live
README, prompt, script, test or any file in this change.

## Deterministic historical allowlist contract (phase 2 only)

The fixed input SHA is `dead4806656a400a0d6db86a74e0f210c6aee6e9`. The checker
baseline **B** is `5ce1715d68cbdd5f72ce157a23fb88f5f28bd3ab`, the completed
phase-1 head supplied to this worktree. This documentation refinement leaves its
tracked path set and every eligible historical blob unchanged. Preserve that
literal pin rather than selecting main, a moving branch, or the phase-2 parent.
In phase 2, copy the literal 40-hex SHA into the allowlist header `baseline <B>`
and the checker configuration before producing any allowlist rows.
Fail closed if it is absent, abbreviated, mismatched or not an ancestor of the
phase-2 branch. No inferred main/HEAD or handoff fallback is allowed. This phase-1 head
must have exactly the inventory delta above, and all candidate historical blobs
must equal their blobs at the fixed input SHA. Thus eligibility is frozen now,
and the immutable baseline identifier is recorded directly in this design.

Use exactly the prefix map above, longest matching prefix first. Entries are triples
`<oldpath> <mapped-path> <baseline-git-blob-oid>` and must exist as tracked files
at B. Eligible globs below use `**` as zero or more path components and `*` as one
component. Enumerate from `git ls-tree -r --name-only B`, never filesystem globs.

| Eligible old-path globs | Additional eligibility restriction |
| --- | --- |
| `spikes/**/evidence/*.json`, `spikes/**/evidence/*.txt`, `spikes/**/evidence/*.log`, `spikes/**/evidence/*.xml` | Only files already tracked at the fixed input and byte-identical at B; captured histories, traces, results and logs. Exclude every README, prompt, script and test. Evidence .md is not eligible. |
| `falcone-loop-state/RUNLOG.md`, `falcone-loop-state/FINDINGS.md` | Only baseline recorded lines; maps to .engineering/falcone-loop-state/ |
| `openspec/changes/**` | Archived membership is the exact empty set for this migration: none is designated archived in this input. Do not auto-archive by age, directory presence or tasks status; therefore zero OpenSpec rows are allowed. |

No README, prompt, script, test, live plan, CAPABILITIES, COVERAGE, TEST-PLAN,
manifest, internal contract or the new change directory is eligible. Archived
OpenSpec membership is deliberately empty rather than guessing which active
changes may be frozen. Any later archive designation needs its own reviewed
explicit membership change; `openspec/` stays at the root in either case.

For each candidate, validate its recorded OID with
`git rev-parse <B>:<oldpath>` and its identity mapping or mapped prefix. Compare the
pure-move commit blob at `<mapped-path>` against that old-path OID, never against
`<B>:<mapped-path>` (the new path may not exist at B). Missing/extra/duplicate rows,
invalid mappings, mismatched blobs, changed manifests or changed directory counts
fail the gate. Git blob OIDs here are separate from the manifest's SHA256 digests.

For the reader-edit commit, compare pinned files to their baseline blobs using
`git diff --no-ext-diff --no-textconv --unified=0 <B>:<oldpath> <head>:<mapped-path>`.
Only unchanged baseline lines may retain old-path tokens: scan every added line
for old root paths and reject stale references even inside an allowlisted file.
Unpinned/new files are scanned in full. Detect root-relative tokens and variants
in quoted strings, links and stack traces (also ./spikes/ and absolute stack paths);
do not mistake `.engineering/spikes/` for a stale `spikes/` root. Bare semantic
scope identifiers are not paths. Inventory/design old-path declarations are live
and never implicitly allowlisted: phase 2 must update or replace them with current
mapped paths; the checker/map header alone owns canonical old-prefix declarations.

Required negative fixtures in phase 2: an old path in a new file fails; one in a
live README fails; an added stale line in pinned evidence fails; unchanged captured
history passes; a forged baseline OID or out-of-map row fails. The new check runs
after both commits, and reader edits remain bounded to this table plus refreshed
phase-1 README/CONTRIBUTING/change planning references.

## Hermes follow-up (external ownership gates)

The source snapshot does not contain engineering-control's authoritative project
configuration or resolver code. GAP-001's manifest names
`hermes-workflows-suite/config/projects.d/falcone.yaml` but that file is missing,
and cannot establish deployed configuration keys. Never invent a key, call site,
owner signoff or retirement signal. Owners must fill the exact external file/key
and call-site fields before phase 2. Snapshot scripts are evidence, not deployed
engineering-control source. Each unresolved row is **blocking phase 2**.

| Scope/path | Config file / key | Dual-layout resolver change and call sites | Owner confirmation / retirement signal |
| --- | --- | --- | --- |
| loop-state | engineering-control Falcone project config: exact file/key unconfirmed | Read and write one selected layout per immutable snapshot; never split ledgers. Maker/checker ledger open/write call sites unconfirmed. | BLOCKING: owner unconfirmed; no in-flight retirement signal confirmed |
| spikes | CI baseline scopes: exact engineering-control file/key unconfirmed | Resolve old/new scope by snapshot; baseline evidence, tests and scope-validation call sites unconfirmed. | BLOCKING: owner unconfirmed; queue/in-flight snapshot census required |
| delivery-adapter | Consumer config and exact file/key unconfirmed; candidate snapshot manifest path above is missing | Owner confirms whether read, moved or retired; adapter artifact/review call sites unconfirmed. Preserve scope string contracts. | BLOCKING: consumer owner and retention decision unconfirmed |
| docs/track-f | Consumer config and exact file/key unconfirmed | Resolve old/new process-doc and prompt paths if read; prompt-loader and documentation call sites unconfirmed. | BLOCKING for this move: consumer owner unconfirmed |
| openspec | Maker OpenSpec root: exact file/key unconfirmed | Keep openspec/; verify maker change creation and force-add call sites without changing root. | BLOCKING verification: external owner must confirm unchanged consumer |
| internal-contracts and public-route-catalog.json | Baseline scopes and route catalog: exact file/key unconfirmed | Keep paths unchanged; verify scope/catalog call sites in both layouts. | BLOCKING verification: external owner must confirm unchanged consumer |

Required resolver semantics: choose layout from the delivery's immutable snapshot;
write only to that chosen layout; fail on ambiguous duplicate layouts; keep old
snapshots readable/writable while in flight. Deployed Hermes must complete dry-run
deliveries on pre-move and phase-2 revisions, covering ledger reads/writes,
OpenSpec creation and baseline-scope resolution. Capture deployed version and
evidence IDs without credentials. Owner must provide a reliable census showing
zero pending/running/retryable deliveries or leased worktrees using pre-move
snapshots, plus the revision watermark/retirement event. Until that signal is
confirmed, old-layout support cannot be retired. No source or deployment action
in phase 1 claims to satisfy these external gates.

## Validation and rollback

Phase-1 public seams: Git's tracked path set, ignore behavior, the stored inventory
and manifest hashes, contributor documentation, existing lint/unit/blackbox commands.
No product test additions are needed for this documentation-only change.
Use inventory.md to reproduce exact coverage and compare scope against the fixed
input; CI additionally compares `origin/main...HEAD`. No M/D/R may touch loop-state,
spikes, delivery-adapter, track-f, internal-contracts or old OpenSpec changes.

Run `pnpm lint`, `pnpm test:unit`, and `bash tests/blackbox/run.sh` without a shorter
timeout than CI. PR CI owns ci.yml, integration.yml and deploy-docs.yml green status,
including spike-reading regression suites. Unavailable dependencies, chart checkout
or sandbox sockets must be handed off, not bypassed. Keep all existing gates and
Hermes-owned FALCONE_CHARTS_REF pins unchanged.

Rollback phase 1 by reverting its commit; IDE settings return from history and no
agent memory changes. Rollback phase 2 by reverting both commits while deployed
dual-layout Hermes continues supporting the old snapshot paths.
