# Program design

Native ClientUpdates owns GitHub checks/downloads and emits UI state. A narrow WebView2 message bridge accepts check/install/state only from the trusted top-level local origin. A separate updater executable waits for the requesting process, applies only allowed application files, retains rollback copies and restarts the client.

Friends UI exposes check/install progress and uses owner-bound room codes. Call client loads the same local identity module, signs room challenges with its nonextractable private key, and signs friend-policy updates. No secret is placed in invitations or query strings.

Worker CallRoom authenticates before sending membership information or accepting SDP/ICE. FriendDirectory requires mutual subscriptions and removes presence visibility after revocation. Group admission is controlled by the room owner's friends, not by anonymous possession of a URL.

Validation for this iteration: compile/package/deploy output and focused code review only; user explicitly deferred runtime tests. Risks: compromised devices/added malicious contacts remain trusted; GitHub publisher account is the update trust anchor; direct networking still exposes peer IPs and may fail on restrictive NATs.
