# Gladys × VigiEau — vigilance sécheresse

External integration for [Gladys Assistant](https://gladysassistant.com) that
brings the French **drought alert level** ("vigilance sécheresse") and the
**water restrictions** in force at your address into Gladys, as regular devices
you can chart, notify on and use in scenes.

Data comes from [VigiEau](https://vigieau.gouv.fr), the official service of the
French Ministry for Ecological Transition. The API is **free and public**: no
account, no API key. It covers **France only**.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

## What it exposes

One device per watched location — `Vigilance sécheresse — <location>` — with five
read-only features:

| Feature                        | Category / type  | Value                                         |
| ------------------------------ | ---------------- | --------------------------------------------- |
| Niveau de vigilance sécheresse | `risk` / integer | 0-3, the worst of the three water types       |
| Niveau (texte)                 | `text` / text    | The official wording, e.g. `Alerte renforcée` |
| Niveau eau superficielle       | `risk` / integer | 0-3, `SUP` zones (rivers, lakes)              |
| Niveau eau souterraine         | `risk` / integer | 0-3, `SOU` zones (aquifers)                   |
| Niveau eau potable             | `risk` / integer | 0-3, `AEP` zones (tap water network)          |

The numeric scale is the prefectoral one folded onto the four values Gladys can
name — `0` Pas de risque, `1` Faible, `2` Moyen, `3` Élevé. VigiEau has five
levels, so `crise` shares `3` with `alerte renforcée`; the text feature keeps
the exact official wording to tell them apart.

Several locations can be watched — a house, a second home, an allotment garden
are rarely under the same prefectoral decree — and each one publishes **its own
device**, up to ten.

The Configuration screen is two sections: **Pour commencer** (what VigiEau is,
and its two links) and **Réglages généraux** (profile and refresh interval,
shared by every location). It holds no field about the locations at all — those
live entirely under the buttons.

Five buttons: **Ajouter un lieu** (geocodes an address, or takes a latitude and
a longitude typed by hand, and adds a location watching that point),
**Afficher les lieux** (the numbered list: name, address, coordinates),
**Supprimer un lieu** (a number plus a confirmation), **Tester la connexion
VigiEau** (live check, shows the current level of every location) and
**Afficher les restrictions en vigueur** (lists the restricted usages and links
the decree, per location).

User documentation, re-hosted by Gladys and linked from the Configuration
screen: [`docs/fr.md`](./docs/fr.md) — [`docs/en.md`](./docs/en.md).

## How it works

`GET https://api.vigieau.beta.gouv.fr/api/zones` is called at the configured
interval, with the user profile (`particulier`, `entreprise`, `collectivite`,
`exploitation`) and the location. The endpoint answers one zone per water type,
each with its own `niveauGravite`, the decree in force and the list of
restricted usages.

A location is a **point**. The user types an address in the
**"Add a location"** action, the integration resolves it on the official
[Base Adresse Nationale](https://adresse.data.gouv.fr) (`GET /search`) — the
same geocoder vigieau.gouv.fr uses — stores the latitude and longitude with
`setConfig()` and re-publishes the catalog on the spot. The same action also
takes a **latitude and a longitude typed by hand** (both optional, but both or
neither): given a point, it skips the geocoder entirely and keeps the address
as a plain label — the way out of an address the BAN does not know, a plot with
no street, or a point read off a map. A location is never edited afterwards:
moving one means adding the new point and deleting the old entry. There is no
INSEE commune code: querying VigiEau by commune answers `409` as soon as the
commune spans several zones of one water type, which no retry can fix. A point
always falls inside exactly one zone per type. An address that matches several
candidates with no clear winner is never guessed — the action lists them and
asks for a more precise query.

**Where the list lives, and why it is never a form field.** A `config_schema` is
a fixed set of fields with no repeatable one, and a `select` only takes the
options written in the manifest, so a list the user builds at runtime cannot be
a form field: it lives under the off-schema `locations` key, which the core
documents as free internal storage of the integration. Nor can the screen
_display_ it: every non-section field it renders is an `<input>`, with no
read-only nor multi-line widget — the ten static `string` lines this integration
wrote up to 1.3.0 needed an F5 to refresh and a rewrite on every save. The list
is shown by the **"Afficher les lieux"** action instead, whose result message the
screen renders live under its button. The delete dropdown therefore names a
location by its _number in that listing_: one showing the names would need the
core's `source: "devices"`, which is refused with a 422 by every released Gladys
(checked at the `v4.84.4` tag: `getDynamicOptions` exists only on master).

A few decisions are worth knowing about:

- **A location outside any zone is not an error.** VigiEau answers `404` there;
  the integration reads that as "nothing in force" and publishes level `0`.
  Neither is a zone published _without_ a severity: VigiEau pads the water types
  a commune has no real zone for with placeholders carrying only the municipal
  decree, and those mean "nothing in force" too — not "unknown".
- **`409` means the location is ambiguous, not that the service is down.**
  Querying by point is meant to make it unreachable, but the branch is kept: it
  is tagged and the Configuration screen asks for a more precise address instead
  of showing a status code and retrying forever.
- **An unreadable severity is never published.** If VigiEau ever returns a
  wording the integration does not know, the affected level is left at its last
  known value and a warning is logged, rather than publishing a `0` that would
  tell a watering scene everything is fine in the middle of a crisis.
- **No device is published before a location is known.** Until an address has
  been geocoded, discovery returns nothing and the Supervision screen says
  why — better than a device pinned to an empty location that the user would
  have to delete by hand.
- **Everything the user has to be told is said under a button.** The
  Configuration screen displays nothing an integration reports about a _Save_:
  `setConnectionStatus` is rendered on the Supervision page and inside an
  `oauth2` field, nowhere else, and the core pushes nothing to a screen that is
  already open. Only an _action's_ result message is shown, right under its
  button — which is why adding, listing and deleting are all actions, and why no
  reload is ever needed to see the current list.
- **The coordinates are text, and both decimal separators are read.** A `number`
  field renders an `<input type="number">`, whose value the browser sanitizes in
  its own locale: on a French browser `48.8566` is not a number, the front
  leaves the key out of the payload it saves, and the value silently stays what
  it was. Coordinates are therefore text everywhere — stored, and typed in the
  add action; `toCoordinate()` reads `48,8566` and `48.8566` alike and checks the
  WGS-84 range itself, which the store schema can only express on a number.
- **The numeric scale stops at 3 because Gladys' does.** A `risk`/`integer`
  feature is rendered through the core's own label set (`BADGE_VALUE_CONVERTERS`
  in `BadgeNumberDeviceValue.jsx`), which maps `0-3` and shows **"Inconnu"** for
  anything else — a `4` for `crise` would read as "unknown" precisely when it
  matters most. `toGladysRisk()` does the folding.
- **The refresh is driven by the integration, not by Gladys.** The device
  declares no `poll_frequency`: the core only accepts a fixed enum of intervals
  in milliseconds, capped at one minute, and querying a public government API
  1440 times a day for a decree that changes once a day would be absurd. The
  blueprint runs its own timer instead (`startPolling`), refreshing immediately
  on connection and then every `poll_frequency` seconds, never faster than a
  5-minute floor.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring (no business logic)
├─ src/
│  ├─ devices/
│  │  ├─ index.js                    #   device registry
│  │  └─ droughtZone.js              #   the drought device: features + polling + actions
│  │  └─ identity.js                 #   which external_id a device keeps for life
│  ├─ vigieau.js                     # VigiEau API driver + severity mapping (pure part)
│  ├─ address.js                     # geocoder driver: address -> lat/lon
│  ├─ locations.js                   # the watched location list: model + storage format
│  ├─ locationEditor.js              # the location manager: the add/list/delete actions
│  ├─ coordinates.js                 # reading and writing a WGS-84 coordinate
│  └─ config.js                      # config defaults, normalization, legacy location id
├─ docs/
│  ├─ en.md                          # user documentation, re-hosted by Gladys and
│  └─ fr.md                          #   linked from the Configuration screen
├─ test/                             # node --test, no test framework to install
├─ gladys-assistant-integration.json # manifest (name, config schema, image…)
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ .github/workflows/release.yml     # UI-driven release: bump + tag + build
├─ .github/workflows/build.yml       # multi-arch build (git tag or called by release)
└─ cover.png                         # catalog cover, 800×534 px, ≤150 KB
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="vigieau" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs inside its sandboxed container; the SDK reads them
automatically. `VIGIEAU_API_URL` and `ADDRESS_API_URL` can be set to point the
two drivers at a mock server instead of the public APIs.

## Quality checks

The same three gates run on every push and pull request (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

```bash
npm run format:check   # Prettier: is everything formatted?
npm run lint           # ESLint: catch real mistakes (unused vars, dead code…)
npm test               # Unit tests, via the built-in `node --test` runner
```

The suite covers the severity mapping (including accents and unknown wordings),
the URL building, the 404/5xx handling, the discovery payload and every polling
path — the network is stubbed, so it runs offline.

## Validate before publishing

Check that the integration passes the store validation locally, without waiting
for the hourly indexer:

```bash
npx github:GladysAssistant/integration-store .
```

It runs the same checks as the store indexer — manifest JSON & schema, Docker
image availability, cover image and the code rules — and exits `0` when the
integration is valid. A few things can only be confirmed once the repository is
public (public repo, the `gladys-assistant-integration` topic, and the manifest
sitting at the root of the default branch).

## Publish

1. Add the GitHub topic `gladys-assistant-integration` to this repository.
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`. The
   workflow bumps the version everywhere (`package.json` + manifest
   `version`/`docker_image`), pushes the `vX.Y.Z` tag and builds the
   `linux/amd64` + `linux/arm64` image to `ghcr.io`.
3. The decentralized indexer picks up the new manifest `version` and Gladys
   offers a one-click install / update.

## Notes

- Requires **Node.js ≥ 20** (uses the built-in global `fetch`; no HTTP
  dependency).
- A device `external_id` is built on the id its location was given when it was
  created, never on its coordinates: changing the address updates the existing
  device, which keeps its history, its rooms and its scenes. The single location
  of an install made before this version keeps the very id its device was
  published under, and a device created by a version up to 1.1.1, whose
  `external_id` carried the coordinates, is adopted on the first start after the
  update — nothing to delete, nothing to re-add.
- Deleting a location does **not** delete its Gladys device: an integration can
  only stop offering one. The action says so; deleting it is one click in
  Gladys.
- VigiEau data is provided for information only; in case of doubt the
  prefectoral decree published by your prefecture prevails.

## License

Apache-2.0
