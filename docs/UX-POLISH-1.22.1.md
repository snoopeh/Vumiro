# Lobby and profile polish — 1.22.1

This patch distributes the Priority 1A UX changes from source commit `0d7c9d7` to Windows and Linux clients.

The unexplained technical identity display and the Settings button between Create Room and Add Friend are removed. Create Room opens a friends room immediately; the host can adjust access from inside the room. Clicking a friend's nickname copies their directory tag. A separate pencil opens a nickname dialog that also works when the responsive side panel is hidden. Profile cards dismiss when their backdrop is clicked and show service icons beside links. Profile editing groups identity, bio and links into clearer sections. Password changes remain inside a disclosure; account recovery and password setup tolerate the shared settings shell moving their controls.

The existing Google sign-in flow already returns to the lobby. An existing encrypted identity can still require the Vumiro password or recovery code before restoring that identity.

Review found and corrected two regressions: an optional account security disclosure was accessed after the settings shell removed it, and nickname editing was inaccessible below the side panel's responsive breakpoint. The final source passes 94 client tests, both edited JavaScript files pass syntax checks, and the Git diff passes whitespace checks. A live installed-app walkthrough of all ten 1A criteria has not been performed.

Windows app, updater, Linux package and lockfile versions are `1.22.1`. The release tag is `client-v1.22.1`. Publication requires successful Windows package validation, Linux packaging and the release workflow. Pushing a source commit alone does not produce an in-app update.
