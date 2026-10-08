// Optional loader for handler tests in sandboxes without installed database/broker SDKs.
// Every SDK constructor fails if reached; tests inject their database and KV boundaries.
const sources = {
  kafkajs: 'export class Kafka { constructor() { throw new Error("unexpected Kafka boundary"); } }; export const logLevel = { NOTHING: 0 };',
  mongodb: 'export class MongoClient { constructor() { throw new Error("unexpected MongoDB boundary"); } };',
  pg: 'export default { Pool: class { constructor() { throw new Error("unexpected PostgreSQL boundary"); } } };',
};

export async function resolve(specifier, context, nextResolve) {
  if (sources[specifier]) return {
    url: `data:text/javascript,${encodeURIComponent(sources[specifier])}`, shortCircuit: true,
  };
  return nextResolve(specifier, context);
}
