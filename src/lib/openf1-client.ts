/**
 * Shared, rate-limited OpenF1 fetch helper.
 *
 * OpenF1 enforces a hard limit of 3 requests/second and answers 429 past it.
 * The analysis pages fan out over several sessions and drivers, so requests
 * are queued through here and spaced out rather than fired concurrently —
 * without this, the second of two parallel calls simply fails.
 */

const MIN_INTERVAL_MS = 380; // ~2.6 req/s, comfortably inside the 3/s limit
const MAX_RETRIES = 3;

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/** Result of a fetch that distinguishes "blocked" from "genuinely empty". */
export type OpenF1Result<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "locked" | "rate_limited" | "unreachable" | "empty" };

async function waitForSlot() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

/**
 * Fetches an OpenF1 array endpoint, serialised against every other call made
 * through this helper so the rate limit is respected process-wide.
 */
export async function openF1Fetch<T>(path: string): Promise<OpenF1Result<T[]>> {
  const run = async (): Promise<OpenF1Result<T[]>> => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await waitForSlot();
      try {
        const res = await fetch(`https://api.openf1.org/v1${path}`, { cache: "no-store" });
        if (res.status === 429) {
          // Back off progressively; the limit is per-second so a short wait
          // is usually enough.
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        const data = await res.json();
        // OpenF1 answers with an error object, not an array, while an F1
        // session is live — it restricts all access including past sessions.
        if (!Array.isArray(data)) return { ok: false, reason: "locked" };
        if (data.length === 0) return { ok: false, reason: "empty" };
        return { ok: true, data: data as T[] };
      } catch {
        if (attempt === MAX_RETRIES) return { ok: false, reason: "unreachable" };
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    return { ok: false, reason: "rate_limited" };
  };

  // Chain onto the queue so concurrent callers are serialised rather than
  // racing each other into the rate limit.
  const result = queue.then(run, run) as Promise<OpenF1Result<T[]>>;
  queue = result.catch(() => undefined);
  return result;
}
