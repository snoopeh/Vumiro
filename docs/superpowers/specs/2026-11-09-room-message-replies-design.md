# Room message replies

## Scope and decision

Priority 2A's first item, direct invitations to online friends with a separate room-code copy action, is already implemented in `f5d1079`. The next missing item is replying to a room chat message by dragging it to the composer. This change covers text messages in the existing direct room chat. It does not add persistent history, threads, file replies, or service storage.

The user can choose a signed message by clicking its Reply button or dragging that button to the composer. The same button supports keyboard activation and touch. A selected reply shows the original author and a short text excerpt above the unsent draft. Selection can be replaced; Cancel or Escape clears it without clearing the draft. Sending still requires text. The sent message shows a single citation above its body. Activating a citation finds and focuses the original if it is still in the local room history; otherwise it says “Original message unavailable.” Citations do not recursively expand other replies. System, file-offer, and unsigned legacy rows are not reply targets.

## Approaches considered

1. **Optional, separately signed reply extension on the current v2 message — chosen.** Older clients can read the ordinary signed text and ignore the extension. New clients validate the extension before showing a citation. This keeps the existing wire type and updater asset list.
2. A new chat version or message type would provide cleaner schema separation, but existing clients treat any live chat version other than 2 as unsigned legacy text. It would need a broader protocol migration.
3. A quoted text prefix would be compatible but would not create a trustworthy, navigable reference and could present forged attribution as conversation history.

## Data and trust boundary

Keep the existing v2 text signature unchanged. A reply adds `replyTo: {authorId, id}` and `replySignature`. The new signature uses a distinct domain and binds the canonical v2 signed message plus target author ID and message ID. Both fields must be present together; IDs must satisfy the existing author/message ID limits. A new client rejects a message with malformed or unverifiable reply metadata rather than silently showing it as a plain message. The reference resolves only against a verified signed v2 message in the current room. If that message is absent or trimmed, display the neutral unavailable state, never peer-supplied excerpt or HTML. Bound all citation text and use DOM text nodes.

Store the verified extension in the existing bounded 100-message/24-hour peer history. Current older clients strip unknown fields when relaying history, so reply context can be lost if only an older relay remains after the sender leaves. The text remains readable; this limitation does not justify changing the transport for this MVP. Clear pending reply state on room change or leave, and ignore an in-flight send after the room epoch changes.

## Interaction and layout

Add a visible Reply button to each verified text row. A pointer drag starts only on that control, uses pointer capture, and selects the row only when released over the composer after a small movement threshold. Cancelled/outside drops leave the current selection and draft untouched. Keep ordinary vertical chat scrolling and text selection available on the rest of each row. Highlight the composer during a valid drag target and honor reduced-motion preference. The reply preview sits above the composer and has a named Cancel button; status and focus behavior must remain usable at narrow widths.

## Verification

- First write failing focused tests for reply signing, tamper rejection, old-client v2 readability, history relay, missing-original fallback, room reset, and direct/drag selection behavior.
- Check the author-plus-ID reference against verified current-room messages only; never trust quoted content from the wire.
- Run focused room-chat tests, then the client suite and LOCAL QA launcher before human review. Human QA should test mouse drag, click, touch, keyboard, late join, narrow widths, and a mixed-version room.

## References

- [W3C WCAG 2.2 dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements): dragging functionality needs a simple pointer alternative; keyboard access is a separate requirement.
- [W3C button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/): use an ordinary button for a discoverable keyboard action.
- [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events): one input model for mouse, pen, and touch, with pointer capture during the drag.
