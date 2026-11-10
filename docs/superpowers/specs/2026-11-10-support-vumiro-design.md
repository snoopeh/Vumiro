# Support Vumiro

Date: 2026-11-10
Source: priority 2A, “Support me” donations
Status: page design ready; payment recipient and link require owner confirmation

## Goal and scope

Give people a clear, optional way to financially support Vumiro's development. Use the product name **Support Vumiro** in navigation and explain who receives the payment on the page. The page must not imply that donating buys access, improves call quality, or grants a premium feature. Vumiro does not process cards, hold funds, or store a donation ledger in this scope.

## Approaches considered

1. **External hosted one-time payment link (chosen).** A verified owner-controlled provider page handles amount, payment methods, receipts, refunds, and compliance. The app needs only a carefully labeled link and no payment backend.
2. Embed provider checkout inside WebView/Electron. It makes the flow look integrated but expands payment security and browser compatibility work with little MVP benefit.
3. Build first-party payments. It adds billing, chargebacks, tax and support operations far beyond a small extension.

## Page and flow

Add a quiet **Support Vumiro** entry in the lobby's secondary navigation or About/Settings area, not as an interruption in sign-in or calls. The page states what voluntary contributions support, names the recipient and provider, and offers one primary **Continue to [provider]** button. A short note says payment opens in the user's normal browser and that no card information is entered into Vumiro. Keep a secondary path back to the app. The contribution is one-time by default; recurring payments require an explicit later product decision and clear cancellation information.

The button is absent or disabled in development and release builds until the owner supplies a verified production recipient and exact HTTPS URL. Do not substitute a developer's personal account, generic provider homepage, test checkout, or unverified URL. If the external browser cannot open, show the provider domain and a Copy link action, without claiming the payment succeeded. No donation success message is inferred from opening a browser.

## Architecture, privacy, and security

Keep the payment URL in reviewed release configuration, with an allowlisted HTTPS provider host and an exact verified destination. The renderer asks the trusted Windows or Linux host to open that fixed destination externally; it cannot pass an arbitrary URL through a privileged bridge. Use a normal external browser with its provider security and accessibility features. Do not append identity, room, profile, email, referral, or tracking parameters. Do not place payment credentials, API keys, or webhooks in the client. The app records no donation amount or payment status. Privacy copy points to the provider's own terms and privacy information before leaving Vumiro.

## Acceptance and verification

- The page is reachable without creating an account, does not interrupt a room, and presents the recipient/provider and voluntary nature clearly.
- The CTA opens only the reviewed HTTPS destination in the external browser on Windows and Linux. A failed open gives a usable copy-link fallback. No arbitrary URL can cross the host bridge.
- No card form appears inside Vumiro; no user/account/peer data is sent to the provider by the app. A browser open is never represented as payment success.
- Keyboard navigation, visible focus, narrow layout, and screen-reader labels work. Human QA checks the exact production link, recipient name, provider disclosures, and both platform hosts before release.

## Pending owner decisions

1. Provide the legal/public recipient name and verified production payment destination. Confirm whether it should be a personal creator page or a Vumiro project account.
2. Approve final public copy explaining how donations are used. If recurring contributions are desired, scope their cancellation and disclosure flow separately.

## References

- [Stripe Payment Links](https://docs.stripe.com/payment-links): hosted checkout without an in-app payment form.
- [Ko-fi payment setup](https://help.ko-fi.com/hc/en-us/articles/115003980093-How-do-I-get-paid): creator payments go to the linked PayPal or Stripe account.
- [W3C WCAG link purpose](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html): make the external destination clear.
