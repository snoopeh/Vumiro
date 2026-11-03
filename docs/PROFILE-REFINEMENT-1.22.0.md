# Profile and room refinement — 1.22.0

Voice & audio now shares the same settings navigation and content alignment as the other settings pages. Audio-specific styles stay inside the audio content, so opening this section no longer changes the sidebar buttons. Device choices, local microphone tests, playback volume and voice processing form one centered, responsive column. Opening settings still leaves the microphone off; existing capture, mute, deafen and test-isolation behavior is preserved.

The screen-sharing idle state uses the same avatar image as its participant header, with a square centered crop. Room access opens higher in the viewport and scales within the available width and height, with scrolling for short windows. The app wordmark scales more clearly on larger windows.

Profiles now support a cover image, a short bio and public links for supported services. Friends and room participants open cards with the cover, overlapping avatar, display name, username and relevant friend actions. These cards have no direct-message action. Decorative avatar borders remain outside this release.

Profile links are supplied by the person and open external HTTPS profile pages; they do not authorize access to a provider account, verify ownership, or synchronize listening and game activity. Banners are resized and stored as bounded image data, rather than loading tracking images from arbitrary remote URLs. Bios and link collections use shared validation across local storage, account backup and direct profile exchange. Older profiles remain valid when these optional fields are absent.

The friend directory assigns a unique Vumiro number in the form `#12345-67890`, making it possible to add someone without sharing an invitation link. This number resolves through the directory to the existing cryptographic identity; it does not replace friendship authorization or room-access checks. Room cards show a number only when the trusted app parent has received it from the directory, rather than accepting an asserted number in peer profile metadata.

## Verification and packaging

The build and release workflows run the existing client regressions plus the audio CSS isolation, room-card metadata/rendering, profile persistence and friend-number client checks. Cloudflare tests include directory friend-number allocation and lookup. Native OAuth callback checks remain separate from browser fixtures and real hardware acceptance.

Both Windows applications and the Linux package metadata use version `1.22.0`. The release tag must be `client-v1.22.0`. The existing Windows legacy bridge and complete package manifests stay unchanged, so embedded profile artwork and controls remain compatible with updater allowlists.

Before publication, build and validate both Windows archives with `scripts/Build-Client.ps1` and `scripts/Test-ClientPackages.ps1`; build AppImage, DEB and RPM artifacts with `scripts/Build-Linux.mjs` on Linux. Validate the generated checksum files and the release workflow results. Browser visual evidence, final check totals and publication status belong in the launch record once those checks have actually completed.

Local Windows validation completed on November 3, 2026: all 26 native OAuth/caption checks passed; both application and updater builds completed with no warnings or errors; the legacy bridge and complete v2 ZIPs passed package-transition, manifest, checksum and embedded-version validation. The package source also matched all nine current web assets and the finalized privacy notice. These checks do not establish Linux packaging success or publication status.

The final source passed 89 client tests, 29 account/directory backend tests, and JavaScript syntax checks. Browser review used a disposable local profile and the real local signaling Worker: profile background selection, saved bio and links, card rendering, shared settings at 900×700 and 2560×1440, and room-access positioning at 1280×720 and 3840×2160 were checked. This visual review did not capture microphone or screen media or claim a physical two-device call test.

Profile-card account data is capability-negotiated so older clients can restore their original profile shape and preserve newer fields when writing. Notice version 2026-11-03 is sent to compatible clients; old binaries receive their bundled notice version and must update before uploading under the revised notice. Existing-account sign-in remains available.

## Publication record — November 3, 2026

Source commit `cd55578f96e3e0a8ada6fa15fd1936afc86549e0` is published as [client-v1.22.0](https://github.com/snoopeh/Vumiro/releases/tag/client-v1.22.0). [Main CI 41644238223](https://github.com/snoopeh/Vumiro/actions/runs/41644238223) and [release CI 41644239154](https://github.com/snoopeh/Vumiro/actions/runs/41644239154) completed successfully. Windows and Linux packaging passed; the release has seven nonempty assets with SHA-256 digests. The two Windows and three Linux package digests match the two published checksum files.

The existing Durable Object owner `screentask-rooms` is deployed at version `92dbc34d-7e6d-4afe-a12b-9f67733513fb`; the public `vumiro-rooms` Worker is version `f07edfee-45e0-4373-8b70-d62fea0fb6fb`. Both retain their existing Durable Object bindings. All nine public web assets matched local source by SHA-256 after deployment. Account service, registration, Google and Microsoft remain enabled. Account API, Supabase health, signing keys and unauthenticated-route enforcement passed the public health check.

Live acceptance used two disposable signing identities and no Supabase account data. Signed directory authentication, matching ready/profile-ready tags, stable reconnect, distinct allocations, formatted/plain/spaced lookup, both block directions and offline hiding passed. No friend requests were sent; sockets closed and ephemeral private keys were discarded when the verification process exited.

Additional local browser checks confirmed a real directory-assigned tag renders in settings, Copy tag places that exact value on the clipboard, and the saved card displays it. An uploaded test avatar uses the same image in the room header and centered idle state. Room access fit a 640×480 viewport and expanded from 520px width there to 820px at 3840×2160. Temporary preview tabs and local servers were closed after review.
