// Fetch JSON, retrying when the API server isn't accepting connections yet.
// On dev startup the API can take a few seconds to load all organisms, during
// which the Vite proxy returns connection errors (ECONNREFUSED) and any in-flight
// request rejects. Without a retry the page would render empty until a manual
// refresh, so we back off and try again for genuine connection/5xx failures.
export async function fetchJSONWithRetry<T>(
  url: string,
  { retries = 8, delayMs = 400 }: { retries?: number; delayMs?: number } = {}
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      // 502/503/504 from the proxy mean the upstream API isn't ready yet.
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error(`upstream not ready (${res.status})`);
      }
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
