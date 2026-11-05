# Lobby and profile polish — 1.22.1

This patch distributes the Priority 1A UX changes from source commit `0d7c9d7` to Windows and Linux clients.

The unexplained technical identity display and the Settings button between Create Room and Add Friend are removed. Create Room opens a friends room immediately; the host can adjust access from inside the room. Clicking a friend's nickname copies their directory tag. A separate pencil opens a nickname dialog that also works when the responsive side panel is hidden. Profile cards dismiss when their backdrop is clicked and show service icons beside links. Profile editing groups identity, bio and links into clearer sections. Password changes remain inside a disclosure; account recovery and password setup tolerate the shared settings shell moving their controls.

The existing Google sign-in flow already returns to the lobby. An existing encrypted identity can still require the Vumiro password or recovery code before restoring that identity.

Review found and corrected two regressions: an optional account security disclosure was accessed after the settings shell removed it, and nickname editing was inaccessible below the side panel's responsive breakpoint. The final source passes 94 client tests, both edited JavaScript files pass syntax checks, and the Git diff passes whitespace checks. A live installed-app walkthrough of all ten 1A criteria has not been performed.

Windows app, updater, Linux package and lockfile versions are `1.22.1`. The release tag is `client-v1.22.1`. Publication requires successful Windows package validation, Linux packaging and the release workflow. Pushing a source commit alone does not produce an in-app update.

## Publication record — November 5, 2026

Source commit `bab54b589512d3462184395ac2e0e9a2774d5e36` is published as [client-v1.22.1](https://github.com/snoopeh/Vumiro/releases/tag/client-v1.22.1). [Release workflow 42073816227](https://github.com/snoopeh/Vumiro/actions/runs/42073816227) passed its Windows, Linux and publication jobs. The stable release appears in both the Windows release-list feed and the Linux latest-release endpoint, with all seven expected assets. Its complete Windows package meets the existing updater's asset-name, size and digest requirements.

The downloaded `Vumiro-win-x64-v2.zip` matches GitHub's SHA-256 digest `3ed8e342ca770ac85b447357a68409d31a6335eecf4311b53e4c3cdd7fe63f03`. All nine packaged web assets match the reviewed source after newline normalization. Both published checksum manifests match GitHub's digests for the two Windows and three Linux packages. Linux runtime behavior was not tested locally.

An isolated local browser profile confirmed the top-bar cleanup, grouped profile layout, a rendered Steam icon, profile-card backdrop dismissal, nickname editing and saving at a 640-by-600 viewport, and direct room entry without a creation form. The preview used a local static server without signaling, accounts or media capture; it does not establish a live Google sign-in or a connected call in the installed application. The preview tab and server were closed afterward.
