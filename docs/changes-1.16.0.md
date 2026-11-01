# Vumiro 1.16

- Renamed the repository directory, solution, active projects and executables to Vumiro. Retired unused server code, dependencies, old builds and obsolete guides/harnesses from the active tree after creating a committed, pushed and verified full restore point.
- Profile pictures save immediately; atomic profile updates preserve newer fields. Online friends exchange current public names and pictures directly, and room chat resolves/upgrades its author display from the same profiles.
- Compact `vm1.` contact codes retain the same identity; existing long codes still work.
- Added confirmation before removing or blocking a contact, including blocks from requests.
- Added public, friends-only and password-protected rooms with authenticated owner policy and access enforcement.
- Redesigned rooms around a focused stage, participant strip, Chat/People side pane and fixed call controls.
- Updated the GitHub updater and package names to Vumiro. Existing local identity storage remains compatible. Older clients require one fresh install after the repository/executable rename.

Compilation, syntax and release/package checks only; runtime streaming, reconnect, profile exchange and install behavior await user feedback as requested.
