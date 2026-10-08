// -----------------------------------------------------------------------------
// The order index.js brings the integration up in: refresh first, catalog second.
//
// The refresh timer used to be armed only once `publishDiscoveredDevices`
// resolved. A catalog Gladys refused — a core briefly unreachable at container
// start, a payload an older core rejects — then left the integration with NO
// refresh at all until the next reconnection: the devices the user had already
// created froze on their last level while VigiEau kept publishing new decrees,
// and nothing retried. The two are independent: the devices that exist take
// their states whether or not the Discovery list could be re-sent, so the timer
// is armed from the configuration alone, BEFORE the publish is attempted.
// -----------------------------------------------------------------------------

/**
 * Arm (or stop) the refresh from the configuration, then publish the catalog.
 *
 * A publish failure is still thrown — the caller reports it — but the timer is
 * already running by then.
 * @param {object} steps
 * @param {boolean} steps.configured - whether at least one location is usable
 * @param {() => Promise<unknown>} steps.publish - publish the device catalog
 * @param {() => void} steps.startPolling - (re)start the refresh timers
 * @param {() => void} steps.stopPolling - stop them
 * @returns {Promise<boolean>} whether the refresh is running
 */
export async function pollThenPublish({ configured, publish, startPolling, stopPolling }) {
  if (configured) {
    startPolling();
  } else {
    stopPolling();
  }
  await publish();
  return configured;
}
