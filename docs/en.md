# VigiEau — French drought alert levels in Gladys

This integration queries [VigiEau](https://vigieau.gouv.fr), the French
government service publishing the **drought alert level** and the **water
restrictions** in force at a given address, and exposes the result as Gladys
sensors.

The VigiEau API is free and public: **no account, no API key**. It covers
**France only**.

## What you get

One device, "Vigilance sécheresse — _your location_", carrying six sensors:

| Sensor                    | Value                                        |
| ------------------------- | -------------------------------------------- |
| **Drought alert level**   | 0 to 4 — the worst of the three water types  |
| **Level (text)**          | "Alerte renforcée", "Crise"…                 |
| **Restrictions in force** | On as soon as the level is above 0           |
| **Surface water level**   | 0 to 4 — rivers and lakes (`SUP` zones)      |
| **Groundwater level**     | 0 to 4 — aquifers (`SOU` zones)              |
| **Drinking water level**  | 0 to 4 — the tap water network (`AEP` zones) |

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
3. Tell the integration **where to look**, either:
   - the **INSEE commune code** (5 characters, e.g. `75056` for Paris) — the most
     reliable option, and it takes precedence over the coordinates;
   - or the **latitude** and **longitude** of the place (WGS-84). You will find
     them in Gladys (house → position) or on any map.
4. Pick your **user profile**: household, company, local authority or farm.
   Restrictions differ per profile, and VigiEau returns the ones that apply to
   yours.
5. Leave the **refresh interval** at 3600 s (1 hour): prefectoral decrees change
   once a day at most.
6. Save: the device shows up in the **Discovery** tab, ready to be added.

> If you change the location later (new coordinates or new INSEE code), Gladys
> discovers a **new** device: add it, then delete the old one. Merely renaming
> the location leaves the existing device untouched.

## Actions

- **Test the VigiEau connection** — runs a live request and shows the current
  level for the three water types. Use it right after the configuration to check
  that your location is covered.
- **Show the restrictions in force** — lists the water usages currently
  restricted at this address for your profile, with a link to the decree.

## Scene ideas

- **Stop the automatic watering** as soon as "Restrictions in force" turns on, or
  as soon as "Drought alert level" reaches 2 (Alerte).
- **Get notified** when the level changes: trigger on the "Level (text)" sensor,
  which carries the official wording.
- **Follow the season**: the numeric sensors keep their history, so a chart shows
  the severity climbing through the summer.

## Troubleshooting

- **No data / errors in the logs** — start with the **Test the VigiEau
  connection** action. A `VigiEau HTTP 5xx` error means the service is
  temporarily unavailable: the integration retries at the next refresh.
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
