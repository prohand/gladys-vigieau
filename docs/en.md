# VigiEau — French drought alert levels in Gladys

This integration queries [VigiEau](https://vigieau.gouv.fr), the French
government service publishing the **drought alert level** and the **water
restrictions** in force at a given address, and exposes the result as Gladys
sensors.

The VigiEau API is free and public: **no account, no API key**. It covers
**France only**.

## What you get

One device, "Vigilance sécheresse — _your location_", carrying five sensors:

| Sensor                   | Value                                        |
| ------------------------ | -------------------------------------------- |
| **Drought alert level**  | 0 to 4 — the worst of the three water types  |
| **Level (text)**         | "Alerte renforcée", "Crise"…                 |
| **Surface water level**  | 0 to 4 — rivers and lakes (`SUP` zones)      |
| **Groundwater level**    | 0 to 4 — aquifers (`SOU` zones)              |
| **Drinking water level** | 0 to 4 — the tap water network (`AEP` zones) |

The numeric scale follows the one used by the prefectoral decrees:

| Value | Level (official French wording) | What it means                              |
| ----- | ------------------------------- | ------------------------------------------ |
| 0     | Pas de restriction              | Nothing in force at this address           |
| 1     | Vigilance                       | Water savings encouraged, no ban yet       |
| 2     | Alerte                          | First bans (watering, car washing…)        |
| 3     | Alerte renforcée                | Wider bans, stricter time windows          |
| 4     | Crise                           | Only priority uses (health, safety) remain |

A single location can belong to several zones: a decree may restrict groundwater
without touching the tap. That is why the three water types are exposed
separately, in addition to the overall level.

## Configuration

1. Open the integration's **Configuration** tab.
2. Give the **location a name** ("Maison", "Jardin"…): it shows up in the device
   name.
3. Fill in the **INSEE commune code** — the only mandatory location field. The
   easy way: click **"Find my commune"**, type its name, and the code is filled
   in for you (see "Finding your INSEE code" below).
4. **Optional**: the **latitude** and **longitude** of the place (WGS-84). Leave
   them empty unless your commune is large enough to span several restriction
   zones; in that case the exact point replaces the commune in the query. Both
   are needed — a latitude on its own is ignored.
5. Pick your **user profile**: household, company, local authority or farm.
   Restrictions differ per profile, and VigiEau returns the ones that apply to
   yours.
6. Leave the **refresh interval** at 3600 s (1 hour): prefectoral decrees change
   once a day at most. The integration keeps that pace itself; a 5-minute floor
   applies whatever you type.
7. Save: the device shows up in the **Discovery** tab, ready to be added.

> Until the INSEE code is filled in, no device is offered and the integration
> says so in its Configuration screen. That is deliberate: no device beats a
> device pinned to an empty location.

> If you change the location later (new INSEE code, or coordinates added or
> removed), Gladys discovers a **new** device: add it, then delete the old one.
> Merely renaming the location leaves the existing device untouched.

## Finding your INSEE code

The INSEE code identifies a French commune with **5 characters**: `75056` for
Paris, `69123` for Lyon, `2A004` for Ajaccio.

> **It is not the postal code.** A postal code can cover several communes, and a
> large city has several postal codes for a single INSEE code. Using the postal
> code in the INSEE field will give an error or the wrong result.

### The easy way: the search button

In the Configuration screen, the **"Find my commune (fills the INSEE code)"**
action does the work for you:

1. Click the button.
2. Type the **commune name** ("Bordeaux"). You can also give only the **postal
   code** — the one on your mail.
3. The integration queries the official Geo API, writes the INSEE code into the
   **INSEE commune code** field and publishes the device in the **Discovery**
   tab. Reload the page to see the field filled in.

When several communes share a name — a dozen "Sainte-Marie" exist — the
integration **does not guess**: it lists the candidates with their department
and INSEE code. Run the search again with the postal code, or copy the right
code yourself.

### By hand

- **The INSEE geographic search** —
  <https://www.insee.fr/fr/recherche/recherche-geographique>: look up your
  commune, its official geographic code is shown on its page.
- **The official Geo API**, for a direct answer — open
  <https://geo.api.gouv.fr/communes?nom=Paris&fields=code,nom> in your browser
  and replace `Paris` with the name of your commune. The `code` field of the
  answer is the INSEE code.

Both links are also available in the integration's Configuration screen, right
above the field.

## Actions

- **Find my commune (fills the INSEE code)** — search by name and/or postal
  code, the INSEE code is filled in automatically. See "Finding your INSEE
  code" above.
- **Test the VigiEau connection** — runs a live request and shows the current
  level for the three water types. Use it right after the configuration to check
  that your location is covered.
- **Show the restrictions in force** — lists the water usages currently
  restricted at this address for your profile, with a link to the decree.

## Scene ideas

- **Stop the automatic watering** as soon as "Drought alert level" reaches 1
  (Vigilance) or 2 (Alerte), depending on how cautious you want to be.
- **Get notified** when the level changes: trigger on the "Level (text)" sensor,
  which carries the official wording.
- **Follow the season**: the numeric sensors keep their history, so a chart shows
  the severity climbing through the summer.

## Troubleshooting

- **No device in the Discovery tab** — in order:
  1. Is the **INSEE code filled in**? Without it the integration deliberately
     publishes no device, and the Configuration screen says so. Use the **"Find
     my commune"** button.
  2. Click **Scan** in the Discovery tab to force a new publication.
  3. Read the **integration logs**. A line starting with `Published` confirms
     Gladys accepted the device. If you see
     `Post-connection initialization failed` instead, the message that follows
     gives the exact reason — it is also shown in the Configuration screen.
  4. Check that the container is actually running: a Docker image that cannot
     be pulled (`manifest unknown`) stops the integration from starting, and
     nothing is ever published.
- **"No recent value" on every feature** — right after adding the device this
  is normal for a few seconds: Gladys drops the states published before the
  device existed. The integration notices the creation and refreshes straight
  away. If it is still empty after a minute, use the **Test the VigiEau
  connection** action: it queries the API live and shows any error.
- **Every feature is called "Risk level"** — that is how Gladys displays them:
  the "Features" list on the device page shows the generic category label, not
  the name published by the integration. In order they are: overall level,
  text, surface water, groundwater, drinking water. On a dashboard or in a
  scene, the four levels do show their real names.
- **No data / errors in the logs** — start with the **Test the VigiEau
  connection** action. A `VigiEau HTTP 5xx` error means the service is
  temporarily unavailable: it is shown in the Configuration screen, and the
  integration retries at the next refresh without giving up.
- **The values do not refresh every minute** — that is expected. The device
  does not use Gladys' polling mechanism (capped at one minute): the
  integration refreshes on its own at the configured interval, immediately on
  connection and then hourly by default.
- **All levels at 0** — that is the normal answer when no restriction zone covers
  the address (VigiEau only covers France).
- **The level stopped moving although the API changed** — the integration never
  publishes a value it did not understand, so it cannot wrongly announce "no
  restriction". The logs then carry a `VigiEau returned an unknown severity`
  warning.

The integration logs everything it does: read its logs from the Gladys interface
(or `docker logs` on the host) with `LOG_LEVEL=debug` for the full detail,
including the URL being called.

## Data source

Data comes from VigiEau, operated by the French Ministry for Ecological
Transition. It is provided for information only: in case of doubt, the
prefectoral decree published by your prefecture prevails.
