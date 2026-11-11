import { useEffect, useRef } from 'react'
import { Field, FieldLabel, Input, Tabs, TabsList, TabsPanel, TabsTab, Text, Timestamp, useAnnounce } from '@gntik-ai/ui'
import { StatusTimeline } from '@gntik-ai/blocks'
import type { StorageState } from './useStorage'
import { bytes, focus, focusRing, useCopy } from './copy'
import { Action, Details, Empty, FailurePanel, Heading, Loading, Table, TextField } from './States'
import { Snippets } from './Snippets'

export function Detail({ state: s }: { state: StorageState }) {
  const { t, i18n } = useCopy()
  const uploadRef = useRef<HTMLInputElement>(null)
  const announce = useAnnounce()
  useEffect(() => { if (s.appended > 0) announce(t('appended', { count: s.appended }), 'polite') }, [s.appended, s.objects.data?.items.length, announce, t])
  useEffect(() => { if (s.showUpload) uploadRef.current?.focus() }, [s.showUpload])
  const bucket = s.bucket
  if (!bucket) return <Empty title={t('detail')} description={t('selectBucket')} />
  const value = (input: unknown) => input == null || input === '' ? t('none') : String(input)
  const date = (input?: string) => input && Number.isFinite(Date.parse(input)) ? <Timestamp value={input} format="absolute" locale={i18n.language} dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} tooltip={false} live={false} /> : value(input)
  const backBuckets = () => { s.selectBucket(null); void s.loadBuckets(); focus('storage-buckets-heading') }
  const backObjects = () => { s.selectObject(null); s.setTab('objects'); void s.loadObjects(bucket); focus('storage-objects-heading') }
  const metadata = s.metadata.data
  const cursor = s.objects.data?.page?.nextCursor ?? s.objects.data?.page?.after ?? null
  const stamps = ['createdAt', 'updatedAt', 'lastModifiedAt'] as const
  return <section className="min-w-0 space-y-6" aria-label={t('detail')}>
    <Heading title={bucket.bucketName} description={t('detail')} />
    <Details title={t('detail')} items={[
      ...['resourceId', 'tenantId', 'workspaceId', 'region', 'status'].map((id) => ({ id, label: t(id), value: id === 'status' && bucket.status ? t(`enums.${bucket.status}`, { defaultValue: bucket.status }) : value(bucket[id as keyof typeof bucket]) })),
      { id: 'provisioning', label: t('provisioning'), value: bucket.provisioning?.state ? t(`enums.${bucket.provisioning.state}`, { defaultValue: bucket.provisioning.state }) : t('none') },
      ...['failureClass', 'gatingMode'].map((id) => ({ id, label: t(id), value: value(bucket.provisioning?.[id as 'failureClass' | 'gatingMode']) })),
      ...stamps.map((id) => ({ id, label: t(id), value: value(bucket.timestamps?.[id]), render: date(bucket.timestamps?.[id]) })),
    ]} />
    <section className="min-w-0 space-y-3" aria-label={t('history')}><Heading title={t('history')} level="h3" />
      {stamps.some((id) => bucket.timestamps?.[id]) ? <StatusTimeline events={stamps.flatMap((id) => bucket.timestamps?.[id] ? [{ id, status: t(id), title: '', description: '', tone: 'neutral' as const, at: bucket.timestamps[id]!, actor: undefined, live: false }] : []).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))} label={t('history')} emptyLabel={t('noHistory')} showFewerLabel={t('fewer')} showEarlierLabel={(count) => t('earlier', { count })} actorLabel={t('actor')} maxVisible={undefined} timeFormat="absolute" className="min-w-0" /> : <Empty title={t('noHistory')} />}
    </section>
    <Snippets key={bucket.resourceId} bucket={bucket} />
    <Tabs value={s.tab} defaultValue="objects" onValueChange={(next) => { if (typeof next === 'string') s.setTab(next) }} orientation="horizontal" variant="underline" className="min-w-0">
      <TabsList aria-label={t('tabsLabel', { name: bucket.bucketName })} indicator={false} fullWidth={false} activateOnFocus={true} className="flex flex-wrap">
        {['objects', 'presigned', 'multipart'].map((tab) => <TabsTab key={tab} value={tab} icon={undefined} count={undefined} disabled={false} className={focusRing}>{t(tab)}</TabsTab>)}
      </TabsList>
      <TabsPanel value="objects" className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div id="storage-objects-heading" tabIndex={-1} className={focusRing}><Heading title={t('objects')} description={t('objectsDescription')} level="h3" /></div>
          <Action id="storage-upload-trigger" aria-expanded={s.showUpload} aria-controls="storage-upload-form" onClick={() => s.setShowUpload(!s.showUpload)}>{t(s.showUpload ? 'close' : 'uploadObject')}</Action></div>
        {s.showUpload && <form id="storage-upload-form" data-testid="storage-upload" className="min-w-0 space-y-4 rounded-lg border border-border p-4" aria-busy={s.mutations.upload.busy} onSubmit={(event) => { event.preventDefault(); if (!s.mutations.upload.failure) void s.perform('upload') }}>
          {s.mutations.upload.failure && <FailurePanel section="upload" failure={s.mutations.upload.failure} retry={() => { void s.perform('upload', true) }} busy={s.mutations.upload.busy} autoFocus={true} close={() => { s.dismiss('upload'); queueMicrotask(() => focus('storage-upload-submit')) }} back={backBuckets} backLabel={t('backBuckets')} />}
          <TextField id="storage-upload-key" label={t('uploadKey')} help={t('uploadKeyHelp')} placeholder={t('uploadKeyPlaceholder')} value={s.key} onChange={s.setKey} busy={s.mutations.upload.busy} inputRef={uploadRef} />
          {/* The file-upload-panel pattern uses a manual file field: the block auto-uploads on selection,
              which would change the legacy explicit Subir action and retry semantics. */}
          <Field invalid={false} disabled={s.mutations.upload.busy} className="min-w-0"><FieldLabel htmlFor="storage-upload-file">{t('uploadFile')}</FieldLabel>
            <Input id="storage-upload-file" type="file" size="md" accept="" multiple={false} disabled={s.mutations.upload.busy} aria-describedby="storage-file-help" onChange={(event) => s.setFile(event.target.files?.[0] ?? null)} leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} />
            <Text id="storage-file-help" as="p" variant="supporting" tone="muted">{t('uploadFileHelp')}</Text>
          </Field>
          {!s.mutations.upload.failure && <Action id="storage-upload-submit" type="submit" disabled={!s.file} busy={s.mutations.upload.busy}>{t(s.mutations.upload.busy ? 'uploading' : 'upload')}</Action>}
          <Action disabled={s.mutations.upload.busy} onClick={() => { s.setShowUpload(false); s.setFile(null); s.setKey(''); s.dismiss('upload'); focus('storage-upload-trigger') }}>{t('cancel')}</Action>
        </form>}
        {s.objects.failure && <FailurePanel section="objects" failure={s.objects.failure} busy={s.objects.busy} retry={() => { void s.loadObjects(bucket, s.appendCursor) }} back={backBuckets} backLabel={t('backBuckets')} />}
        {s.objects.busy && !s.objects.failure && !s.appendCursor && <Loading label={t('loading')} />}
        {s.objects.data && <>
          {s.objects.data.items.length ? <Table rows={s.objects.data.items} id={(row) => row.objectKey} label={t('objects')} columns={[
            { id: 'key', header: t('key'), sortable: false, cell: (row) => <Action variant="ghost" aria-pressed={s.objectKey === row.objectKey} onClick={() => s.selectObject(row.objectKey)}>{row.objectKey}</Action> },
            { id: 'size', header: t('size'), sortable: false, cell: (row) => bytes(row.sizeBytes) ?? t('none') },
            { id: 'type', header: t('contentType'), sortable: false, cell: (row) => value(row.contentType) },
            { id: 'modified', header: t('lastModifiedAt'), sortable: false, cell: (row) => date(row.timestamps?.lastModifiedAt) },
            { id: 'etag', header: t('etag'), sortable: false, cell: (row) => value(row.etag) },
          ]} /> : <Empty title={t('noObjects')} description={t('noObjectsDescription')} action={<Action onClick={() => s.setShowUpload(true)}>{t('uploadFirst')}</Action>} />}
          {cursor && <Action busy={s.objects.busy} onClick={() => { void s.loadObjects(bucket, cursor) }}>{t(s.objects.busy ? 'loading' : 'next')}</Action>}
        </>}
        {s.objectKey && <section className="min-w-0 space-y-4" aria-label={t('metadata')}>
          <Heading title={t('metadata')} description={t('metadataDescription')} level="h3" />
          {s.metadata.failure ? <FailurePanel section="metadata" failure={s.metadata.failure} busy={s.metadata.busy} retry={() => { void s.loadMetadata(bucket, s.objectKey!) }} back={backObjects} backLabel={t('backObjects')} /> : s.metadata.busy ? <Loading label={t('loading')} /> : metadata && <>
            <Details title={t('metadata')} items={[
              ...['objectKey', 'bucketName', 'contentType', 'storageClass', 'etag', 'checksumSha256', 'versionId', 'providerType', 'applicationId', 'namespace'].map((id) => ({ id, label: t(id === 'objectKey' ? 'key' : id === 'bucketName' ? 'bucket' : id), value: value(metadata[id as keyof typeof metadata]) })),
              { id: 'size', label: t('size'), value: bytes(metadata.sizeBytes) ?? t('none') },
              ...stamps.map((id) => ({ id, label: t(id), value: value(metadata.timestamps?.[id]), render: date(metadata.timestamps?.[id]) })),
            ]} />
            {Object.keys(metadata.metadata ?? {}).length ? <Table rows={Object.entries(metadata.metadata!).map(([key, value]) => ({ key, value }))} id={(row) => row.key} label={t('customMetadata')} columns={[{ id: 'key', header: t('key'), sortable: false, accessor: (row) => row.key }, { id: 'value', header: t('value'), sortable: false, accessor: (row) => row.value }]} /> : <Text as="p" variant="supporting" tone="muted">{t('noCustomMetadata')}</Text>}
          </>}
        </section>}
      </TabsPanel>
      <TabsPanel value="presigned" className="min-w-0 space-y-4"><Heading title={t('presigned')} description={t('presignDescription')} level="h3" />
        {!s.objectKey ? <Text as="p" variant="body" tone="muted">{t('selectObject')}</Text> : <>
          <Text as="p" variant="body" tone="default">{t('selectedObject', { key: s.objectKey })}</Text>
          <Action busy={s.presigned.busy} onClick={() => { void s.generate() }}>{t(s.presigned.busy ? 'generating' : 'generate')}</Action>
          {s.presigned.failure ? <FailurePanel section="presign" failure={s.presigned.failure} busy={s.presigned.busy} retry={() => { void s.generate() }} back={backObjects} backLabel={t('backObjects')} /> : s.presigned.busy && <Loading label={t('loading')} />}
          {s.presigned.data && <div data-testid="storage-presigned-result"><Details title={t('presigned')} items={['operation', 'bucketName', 'objectKey', 'expiresAt', 'ttlSeconds', 'ttlClamped', 'url'].map((id) => ({ id, label: t(id === 'bucketName' ? 'bucket' : id === 'objectKey' ? 'key' : id), value: id === 'ttlClamped' ? t(s.presigned.data!.ttlClamped ? 'yes' : 'no') : id === 'operation' && s.presigned.data!.operation === 'download' ? t('download') : value(s.presigned.data![id as keyof typeof s.presigned.data]) }))} /></div>}
        </>}
      </TabsPanel>
      <TabsPanel value="multipart" className="min-w-0"><Empty title={t('unsupported')} description={t('unsupportedDescription')} /></TabsPanel>
    </Tabs>
  </section>
}
