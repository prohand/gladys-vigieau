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
import { describeCommune, resolveCommune } from './src/communes.js';
import {
  DEVICE_BLUEPRINTS,
  buildDiscoveredDevices,
  findBlueprintByDevice,
} from './src/devices/index.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

// Shown in the Configuration screen while the mandatory INSEE code is missing.
const NOT_CONFIGURED_MESSAGE = {
  en: 'Fill in the INSEE code of your commune to start watching the drought level.',
  fr: 'Renseignez le code INSEE de votre commune pour suivre le niveau de sécheresse.',
};

/**
 * Publish the device catalog — unless we do not know WHERE to look yet.
 * Publishing a device before the user filled in the mandatory INSEE code would
 * create a device pinned to an empty location, which the user would then have
 * to delete by hand once configured.
 * @returns {Promise<boolean>} whether the devices were published
 */
async function publishDevices() {
  if (!isConfigured(config)) {
    logger.warn('No INSEE commune code configured yet: nothing to discover');
    await gladys.setConnectionStatus(false, NOT_CONFIGURED_MESSAGE).catch(() => {});
    return false;
  }
  const devices = buildDiscoveredDevices(gladys, config);
  // Logged in full at debug level: when Gladys refuses the batch, the rejected
  // payload is the only thing that tells you WHICH feature it choked on.
  logger.debug('publishDiscoveredDevices ->', JSON.stringify(devices));
  const response = await gladys.publishDiscoveredDevices(devices);
  logger.info(`Published ${response?.count ?? devices.length} device(s) to the Discovery screen`);
  return true;
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered devices');
  await publishDevices();
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

// The commune search is registered here, not in a blueprint: it writes the
// configuration back and re-publishes the catalog, which is this file's job.
//
// It is the closest thing to a commune "selector" the manifest allows — a
// `config_schema` select only takes static options or the core's `devices`
// source, and the 34 000 French communes fit in neither. So the user types a
// name (and, when it is ambiguous, a postal code) in the action's own form,
// and we fill the INSEE code in for them.
gladys.onAction('rechercher_commune', async (fields) => {
  logger.info(`Action rechercher_commune <- ${fields.nom ?? ''} ${fields.code_postal ?? ''}`);
  const { commune, candidates } = await resolveCommune({
    nom: fields.nom,
    codePostal: fields.code_postal,
  });

  if (candidates.length === 0) {
    return {
      en: 'No commune found. Check the spelling, or search by postal code.',
      fr: 'Aucune commune trouvée. Vérifiez l’orthographe, ou cherchez par code postal.',
    };
  }

  if (!commune) {
    // Several communes share that name: the user must choose. Guessing here
    // would silently watch the drought level of another town.
    const list = candidates.slice(0, 8).map(describeCommune).join(' | ');
    const more = candidates.length > 8 ? ` (+${candidates.length - 8})` : '';
    return {
      en: `Several communes match. Add the postal code, or copy the right INSEE code: ${list}${more}`,
      fr: `Plusieurs communes correspondent. Ajoutez le code postal, ou recopiez le bon code INSEE : ${list}${more}`,
    };
  }

  // Write the INSEE code into our own configuration, then re-publish: the
  // device shows up in the Discovery screen right away, no copy-paste.
  await gladys.setConfig({ commune: commune.code });
  config = normalizeConfig({ ...config, commune: commune.code });
  await publishDevices();
  await gladys.setConnectionStatus(true).catch(() => {});

  return {
    en: `${commune.nom} — INSEE code ${commune.code} filled in. Reload the page to see it, the device is in the Discovery tab.`,
    fr: `${commune.nom} — code INSEE ${commune.code} renseigné. Rechargez la page pour le voir, l’appareil est dans l’onglet Découverte.`,
  };
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // Re-publish the devices: the name, the poll frequency and the external_id
  // itself depend on the configured location.
  // publishDiscoveredDevices is idempotent (upsert by external_id).
  if (await publishDevices()) {
    // The location just became valid: clear the "not configured" status.
    await gladys.setConnectionStatus(true);
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
      return;
    }

    // 3) Report the application-level status, shown in the Configuration
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
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the VigiEau integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
