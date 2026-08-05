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
| **Drought alert level**  | 0 to 3 — the worst of the three water types  |
| **Level (text)**         | "Alerte renforcée", "Crise"…                 |
| **Surface water level**  | 0 to 3 — rivers and lakes (`SUP` zones)      |
| **Groundwater level**    | 0 to 3 — aquifers (`SOU` zones)              |
| **Drinking water level** | 0 to 3 — the tap water network (`AEP` zones) |

The numeric scale follows the prefectoral decrees, folded onto the four values
Gladys knows how to name:

| Value | Shown by Gladys | VigiEau level                 | What it means                        |
| ----- | --------------- | ----------------------------- | ------------------------------------ |
| 0     | Pas de risque   | Pas de restriction            | Nothing in force at this address     |
| 1     | Faible          | Vigilance                     | Water savings encouraged, no ban yet |
| 2     | Moyen           | Alerte                        | First bans (watering, car washing…)  |
| 3     | Élevé           | Alerte renforcée **or** Crise | Wider bans, up to priority uses only |

> Gladys can only label a risk level from 0 to 3; anything above shows as
> "Inconnu". "Alerte renforcée" and "Crise" therefore share the value 3. The
> **Level (text)** sensor keeps the exact official wording, "Crise" included —
> use it to tell the two apart.

A single location can belong to several zones: a decree may restrict groundwater
without touching the tap. That is why the three water types are exposed
separately, in addition to the overall level.

## Configuration

1. Open the integration's **Configuration** tab.
2. Give the **location a name** ("Maison", "Jardin"…): it shows up in the device
   name.
3. Click **"Search for my address"**, type your address (street, postal code,
   town) and confirm: the **latitude** and **longitude** are filled in for you,
   and the address it settled on is kept in **"Last address searched"** so you
   can see at a glance where the device is looking.
   If you rather type the coordinates yourself — read off a map, say — both
   decimal separators are accepted: `48.8566` and `48,8566` are the same point.
4. Pick your **user profile**: household, company, local authority or farm.
   Restrictions differ per profile, and VigiEau returns the ones that apply to
   yours.
5. Leave the **refresh interval** at 3600 s (1 hour): prefectoral decrees change
   once a day at most. The integration keeps that pace itself; a 5-minute floor
   applies whatever you type.
6. Save: the device shows up in the **Discovery** tab, ready to be added.

> Until an address has been geocoded, no device is offered and the integration
> says so in its Configuration screen. That is deliberate: no device beats a
> device pinned to an empty location.

> If you change the location later (a new address), Gladys discovers a **new**
> device: add it, then delete the old one. Merely renaming the location leaves
> the existing device untouched.

## Why an address and not a postal code

The watched location is a **precise point**, not a commune.

> A **postal code** often covers several communes, and one commune can span
> **several restriction zones** for the same water type. That is exactly when
> VigiEau refuses to answer and asks for your street: the commune code cannot
> name the applicable zone.

A geocoded point never has that problem — it falls inside exactly one zone per
water type. The integration therefore always queries VigiEau by coordinates.

### The search button

1. Click **"Search for my address (fills the coordinates)"**.
2. Type your address. The more precise, the better: "12 rue des Lilas, 82000
   Montauban" beats "Montauban".
3. The integration geocodes it on the official
   [Base Adresse Nationale](https://adresse.data.gouv.fr) — the same service
   the VigiEau website uses — writes the latitude and longitude into the
   fields, and publishes the device in the **Discovery** tab. Reload the page
   to see the fields filled in.

When several addresses match with **no clear winner**, the integration **does
not guess**: it lists the candidates and asks you to be more precise. Add the
number, the street or the town, and search again.

The confirmation message shows the address it settled on and its coordinates:
check it at a glance before moving on.

## Actions

- **Search for my address (fills the coordinates)** — geocodes your address and
  fills in the latitude and longitude. See "Why an address and not a postal
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
  1. Are the **latitude and longitude filled in**? Without them the integration
     deliberately publishes no device, and the Configuration screen says so.
     Use the **"Search for my address"** button.
  2. Click **Scan** in the Discovery tab to force a new publication.
  3. Read the **integration logs**. A line starting with `Published` confirms
     Gladys accepted the device. If you see
     `Post-connection initialization failed` instead, the message that follows
     gives the exact reason — it is also shown in the Configuration screen.
  4. Check that the container is actually running: a Docker image that cannot
     be pulled (`manifest unknown`) stops the integration from starting, and
     nothing is ever published.
- **A latitude or longitude typed by hand is not saved** — that was the case up
  to version 1.1.1: the fields only took the decimal separator of your browser,
  and a value it refused was dropped with no message. Both separators work now
  (`48.8566` as well as `48,8566`). Update the integration, then type the
  coordinate again — or simply use **"Search for my address"**.
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
- **"VigiEau cannot tell which zone applies here"** — the configured point does
  not fall inside a single zone. Run **"Search for my address"** again with a
  more precise address (number and street rather than just the town name).
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
