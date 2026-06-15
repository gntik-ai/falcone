// WalReplicationClient — change add-ferretdb-realtime-cdc-remediation (#460).
//
// Streams DocumentDB document changes over a Postgres logical replication slot (pgoutput plugin,
// default TEXT mode) and emits normalized change records. Shared by both consumers that previously
// drove off MongoDB change streams: the realtime SSE executor and the Kafka CDC bridge.
//
// One client owns ONE replication slot — Postgres logical slots are exclusive (a slot can have at
// most one active consumer). The PUBLICATION (the set of tables) may be shared across slots, so
// realtime and CDC each create their own slot against the same `falcone_cdc_pub`. The slot's
// server-side confirmed_flush_lsn IS the durable resume cursor: on restart the client re-subscribes
// and the engine replays from where this client last acknowledged.
//
// Acknowledgement policy:
//   - autoAck:true  → the library advances confirmed_flush on a heartbeat/timer. Use for the
//     realtime executor (sessions are ephemeral; at-most-once redelivery on reconnect is fine).
//   - autoAck:false → confirmed_flush only advances when the consumer calls acknowledge(lsn) after
//     durably persisting (Kafka publish + ResumeTokenStore). Use for the CDC bridge so a crash
//     never loses or skips an unpublished change. Heartbeats are answered with the last acknowledged
//     LSN to keep the connection alive without advancing the cursor past unpersisted data.
//
// Emits:
//   'change' → { lsn, operationType, database, collection, collectionId, tenantId, documentId,
//                fullDocument, fullDocumentBeforeChange }
//   'error'  → Error (connection / decode failures; the client keeps retrying unless stopped)
//
// For consumers that need strict ordering + backpressure (the CDC bridge must publish + persist +
// acknowledge each change before the next), set the async `onChange` handler instead of (or in
// addition to) the 'change' event. With flowControl enabled the replication stream is paused until
// `onChange` resolves, so changes are delivered and acknowledged one at a time, in order. The
// fire-and-forget 'change' event is suited to the realtime executor's per-session fan-out.
import { EventEmitter } from 'node:events'
import { LogicalReplicationService, PgoutputPlugin } from 'pg-logical-replication'

import { decodeWalMessage } from './WalBsonDecoder.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class WalReplicationClient extends EventEmitter {
  constructor({
    connectionConfig,
    slotName,
    publicationName,
    catalog,
    autoAck = true,
    protoVersion = 1,
    maxReconnectAttempts = Infinity,
    onChange = null
  }) {
    super()
    if (!connectionConfig) throw new TypeError('WalReplicationClient requires connectionConfig')
    if (!slotName) throw new TypeError('WalReplicationClient requires slotName')
    if (!publicationName) throw new TypeError('WalReplicationClient requires publicationName')
    if (!catalog || typeof catalog.resolve !== 'function') {
      throw new TypeError('WalReplicationClient requires a catalog with resolve(collectionId)')
    }
    this.connectionConfig = connectionConfig
    this.slotName = slotName
    this.publicationName = publicationName
    this.catalog = catalog
    this.autoAck = autoAck
    this.protoVersion = protoVersion
    this.maxReconnectAttempts = maxReconnectAttempts
    // Optional async handler; awaited by _onData so the stream applies backpressure (in-order,
    // one-at-a-time delivery). May be set after construction (the CDC watcher does this).
    this.onChange = onChange
    this.service = null
    this._stopped = false
    this._confirmedLsn = null
    this._loop = null
  }

  // Begin consuming. Resolves immediately once the reconnect loop is kicked off; the client then
  // streams 'change' events until stop(). The slot's confirmed_flush governs where it resumes.
  // The loop runs in the background and never resolves until stop() — do NOT await it here.
  async start() {
    this._stopped = false
    this._loop = this._runWithReconnect()
    this._loop.catch(() => {}) // terminal failures surface via the 'error' event
  }

  async _runWithReconnect() {
    let attempt = 0
    while (!this._stopped) {
      const service = new LogicalReplicationService(
        { ...this.connectionConfig, replication: 'database' },
        {
          acknowledge: this.autoAck
            ? { auto: true, timeoutSeconds: 10 }
            : { auto: false, timeoutSeconds: 0 },
          flowControl: { enabled: true } // await the async 'change' consumer before the next message
        }
      )
      this.service = service
      service.on('data', (lsn, log) => this._onData(lsn, log))
      service.on('heartbeat', (lsn, _timestamp, shouldRespond) => {
        // Keep the connection alive. In manual-ack mode only confirm up to what the consumer has
        // durably persisted (never past it), so a crash cannot skip an unpublished change.
        if (shouldRespond && !this.autoAck && this._confirmedLsn) {
          service.acknowledge(this._confirmedLsn).catch((err) => this.emit('error', err))
        }
      })
      service.on('error', (err) => this.emit('error', err))

      const plugin = new PgoutputPlugin({
        protoVersion: this.protoVersion,
        publicationNames: [this.publicationName]
      })

      try {
        // subscribe() resolves only when the stream ends (stop() or a connection drop).
        await service.subscribe(plugin, this.slotName)
      } catch (err) {
        if (!this._stopped) this.emit('error', err)
      }

      if (this._stopped) return
      attempt += 1
      if (attempt > this.maxReconnectAttempts) {
        this.emit('error', new Error('wal-replication-max-reconnect-exceeded'))
        return
      }
      await sleep(Math.min(60000, 1000 * 2 ** (attempt - 1)))
    }
  }

  async _onData(lsn, log) {
    let decoded
    try {
      decoded = decodeWalMessage(log)
    } catch (err) {
      this.emit('error', err)
      return
    }
    if (!decoded) return
    const collection = await this.catalog.resolve(decoded.collectionId)
    if (!collection) return // collection metadata not found (e.g. dropped) — skip
    const record = {
      lsn,
      operationType: decoded.walOp,
      database: collection.databaseName,
      collection: collection.collectionName,
      collectionId: decoded.collectionId,
      tenantId: decoded.tenantId,
      documentId: decoded.documentId,
      fullDocument: decoded.fullDocument,
      fullDocumentBeforeChange: decoded.fullDocumentBeforeChange
    }
    this.emit('change', record)
    // Awaited: with flowControl this pauses the stream until the consumer has handled (and, for the
    // CDC bridge, durably persisted + acknowledged) this change — preserving order and at-least-once.
    if (this.onChange) await this.onChange(record)
  }

  // Durably advance the confirmed LSN (manual-ack consumers call this AFTER persisting a change).
  async acknowledge(lsn) {
    if (!lsn) return
    this._confirmedLsn = lsn
    if (this.service && !this.autoAck) {
      await this.service.acknowledge(lsn).catch((err) => this.emit('error', err))
    }
  }

  lastLsn() {
    return this.service?.lastLsn?.() ?? null
  }

  async stop() {
    this._stopped = true
    await this.service?.stop?.().catch(() => {})
    await this._loop?.catch?.(() => {})
  }
}
