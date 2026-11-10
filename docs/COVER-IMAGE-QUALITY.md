# Cover image quality

## Problem and scope

The previous importer always center-cropped covers to 480 x 160 pixels or less, encoded only JPEG, and could reduce quality to 0.2. Enlarged profile settings exposed blurred edges, especially on flat artwork. Already-saved small images contain no recoverable original detail; select the original file again and Save.

This change improves the shared image itself without introducing a local-only rendition or requiring a backend deployment. It does not promise full-HD output for every detailed photograph.

## Encoding policy

- Accept the existing PNG, JPEG and WebP inputs, at most 10 MiB and 25 megapixels.
- Center-crop to the existing approximately 3:1 cover shape. Keep up to 1920 x 640 pixels, never upscale the available source crop.
- Try PNG first at each size to preserve lossless artwork when it fits. Try WebP and JPEG at 0.9, 0.8, 0.7 and 0.6, then reduce dimensions rather than use extremely low quality.
- Fall back through 1600, 1280, 960, 720, 480, 360 and 240 pixels where smaller than the source crop. Reject content that cannot fit instead of violating transport limits.
- Use asynchronous Blob encoding. Check MIME actually returned by the browser, account for base64 padding/header in the size budget, and allocate the data URL only for a fitting result.
- Cancel superseded selection/removal/dismissal work between asynchronous operations. Release bitmap and canvas memory after success, error or cancellation. Preserve the staged Save workflow.

## Compatibility and security

The banner remains the same raster data URL, capped at 16,384 characters. Local IndexedDB, friend caches, signed peer profiles, room profiles and account snapshots retain their existing schema and validation. The combined profile still fits the 65,536-byte peer frame budget alongside the 32 KiB avatar. No original image, remote URL, new permission, backend storage class or relay is introduced.

Larger universal photo covers would require a separate design: capability-negotiated, authenticated and bounded media chunks for peer and room paths, plus version-aware account read/write handling and invalidation of superseded media. Simply increasing the current limit or adding unknown profile fields would break old clients. That extension is not part of this change.

## Verification

Run focused tests:

```powershell
node --test tests/cover-encoding.test.mjs tests/profile-card-data.test.mjs tests/profile-draft.test.mjs tests/account-client.test.mjs tests/call-layout.test.mjs
```

Run the actual Windows WebView2 encoder with deterministic, locally generated fixtures:

```powershell
dotnet run --project tests/CoverEncodingChecks/CoverEncodingChecks.csproj -c Release -- (Get-Location).Path
```

The runtime check uses an isolated temporary browser profile and produces an internal comparison image at `dist/local-qa/cover-encoding-comparison.png`. It does not open the installed profile or contact a service. Timings include encoding, decoding and legacy comparison, not just the new encoder.

Measured on the development desktop, 2026-11-10:

| Fixture | Previous output | Current output | Current encoded bytes | Check time |
| --- | --- | --- | ---: | ---: |
| Flat star artwork | 480 x 160 JPEG | 1920 x 640 WebP | 9,808 | 155 ms |
| Transparent stars | 480 x 160 JPEG | 1920 x 640 WebP | 7,260 | 86 ms |
| Synthetic detailed landscape | 480 x 160 JPEG | 960 x 320 WebP | 11,102 | 848 ms |
| Deterministic noise | 480 x 160 JPEG | 480 x 160 JPEG | 10,965 | 1,762 ms |
| Small artwork | Upscaled 480 x 160 JPEG | Native 300 x 100 PNG | 2,361 | 4 ms |

All outputs fit the original serialized budget. The transparent fixture retains a transparent corner. The before/after artwork comparison was visually inspected: enlarged edges are substantially sharper. These fixtures are not the user's attached image, which could not be materialized for inspection.

Independent review found no blocking compatibility or security issues. Review suggestions to distinguish null encoding failures from unsupported MIME and clarify the size helper text were applied. Automated results are not human acceptance.

## Human acceptance checklist

1. In the real LOCAL QA app, change the cover by reselecting its original high-resolution file, then Save.
2. Inspect at a wide window size and normal/high display scaling; reopen Profile and confirm it persists.
3. Try a detailed photo and verify the size/quality trade-off is acceptable.
4. Start preparing a large image, then choose another, remove it, or close the dialog. A stale image must not return or save itself.
5. Verify the cover appears on a friend card and in a room, and survives account backup/restore when those flows are available.

Keep the existing release version. No push, deployment or release is authorized by this change; human signoff and a separate ship instruction remain required.

## References

- [MDN: Canvas toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob): asynchronous encoding, PNG requirement, output MIME fallback.
- [MDN: Image types](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types): lossless PNG for graphics and WebP/JPEG trade-offs.
- [web.dev: Choose the right image format](https://web.dev/articles/choose-the-right-image-format): format choice depends on visual requirements and content.