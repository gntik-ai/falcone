#!/usr/bin/env python3
"""Capture raw ListBuckets / ListObjectsV2 XML from SeaweedFS and run the EXACT regex
patterns from apps/control-plane/storage-handlers.mjs:76-97 against them (tasks 4.1-4.3).

The live control-plane runtime parses S3 list responses with hand-rolled regexes, not an XML
parser. This proves whether SeaweedFS's XML envelope is byte-compatible with those regexes.
"""
import re
import boto3
from botocore.config import Config
from botocore.awsrequest import AWSRequest
from botocore.auth import SigV4Auth
import urllib.request

ENDPOINT = "http://127.0.0.1:8333"
ACCESS, SECRET, REGION = "falconespikeadmin", "falcone-spike-admin-secret-0000", "us-east-1"
BUCKET = "tenant-a-bucket"

sess = boto3.Session(aws_access_key_id=ACCESS, aws_secret_access_key=SECRET, region_name=REGION)
creds = sess.get_credentials().get_frozen_credentials()


def signed_get(path, query=""):
    url = f"{ENDPOINT}{path}" + (f"?{query}" if query else "")
    req = AWSRequest(method="GET", url=url)
    SigV4Auth(creds, "s3", REGION).add_auth(req)
    r = urllib.request.Request(url, method="GET", headers=dict(req.headers.items()))
    with urllib.request.urlopen(r) as resp:
        return resp.status, resp.read().decode()


# --- exact helpers transcribed from storage-handlers.mjs:76-97 ---
def all_tags(xml, tag):
    return re.findall(rf"<{tag}>([\s\S]*?)</{tag}>", xml)


def one_tag(xml, tag):
    m = re.search(rf"<{tag}>([\s\S]*?)</{tag}>", xml)
    return m.group(1) if m else None


print("### Task 4.1 — ListBuckets raw XML")
st, xml_lb = signed_get("/")
print(f"HTTP {st}")
print(xml_lb)
open("evidence/03-listbuckets.xml", "w").write(xml_lb)

# storage-handlers.mjs listBuckets(): allTags(text,'Bucket') -> {Name, CreationDate}
buckets = [{"name": one_tag(b, "Name"), "creationDate": one_tag(b, "CreationDate")} for b in all_tags(xml_lb, "Bucket")]
lb_match = len(buckets) > 0 and all(b["name"] for b in buckets)
print(f"regex parse -> {buckets}")
print(f"LISTBUCKETS regex parser: {'MATCH' if lb_match else 'MISMATCH'}\n")

print("### Task 4.2 — ListObjectsV2 raw XML (non-empty bucket)")
st, xml_lo = signed_get(f"/{BUCKET}", "list-type=2&max-keys=50")
print(f"HTTP {st}")
print(xml_lo)
open("evidence/04-listobjectsv2.xml", "w").write(xml_lo)

# storage-handlers.mjs listObjects(): allTags(text,'Contents') -> {Key,Size,ETag,LastModified,StorageClass}
objects = []
for c in all_tags(xml_lo, "Contents"):
    objects.append({
        "key": one_tag(c, "Key"),
        "size": int(one_tag(c, "Size") or 0),
        "etag": re.sub(r"&quot;|&#34;|\"", "", one_tag(c, "ETag") or ""),
        "lastModified": one_tag(c, "LastModified"),
        "storageClass": one_tag(c, "StorageClass") or "STANDARD",
    })
truncated = one_tag(xml_lo, "IsTruncated") == "true"
next_token = one_tag(xml_lo, "NextContinuationToken") if truncated else None
lo_match = len(objects) > 0 and all(o["key"] for o in objects)
print(f"regex parse -> objects={objects}")
print(f"             truncated={truncated} nextToken={next_token}")
print(f"LISTOBJECTSV2 regex parser: {'MATCH' if lo_match else 'MISMATCH'}")

# Element-presence audit for the tags the regex parser depends on
print("\n### Tag-presence audit (regex parser dependencies)")
for tag in ["Bucket", "Name", "CreationDate", "Contents", "Key", "Size", "ETag",
            "LastModified", "StorageClass", "IsTruncated", "NextContinuationToken"]:
    src = xml_lb if tag in ("Bucket",) else xml_lo
    present_lb = f"<{tag}>" in xml_lb
    present_lo = f"<{tag}>" in xml_lo
    print(f"  <{tag:22}> ListBuckets={'Y' if present_lb else '-'} ListObjectsV2={'Y' if present_lo else '-'}")
