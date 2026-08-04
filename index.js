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
import { normalizeConfig } from './src/config.js';
import {
  DEVICE_BLUEPRINTS,
  buildDiscoveredDevices,
  findBlueprintByDevice,
} from './src/devices/index.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered devices');
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));
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

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // Re-publish the devices: the name, the poll frequency and the external_id
  // itself depend on the configured location.
  // publishDiscoveredDevices is idempotent (upsert by external_id).
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK itself logs the WebSocket lifecycle (connections, disconnections,
// reconnection attempts) under the `gladys-sdk` name: no need to log it again
// here, these handlers only run the integration's own (re)initialization.
gladys.on('connected', async () => {
  try {
    // 1) Fetch the configuration filled in by the user.
    config = normalizeConfig(await gladys.getConfig());

    // 2) (Re)publish the device as soon as we are connected.
    await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));

    // 3) Report the application-level status, shown in the Configuration
    // screen. Distinct from the container state machine: an integration can
    // be RUNNING and still unable to reach its third-party service.
    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

// --- Graceful shutdown -------------------------------------------------------
// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT).
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the VigiEau integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
