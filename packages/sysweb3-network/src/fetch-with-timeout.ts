import { memoize } from 'lodash';

export const getFetchWithTimeout = memoize((timeout: number) => {
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new Error('Must specify positive integer timeout.');
  }

  const _fetch = async (url: string, opts: any) => {
    const abortController = new window.AbortController();

    const { signal } = abortController;

    const windowFetch = window.fetch(url, {
      ...opts,
      signal,
    });

    const timer = setTimeout(() => abortController.abort(), timeout);

    try {
      const response = await windowFetch;

      clearTimeout(timer);

      return response;
    } catch (error) {
      clearTimeout(timer);

      throw error;
    }
  };

  return _fetch;
});
