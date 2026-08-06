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
  `onPoll`, `refresh`, `startPolling` and the two read-only manifest actions.
- **`src/devices/index.js`** — the blueprint registry. `index.js` only ever talks to the registry, so
  adding a device type means adding a file and one array entry.
- **`src/devices/identity.js`** — which `external_id` a device keeps for life. Holds the adoption of
  the devices created by ≤ 1.1.1 (see below).
- **`src/locations.js`** — the watched location list: its model, its storage format, the position
  arithmetic the delete dropdown needs, and `locationRows()`, which renders the table.
- **`src/locationEditor.js`** — the location manager: the add/delete actions, and `sync()`, which
  redraws the table from the stored list. All its dependencies are injected, so it is tested
  offline.
- **`src/vigieau.js`** — VigiEau driver. Deliberately split: `fetchZones()` is the only impure part,
  `summarize()` / `toSeverityLevel()` are pure and carry all the mapping logic, which is why the
  severity rules are cheap to test.
- **`src/address.js`** — Base Adresse Nationale driver, free-text address → WGS-84 point.
- **`src/coordinates.js`** — reading and writing a WGS-84 coordinate. Its own module so `locations.js`
  can parse one without a cycle through `config.js`.
- **`src/config.js`** — defaults, normalization, and `legacyLocationId()`, which only reproduces the
  `external_id` of the devices published by ≤ 1.1.1 so they can be recognized.

A blueprint exposes: `key`, `deviceExternalIds(gladys, config)`, `buildDevices(gladys, config)`, and
optionally `onPoll`, `refresh`, `startPolling`, `actions`.

### Several locations, one device each — and a READ-ONLY table

The user watches a LIST of locations, one device per entry, capped at `MAX_LOCATIONS` (10). It is
built by two actions and by nothing else: **a location is added and deleted, never edited.**

**Where the list lives.** Not in the `config_schema`: it is a fixed set of fields with no repeatable
one, and a `select` only takes the options written in the manifest. It lives under the off-schema
`locations` key, which `setIntegrationConfig` documents as free internal storage of the integration
— JSON-encoded, handed back parsed by `getConfig()`.

**How the user sees it.** The Configuration screen is three sections, in this order. "Pour
commencer" presents VigiEau and stops there. "Réglages généraux" holds the two settings shared by
every location (`profil`, `poll_frequency`) — first, because it is two fields and the table below is
ten lines. "Informations sur les lieux" is the TABLE: ten `string` fields `lieu_1` … `lieu_10`
(`ROW_FIELDS`), each holding one line, `Nom | Adresse | Latitude | Longitude`. The integration
writes them; the positions nothing sits at are written EMPTY, so only the configured locations show.

**The table is a display, never an input.** Every non-`section` field the screen renders is an
`<input>` — there is no read-only, multi-line nor repeatable widget in `ConfigSchemaForm.jsx` — so a
line the user types over is simply rewritten from the store: `locationEditor.sync()` runs on every
`config-updated` and on every connection, and only writes the lines that actually differ. Nothing in
that section can create, move or rename a location.

**Ten lines exist whatever the list holds** — a manifest is a file. That is also why the delete
action names a location by its LINE NUMBER: `locationAtPosition` maps "Lieu 3" to an entry, and the
table is what tells the user which one that is.

Three constraints forced this shape, and none is negotiable:

- **A `select` is validated against the manifest's static `options`, so a dropdown can NEVER show
  the location names.** Checked at the `v4.84.4` tag itself, not on master:
  `externalIntegration.getDynamicOptions.js` does not exist there, and `validateConfigValue` reads
  `(field.options || []).map(o => o.value)`. The core's only dynamic source, `source: "devices"`,
  is therefore refused with a 422 in `runAction`/`saveConfigFromFront` before the command reaches
  the container — a previous attempt shipped it and every action carrying it failed with "L'action
  a échoué". A test fails the build if any field declares a `source` again, and another one runs
  every declared option through the real `validateConfigValue` with no dynamic options.
- **The Configuration screen displays NOTHING an integration says about a Save, and nothing can
  refresh it.** `setConnectionStatus` is rendered on the Supervision page and inside an `oauth2`
  field, nowhere else; only an ACTION's result message is shown, under its button. The page listens
  to exactly two websocket events (`STATUS_CHANGED`, `CONNECTION_STATUS_UPDATED`) and neither
  re-reads the config; `runAction` does not call `loadData()`; and `saveConfigFromFront` returns
  `getConfigForFront()` right after a **fire-and-forget** `sendMessage` (its own JSDoc says so), so
  the answer the front refreshes its fields from is read BEFORE this container has reacted. There is
  no way to refresh the screen in real time, and no way to reload it — the user presses F5. Since
  the table cannot answer either, everything the user has to be told happens under an action button,
  which is exactly where adding and deleting live.
- **A Save of an open tab sends back the lines it was loaded with.** The core stores them, so a
  location added or deleted since that page load would stay on screen for good — hence the redraw on
  every `config-updated`, not only when the list changes.

**What editing a location used to be, and why it is gone.** Up to this version the section carried a
`lieu` dropdown pointing four mirror fields (`location_name`, `address_label`, `latitude`,
`longitude`) at one entry; a Save wrote them back into the list. Two things made it unusable: the
dropdown could only offer positions (above), and the mirror fields kept showing the PREVIOUS
location after every selection — the core pushes nothing to an open form — so saving them wrote one
location's address onto another. A snapshot guard (`staleFields`) made that safe and cost more than
the feature was worth. Moving a location now means adding the new address and deleting the old line,
which publishes a NEW device: the old one keeps its own history. Do not bring the selection back
without re-reading the two constraints above.

Those four keys are gone from the `config_schema`, but their stored VALUES are still handed to the
integration — `getIntegrationConfig` returns every variable, schema or not — which is what
`legacyLocations()` reads to migrate an install made before 1.3.0.

### The device identity does not depend on the configuration

Gladys matches devices, features and states by `external_id`. Up to 1.1.1 it carried the coordinates
(`ext:vigieau:drought-zone:latlon-48.8566_2.3522`), so changing the address changed the device's
identity: Discovery offered a second device, the one already in a room went silent, and the user had
to delete it and lose its history. The location is configuration, not identity — the platform id is
the location's OWN id, generated once when it is added and never derived from anything editable.
Nothing in the Configuration screen moves a location any more, but the rule is what makes a rename
or a future edit free of consequence — and it is what an install upgraded from ≤ 1.1.1 relies on.

The single location of an install made before this version is migrated under `FIRST_LOCATION_ID`
(`location`), which is the very platform id its device was published with — so no external_id moves.

`adoptExistingDevices()` runs on every connection, before publishing: it reads `gladys.getDevices()`
and, when a leftover device of ours exists under an older coordinate-based id, keeps publishing the
FIRST location under **its** external_id (features included — they exist under that prefix). That is
the whole upgrade path: nothing to delete, nothing to re-add. Several leftovers → the one matching
the first location wins; none matching → publish its own identity rather than pick a history at
random. `forgetDeletedDevice()` (wired to `onDeviceDeleted`) drops an adoption when the user deletes
that device, so the next publish offers the location's own identity again.

Never derive `external_id` from anything the user can change in the Configuration screen.

Deleting a location does NOT delete its Gladys device — an integration can only stop offering one —
which is why location ids are random rather than counters: a reused id would hand a surviving
device's history to the next location the user creates.

Two different things hide behind "the device is still there", and the delete action tells them
apart by asking `findCreatedDevice` BEFORE it re-publishes:

- **Never created.** It only ever existed in the Discovery screen, which is an IN-MEMORY list
  `setDiscoveredDevices` REPLACES on every publish. Re-publishing without it is enough — but only if
  the publish actually happens: `publishDevices()` used to return early when no location was left,
  so deleting the LAST one kept offering its device until the container restarted. An empty catalog
  is published now, and that is the whole point of publishing one.
- **Already created.** It lives in `t_device` and nothing an integration can call deletes it: there
  is no `deleteDevice` in the SDK and no device DELETE route in the integration-facing API (checked
  at `v4.84.4`). The message names the device and points at the Devices tab, because a sensor that
  silently stops updating is the worst of both worlds.

### The location is a point, never a commune

`latitude`/`longitude` ARE a location, geocoded from the address typed in the `rechercher_adresse`
action — the only place an address is ever typed. There is deliberately no INSEE commune code: `GET /api/zones?commune=` answers `409` as soon
as the commune spans several zones of one water type, and no retry fixes that — a point always falls
inside exactly one zone per type. The coordinates are only the query — the device `external_id` is
deliberately independent of them (see above).

Empty coordinates are `null`, never `0`: `Number('')` is `0`, a valid latitude in the Gulf of Guinea.

**They are stored as TEXT, not as numbers**, and `toCoordinate()` reads them. No field asks for one
any more, but the rule holds for whatever does next: a `number` field is rendered as an
`<input type="number">`, and the browser sanitizes that input against **its own locale**: on a
French browser `48.8566` is not a number, so `e.target.value` is `''`, and the Configuration screen
drops the key from the payload it saves (`saveConfig` skips a `NaN`) — the value silently keeps what
it had. `toCoordinate()` accepts the comma and the dot alike, checks the WGS-84 range itself
(`min`/`max` are number-only in the store schema), and `formatCoordinate()` writes back the text it
reads. A coordinate stored as a NUMBER by ≤ 1.1.1 is read just as well, which is all the migration
needs now that those keys are off-schema.

`isConfigured()` gates discovery: it is true as soon as ONE location has a usable point. With none,
`publishDevices()` publishes nothing and reports why through `setConnectionStatus` — a device pinned
to an empty location is worse than no device.

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

The devices declare **no `poll_frequency`** and the integration runs its own `setInterval`
(`startPolling`), refreshing immediately then every `poll_frequency` seconds, floored at
`MIN_REFRESH_SECONDS` (300). One cycle covers EVERY location, and one failing does not silence the
others — a 409 on a badly geocoded garden must not hide the drought level of the house; the status
names the location that failed. `blueprint.refresh()` never throws — a rejection inside a timer
callback would take the container down — and reports outages through `setConnectionStatus`.

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
- a `select` takes static `options` or the core's `source: "devices"` — and that source has no
  server-side implementation in any released Gladys, so the only usable options are the static ones,
  which is why the delete dropdown offers line numbers.

Manifest actions are registered per key. The read-only ones live in `blueprint.actions`; the two
that EDIT the list (`rechercher_adresse`, `supprimer_lieu`) come from `createLocationEditor()`
because they write the config back and re-publish the catalog, which is not a device's business. `test/manifest.test.js` reads `REGISTRY_LEVEL_ACTIONS` off that factory, so a
handler added there cannot silently skip the manifest.

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
