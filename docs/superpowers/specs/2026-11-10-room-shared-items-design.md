# Current-room shared items

Date: 2026-11-10
Source: priority 2A, “media-only chat history”
Status: design ready; human review and implementation pending

## Goal and scope

Help people find media, files, and links shared during the current room session without scrolling through every chat message. Label the view **Shared in this room** and explain that items disappear when the room session ends. This is a session view, not a durable Telegram-style archive. A lasting cross-session library would require a separate decision about storage, retention, deletion, and participant consent.

The room currently keeps up to 100 signed text messages from the past 24 hours for peer relay, up to 250 rendered rows, and direct file offers and transfers with a 10 MiB file limit. Received file bytes and object URLs are bounded and released on room changes or row retirement. HTTPS image previews are opt-in. The connection service does not store chats or files.

## Approaches considered

1. **Index current-room items in client memory (chosen).** Reuse validated chat and file events, the existing transfer controls, and the room lifecycle. No service migration or new retention promise.
2. Store a local library across rooms. Useful offline, but introduces per-device retention, deletion, disk limits, and privacy controls before the product has agreed on them.
3. Cloud-backed shared media. Enables cross-device history but would change the direct-only media architecture and require access control, cost, deletion, and moderation design.

## Interaction

Add a **Shared** tab beside Chat and People. Inside it, offer **Media**, **Files**, and **Links** filters with counts. Each item shows a safe thumbnail or file icon, bounded display name or domain, sender, and local time. Sort newest first and preserve the active filter while the room is open. The empty state says no items have been shared in this session. If an item is no longer available, show a clear unavailable state rather than a dead control.

Selecting a linked text item jumps to and focuses its chat row if retained. File items use the existing Receive or Download action; they do not fetch bytes on opening the Shared tab. An image link preview retains its existing explicit **Load preview** action, so visiting the gallery does not contact third-party hosts. Sender-supplied names and URLs render through text nodes, not HTML. A keyboard user can reach each filter and item; focus remains understandable after a row is retired. Narrow windows reflow without horizontal scrolling.

## Architecture and trust boundary

Keep a bounded room-local item index as a projection of accepted chat messages, recognized HTTPS links, and accepted file offers. A signed v2 text message supplies author and timestamp. A file offer supplies the authenticated data-channel peer and a locally observed arrival time; do not present it as a cryptographically signed chat message. Do not index system messages or unverified legacy chat as attributed history. Keep source keys scoped to the room epoch and existing row/file IDs, and retire index entries when their source row/file is released. A view switch must not duplicate a Blob, start a transfer, or extend the existing memory cap. A new room or leave clears the index, object URLs, and view state through the existing cleanup path.

The transport and Cloudflare Worker remain unchanged. The UI should be built in shared web assets so Windows and Linux receive identical behavior. If new assets are introduced, update both packaging and updater allowlists; prefer a focused module only if its lifecycle is easier to verify than additions to the existing room client.

## Acceptance and verification

- Media, Files, and Links show only eligible items from the current room; counts update when items arrive or retire. Reconnect and late join do not create duplicates.
- A user can find an item, return to its retained message, receive or download a file through the existing control, and see a neutral unavailable state when the source has gone.
- Opening Shared causes no automatic third-party image requests or file transfers. A click on **Load preview** is still required for external images.
- Leaving or changing rooms leaves no visible old items and releases old object URLs. The index respects existing 100-message, 250-row, transfer, and byte bounds.
- Test signed messages with image links, multiple links, file offer/receive/timeout, reconnect replay, row eviction, room change, keyboard navigation, narrow layout, and Windows/Linux LOCAL QA.

## Pending product decision

If “history” means content must survive leaving a room or reinstalling the app, obtain a retention and storage decision before extending this scope. The safe default for 2A is current-session-only.

## References

- [MDN Blob URLs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob): release object URLs when no longer needed.
- [MDN lazy loading](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Lazy_loading): avoid loading media outside the user's immediate view.
- [W3C WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): keep content reachable at narrow widths.
- [W3C ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): keyboard and focus behavior for filtered panels.
