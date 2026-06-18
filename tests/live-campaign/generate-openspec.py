#!/usr/bin/env python3
# Generate an OpenSpec change package per child issue on the feature branch:
# openspec/changes/<change-id>/{proposal.md, specs/<capability>/spec.md, tasks.md}.
# Reuses the issue data from file-issues.py. Mirrors the validated delta format
# (ADDED Requirement + SHALL + WHEN/THEN scenario).
import os, importlib.util, re

spec = importlib.util.spec_from_file_location("fi", os.path.join(os.path.dirname(__file__),"file-issues.py"))
fi = importlib.util.module_from_spec(spec); spec.loader.exec_module(fi)
CH = {c[0]: c for c in fi.CHILDREN}  # key -> tuple

# key -> (change-id, openspec-capability, change-type, gh-issue#, gh-epic#)
M = {
 "A1":("fix-events-topic-tenant-scope","events","bugfix",547,539),
 "A2":("fix-functions-ksvc-tenant-namespacing","functions","bugfix",548,539),
 "A3":("fix-metrics-tenant-authorization","tenant-isolation","bugfix",549,539),
 "A4":("fix-mongo-browse-tenant-scope","document-store","bugfix",550,539),
 "A5":("fix-pg-browse-tenant-scope","tenant-isolation","bugfix",551,539),
 "A6":("fix-quota-read-tenant-scope","tenant-isolation","bugfix",552,539),
 "B1":("add-seaweedfs-per-tenant-identities","storage","enhancement",553,540),
 "B2":("fix-storage-object-binary-put","storage","bugfix",554,540),
 "C1":("fix-governance-schema-bootstrap","control-plane-runtime","bugfix",555,541),
 "C2":("fix-workspace-quota-enforcement","tenant-provisioning","bugfix",556,541),
 "C3":("add-audit-write-and-scope-enforcement-store","audit","enhancement",557,541),
 "D1":("fix-bootstrap-job-coldstart-retry","tenant-provisioning","bugfix",558,542),
 "D2":("fix-executor-ferretdb-netpol-labels","control-plane-runtime","bugfix",559,542),
 "D3":("add-apisix-flows-mcp-routes","gateway","enhancement",560,542),
 "D4":("fix-campaign-image-pull-policy","control-plane-runtime","bugfix",561,542),
 "D5":("add-deploy-completeness-cluster","control-plane-runtime","enhancement",562,542),
 "E1":("fix-flows-worker-db-activity-wiring","workflows","bugfix",563,543),
 "E2":("add-event-trigger-integration","workflows","enhancement",564,543),
 "F1":("fix-mcp-tool-call-execution","mcp","bugfix",565,544),
 "F2":("add-mcp-workflow-and-platform-binding","mcp","enhancement",566,544),
 "G1":("add-enduser-lifecycle-management","tenant-rbac","enhancement",567,545),
 "G2":("add-project-auth-config-api","access-policies","enhancement",568,545),
 "H1":("fix-console-operator-tenant-context","web-console","bugfix",569,546),
 "H2":("fix-functions-invoke-input-binding","functions","bugfix",570,546),
 "H3":("fix-pg-insert-request-contract","data-api","bugfix",571,546),
 "H4":("fix-mongo-indexes-missing-collection","document-store","bugfix",572,546),
}

def req_title(title):
    return title.rstrip(".")

def shall(fix, title):
    # one SHALL sentence summarizing the corrected behavior
    return f"The system SHALL ensure that {title[0].lower()+title[1:]} is corrected: {fix.split('—')[0].strip().rstrip('.')}."

ROOT="openspec/changes"
made=[]
for key,(cid,cap,ctype,ghn,ghe) in M.items():
    (_,_,title,labels,prob,repro,fix,acc,deps,ev) = CH[key]
    d=os.path.join(ROOT,cid); os.makedirs(os.path.join(d,"specs",cap),exist_ok=True)
    sev=[l for l in labels if l in ("P0","P1","P2")][0]
    # proposal.md
    prop  = f"# {cid}\n\n## Change type\n{ctype}\n\n## Capability\n{cap}\n\n## Priority\n{sev}\n\n"
    prop += f"## Why\n{prob}\n\n**Empirical evidence (live 2-tenant E2E, 2026-06-18):** {repro}\n\n"
    prop += f"GitHub issue #{ghn} (epic #{ghe}). Evidence: `audit/live-campaign/evidence/{ev}`.\n\n"
    prop += f"## What Changes\n{fix}\n\n## Impact\n{acc}"
    if deps: prop += f"\n\nDependencies: {deps}"
    prop += "\n"
    open(os.path.join(d,"proposal.md"),"w").write(prop)
    # spec delta
    sname = "Scenario: corrected behavior verified end-to-end"
    s  = f"# {cap} — spec delta for {cid}\n\n## ADDED Requirements\n\n"
    s += f"### Requirement: {req_title(title)}\n\n{shall(fix,title)}\n\n"
    s += f"#### {sname}\n\n- **WHEN** the conditions in the reproduction are exercised against the running system\n"
    s += f"- **THEN** {acc.split(';')[0].strip().rstrip('.')}\n"
    open(os.path.join(d,"specs",cap,"spec.md"),"w").write(s)
    # tasks.md
    t  = f"# Tasks — {cid}\n\n## Reproduce (test-first)\n- [ ] Add a failing black-box / live probe that reproduces: {repro.split('.')[0]}.\n\n"
    t += "## Implement (kind runtime AND shippable product)\n"
    t += f"- [ ] {fix}\n- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.\n\n"
    t += "## Verify\n- [ ] Black-box suite green; the live 2-tenant probe now passes.\n"
    t += f"- [ ] Acceptance: {acc}\n\n## Archive\n- [ ] `openspec validate {cid} --strict`; `/opsx:archive {cid}` after merge.\n"
    open(os.path.join(d,"tasks.md"),"w").write(t)
    made.append(cid)

print(f"generated {len(made)} OpenSpec change packages under {ROOT}/")
for c in made: print("  "+c)
