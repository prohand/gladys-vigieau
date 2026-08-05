# VigiEau — French drought alert levels in Gladys

This integration queries [VigiEau](https://vigieau.gouv.fr), the French
government service publishing the **drought alert level** and the **water
restrictions** in force at a given address, and exposes the result as Gladys
sensors.

The VigiEau API is free and public: **no account, no API key**. It covers
**France only**.

## What you get

**One device per watched location**, "Vigilance sécheresse — _your location_",
carrying five sensors each. You can follow your house, a second home and an
allotment garden side by side: they are rarely under the same prefectoral
decree.

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
2. Pick your **user profile**: household, company, local authority or farm.
   Restrictions differ per profile, and VigiEau returns the ones that apply to
   yours. This setting is shared by every location.
3. Leave the **refresh interval** at 3600 s (1 hour): prefectoral decrees change
   once a day at most. The integration keeps that pace itself; a 5-minute floor
   applies whatever you type.
4. Click **"Add a location"**, give it a name ("Maison", "Jardin"… — it shows up
   in the device name) and type your address (street, postal code, town). The
   integration geocodes it and creates the matching device.
   If you rather type the coordinates yourself — read off a map, say — leave the
   address empty and fill in **latitude** and **longitude**: both decimal
   separators are accepted, `48.8566` and `48,8566` are the same point.
5. Repeat for every location you want to watch (10 at most).
6. The devices show up in the **Discovery** tab, ready to be added.

> Until an address has been geocoded, no device is offered and the integration
> says so in its Configuration screen. That is deliberate: no device beats a
> device pinned to an empty location.

> If you move or rename a location later (**"Edit a location"**), the
> **existing device follows it**: it keeps its history, its rooms and its
> scenes, and simply reports on the new point. There is nothing to delete and
> nothing to add again.

### Managing several locations

Locations are managed entirely from the buttons of the Configuration screen,
not from form fields: the list grows as you go, which a fixed form cannot
represent.

- **Add a location** — name + address (or coordinates). Re-using an existing
  name **updates that location** instead of creating a twin: that is how you fix
  an address you got wrong before its device even exists.
- **Edit a location** — pick the **device** in the dropdown, then give a new
  name, a new address, or both. Whatever you leave empty is left untouched.
- **Delete a location** — pick the device in the dropdown. For a location whose
  device was never added from the Discovery tab (so it is not in the list), type
  its **exact name** instead.
- **List the watched locations** — shows the whole list, with each address and
  its coordinates.

> The dropdown only offers the devices you have **actually added** from the
> Discovery tab: Gladys fills it with the integration's own devices. A location
> you just added is therefore not in it yet.

> Deleting a location stops its device from being offered, but **does not delete
> the device**: an integration is not allowed to. Delete it yourself in Gladys,
> or it will sit on its last value forever.

## Why an address and not a postal code

The watched location is a **precise point**, not a commune.

> A **postal code** often covers several communes, and one commune can span
> **several restriction zones** for the same water type. That is exactly when
> VigiEau refuses to answer and asks for your street: the commune code cannot
> name the applicable zone.

A geocoded point never has that problem — it falls inside exactly one zone per
water type. The integration therefore always queries VigiEau by coordinates.

### The address search

1. Click **"Add a location"** (or **"Edit a location"**).
2. Type your address. The more precise, the better: "12 rue des Lilas, 82000
   Montauban" beats "Montauban".
3. The integration geocodes it on the official
   [Base Adresse Nationale](https://adresse.data.gouv.fr) — the same service
   the VigiEau website uses — stores the point, and publishes the device in the
   **Discovery** tab.

When several addresses match with **no clear winner**, the integration **does
not guess**: it lists the candidates and asks you to be more precise. Add the
number, the street or the town, and search again.

The confirmation message shows the address it settled on and its coordinates:
check it at a glance before moving on.

## Actions

- **Add a location** — geocodes an address and creates the matching device. See
  "Why an address and not a postal code" above.
- **Edit a location** — renames or moves an existing location, picked by its
  device.
- **Delete a location** — stops watching a location.
- **List the watched locations** — shows the whole list.
- **Test the VigiEau connection** — runs a live request and shows the current
  level for the three water types. Use it right after the configuration to check
  that your location is covered. Leave the device selector empty to test every
  location at once.
- **Show the restrictions in force** — lists the water usages currently
  restricted for your profile, with a link to the decree. Here too, an empty
  selector covers every location.

## Scene ideas

- **Stop the automatic watering** as soon as "Drought alert level" reaches 1
  (Vigilance) or 2 (Alerte), depending on how cautious you want to be.
- **Get notified** when the level changes: trigger on the "Level (text)" sensor,
  which carries the official wording.
- **Follow the season**: the numeric sensors keep their history, so a chart shows
  the severity climbing through the summer.

## Troubleshooting

- **No device in the Discovery tab** — in order:
  1. **Have you added a location?** Without a geocoded location the integration
     deliberately publishes no device, and the Configuration screen says so. Use
     the **"Add a location"** button, then **"List the watched locations"** to
     check what is stored.
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
  coordinate again — or simply type an address.
- **Did my single location survive the update?** — yes. The location configured
  before version 1.3.0 automatically becomes the first of the list, under the id
  its device already had: that device keeps its history, its rooms and its
  scenes. Check with **"List the watched locations"**.
- **The "Location device" dropdown is empty** — it only holds the devices
  **already added** from the Discovery tab. Add the device first; to delete a
  location that has none yet, type its exact name in the field provided.
- **Two "Vigilance sécheresse" devices after changing the address** — that was
  the case up to version 1.1.1: the device id was built from the coordinates, so
  every address created its own device and the previous one stopped refreshing.
  The device now follows the address. After the update, the integration keeps
  the device you already created, history included — the log line
  `Keeping the existing identity of drought-zone` says which one. Any other
  device left over from an older address can be deleted in Gladys.
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
  not fall inside a single zone. The message names the location concerned: take
  it up again with **"Edit a location"** and a more precise address (number and
  street rather than just the town name).
- **Only one location is failing** — the others carry on normally: each location
  is queried independently, and the Configuration screen names the one that
  fails.
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
