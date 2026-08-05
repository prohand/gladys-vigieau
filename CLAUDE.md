# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An **external integration for Gladys Assistant**, built on the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js) and
`@gladysassistant/integration-sdk`. It runs as its own Docker container, talks to Gladys over a
WebSocket the SDK manages, and exposes the French [VigiEau](https://vigieau.gouv.fr) drought alert
levels as devices.

It is **not** part of the Gladys core: it can only publish devices/states and read its own
configuration. Anything the core UI does with that data is outside this repo's control.

## Commands

```bash
npm test                 # node --test (built-in runner, no framework)
node --test test/vigieau.test.js          # a single file
node --test --test-name-pattern "summarize"   # a single test by name
npm run lint             # ESLint
npm run format           # Prettier, write
npm run format:check     # Prettier, check — the CI gate
```

All three gates run on every push and PR (`.github/workflows/ci.yml`). Tests stub `globalThis.fetch`
and run fully offline.

Before tagging a release, check the manifest against the real store rules:

```bash
npx github:GladysAssistant/integration-store .
```

It reports every problem at once. Two findings are expected before a release exists: the
`docker_image` tag is not on ghcr.io yet, and `cover_image` 404s until the branch is pushed.

Run locally against a real Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="vigieau" LOG_LEVEL=debug npm start
```

`VIGIEAU_API_URL` and `ADDRESS_API_URL` redirect the two drivers at a mock server.

## Architecture

`index.js` is pure wiring — SDK handlers, config lifecycle, the refresh timer's lifecycle — and holds
no business logic. Everything else lives under `src/`:

- **`src/devices/droughtZone.js`** — the only device blueprint. Declares the features, implements
  `onPoll`, `refresh`, `startPolling` and the two per-device manifest actions.
- **`src/devices/index.js`** — the blueprint registry. `index.js` only ever talks to the registry, so
  adding a device type means adding a file and one array entry.
- **`src/devices/identity.js`** — which `external_id` a device keeps for life. Holds the stable
  platform id and the adoption of the devices created by ≤ 1.1.1 (see below).
- **`src/vigieau.js`** — VigiEau driver. Deliberately split: `fetchZones()` is the only impure part,
  `summarize()` / `toSeverityLevel()` are pure and carry all the mapping logic, which is why the
  severity rules are cheap to test.
- **`src/address.js`** — Base Adresse Nationale driver, free-text address → WGS-84 point.
- **`src/config.js`** — defaults, normalization, and `legacyLocationId()`, which only reproduces the
  `external_id` of the devices published by ≤ 1.1.1 so they can be recognized.

A blueprint exposes: `key`, `deviceExternalId(gladys)`, `buildDevice(gladys, config)`, and
optionally `onPoll`, `refresh`, `startPolling`, `actions`.

### The device identity does not depend on the configuration

Gladys matches devices, features and states by `external_id`. Up to 1.1.1 it carried the coordinates
(`ext:vigieau:drought-zone:latlon-48.8566_2.3522`), so changing the address changed the device's
identity: Discovery offered a second device, the one already in a room went silent, and the user had
to delete it and lose its history. The location is configuration, not identity — this integration
watches ONE location, so the platform id is the constant `STABLE_PLATFORM_ID` and moving the address
only moves where the same device looks.

`adoptExistingDevices()` runs on every connection, before publishing: it reads `gladys.getDevices()`
and, when a device of ours already exists under an older coordinate-based id, keeps publishing under
**its** external_id (features included — they exist under that prefix). That is the whole upgrade
path: nothing to delete, nothing to re-add. Several leftovers → the one matching the configured
location wins; none matching → publish the stable identity rather than pick a history at random.
`forgetDeletedDevice()` (wired to `onDeviceDeleted`) drops an adoption when the user deletes that
device, so the next publish offers the stable identity again.

Never derive `external_id` from anything the user can change in the Configuration screen.

### The location is a point, never a commune

`latitude`/`longitude` ARE the location, geocoded from the address typed in the `rechercher_adresse`
action. There is deliberately no INSEE commune code: `GET /api/zones?commune=` answers `409` as soon
as the commune spans several zones of one water type, and no retry fixes that — a point always falls
inside exactly one zone per type. The coordinates are only the query — the device `external_id` is
deliberately independent of them (see above).

Empty coordinates are `null`, never `0`: `Number('')` is `0`, a valid latitude in the Gulf of Guinea.

**They are stored as TEXT, not as numbers** (`type: "string"` in the manifest, parsed by
`toCoordinate()`). A `number` field is rendered as an `<input type="number">`, and the browser
sanitizes that input against **its own locale**: on a French browser `48.8566` is not a number, so
`e.target.value` is `''`, and the Configuration screen drops the key from the payload it saves
(`saveConfig` skips a `NaN`) — the coordinate silently keeps its previous value. A text field hands
the integration exactly what was typed, and `toCoordinate()` accepts the comma and the dot alike.
Two consequences: the range `min`/`max` used to enforce is checked in `src/config.js` (`min`/`max`
are number-only in the store schema), and anything written back with `setConfig` must be a string —
hence `formatCoordinate()`. `legacyCoordinatePatch()` rewrites the numbers stored by ≤ 1.1.1, whose
first Save would otherwise 422 as a whole.

`isConfigured()` gates discovery. With no location, `publishDevices()` publishes nothing and reports
why through `setConnectionStatus` — a device pinned to an empty location is worse than no device.

The geocoder answers GeoJSON: `coordinates[0]` is the **longitude**, `[1]` the latitude. Swapping
them moves the location by hundreds of kilometres in silence.

### VigiEau answers that are not what they look like

Confirmed against the API sources (`MTES-MCT/vigieau-api`, public), not guessed:

- **`404`** = no zone covers the location → level 0, not an error.
- **`409`** = "la commune comporte plusieurs zones d'alerte de même type": the commune path cannot
  identify the applicable zone, which is why this integration never uses it. The branch is kept
  tagged with `code = AMBIGUOUS_COMMUNE` so that, if it ever fires on a point, the screen asks for a
  more precise address instead of retrying forever.
- **A zone with no severity at all** is level 0, not "unknown". `formatZones` pads the water types a
  commune has no real zone for with placeholders holding only `type` and the municipal decree URL.
  `zoneSeverity()` makes that distinction; only a non-empty wording it cannot map returns `null`.

`niveauGravite` is the current field (`pas_restriction | vigilance | alerte | alerte_renforcee |
crise`); `niveauAlerte` was the previous generation's name, spelled out in French, and is read as a
fallback. `toSeverityLevel()` normalizes accents, case and separators, so both vocabularies map.

### Refresh loop

The device declares **no `poll_frequency`** and the integration runs its own `setInterval`
(`startPolling`), refreshing immediately then every `poll_frequency` seconds, floored at
`MIN_REFRESH_SECONDS` (300). `blueprint.refresh()` never throws — a rejection inside a timer callback
would take the container down — and reports outages through `setConnectionStatus`.

## Gladys core constraints that are not obvious

Each of these caused a real bug. The core sources are worth cloning when in doubt
(`GladysAssistant/Gladys`, public, read-only clone is enough).

- **`poll_frequency` is an ENUM in MILLISECONDS capped at one minute** —
  `[60000, 30000, 15000, 10000, 2000, 1000]`, see `server/utils/constants.js`. Anything else is
  rejected with `invalid poll frequency` and the **whole batch** is refused. Hence the self-driven
  timer: a drought decree changes once a day, and one minute is the slowest interval the core offers.
- **Every feature needs an explicit numeric `min` and `max`** — `t_device_feature.min/max` are
  `NOT NULL` with no default. Publishing passes, then the user's "add device" click fails.
- **A `number` config field is locale-dependent, and a value it rejects is dropped in silence** —
  `ConfigSchemaForm.jsx` renders `<input type="number">` and reads `e.target.value`, which the
  browser has already sanitized in its own locale (a French one refuses `48.8566`); `saveConfig`
  (`config-page/index.js`) then leaves a `NaN` out of the payload, and the partial server-side merge
  keeps the old value. A decimal a user has to type belongs in a `string` field, parsed here. The
  types must match at the other end too: `validateConfigValue` 422s a number written under a
  `string` field, and vice versa.
- **The core silently drops states for a feature that does not exist yet**
  (`externalIntegration.saveStates.js`). States published before the user adds the device go nowhere,
  which is why `index.js` listens to `onDeviceCreated` and refreshes immediately.
- **A `risk`/`integer` value is rendered through the core's OWN label set** —
  `BADGE_VALUE_CONVERTERS` in
  `front/src/components/boxs/device-in-room/device-features/sensor-value/BadgeNumberDeviceValue.jsx`
  maps `0 no-risk · 1 low-risk · 2 medium-risk · 3 high-risk`; everything else,
  a missing value included, falls through to "Inconnu". VigiEau's five levels are folded onto that
  range by `toGladysRisk()` — `crise` joins `alerte renforcée` at `3`, and the text feature carries
  the exact wording.
- **The Features list ignores the published feature `name`** —
  `front/src/components/device/view/DeviceFeature.jsx` renders only
  `deviceFeatureCategory.<category>.<type>`, so four `risk`/`integer` features all read "Niveau de
  risque". Dashboards and scenes use `getDeviceFeatureName`, which does show the real name — but only
  when another feature shares the same `type`. Nothing here can change those labels.
- **Publish-time validation lives in `externalIntegration.setDiscoveredDevices.js`** — read it before
  adding a field to the device payload.

## Manifest gotchas

`gladys-assistant-integration.json` is validated by the store schema, not by anything in this repo.
The traps, each pinned by a test in `test/manifest.test.js`:

- the free-text field type is **`string`**, not `text`;
- `placeholder` must be a multi-language **object**, never a bare string;
- `description.en` / `.fr` are capped at **100 characters**;
- a `select` takes static `options` or the core's `source: "devices"` — there is no dynamic source,
  which is why the commune "selector" is an action with its own form rather than a dropdown.

Manifest actions are registered per key. Most live in `blueprint.actions`; `rechercher_adresse` is
registered directly in `index.js` because it writes the config back (`setConfig`) and re-publishes
the catalog. `test/manifest.test.js` keeps `REGISTRY_LEVEL_ACTIONS` in sync — update it when adding
another registry-level action.

## Releasing

**Actions → Release → Run workflow** (`patch`/`minor`/`major`). It bumps `package.json` and the
manifest `version` + `docker_image` tag together, reformats both with Prettier (jq and npm do not
write Prettier's style, which used to break the next `format:check`), commits, tags `vX.Y.Z` and
calls `build.yml` for the multi-arch image.

Config-schema and feature changes only reach users through a release. A feature-set change also
requires the user to update the already-created device from the Discovery screen, or the removed
feature lingers as an orphan.

## Conventions

Comments explain **why**, not what — particularly the core constraints above, which look arbitrary
without their reason. Prefer keeping the pure/impure split in the drivers so logic stays testable
without the network. User-facing strings (device and feature names, action messages) are French, with
`en`/`fr` pairs everywhere the manifest or the SDK accepts a multi-language object.
