# Vumiro 1.19.0

- Friend requests wait for service confirmation and distinguish delivery from submission.
- Requests last up to 24 hours and survive reconnects. Accepted/declined results replay until both apps have applied them, with bounded seven-day retention.
- Local contact updates and completion tracking are atomic, preventing duplicate replay from restoring a removed friend.
- Signed expiries use server time from existing WebSocket handshakes, avoiding the old five-second dependence on PC clock agreement.
- No periodic Cloudflare polling: messages are pushed on actions/reconnect, with indexed request storage and one-shot expiry cleanup.

Both peers should update to 1.19 for the durable friend flow. Existing legacy traffic remains supported; photos, chat and media stay peer-to-peer. Compilation and packaging only; runtime testing remains with the user.
