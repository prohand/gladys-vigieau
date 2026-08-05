// -----------------------------------------------------------------------------
// Entry point of the Gladys "VigiEau" external integration.
//
// Role of this file: wire the SDK to the device catalog (src/devices/). It holds
// NO business logic: the VigiEau calls live in src/vigieau.js, the device
// definition in src/devices/droughtZone.js and the watched locations in
// src/locations.js. This file only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects and publishes the discovered devices;
//   4. owns the actions that EDIT THE LOCATION LIST — they write the
//      configuration back and re-publish the catalog, which is not a device's
//      business.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { isConfigured, normalizeConfig } from './src/config.js';
import { LOCATIONS_KEY, serializeLocations } from './src/locations.js';
import { createLocationActions } from './src/locationActions.js';
import {
  DEVICE_BLUEPRINTS,
  adoptExistingDevices,
  buildDiscoveredDevices,
  findBlueprintByDevice,
  forgetDeletedDevice,
} from './src/devices/index.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

// Cleanup functions of the refresh timers. The devices declare no
// `poll_frequency` — Gladys' polling caps at one minute, far too fast for a
// prefectoral decree — so the integration drives its own refresh.
let pollingCleanups = [];

// Shown in the Configuration screen while no location has been added yet.
const NOT_CONFIGURED_MESSAGE = {
  en: 'Add a location to start watching the drought level.',
  fr: 'Ajoutez un lieu pour suivre le niveau de sécheresse.',
};

/**
 * Publish the device catalog — unless we do not know WHERE to look yet.
 * Publishing a device before a location is geocoded would create a device
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

/**
 * Store a new location list, re-publish the catalog and restart the refresh on
 * it. The single place that writes `locations`, so the three editing actions
 * cannot drift apart.
 * @param {Array<object>} locations - the new list, already normalized
 */
async function saveLocations(locations) {
  // Written as TEXT coordinates under a key the manifest does NOT declare: the
  // core stores an off-schema key as free internal storage of the integration
  // (JSON-encoded, never rendered in the Configuration screen), which is the
  // only place a list the user builds at runtime can live. See src/locations.js.
  await gladys.setConfig({ [LOCATIONS_KEY]: serializeLocations(locations) });
  config = normalizeConfig({ ...config, [LOCATIONS_KEY]: serializeLocations(locations) });
  if (await publishDevices()) {
    startPolling();
    await gladys.setConnectionStatus(true).catch(() => {});
  } else {
    stopPolling();
  }
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered devices');
  await publishDevices();
});

// --- The user just added a device from the Discovery screen ------------------
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
    // Not one of the locations we watch: either a leftover from a version that
    // published one device per address, or the device of a location the user
    // has since deleted. Either way it can safely be deleted in Gladys.
    logger.warn(
      `onPoll ignored: ${device.external_id} is not a device this integration publishes. ` +
        'Its location no longer exists, you can delete it in Gladys.',
    );
    return;
  }
  await blueprint.onPoll(gladys, config, device.external_id);
});

// --- The user deleted a device in Gladys -------------------------------------
// If it was the device whose identity we inherited (an install upgraded from a
// version that keyed the external_id on the coordinates), keep publishing under
// the location's own identity instead of an id that no longer exists.
gladys.onDeviceDeleted(async (device) => {
  if (!forgetDeletedDevice(device.external_id)) {
    return;
  }
  logger.info(`onDeviceDeleted -> ${device.external_id}, re-publishing under the stable identity`);
  // Never throws out of the handler: publishDevices already reported the
  // reason through setConnectionStatus.
  await publishDevices().catch(() => {});
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

// The location-list actions live in src/locationActions.js and are registered
// here, not in a blueprint: they write the configuration back and re-publish
// the catalog, which is this file's business.
//
// They are also the only way to offer a location manager at all — a
// `config_schema` holds a fixed set of fields and no repeatable one, so a list
// the user builds at runtime cannot be a form field, while an action's
// mini-form IS rendered from the manifest. Each of them designates a location
// by its NAME: the core's `devices` select renders a dropdown but no released
// Gladys can validate its value (see src/locationActions.js).
const locationActions = createLocationActions({
  getConfig: () => config,
  saveLocations,
});
for (const [actionKey, handler] of Object.entries(locationActions)) {
  gladys.onAction(actionKey, (fields) => handler(fields));
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // Re-publish the devices: the names depend on the configured locations. The
  // external_ids deliberately do NOT depend on the coordinates, so a device
  // already created keeps reporting on the new address instead of being
  // replaced. publishDiscoveredDevices is idempotent (upsert by external_id).
  if (await publishDevices()) {
    // Restart the timers: both the locations and the interval may have changed.
    startPolling();
    // The configuration just became valid: clear the "not configured" status.
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
    const rawConfig = await gladys.getConfig();
    config = normalizeConfig(rawConfig);

    // 1 bis) An install made before 1.3.0 kept its single location in the
    // `location_name` / `latitude` / `longitude` config fields. normalizeConfig
    // has already rebuilt it as the first entry of the list (keeping the very
    // id its device was published under); persist that so the editing actions
    // work on a real list. The old keys are left where they are: they are no
    // longer declared in the config_schema, so the Configuration screen neither
    // shows them nor sends them back — they simply stop being read.
    if (!Array.isArray(rawConfig?.[LOCATIONS_KEY]) && config.locations.length > 0) {
      logger.info('Migrating the single configured location to the location list');
      await gladys.setConfig({ [LOCATIONS_KEY]: serializeLocations(config.locations) });
    }

    // 1 ter) Inherit the identity of the device the user already created. The
    // versions up to 1.1.1 built the external_id from the coordinates; without
    // this, upgrading would leave that device orphaned and discover a new one.
    await adoptExistingDevices(gladys, config);

    // 2) (Re)publish the devices as soon as we are connected. They report
    // their own status when no location is configured yet.
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
