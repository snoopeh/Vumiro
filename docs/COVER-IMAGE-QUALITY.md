# High-resolution profile covers

Status: source implementation for human review. No storage provisioned, deployment, release or push.

## Product behavior

A cover is now a separately stored, rendered image, not the old 16 KiB profile field. The editor supports drag, wheel/slider zoom, keyboard movement, reset, cancel and explicit Use cover followed by the existing profile Save. It previews the actual 3:1 framing and output dimensions. Images are capped at 3840 x 1280 and 1 MiB; source crops are never upscaled. Small crops show a quality warning. PNG, WebP and JPEG input is limited to 10 MiB and 25 megapixels before decoding where the header provides dimensions.

Encoding tries lossless PNG and high-quality WebP/JPEG (0.92/0.88). Transparent output is never flattened to JPEG. If the selected resolution cannot fit, the user gets a clear error rather than a secretly low-resolution result. Existing low-quality covers cannot regain lost detail: reselect the original file.

The original and crop coordinates remain in IndexedDB only on the selecting device, per the user's finished-cover-only backup choice. The finished raster strips original file metadata through canvas encoding. On another device only the finished cover can be reframed; revealing areas outside it requires selecting the original. Cancel, removal and a newer selection invalidate in-flight work, including pre-dialog decoding.

## Compatibility and transport

The legacy profile schema and its <=16,384-character banner remain unchanged. It is now only a compatibility preview. Old peers keep displaying it and ignore capability messages. New peers negotiate a separate authenticated, bounded chunk transfer for the finished image, with signed sender/recipient/revision/nonce/expiry metadata, SHA-256 verification, native raster decode and dimension checks. Room guests keep images only in memory. Friend caching is capped at 32 images and 16 MiB. Transfer queues, concurrent receives, timeouts and data-channel backpressure are bounded. Original source bytes and framing metadata are never transferred.

The Windows v1/v2 update package file lists are frozen: installed updaters reject extra entries. `scripts/bundle-client-web.mjs` folds cover modules into the existing local-profile.js entry in the disposable release staging copy. Packaged HTML no longer requests those standalone modules. Debug sources stay modular. Cloudflare and Linux asset lists serve the standalone modules. No new updater schema or installed allowlist is required.

## Optional private backup

High-quality local and peer covers work without hosting. The optional account extension uses the existing Cloudflare infrastructure with a private R2 binding, not a public image URL. Only the finished raster is uploaded. It is owner/device-authenticated, not end-to-end encrypted from the infrastructure operator. Current manifests are stored in D1; image bytes are not stored as JSON/base64 in D1. Old account clients remain compatible. Without a configured binding the new client backs up the ordinary thumbnail and clearly says the HD image was not backed up.

The client stages the finished image before snapshot compare-and-swap. Each cover-bearing sync repeats an idempotent upload, bounded at 1 MiB, to avoid assuming that a previous staging object still exists after expiry or replacement. Restore validates the download before changing local data. Export includes the finished raster, never the original. Account deletion waits for blob cleanup; aborted and obsolete media has bounded cleanup. See [backend contract, tests and deployment prerequisites](../cloudflare/PROFILE-MEDIA.md).

R2 is recommended over generic free image hosting because it fits existing infrastructure, supports private access and deletion, and avoids sending every viewer to a third-party public image URL. Published Standard free allowance is 10 GB-month, 1 million Class A and 10 million Class B operations/month; direct egress is free. Above that: $0.015/GB-month, $4.50/million Class A and $0.36/million Class B. Workers/D1 quotas and activation requirements are separate. This is not a hard-zero-cost promise. No provider account, billing, credentials or bucket has been created. Imgur's forum FAQ disallows use as an avatar/banner CDN, making it unsuitable here.

Before enabling backup: approve/provision the private R2 binding and migration, review the privacy-notice revision for the new media storage, verify provider region/cost controls and actual Cloudflare limits, and perform a non-production end-to-end account test. Do not deploy simply to test the UI.

## Evidence and review boundaries

Run client tests with `node --test tests/*.test.mjs`, backend tests from cloudflare with `npm test`, and the real Windows encoder/editor/IndexedDB fixture with:

```powershell
dotnet run --project tests/CoverEncodingChecks/CoverEncodingChecks.csproj -c Release -- (Get-Location).Path
```

The browser fixture uses an isolated ephemeral WebView2 profile and generated graphics. A 4,389,533-byte source rendered at the full 3840 x 1280 into a 63,778-byte WebP. The separate account snapshot was 16,622 bytes. It checks local-only original storage, atomic save, rename preservation, same-image restore, keyboard crop controls, cancellation during decoding and after opening, and removal. Initial compatible artwork checks also retain sharper 1920 x 640 output under the legacy preview budget, but that optimization is not the HD solution.

These fixtures are not the user's screenshot, whose pixels could not be retrieved. Full photo quality, high-DPI appearance and a real two-device exchange still require human review. Actual Cloudflare deployment/CPU and Linux graphical runtime have not been verified. Automated checks are not human acceptance.

## Human acceptance checklist

1. In the real LOCAL QA window choose the original cover, frame it, use it and Save. Inspect a wide/high-DPI profile card.
2. Reopen Adjust cover and confirm original framing is retained; cancel changes and verify they are not saved.
3. Test small, transparent and detailed images. Select a replacement or close the profile while preparation is running; no stale draft should return.
4. Verify a new peer receives the sharp cover in friend and room cards while an old peer sees the compatible preview. Remove/replace the cover and check stale caches are cleared.
5. After explicitly authorized non-production storage setup, verify finished-only backup, cross-device restore, export, revoked-device denial and deletion retry. Original areas must not appear on the second device.

## References

- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
- https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://help.imgur.com/hc/en-us/articles/26509006740891-FAQ-for-Forum-Users
