# Supporting Vumiro

The app's **Settings → Support Vumiro** page explains optional contributions and links to PayPal once configured. No payment destination was supplied for this change, so the action remains unavailable rather than sending money to an assumed account.

To enable it, the project owner must create/confirm a PayPal.Me link or a PayPal-hosted Donate link with a `hosted_button_id`. Set `PAYPAL_SUPPORT_URL` at the top of `Vumiro.Client/WebServer/app-extras.js` to that exact HTTPS link, then verify it in LOCAL QA before releasing. A login email or public contact email is not proof of a payment destination. No API secret, payment-card form, PayPal SDK, recurring charge or webhook is needed for this outbound link. Availability and payment fees depend on the owner's PayPal account and region.

Payments open on PayPal; Vumiro does not claim payment completion, collect card details or grant paid benefits. This screen is part of the shared Windows/Linux interface and its script is folded into the existing updater file set during packaging.

The presentation uses an editorial split: a left-aligned headline, abstract folded Vumiro ribbon, and numbered project priorities. A warm accent highlights the sidebar entry and contribution action; there are no plan cards or subscription comparisons.
