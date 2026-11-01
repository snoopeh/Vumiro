# Delivery slices

1. Native GitHub update controller/helper and dedicated release workflow, reusing installer patterns.
2. Mutual-friend presence/invitations and challenge-authenticated private room entry.
3. Friends/call UI integration, compilation and package generation.
4. Publish source and client asset to GitHub, deploy signaling update and preserve local identity path.

Each slice is implemented within the user's existing autonomous authorization. Runtime tests are left to the user. Publishing is not claimed until the remote operation succeeds.
