// -----------------------------------------------------------------------------
// Entry point of the Gladys "VigiEau" external integration.
//
// Role of this file: wire the SDK to the device catalog (src/devices/). It holds
// NO business logic: the VigiEau calls live in src/vigieau.js and the device
// definition in src/devices/droughtZone.js. This file only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects and publishes the discovered devices.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { isConfigured, normalizeConfig } from './src/config.js';
import { describeAddress, resolveAddress } from './src/address.js';
import {
  DEVICE_BLUEPRINTS,
  buildDiscoveredDevices,
  findBlueprintByDevice,
} from './src/devices/index.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

// Cleanup functions of the refresh timers. The devices declare no
// `poll_frequency` — Gladys' polling caps at one minute, far too fast for a
// prefectoral decree — so the integration drives its own refresh.
let pollingCleanups = [];

// Shown in the Configuration screen while no address has been geocoded yet.
const NOT_CONFIGURED_MESSAGE = {
  en: 'Search for your address to start watching the drought level.',
  fr: 'Recherchez votre adresse pour suivre le niveau de sécheresse.',
};

/**
 * Publish the device catalog — unless we do not know WHERE to look yet.
 * Publishing a device before the address is geocoded would create a device
 * pinned to an empty location, which the user would then have to delete by
 * hand once configured.
 * @returns {Promise<boolean>} whether the devices were published
 */
async function publishDevices() {
  if (!isConfigured(config)) {
    logger.warn('No location configured yet: nothing to discover');
    await gladys.setConnectionStatus(false, NOT_CONFIGURED_MESSAGE).catch(() => {});
    return false;
  }
  const devices = buildDiscoveredDevices(gladys, config);
  // Logged in full at debug level: when Gladys refuses the batch, the rejected
  // payload is the only thing that tells you WHICH feature it choked on.
  logger.debug('publishDiscoveredDevices ->', JSON.stringify(devices));
  try {
    const response = await gladys.publishDiscoveredDevices(devices);
    logger.info(`Published ${response?.count ?? devices.length} device(s) to the Discovery screen`);
    return true;
  } catch (err) {
    // Gladys refused the batch — an unsupported feature category, a malformed
    // external_id... Without this, a "Scan" that fails leaves the Discovery
    // tab empty with nothing anywhere to say why: the error would only reach
    // the SDK acknowledgement, which the user never sees.
    logger.error('Gladys refused the discovered devices', err);
    const reason = String(err?.message ?? err).slice(0, 150);
    await gladys
      .setConnectionStatus(false, {
        en: `Gladys refused the device: ${reason}`,
        fr: `Gladys a refusé l'appareil : ${reason}`,
      })
      .catch(() => {});
    throw err;
  }
}

/** (Re)start the refresh timers of every blueprint that has one. */
function startPolling() {
  stopPolling();
  pollingCleanups = DEVICE_BLUEPRINTS.filter((bp) => typeof bp.startPolling === 'function').map(
    (bp) => bp.startPolling(gladys, config),
  );
}

function stopPolling() {
  for (const cleanup of pollingCleanups) {
    try {
      cleanup?.();
    } catch (err) {
      logger.error('Refresh timer cleanup failed', err);
    }
  }
  pollingCleanups = [];
}

/** Run one refresh cycle right now. Never throws (see blueprint.refresh). */
async function refreshNow() {
  await Promise.all(
    DEVICE_BLUEPRINTS.filter((bp) => typeof bp.refresh === 'function').map((bp) =>
      bp.refresh(gladys, config),
    ),
  );
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered devices');
  await publishDevices();
});

// --- The user just added the device from the Discovery screen ----------------
// Until that moment the core SILENTLY DROPS every state we publish: the
// feature does not exist yet (see externalIntegration.saveStates). Without
// this handler the brand new device would sit on "no recent value" until the
// next hourly tick — which is exactly what it looks like when it is broken.
gladys.onDeviceCreated(async (device) => {
  logger.info(`onDeviceCreated -> ${device.external_id}, refreshing right away`);
  await refreshNow();
});

// --- Polling: Gladys asks to refresh a device --------------------------------
gladys.onPoll(async (device) => {
  const blueprint = findBlueprintByDevice(gladys, device, config);
  if (!blueprint || typeof blueprint.onPoll !== 'function') {
    // Happens when the user changed the observed location: the device created
    // earlier keeps the external_id of the PREVIOUS location and is now an
    // orphan. Deleting it in Gladys and adding the new one fixes it.
    logger.warn(
      `onPoll ignored: ${device.external_id} does not match the current location. ` +
        'Delete this device in Gladys and add the one discovered for the new location.',
    );
    return;
  }
  await blueprint.onPoll(gladys, config);
});

// --- Manifest actions: buttons in the Configuration screen -------------------
// Each action declared in the `actions` field of the manifest is registered
// per key; the message resolved by the handler is displayed under the button
// (the ack is awaited under the action's `timeout_seconds`, not the usual 5 s).
for (const blueprint of DEVICE_BLUEPRINTS) {
  for (const [actionKey, handler] of Object.entries(blueprint.actions ?? {})) {
    gladys.onAction(actionKey, (fields) => handler(gladys, { fields, config }));
  }
}

// The address search is registered here, not in a blueprint: it writes the
// configuration back and re-publishes the catalog, which is this file's job.
//
// It is also the only way to offer a location picker at all — a `config_schema`
// select only takes static options or the core's `devices` source, so the user
// types an address in the action's own form and we geocode it for them.
gladys.onAction('rechercher_adresse', async (fields) => {
  logger.info(`Action rechercher_adresse <- ${fields.adresse ?? ''}`);
  const { match, candidates } = await resolveAddress(fields.adresse);

  if (candidates.length === 0) {
    return {
      en: 'No address found. Try adding the postal code or the town.',
      fr: 'Aucune adresse trouvée. Essayez d’ajouter le code postal ou la commune.',
    };
  }

  if (!match) {
    // Too vague to pick one — a postal code covers several communes, and a
    // town name often exists a dozen times over. Guessing here would silently
    // watch another town's drought level.
    const list = candidates.slice(0, 6).map(describeAddress).join(' | ');
    return {
      en: `Several addresses match, none clearly. Be more precise: ${list}`,
      fr: `Plusieurs adresses correspondent, sans évidence. Précisez : ${list}`,
    };
  }

  // Write the coordinates into our own configuration, then re-publish: the
  // device shows up in the Discovery screen right away, no copy-paste.
  await gladys.setConfig({ latitude: match.latitude, longitude: match.longitude });
  config = normalizeConfig({ ...config, latitude: match.latitude, longitude: match.longitude });
  await publishDevices();
  // The location changed: restart the refresh on the new point.
  startPolling();
  await gladys.setConnectionStatus(true).catch(() => {});

  const point = `${match.latitude.toFixed(5)}, ${match.longitude.toFixed(5)}`;
  return {
    en: `Location set to ${describeAddress(match)} — ${point}. The device is in the Discovery tab.`,
    fr: `Lieu défini sur ${describeAddress(match)} — ${point}. L’appareil est dans l’onglet Découverte.`,
  };
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // Re-publish the devices: the name and the external_id itself depend on the
  // configured location.
  // publishDiscoveredDevices is idempotent (upsert by external_id).
  if (await publishDevices()) {
    // Restart the timers: both the location and the interval may have changed.
    startPolling();
    // The location just became valid: clear the "not configured" status.
    await gladys.setConnectionStatus(true);
  } else {
    stopPolling();
  }
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK itself logs the WebSocket lifecycle (connections, disconnections,
// reconnection attempts) under the `gladys-sdk` name: no need to log it again
// here, these handlers only run the integration's own (re)initialization.
gladys.on('connected', async () => {
  try {
    // 1) Fetch the configuration filled in by the user.
    config = normalizeConfig(await gladys.getConfig());

    // 2) (Re)publish the device as soon as we are connected. It reports its
    // own status when the mandatory INSEE code is still missing.
    if (!(await publishDevices())) {
      stopPolling();
      return;
    }

    // 3) Start our own refresh loop (the devices declare no poll_frequency).
    startPolling();

    // 4) Report the application-level status, shown in the Configuration
    // screen. Distinct from the container state machine: an integration can
    // be RUNNING and still unable to reach its third-party service.
    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    // Carry the real reason into the Configuration screen. A rejected device
    // batch is otherwise invisible: the user just sees an empty Discovery tab
    // with no clue that Gladys refused the payload.
    const reason = String(err?.message ?? err).slice(0, 150);
    await gladys
      .setConnectionStatus(false, {
        en: `Initialization failed: ${reason}`,
        fr: `L'initialisation a échoué : ${reason}`,
      })
      .catch(() => {});
  }
});

// --- Graceful shutdown -------------------------------------------------------
// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT).
gladys.on('disconnected', () => {
  // No point hammering VigiEau while we cannot publish anything.
  stopPolling();
});

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  stopPolling();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the VigiEau integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
