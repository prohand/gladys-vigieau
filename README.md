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

Three buttons are available in the Configuration screen: **Rechercher mon
adresse** (geocodes an address and fills in the coordinates),
**Tester la connexion VigiEau** (live check, shows the current level) and
**Afficher les restrictions en vigueur** (lists the restricted usages and links
the decree).

User documentation, re-hosted by Gladys and linked from the Configuration
screen: [`docs/fr.md`](./docs/fr.md) — [`docs/en.md`](./docs/en.md).

## How it works

`GET https://api.vigieau.beta.gouv.fr/api/zones` is called at the configured
interval, with the user profile (`particulier`, `entreprise`, `collectivite`,
`exploitation`) and the location. The endpoint answers one zone per water type,
each with its own `niveauGravite`, the decree in force and the list of
restricted usages.

The location is a **geocoded point**. The user types an address in the
**"Search for my address"** action, the integration resolves it on the official
[Base Adresse Nationale](https://adresse.data.gouv.fr) (`GET /search`) — the
same geocoder vigieau.gouv.fr uses — and writes the latitude and longitude back
with `setConfig()`, re-publishing the catalog on the spot. The address it
settled on is kept in the `address_label` config field — purely informational,
so the user can see where the device is looking without decoding two decimals. There is no INSEE
commune code: querying VigiEau by commune answers `409` as soon as the commune
spans several zones of one water type, which no retry can fix. A point always
falls inside exactly one zone per type. An address that matches several
candidates with no clear winner is never guessed — the action lists them and
asks for a more precise query.

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
- **No device is published before the location is known.** Until an address has
  been geocoded, discovery returns nothing and the Configuration screen says
  why — better than a device pinned to an empty location that the user would
  have to delete by hand.
- **The coordinates are stored as text, and both decimal separators work.** A
  `number` config field renders an `<input type="number">`, whose value the
  browser sanitizes in its own locale: on a French browser `48.8566` is not a
  number, the front leaves the key out of the payload it saves, and the
  coordinate silently keeps its old value. A `string` field hands the
  integration exactly what was typed; `toCoordinate()` reads `48,8566` and
  `48.8566` alike and checks the WGS-84 range itself.
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
│  ├─ vigieau.js                     # VigiEau API driver + severity mapping (pure part)
│  ├─ address.js                     # geocoder driver: address -> lat/lon
│  └─ config.js                      # config defaults, normalization, stable location id
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
- The device `external_id` is derived from the watched location, not from its
  name: renaming a location keeps the device and its history, moving it creates
  a new one.
- VigiEau data is provided for information only; in case of doubt the
  prefectoral decree published by your prefecture prevails.

## License

Apache-2.0
