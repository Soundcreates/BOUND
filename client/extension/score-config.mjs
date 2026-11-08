const defaults = Object.freeze({
  connectionThreshold: 80,
  weights: Object.freeze({ origin: 10, snapshot: 25, domain: 20, arkiv: 10, watcher: 25, wallet: 10 }),
  transaction: Object.freeze({ green: 70, amber: 40, red: 16 })
});
export function scoreConfigFromEnv(env = {}) {
  function number(name, fallback, min = 0, max = 100) {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new Error(`${name} must be an integer from ${min} to ${max}`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
    return value;
  }
  const connectionThreshold = number('BOUND_CONNECTION_THRESHOLD', defaults.connectionThreshold, 1);
  const weights = Object.fromEntries(Object.entries(defaults.weights).map(([key, value]) => [key, number(`BOUND_CONNECTION_WEIGHT_${key.toUpperCase()}`, value)]));
  if (Object.values(weights).reduce((a, b) => a + b, 0) !== 100) throw new Error('Connection weights must add up to 100');
  const transaction = {
    green: number('BOUND_TX_GREEN_THRESHOLD', defaults.transaction.green, 66),
    amber: number('BOUND_TX_AMBER_THRESHOLD', defaults.transaction.amber, 40),
    red: number('BOUND_TX_RED_THRESHOLD', defaults.transaction.red, 1)
  };
  if (!(transaction.red < transaction.amber && transaction.amber < transaction.green)) throw new Error('Transaction thresholds must satisfy red < amber < green');
  return { connectionThreshold, weights, transaction };
}
