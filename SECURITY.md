# Security Policy

## Supported Versions

`buildwithnexus` is published to npm under semantic versioning. Only the latest
released minor line receives security fixes.

| Version    | Supported          |
|------------|--------------------|
| 0.8.x      | :white_check_mark: |
| < 0.8      | :x:                |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security problems.**

Report vulnerabilities privately via GitHub's coordinated-disclosure flow:

  https://github.com/Garretts-Apps/buildwithnexus/security/advisories/new

Or by email to `security@buildwithnexus.dev`.

We aim to acknowledge new reports within **3 business days** and to ship a fix
or mitigation within **30 days** of acknowledgement, depending on severity. We
will credit reporters in the advisory unless they ask to remain anonymous.

## Scope

In scope:

- The `buildwithnexus` npm package (CLI, bundled NEXUS source tarball,
  installer scripts).
- The publish pipeline in `.github/workflows/publish.yml`.
- The bundled NEXUS Python source (`dist/nexus-release.tar.gz`).
- Any release artifacts attached to GitHub Releases (SBOM, checksums).

Out of scope:

- Vulnerabilities in upstream dependencies — please report those upstream first;
  if exploitable through `buildwithnexus`, also notify us.
- Self-XSS or social-engineering against your own developer machine.
- Issues that require an attacker to already control your CI secrets, npm
  account, or developer machine.

## Verifying a Release

Every release on npm from `v0.9.0` onward ships with **npm provenance** — a
SLSA-Build-L3-style attestation cryptographically tying the tarball back to the
specific GitHub Actions workflow run that built it.

To verify:

```sh
npm view buildwithnexus@<version> --json | jq .dist.attestations
```

Or interactively in the terminal:

```sh
npx -y npm-audit-resolver buildwithnexus
```

The publish workflow also attaches a CycloneDX SBOM (`sbom.cdx.json`) and a
`SHA256SUMS.txt` to each GitHub Release. You can reproduce the tarball locally
by checking out the corresponding tag and running:

```sh
git clone --branch v<version> https://github.com/Garretts-Apps/buildwithnexus
cd buildwithnexus
NEXUS_SRC=/path/to/nexus npm run build && npm run bundle
sha256sum dist/nexus-release.tar.gz
```

## Hardening Inside the Package

- `prepublishOnly` refuses to publish unless `NEXUS_SRC` is explicitly set to a
  valid nexus checkout. No silent fall-through to a stale `/tmp/` copy.
- `postinstall` was removed. `npm install buildwithnexus` no longer executes
  any project-defined lifecycle script on the user's machine.
- All GitHub Actions in our workflows are pinned to specific minor versions
  (Dependabot proposes SHA-pinned bumps weekly).
- The publish workflow runs with the minimum permissions required, plus
  `id-token: write` only for OIDC provenance signing.
- `npm ci --ignore-scripts` is used in CI to neutralise transitive postinstall
  scripts during builds and audits.
