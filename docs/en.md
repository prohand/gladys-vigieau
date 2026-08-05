# VigiEau — French drought alert levels in Gladys

This integration queries [VigiEau](https://vigieau.gouv.fr), the French
government service publishing the **drought alert level** and the **water
restrictions** in force at a given address, and exposes the result as Gladys
sensors.

The VigiEau API is free and public: **no account, no API key**. It covers
**France only**.

## What you get

**One device per watched location**, named "Vigilance sécheresse — _your
location_", each carrying five sensors. You can watch up to **ten locations**: a
house, a second home and an allotment garden are rarely under the same
prefectoral decree.

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
2. Click **"Add a location (search for an address)"**, type your address
   (street, postal code, town) and, if you like, a **name** ("Maison",
   "Jardin"… — the town is used when you leave it empty). The location is
   created, its coordinates are geocoded for you, and its device shows up in the
   **Discovery** tab, ready to be added.
3. Repeat for every location you want to watch, up to ten.
4. Pick your **user profile**: household, company, local authority or farm.
   Restrictions differ per profile, and VigiEau returns the ones that apply to
   yours. This setting applies to **every location**.
5. Leave the **refresh interval** at 3600 s (1 hour): prefectoral decrees change
   once a day at most. The integration keeps that pace itself; a 5-minute floor
   applies whatever you type.
6. Save.

> Until an address has been geocoded, no device is offered. That is deliberate:
> no device beats a device pinned to an empty location.

### Viewing and editing a location

The **"The location to watch"** section has its own dropdown. Right below it,
the **"Watched locations"** field lists your locations, numbered, with their
address and coordinates; the one on display is marked with a ▶. That is where
you read which location "Location 2" is.

- **No location?** the field says so and points you at "Add a location".
- **One location?** it is selected and shown by default.
- **Several?** the first one is shown; pick another in the dropdown.

1. Pick the location number, then click **"Save the configuration"**.
2. **Reload the page (F5)**: the **Name of the selected location**, **Address**,
   **Latitude** and **Longitude** fields now show its information.
3. Change what you want and **Save** again:
   - a new **name** renames the location (its device keeps its history);
   - a new **address** is geocoded and moves the point;
   - typing **latitude and longitude** yourself takes precedence over the
     address. Both decimal separators are accepted: `48.8566` and `48,8566` are
     the same point.

   Reload the page to see the result (the address it settled on, the recomputed
   coordinates).

> **Why reload the page?** Gladys pushes nothing to a Configuration screen that
> is already open, and the answer to a save is prepared before the integration
> has even reacted. After switching location, adding or deleting, the fields
> keep showing the previous one until you reload. Saving that stale screen is
> harmless — the integration knows what it was showing and only applies what you
> really changed — but you will not see the right values before F5.

> If you switch location **and** edit a field in the same save, the edit is
> applied to the location that was on display — the one you were looking at —
> and the section then moves on to the new one. Nothing is lost.

### Deleting a location

The **"Delete a location"** action has **its own** dropdown, independent of the
one above: pick the location number, tick **"I confirm the deletion"** and run
it. Run unticked, it only tells you which location would go.

> Changing a location's address does not create a second device: the **existing
> device follows it**, with its history, its rooms and its scenes. Deleting a
> location, on the other hand, does not delete its Gladys device — an
> integration is not allowed to. Delete it yourself if you no longer want it.

## Why an address and not a postal code

The watched location is a **precise point**, not a commune.

> A **postal code** often covers several communes, and one commune can span
> **several restriction zones** for the same water type. That is exactly when
> VigiEau refuses to answer and asks for your street: the commune code cannot
> name the applicable zone.

A geocoded point never has that problem — it falls inside exactly one zone per
water type. The integration therefore always queries VigiEau by coordinates.

### The search button

1. Click **"Add a location (search for an address)"**.
2. Type your address. The more precise, the better: "12 rue des Lilas, 82000
   Montauban" beats "Montauban".
3. The integration geocodes it on the official
   [Base Adresse Nationale](https://adresse.data.gouv.fr) — the same service
   the VigiEau website uses — creates the location and publishes its device in
   the **Discovery** tab. Reload the page to see the fields filled in.

When several addresses match with **no clear winner**, the integration **does
not guess**: it lists the candidates and asks you to be more precise. Add the
number, the street or the town, and search again.

The confirmation message shows the address it settled on and its coordinates:
check it at a glance before moving on.

## Actions

- **Add a location (search for an address)** — geocodes the address, creates the
  location and shows it in "The location to watch". Reload the page to see it in
  the fields. See "Why an address and not a postal code" above.
- **Delete a location** — stops watching the location picked in this action's own
  dropdown, after confirmation. Its Gladys device stays: delete it yourself.
- **Test the VigiEau connection (all locations)** — runs a live request and
  shows the current level of every location, for the three water types. Use it
  right after the configuration to check that your locations are covered.
- **Show the restrictions in force (all locations)** — lists the water usages
  currently restricted at each address for your profile, with a link to the
  decree.

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
     deliberately publishes no device. Use the
     **"Add a location (search for an address)"** button; the
     **"Watched locations"** field lists what is actually stored.
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
  coordinate again — or simply type the address and let it be geocoded.
- **Two "Vigilance sécheresse" devices after changing the address** — that was
  the case up to version 1.1.1: the device id was built from the coordinates, so
  every address created its own device and the previous one stopped refreshing.
  The device now follows the address. After the update, the integration keeps
  the device you already created, history included — the log line
  `Keeping the existing identity of drought-zone` says which one. Any other
  device left over from an older address can be deleted in Gladys.
- **The fields still show the previous location** — reload the page (F5).
  Gladys pushes nothing to a Configuration screen that is already open: after
  switching location, adding or deleting, the fields keep what they had loaded.
  Saving that stale screen breaks nothing — only what you really changed is
  applied — but the values on screen are only right after the reload. The
  integration cannot reload the page for you: nothing in Gladys lets an
  integration refresh an open configuration screen.
- **The dropdown shows "Location 1", "Location 2"… instead of the names** — that
  is a Gladys limitation, not a choice: the options of a dropdown are written in
  the integration manifest, hence fixed, and the only dynamic source Gladys
  defines is not active server-side yet (checked at version 4.84.4). The
  **"Watched locations"** field gives the number → name mapping.
- **A device that stopped refreshing after a location was deleted** — that is
  expected: an integration cannot delete a Gladys device, it can only stop
  offering it. Delete it in Gladys.
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
  not fall inside a single zone. Select the location the message names and type
  a more precise address (number and street rather than just the town name).
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
