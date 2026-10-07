// -----------------------------------------------------------------------------
// A widget pull answers before the core gives up on it.
//
// The core waits 15 s for a widget content. Past that it shows "widget data
// unavailable", drops the content it had and schedules NO retry: the card stays
// dead until somebody reloads the dashboard. A pull that has to read the
// network on a cold cache can get there (one request alone is allowed 15 s), so
// past PULL_DEADLINE_MS the card says it is loading, with a short ttl, while
// the read keeps going and fills the cache the next pull reads.
//
// A thrown error is not swallowed: the core turns it into a message the user
// can act on. Only the missed deadline is the failure with no explanation.
// -----------------------------------------------------------------------------

/** How long a pull may take before the loading card is served. */
export const PULL_DEADLINE_MS = 9000;

/** The ttl of the loading card: the core pulls again right after. */
export const LOADING_TTL_SECONDS = 15;

/** The card served while a slow read completes. */
export function loadingContent() {
  return {
    ttl_seconds: LOADING_TTL_SECONDS,
    components: [
      {
        type: 'text',
        variant: 'body',
        text: {
          en: 'Reading the data, this takes longer than usual…',
          fr: 'Lecture des données, plus longue que d’habitude…',
        },
      },
    ],
  };
}

/**
 * Run a widget pull, serving the loading card when it misses the deadline.
 * @param {() => Promise<object>} pull - Builds the content.
 * @param {number} [deadlineMs] - How long to wait for it.
 * @returns {Promise<object>} The content, or the loading card.
 */
export async function withPullDeadline(pull, deadlineMs = PULL_DEADLINE_MS) {
  const content = Promise.resolve().then(pull);
  // Whichever side wins, a failure after the deadline must not be unhandled.
  content.catch(() => {});
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
    timer.unref?.();
  });
  const result = await Promise.race([content, late]).finally(() => clearTimeout(timer));
  return result ?? loadingContent();
}
