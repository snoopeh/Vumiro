# Vumiro 1.21.1

- Uses the Vumiro-branded service URL `vumiro-rooms.vumiro-signaling.workers.dev` in both desktop clients.
- Automatically migrates known legacy saved service URLs and room invitations, preserving custom services.
- Retains existing Durable Object namespaces and stored friend-request state through direct cross-script bindings; no proxy hop, extra polling or new identity is introduced.
- Preserves local profiles, signing keys, friends, settings and protocol compatibility identifiers.

The account workers.dev subdomain changes as part of the rename. Older clients should install this update before reconnecting. Builds and deployment metadata are checked; runtime testing remains with the user.
