import { CodeBlock, CopyButton, Text } from '@gntik-ai/ui'
import { focusRing, useCopy } from './copy'
import { Heading } from './States'

// Legacy mongo-collection catalogue. Host, port and secret stay placeholders; the database and collection are the only live values.
const templates = [
  { id: 'uri', label: 'snippetUri', note: true, code: 'mongodb://<MONGO_USER>:{PASSWORD}@{HOST}:{PORT}/{DATABASE}?authSource=admin&retryWrites=true&w=majority' },
  { id: 'node', label: 'snippetNode', note: false, code: "import mongoose from 'mongoose'\n\nawait mongoose.connect('mongodb://<MONGO_USER>:{PASSWORD}@{HOST}:{PORT}/{DATABASE}?authSource=admin')\n\nconst collection = mongoose.connection.collection('{COLLECTION}')\nconst count = await collection.countDocuments()\nconsole.log({ count })\n\nawait mongoose.disconnect()" },
  { id: 'python', label: 'snippetPython', note: false, code: "from pymongo import MongoClient\n\nclient = MongoClient('mongodb://<MONGO_USER>:{PASSWORD}@{HOST}:{PORT}/{DATABASE}?authSource=admin')\ncollection = client['{DATABASE}']['{COLLECTION}']\nprint(collection.estimated_document_count())\nclient.close()" },
]
export function mongoSnippets(database: string, collection: string) {
  return templates.map((entry) => ({ ...entry, code: entry.code.replace(/\{PASSWORD\}/g, '<YOUR_SECRET>').replace(/\{HOST\}/g, '<RESOURCE_HOST>').replace(/\{PORT\}/g, '27017').replace(/\{DATABASE\}/g, () => database).replace(/\{COLLECTION\}/g, () => collection) }))
}
export function Snippets({ database, collection, workspace }: { database: string; collection: string; workspace: boolean }) {
  const { t } = useCopy()
  return <section className="min-w-0 space-y-4" aria-label={t('snippets')}>
    <Heading title={t('snippets')} description={t('snippetsDescription')} level="h3" />
    {mongoSnippets(database, collection).map((entry) => <article key={entry.id} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading title={t(entry.label)} level="h3" />
        <CopyButton value={entry.code} display="label" label={t('copy')} copiedLabel={t('copied')} announcement={t('snippetCopied')} failureLabel={t('copyFailed')} failureAnnouncement={t('copyFailed')} variant="secondary" size="sm" aria-label={t('copyLabel', { label: t(entry.label) })} className={focusRing} />
      </div>
      <CodeBlock code={entry.code} language="" filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={(value) => value} label={t(entry.label)} className="min-w-0 max-w-full" />
      {entry.note && <Text as="p" variant="body" tone="muted">{t('snippetNote')}</Text>}
      {!workspace && <Text as="p" variant="body" tone="muted">{t('snippetExternal')}</Text>}
      <Text as="p" variant="body" tone="muted">{t('secrets')} {t('secretReference')}</Text>
    </article>)}
  </section>
}
