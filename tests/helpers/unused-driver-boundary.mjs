// These external clients are not used by the control-plane routes in this suite.
class UnusedDriver { constructor() { throw new Error('Unexpected external driver use in HTTP replay test'); } }
export const MongoClient = UnusedDriver;
export const ObjectId = UnusedDriver;
export const Kafka = UnusedDriver;
export const logLevel = { NOTHING: 0, ERROR: 1, WARN: 2 };
