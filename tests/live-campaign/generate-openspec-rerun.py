#!/usr/bin/env python3
# Generate an OpenSpec change package per child issue (RE-RUN 2026-06-18) on the feature branch:
# openspec/changes/<change-id>/{proposal.md, specs/<capability>/spec.md, tasks.md}.
# Reuses the child data from file-issues-rerun.py. Mirrors the validated delta format
# (ADDED Requirement + SHALL + WHEN/THEN scenario).
import os, importlib.util

spec = importlib.util.spec_from_file_location("fir", os.path.join(os.path.dirname(__file__),"file-issues-rerun.py"))
fir = importlib.util.module_from_spec(spec); spec.loader.exec_module(fir)
CH = {c[0]: c for c in fir.CHILDREN}

# key -> (change-id, openspec-capability, change-type)
M = {
 "A1":("fix-keycloak-persistent-store","iam","bugfix"),
 "B1":("fix-events-physical-topic-workspace-id","events","bugfix"),
 "B2":("fix-storage-bucket-tenant-scope","storage","bugfix"),
 "B3":("fix-executor-ddl-db-ownership-guard","data-api","bugfix"),
 "B4":("fix-activate-seaweedfs-tenant-identities","storage","bugfix"),
 "C1":("fix-plan-impact-usage-bigint","quotas-plans","bugfix"),
 "C2":("fix-scheduling-handler-dockerfile","scheduling","bugfix"),
 "C3":("fix-flow-trigger-schema","workflows","bugfix"),
 "C4":("fix-flows-worker-pg-env-and-search-attrs","workflows","bugfix"),
 "C5":("fix-audit-enforcement-logging","audit","bugfix"),
 "C6":("fix-backup-scope-schema","backup-restore","bugfix"),
 "D1":("fix-iam-user-credentials","iam","bugfix"),
 "D2":("add-tenant-owner-enduser-management","iam","enhancement"),
 "D3":("fix-iam-route-wiring","iam","bugfix"),
 "D4":("add-project-auth-method-config-api","access-control","enhancement"),
 "E1":("fix-ddl-column-contract-and-pk","data-api","bugfix"),
 "E2":("fix-data-api-contract-mismatches","data-api","bugfix"),
 "E3":("add-pgvector-image-for-vector-search","data-api","enhancement"),
 "F1":("fix-console-operator-shell","web-console","bugfix"),
 "F2":("fix-seaweedfs-netpol-bucket-hook","storage","bugfix"),
 "F3":("fix-install-health-gate-probes","deployment","bugfix"),
 "F4":("fix-apisix-metrics-target","observability","bugfix"),
 "G1":("add-platform-mcp-http-route","mcp","enhancement"),
 "G2":("add-mcp-jsonrpc-protocol","mcp","enhancement"),
 "G3":("add-gateway-flows-mcp-routes","gateway","enhancement"),
 "G4":("add-event-driven-triggers","events","enhancement"),
 "G5":("add-gateway-realtime-config-identity","gateway","bugfix"),
 "G6":("add-vault-secret-consumption","secrets","enhancement"),
}

def shall(fix, title):
    return f"The system SHALL ensure that {title[0].lower()+title[1:]}: {fix.split('—')[0].split('.')[0].strip()}."

ROOT="openspec/changes"; EV="audit/live-campaign/evidence-rerun"
made=[]
for key,(cid,cap,ctype) in M.items():
    (_,ek,title,labels,prob,repro,fix,acc,deps,ev) = CH[key]
    d=os.path.join(ROOT,cid); os.makedirs(os.path.join(d,"specs",cap),exist_ok=True)
    sev=[l for l in labels if l in ("P0","P1","P2")][0]
    prop  = f"# {cid}\n\n## Change type\n{ctype}\n\n## Capability\n{cap}\n\n## Priority\n{sev}\n\n"
    prop += f"## Why\n{prob}\n\n**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** {repro}\n\n"
    prop += f"GitHub epic {ek}. Evidence: `{EV}/{ev}`.\n\n"
    prop += f"## What Changes\n{fix}\n\n## Impact\n{acc}"
    if deps: prop += f"\n\nDependencies: {deps}"
    prop += "\n"
    open(os.path.join(d,"proposal.md"),"w").write(prop)
    s  = f"# {cap} — spec delta for {cid}\n\n## ADDED Requirements\n\n"
    s += f"### Requirement: {title.rstrip('.')}\n\n{shall(fix,title)}\n\n"
    s += "#### Scenario: corrected behavior verified end-to-end\n\n"
    s += "- **WHEN** the conditions in the reproduction are exercised against the running system\n"
    s += f"- **THEN** {acc.split(';')[0].strip().rstrip('.')}\n"
    open(os.path.join(d,"specs",cap,"spec.md"),"w").write(s)
    t  = f"# Tasks — {cid}\n\n## Reproduce (test-first)\n- [ ] Add a failing black-box / live probe reproducing: {repro.split('.')[0]}.\n\n"
    t += "## Implement (kind runtime AND shippable product as applicable)\n"
    t += f"- [ ] {fix}\n\n## Verify\n- [ ] Black-box suite green; the live 2-tenant probe now passes.\n"
    t += f"- [ ] Acceptance: {acc}\n\n## Archive\n- [ ] `openspec validate {cid} --strict`; `/opsx:archive {cid}` after merge.\n"
    open(os.path.join(d,"tasks.md"),"w").write(t)
    made.append(cid)

print(f"generated {len(made)} OpenSpec change packages under {ROOT}/")
for c in made: print("  "+c)
