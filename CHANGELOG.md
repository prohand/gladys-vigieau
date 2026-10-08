# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

### Fixed

- A VigiEau `404` is no longer read as "no restriction". The API answers an empty list for a point outside every zone and a `404` only for an unknown route: taken as an all-clear, a moved endpoint published "Pas de restriction" and fired a downward level change. It is now an error: the last level is kept and no scene event fires. A `200` that is not a list of zones is refused the same way.
- The refresh starts even when Gladys refuses the device catalog, so the devices already created keep being updated.
- A refresh interval that is not a number, or a huge one, could make the integration query VigiEau in a loop. The interval is now clamped to 15 minutes – 24 hours (the bounds of the Configuration field), the default being used when it is not a number.
- A location deleted while another one was being added (address lookup in progress) or while the Gladys houses were being imported came back. Every change of the location list is now applied one at a time, on the list as it is at that moment.

### Changed

- The four severity levels are only re-published when they change, plus once every 6 hours, instead of on every refresh: their history no longer fills with identical rows.
- The Gladys houses are read through the SDK (`getHouses()`).
- The Docker image is built with `npm ci` only; CI tests on Node 22 and 24 and builds the image on pull requests. Node 22 is now the minimum.

### Security

- Addresses and coordinates (typed, geocoded or read from the Gladys houses) are no longer written to the logs.

## [3.2.0] - 2026-10-07

### Fixed

- A dashboard widget pull now answers before the core's 15 s deadline (a "loading" card while the read completes) instead of leaving the widget on "data unavailable" until the dashboard is reloaded.

### Changed

- CI runs the store admission checks on pull requests; Dependabot keeps the npm dependencies and the GitHub Actions up to date.

## [3.1.0] - 2026-10-06

### Added

- `SECURITY.md`: how to report a vulnerability.
- `CHANGELOG.md`, rebuilt from the release history.

### Changed

- Development dependencies updated to their latest versions (ESLint 10.12, Prettier 3.9.9, globals 17.13).

## [3.0.0] - 2026-09-22

### Added

- Dashboard widgets, scene triggers and scene actions of Gladys 5.1

## [2.0.3] - 2026-08-15

### Added

- SDK 0.12 and the catalog shelf of Gladys 4.86

## [2.0.2] - 2026-08-08

### Added

- Date the values, and the decree that sets them

## [2.0.1] - 2026-08-07

### Added

- Add the Gladys houses as watched locations in one click

## [2.0.0] - 2026-08-06

### Added

- Watch several locations, each with its own device
- Watch several locations, selected from one dropdown
- One section per concern, each with its own location dropdown
- Show the watched locations as a read-only table
- List the locations under a button, and accept a typed point
- One location per line, and label a point with its address
- Delete last, and a bullet opening every listed location
- One entry format for the three reports, with a bold label

### Fixed

- Designate a location by name, no released Gladys validates a device select
- Answer a phantom position, and clear the Discovery screen on delete

## [1.2.0] - 2026-08-05

### Fixed

- Take the coordinates as text so both decimal separators work
- Keep one device across address changes instead of discovering a new one

## [1.1.1] - 2026-08-05

### Fixed

- Fold the severity onto the 0-3 scale Gladys can actually label

## [1.1.0] - 2026-08-05

### Added

- Locate by geocoded address instead of an INSEE commune code

### Changed

- Add CLAUDE.md

### Fixed

- Read VigiEau's "nothing in force" and "ambiguous commune" answers correctly

## [1.0.6] - 2026-08-04

- Maintenance release, no functional change.

## [1.0.5] - 2026-08-04

### Added

- Drop the "Restrictions en cours" feature

### Fixed

- Refresh as soon as the user adds the device, not an hour later

## [1.0.4] - 2026-08-04

### Fixed

- Stop declaring poll_frequency, drive the refresh from the integration

## [1.0.3] - 2026-08-04

### Added

- Resolve a commune name to its INSEE code from the Configuration screen

### Fixed

- Surface a rejected device batch instead of an empty Discovery tab

## [1.0.2] - 2026-08-04

### Added

- Make the INSEE code mandatory and the coordinates optional

## [1.0.1] - 2026-08-04

First public release.

### Added

- Vigieau integration for Gladys (vigilance sécheresse)

[Unreleased]: https://github.com/prohand/gladys-vigieau/compare/v3.2.0...HEAD
[3.2.0]: https://github.com/prohand/gladys-vigieau/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/prohand/gladys-vigieau/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/prohand/gladys-vigieau/compare/v2.0.3...v3.0.0
[2.0.3]: https://github.com/prohand/gladys-vigieau/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/prohand/gladys-vigieau/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/prohand/gladys-vigieau/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/prohand/gladys-vigieau/compare/v1.2.0...v2.0.0
[1.2.0]: https://github.com/prohand/gladys-vigieau/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/prohand/gladys-vigieau/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/prohand/gladys-vigieau/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/prohand/gladys-vigieau/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/prohand/gladys-vigieau/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/prohand/gladys-vigieau/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/prohand/gladys-vigieau/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/prohand/gladys-vigieau/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-vigieau/releases/tag/v1.0.1
