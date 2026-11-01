# Restore point before Vumiro cleanup

Created before implementation on 2026-11-01:

- Committed and pushed baseline: `c69a2e1ad3c9e20fb0978864d6f9a5f104d0f9a7`.
- Annotated remote tag: `restore/pre-vumiro-cleanup-2026-11-01`.
- Verified complete Git bundle: `../Restore Points/2026-11-01-pre-vumiro-cleanup/vumiro-all-history.bundle`.
- Complete folder snapshot: `../Restore Points/2026-11-01-pre-vumiro-cleanup/Workspace`. The comparison verified 3,066 files / approximately 3.9 GiB, including ignored builds and dependencies; Git metadata is in the bundle.
- Separate closed-app WebView profile backup: `../Restore Points/2026-11-01-pre-vumiro-cleanup/LocalProfile`.
- Retired original folders were moved to `RetiredOriginals` under that restore point as cleanup proceeded. These include the old native server and build artifacts.

To recover source without modifying the current checkout, clone the bundle into a separate directory:

```powershell
git clone '../Restore Points/2026-11-01-pre-vumiro-cleanup/vumiro-all-history.bundle' Vumiro-restored
git -C Vumiro-restored switch --detach restore/pre-vumiro-cleanup-2026-11-01
```

The same tag is available from [the GitHub repository](https://github.com/snoopeh/Vumiro/tree/restore/pre-vumiro-cleanup-2026-11-01). Old ignored executables are available in the local folder snapshot.

The current profile directory was left untouched. Restore the `LocalProfile` snapshot only with all app/WebView processes closed and after saving another copy of the current directory. That backup contains private identity data; keep it local. Contact codes do not back up the private signing key.

## Before the window backdrop update

The 1.16.0 desktop state is also preserved by `restore/pre-window-backdrop-1.16.0` (commit `7be184a`). Its verified all-history bundle and previous published Windows package are in `../Restore Points/2026-11-01-pre-window-backdrop`. The backdrop change does not modify local profile storage.

## Before durable friend requests

The prior desktop and service source is preserved by `client-v1.18.0` (commit `efb8ee1`). Before the 1.19 service update, the active Worker version was `7b0c29c5-5b10-481d-8b2f-66cdab4d53f4`. The new version adds a separate bounded SQLite friend-request table and a local completion-state key; it preserves existing identities and contacts.
