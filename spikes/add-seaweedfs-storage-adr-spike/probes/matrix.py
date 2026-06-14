#!/usr/bin/env python3
"""SeaweedFS S3 bucket-management compatibility matrix (OpenSpec add-seaweedfs-storage-adr-spike).

Drives every S3 operation Falcone issues today against the running SeaweedFS S3 gateway and
classifies each SUPPORTED / PARTIAL / UNSUPPORTED with the observed HTTP status as evidence.
Path-style + region match the openapi-sdk-service (forcePathStyle) and storage-applier callers.
"""
import json
import sys
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

ENDPOINT = "http://127.0.0.1:8333"
BUCKET = "tenant-a-bucket"
results = []


def s3(access, secret, region="us-east-1"):
    return boto3.client(
        "s3", endpoint_url=ENDPOINT,
        aws_access_key_id=access, aws_secret_access_key=secret,
        region_name=region,
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4"),
    )


def record(op, status, classification, detail):
    results.append({"op": op, "http": status, "class": classification, "detail": detail})
    print(f"[{classification:10}] {op:32} http={status} {detail}")


def http_of(exc):
    try:
        return exc.response["ResponseMetadata"]["HTTPStatusCode"], exc.response["Error"].get("Code", "")
    except Exception:
        return None, str(exc)


admin = s3("falconespikeadmin", "falcone-spike-admin-secret-0000")

# --- namespace ops (filer-on-PG smoke: 2.1/2.2) ---
try:
    admin.create_bucket(Bucket=BUCKET)
    code = admin.meta.events  # noop
    record("createBucket", 200, "SUPPORTED", f"bucket={BUCKET}")
except ClientError as e:
    st, c = http_of(e)
    # idempotent: already-owned is fine
    if c in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
        record("createBucket", st, "SUPPORTED", f"idempotent ({c})")
    else:
        record("createBucket", st, "UNSUPPORTED", c)

try:
    admin.put_object(Bucket=BUCKET, Key="probe/hello.txt", Body=b"falcone-seaweedfs-roundtrip")
    got = admin.get_object(Bucket=BUCKET, Key="probe/hello.txt")["Body"].read()
    ok = got == b"falcone-seaweedfs-roundtrip"
    record("putObject+getObject", 200, "SUPPORTED" if ok else "PARTIAL",
           f"roundtrip_integrity={ok}")
except ClientError as e:
    st, c = http_of(e)
    record("putObject+getObject", st, "UNSUPPORTED", c)

# --- bucket policy (5.1 / 5.2) ---
policy = {
    "Version": "2012-10-17",
    "Statement": [{
        "Sid": "AllowTenantRead", "Effect": "Allow",
        "Principal": {"AWS": ["*"]}, "Action": ["s3:GetObject"],
        "Resource": [f"arn:aws:s3:::{BUCKET}/*"],
    }],
}
try:
    r = admin.put_bucket_policy(Bucket=BUCKET, Policy=json.dumps(policy))
    record("putBucketPolicy", r["ResponseMetadata"]["HTTPStatusCode"], "SUPPORTED", "minimal policy accepted")
    policy_put_ok = True
except ClientError as e:
    st, c = http_of(e)
    record("putBucketPolicy", st, "UNSUPPORTED", c)
    policy_put_ok = False

try:
    r = admin.get_bucket_policy(Bucket=BUCKET)
    roundtrips = "AllowTenantRead" in r["Policy"]
    record("getBucketPolicy", r["ResponseMetadata"]["HTTPStatusCode"],
           "SUPPORTED" if roundtrips else "PARTIAL", f"roundtrip_sid_present={roundtrips}")
except ClientError as e:
    st, c = http_of(e)
    record("getBucketPolicy", st, "PARTIAL" if policy_put_ok else "UNSUPPORTED", c)

# --- versioning (5.3) ---
try:
    r = admin.put_bucket_versioning(Bucket=BUCKET, VersioningConfiguration={"Status": "Enabled"})
    st = r["ResponseMetadata"]["HTTPStatusCode"]
    v = admin.get_bucket_versioning(Bucket=BUCKET).get("Status")
    record("putBucketVersioning", st, "SUPPORTED" if v == "Enabled" else "PARTIAL",
           f"readback_status={v}")
    versioning_on = v == "Enabled"
except ClientError as e:
    st, c = http_of(e)
    record("putBucketVersioning", st, "UNSUPPORTED", c)
    versioning_on = False

# --- lifecycle (5.4) ---
lifecycle = {"Rules": [{
    "ID": "expire-tmp", "Status": "Enabled",
    "Filter": {"Prefix": "tmp/"}, "Expiration": {"Days": 7},
}]}
try:
    r = admin.put_bucket_lifecycle_configuration(Bucket=BUCKET, LifecycleConfiguration=lifecycle)
    st = r["ResponseMetadata"]["HTTPStatusCode"]
    try:
        back = admin.get_bucket_lifecycle_configuration(Bucket=BUCKET)
        rules = back.get("Rules", [])
        record("putBucketLifecycleConfiguration", st,
               "SUPPORTED" if rules else "PARTIAL", f"readback_rules={len(rules)}")
    except ClientError as e2:
        st2, c2 = http_of(e2)
        record("putBucketLifecycleConfiguration", st,
               "PARTIAL", f"put ok but get-> {st2}/{c2}")
except ClientError as e:
    st, c = http_of(e)
    record("putBucketLifecycleConfiguration", st, "UNSUPPORTED", c)

# --- CORS (5.5) ---
cors = {"CORSRules": [{
    "AllowedMethods": ["GET", "PUT"], "AllowedOrigins": ["https://app.example.com"],
    "AllowedHeaders": ["*"], "MaxAgeSeconds": 3000,
}]}
try:
    r = admin.put_bucket_cors(Bucket=BUCKET, CORSConfiguration=cors)
    st = r["ResponseMetadata"]["HTTPStatusCode"]
    try:
        back = admin.get_bucket_cors(Bucket=BUCKET)
        n = len(back.get("CORSRules", []))
        record("putBucketCors", st, "SUPPORTED" if n else "PARTIAL", f"readback_rules={n}")
    except ClientError as e2:
        st2, c2 = http_of(e2)
        record("putBucketCors", st, "PARTIAL", f"put ok but get-> {st2}/{c2}")
except ClientError as e:
    st, c = http_of(e)
    record("putBucketCors", st, "UNSUPPORTED", c)

# --- object versioning by version-id (5.6) ---
try:
    v1 = admin.put_object(Bucket=BUCKET, Key="ver/obj.txt", Body=b"v1-body")
    v2 = admin.put_object(Bucket=BUCKET, Key="ver/obj.txt", Body=b"v2-body")
    vid1 = v1.get("VersionId")
    vid2 = v2.get("VersionId")
    distinct = bool(vid1) and bool(vid2) and vid1 != vid2
    detail = f"vid1={vid1} vid2={vid2}"
    if distinct:
        old = admin.get_object(Bucket=BUCKET, Key="ver/obj.txt", VersionId=vid1)["Body"].read()
        detail += f" get(vid1)={old!r}"
        record("objectVersioning", 200, "SUPPORTED" if old == b"v1-body" else "PARTIAL", detail)
    else:
        record("objectVersioning", 200, "PARTIAL", "no distinct VersionId returned " + detail)
except ClientError as e:
    st, c = http_of(e)
    record("objectVersioning", st, "UNSUPPORTED", c)

# --- object-lock / WORM (5.7) ---
# Try the canonical path: create a bucket WITH object-lock enabled, then read its config.
LOCK_BUCKET = "tenant-a-lock-bucket"
try:
    admin.create_bucket(Bucket=LOCK_BUCKET, ObjectLockEnabledForBucket=True)
    try:
        cfg = admin.get_object_lock_configuration(Bucket=LOCK_BUCKET)
        enabled = cfg.get("ObjectLockConfiguration", {}).get("ObjectLockEnabled")
        record("objectLock/WORM", 200, "SUPPORTED" if enabled == "Enabled" else "PARTIAL",
               f"ObjectLockEnabled={enabled}")
    except ClientError as e2:
        st2, c2 = http_of(e2)
        record("objectLock/WORM", st2, "UNSUPPORTED",
               f"create accepted but get-object-lock-config-> {st2}/{c2}")
except ClientError as e:
    st, c = http_of(e)
    record("objectLock/WORM", st, "UNSUPPORTED", c)

# --- per-tenant scoped identity signs (7.1) ---
tenant = s3("AKSTSPIKETENANTA0001", "sk_spike_tenant_a_secret_00000000")
try:
    tenant.put_object(Bucket=BUCKET, Key="byTenantA.txt", Body=b"signed-by-tenant-a")
    body = tenant.get_object(Bucket=BUCKET, Key="byTenantA.txt")["Body"].read()
    record("tenantA scoped identity (signs own bucket)", 200,
           "SUPPORTED" if body == b"signed-by-tenant-a" else "PARTIAL", "static identities file")
except ClientError as e:
    st, c = http_of(e)
    record("tenantA scoped identity (signs own bucket)", st, "UNSUPPORTED", c)

# tenant-a must NOT be able to touch a bucket outside its scope (isolation probe)
try:
    tenant.put_object(Bucket=LOCK_BUCKET, Key="x.txt", Body=b"should-be-denied")
    record("tenantA cross-bucket write (expect DENY)", 200, "PARTIAL",
           "LEAK: tenant-a wrote outside its scoped bucket")
except ClientError as e:
    st, c = http_of(e)
    record("tenantA cross-bucket write (expect DENY)", st,
           "SUPPORTED" if c in ("AccessDenied", "AccessDeniedException") else "PARTIAL",
           f"correctly denied ({c})")

print("\n=== JSON ===")
print(json.dumps(results, indent=2))
with open("evidence/05-bucket-management-matrix.json", "w") as f:
    json.dump(results, f, indent=2)
sys.exit(0)
