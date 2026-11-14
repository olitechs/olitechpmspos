// Serialises asynchronous work per key (for example one POS table) so writes
// that were started in order are also committed in order. A rejected task must
// not block later work for the same key.
export function createKeyedQueue() {
  const tails = new Map();
  return function enqueue(key, task) {
    const previous = tails.get(key) || Promise.resolve();
    const run = previous.then(() => task());
    // Store the settled tail, never a rejected promise, so one failed write
    // cannot wedge every later write for the same key.
    tails.set(key, run.catch(() => {}));
    return run;
  };
}
