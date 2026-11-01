# Client updates and friend access

Standing user authorization: implement autonomously, delegate where useful, and leave runtime tests to the user. Approval pauses and runtime test steps in software-factory are waived by those explicit instructions. No separate human gate approvals are claimed.

Product, architecture, program design and slices are recorded separately below. Implementation and delivery are complete.

- [x] Integrate repository releases and client updater.
- [x] Enforce mutual friends for presence and direct invitations.
- [x] Authenticate room entry and restrict it to the owner's mutual friends.
- [x] Package, publish repository release, deploy Worker and update local shortcut.

No application launch, test suites or end-to-end tests in this iteration. Compilation and publishing output will be reported with their limits.

Delivered 2026-11-01: source commit 47a1cc0 on origin/main; tag and public release client-v1.14.0; GitHub client-release run 41277785593 succeeded. Local app/helper builds completed with zero warnings/errors; JS syntax checks passed. Worker version 7a397414-36e1-48ec-91ef-96876a3c9345 deployed. Desktop shortcut targets dist/client-1.14.0/ScreenTask/ScreenTask.Client.exe; user-data folder stays unchanged. Code review fixed stale invitation acceptance and friend-policy revision ordering; runtime security/streaming/update-install behavior is still unverified, as requested.
