# Releasing

Releases are cut with the **release** workflow (Actions → release → Run workflow; see
[CONTRIBUTING.md](../CONTRIBUTING.md#commit-messages-and-releases)). Tag builds publish a draft
GitHub release with `SHA256SUMS` and update GitHub Pages, including the **GPG-signed Flatpak
repository**.

## One-time setup: Flatpak signing key

Use a dedicated key that is used for nothing else.

```bash
export GNUPGHOME="$(mktemp -d)"; chmod 700 "$GNUPGHOME"
gpg --batch --passphrase '' --quick-generate-key "WF-Studio for Linux Flatpak <you@example.org>" ed25519 sign 3y
gpg --list-secret-keys --with-colons | awk -F: '/^fpr/ {print $10; exit}'   # fingerprint
```

1. Commit the public key as `packaging/pages/wf-studio-linux.gpg`:
   `gpg --export <fingerprint> > packaging/pages/wf-studio-linux.gpg`
2. Repository secrets (Settings → Secrets and variables → Actions):
   - `FLATPAK_GPG_PRIVATE_KEY`: output of `gpg --armor --export-secret-keys <fingerprint>`
   - `FLATPAK_GPG_KEY_ID`: the fingerprint
3. Keep an offline backup of the private key, then delete the temporary `GNUPGHOME`.

Release builds fail if the secrets are missing or the key does not match the committed public key.
Before the key expires (3 years), generate a new one and repeat the steps; users then need to
re-add the remote.

## Migrating existing Flatpak users

Remotes created with `--no-gpg-verify` keep working unverified. Re-add them once:

```bash
flatpak remote-delete --user wf-studio-linux
flatpak remote-add --user wf-studio-linux https://kirnbauer.github.io/wf-studio-linux/wf-studio-linux.flatpakrepo
```
