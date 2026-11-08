/** Small injectable lifecycle used by the browser worker factory and its race tests. */
export function createWorkerLifecycle<T extends { close(): void }, H>() {
  let generation = 0;
  let cached: { key: string; worker: T; handle: H } | undefined;
  let pending: { key: string; generation: number; worker: T; promise?: Promise<H>; closed: boolean } | undefined;

  const closePending = () => {
    if (pending && !pending.closed) {
      pending.closed = true;
      pending.worker.close();
    }
  };

  return {
    ensure(key: string, make: () => { worker: T; ready: Promise<H> }): Promise<H> {
      if (cached?.key === key) return Promise.resolve(cached.handle);
      // A pending entry is published only after its startup promise is assigned.
      if (pending?.key === key) return pending.promise!;
      const current = ++generation;
      closePending(); pending = undefined;
      cached?.worker.close(); cached = undefined;
      const { worker, ready } = make();
      const entry: { key: string; generation: number; worker: T; promise?: Promise<H>; closed: boolean } = { key, generation: current, worker, closed: false };
      let promise!: Promise<H>;
      promise = ready.then((handle) => {
        if (generation !== current) {
          if (!entry.closed) { entry.closed = true; worker.close(); }
          throw new Error("worker startup invalidated");
        }
        cached = { key, worker, handle };
        return handle;
      }, (error) => { if (!entry.closed) { entry.closed = true; worker.close(); } throw error; }).finally(() => {
        if (pending?.promise === promise) pending = undefined;
      });
      entry.promise = promise;
      pending = entry;
      return promise;
    },
    close(): void {
      ++generation;
      cached?.worker.close(); cached = undefined;
      closePending();
      pending = undefined;
    },
  };
}
