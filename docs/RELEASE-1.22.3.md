# Vumiro 1.22.3 publication record

Published on **2026-11-10 at 08:08:57 UTC**, following the user's release authorization.

- [Stable release and downloads](https://github.com/snoopeh/Vumiro/releases/tag/client-v1.22.3)
- Immutable product tag: `client-v1.22.3`
- Product source: `96da6ebc8218641f1282882612a82a75dd56aa8e`
- [Release workflow 42778468013](https://github.com/snoopeh/Vumiro/actions/runs/42778468013), final attempt: **passed**.
- All seven required assets are public. Windows release selection and Linux latest-release discovery both select `client-v1.22.3`.

## Consolidated Linux review

Commit `8664405` restored eight already-bundled scripts to the Linux trusted asset routes. The smoke now derives script expectations from all three packaged entry pages, requires completed successful Chromium resource loads, checks the actual room-ready handshake and identity, and cancels through the room's real handler before confirming lobby restoration. It retains account gating, synthetic account authentication, contact import, inspection-card nickname editing at a narrow width, backdrop dismissal, offline isolation and capture denial.

Twenty-four focused smoke contracts passed. Both source CI and the release's packaged Linux smoke passed. AppImage, DEB and RPM packaging passed. This is automated packaged-app evidence; it does not claim a human Linux desktop acceptance session.

## Windows packaging and publication recovery

The `client-v1.22.2` tag remains unchanged and unpublished after the Windows package validator compared intentionally bundled files against raw source. Commit `83c575c` repaired that comparison using a separate source copy processed by the canonical bundler. Fresh local packaging and full archive validation passed with zero build warnings/errors; regressions reject changed and missing shipped files. The 1.22.3 Windows release job passed all native, manifest, version, checksum, source-content and updater checks.

The first 1.22.3 publication attempt stopped before promotion because the verifier used GitHub's published-tag endpoint for a draft. Actual draft assets also used GitHub's temporary `untagged-…` download paths. Verifier commit **`02ae40930ec67a46a8ccc1bb8081de869d5be2cf`** repairs draft discovery and its URL contract while preserving strict published URLs, authenticated asset-ID downloads, source validation and byte checks. Seventeen focused verifier tests passed, including real draft shapes and failure cases.

All seven original artifacts from workflow 42778468013 were retained. The repaired verifier passed **14 pre-promotion checks** against draft **440079937** and the original product SHA, including every local asset size/SHA256, both downloaded checksum manifests, exact tag resolution and numeric version order. That same draft was promoted; no product tag or built file was replaced. Only failed publication/report jobs were rerun through the workflow's existing published-release recovery branch. The fresh final report passed all four stage results and all seven public verification checks, including public Windows download and both updater feeds on the first attempt.

Preserved evidence:

- [Full pre-promotion verification](release-reports/client-v1.22.3-draft.json)
- [Final passing pipeline report](release-reports/client-v1.22.3-pipeline.json)

## Production service

The existing coordination service was deployed on 2026-11-10 and verified with the real LOCAL QA client receiving a directory-issued named friend tag. Backend regressions passed **80/80**.

- Storage-owner Worker `screentask-rooms`: `a75dfee7-77a4-43d4-b6a4-851eb0971639`
- Public Worker `vumiro-rooms`: `fe19941b-9094-4005-9c1c-9f1ecb23ffca`
- Existing Durable Object and D1 storage were reused. Optional account cover-media storage remains disabled; no bucket or billing resource was provisioned.
