import { useCallback, useEffect, useState } from 'react';

export interface ResourceState<T> {
  readonly status: 'loading' | 'ready' | 'error';
  readonly data: T | null;
  readonly error: string;
  reload: () => void;
}

export function useResource<T>(key: string, loader: () => Promise<T>): ResourceState<T> {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<ResourceState<T>, 'reload'>>({
    status: 'loading',
    data: null,
    error: '',
  });

  useEffect(() => {
    let active = true;
    setState((current) => ({
      status: current.data === null ? 'loading' : current.status,
      data: current.data,
      error: '',
    }));
    loader()
      .then((data) => {
        if (active) setState({ status: 'ready', data, error: '' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          data: null,
          error: error instanceof Error ? error.message : 'Could not load this page.',
        });
      });
    return () => {
      active = false;
    };
    // `loader` is intentionally omitted. Callers put every input in `key`.
  }, [key, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, reload };
}

/** Refreshes a resource on an interval. The loader identity stays in `key`. */
export function usePolling(reload: () => void, intervalMs: number, enabled = true): void {
  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    const id = window.setInterval(reload, intervalMs);
    return () => window.clearInterval(id);
  }, [reload, intervalMs, enabled]);
}
