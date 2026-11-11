import type { StorageBucket } from './api'
// Exact storage-bucket templates from the legacy snippet generator. No endpoint is inferred.
const templates = [
  "aws --endpoint-url {HOST} s3 ls s3://{RESOURCE_NAME} --region {RESOURCE_EXTRA_A}",
  "import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'\n\nconst client = new S3Client({\n  endpoint: '{HOST}',\n  region: '{RESOURCE_EXTRA_A}',\n  credentials: {\n    accessKeyId: '<AWS_ACCESS_KEY_ID>',\n    secretAccessKey: '<AWS_SECRET_ACCESS_KEY>'\n  },\n  forcePathStyle: true\n})\n\nconst result = await client.send(new ListObjectsV2Command({ Bucket: '{RESOURCE_NAME}' }))\nconsole.log(result.Contents ?? [])",
  "import boto3\n\ns3 = boto3.client(\n    's3',\n    endpoint_url='{HOST}',\n    region_name='{RESOURCE_EXTRA_A}',\n    aws_access_key_id='<AWS_ACCESS_KEY_ID>',\n    aws_secret_access_key='<AWS_SECRET_ACCESS_KEY>'\n)\n\nresponse = s3.list_objects_v2(Bucket='{RESOURCE_NAME}')\nprint(response.get('Contents', []))",
  "curl -X GET \"{RESOURCE_EXTRA_B}\""
]
export function storageSnippets(bucket: StorageBucket) {
  return templates.map((code, index) => ({ id: String(index), label: ['snippetAws', 'snippetNode', 'snippetPython', 'snippetCurl'][index],
    code: code.replace(/\{HOST\}/g, '<RESOURCE_HOST>').replace(/\{RESOURCE_NAME\}/g, () => bucket.bucketName).replace(/\{RESOURCE_EXTRA_A\}/g, () => bucket.region ?? '<RESOURCE_EXTRA_A>').replace(/\{RESOURCE_EXTRA_B\}/g, '<RESOURCE_EXTRA_B>') }))
}
