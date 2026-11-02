# Account identity recovery design

## Goal

Restoring an account on another device should preserve the public signing identity that existing friends trust. A contact-book-only restore is insufficient because mutual-friend checks are keyed to the signing-key fingerprint.

The account database must never receive a plaintext private identity key or recovery code. A recovered local signing key is imported as nonextractable before it is stored in IndexedDB.

## Recovery envelope

An account snapshot may contain one `identityRecovery` object:

```text
version: 1
identityId: SHA-256 fingerprint of publicKey
publicKey: P-256 SPKI, base64url
passwordWrap:
  kdf: PBKDF2-SHA-256
  iterations: at least 600000
  salt: 16 random bytes
  iv: 12 random bytes
  ciphertext: AES-256-GCM encrypted PKCS#8 key
recoveryWrap:
  kdf: HKDF-SHA-256
  salt: 16 random bytes
  iv: 12 random bytes
  ciphertext: AES-256-GCM encrypted PKCS#8 key
transition: optional signed migration from a legacy identity
```

The AES-GCM additional authenticated data binds the envelope version, identity ID, public key, wrap type, KDF parameters, and Vumiro protocol domain. Changing metadata therefore invalidates decryption.

`passwordWrap` supports normal device switching after the user enters the account password. It is susceptible to offline password guessing if an attacker obtains the encrypted snapshot, so new and changed passwords require at least 12 characters and the configured provider must reject known-compromised or weak passwords when that control is available.

`recoveryWrap` uses a random 256-bit recovery code. It preserves the identity after email-based password reset, where the old password is unavailable. The code is shown once, can be saved by the user, and is kept in operating-system secure storage on enrolled devices. It is never uploaded in plaintext. Losing both the old password and recovery code means the account data can still be recovered, but the old signing identity cannot be decrypted.

## Existing nonextractable identities

Existing Vumiro private keys were created nonextractable and cannot be copied or wrapped. The app must not attempt browser-storage tricks to bypass that security property.

Migration creates a new recoverable P-256 identity and, before replacing the old key, signs a bounded transition statement with the old key. Updated friends can verify that statement using the old public key they already trust and replace the contact identity atomically. The transition contains no account ID, email, private key, or recovery code.

Older clients that do not understand transition statements require one manual friend acceptance. This compatibility limitation must be shown before migration.

## Lifecycle

1. Generate the new key pair as extractable only long enough to export PKCS#8.
2. Create both encrypted wraps and zero references to plaintext buffers as soon as WebCrypto operations finish.
3. Import PKCS#8 as a nonextractable signing key.
4. Verify the imported public key and fingerprint before committing anything.
5. Upload the encrypted envelope using the current account revision.
6. Commit the new local identity and signed transition only after the account upload succeeds. If local commit fails, the encrypted envelope remains recoverable from the account.
7. Reconnect signaling with the new identity. The directory verifies the old-key signature and relays the transition only to an online contact that still watches the old identity while the new identity watches that contact. The receiving client verifies the signature again before atomically replacing the contact.
8. Store the recovery code in native secure storage only after successful enrollment, and provide an explicit option to save it offline.

Password change re-encrypts `passwordWrap` with the new password before the old provider session is discarded. Email password recovery requires the recovery code to rebuild `passwordWrap`; without it, the user chooses whether to keep using the local identity on an already enrolled device or create a new identity.

Account deletion removes both encrypted wraps. Local deletion separately removes the local nonextractable key and any securely stored recovery code.

## Required tests

- Public-key fingerprint matches `identityId` after each unwrap and import.
- Wrong password, wrong recovery code, changed metadata, changed IV, and changed ciphertext all fail without modifying the local profile.
- Password change rewrap preserves the same PKCS#8 key.
- Password recovery plus recovery code preserves the same public identity.
- Legacy transition is accepted only when signed by the exact old contact key and targets the connecting new key.
- Replayed, malformed, self-referential, expired, or chained transition attacks are rejected.
- Failed account upload does not replace the old local identity.
- Failed local commit after upload remains recoverable.
- The recovery code and raw PKCS#8 never appear in logs, exports, Worker responses beyond encrypted ciphertext, or support diagnostics.
