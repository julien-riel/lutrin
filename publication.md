# Publishing Lutrin

Where each deliverable goes and how it gets there. The npm packages
(`lutrin`, `@lutrin/core`) are published with `npm publish` from their
directories; this file details the channel that needs one-time setup:
the **VS Code extension** on the Visual Studio Marketplace.

## VS Code extension — one-time setup

The Marketplace hands out identities in two steps: an Azure DevOps
**personal access token** proves who you are, a Marketplace **publisher**
is the name extensions appear under. Both are free.

1. **Azure DevOps organization** — sign in at
   [dev.azure.com](https://dev.azure.com) (any Microsoft account) and
   create an organization if you have none. Its name does not matter;
   it only exists to hold the token.
2. **Personal access token** — User settings → Personal access tokens →
   New token. Organization: **All accessible organizations** (a token
   scoped to one organization is refused by `vsce`). Scopes: "Custom
   defined" → **Marketplace → Manage**. Expiration: up to a year —
   note the date, renewing it is this same screen.
3. **Publisher** — at
   [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage),
   create the publisher `lutrin` (ID and display name). The ID must
   equal the `"publisher"` field of
   `packages/vscode-extension/package.json`; if `lutrin` is already
   taken, pick another ID and change that field to match.
4. **Repository secret** — GitHub → Settings → Secrets and variables →
   Actions → New repository secret: `VSCE_PAT`, value = the token from
   step 2. The release workflow reads it; nothing else does.
5. **Open VSX (optional)** — the registry VSCodium and Cursor read.
   Create an account at [open-vsx.org](https://open-vsx.org) (Eclipse
   account), sign the publisher agreement, create the `lutrin`
   namespace (`npx ovsx create-namespace lutrin -p <token>`), and add
   the token as the `OVSX_PAT` repository secret. If the secret is
   absent the workflow silently skips this registry.

## VS Code extension — every release

The extension's version tracks the compiler it embeds (both are 1.1.0
today). To release:

1. Bump `"version"` in `packages/vscode-extension/package.json`, update
   `packages/vscode-extension/CHANGELOG.md` (the Marketplace "Changelog"
   tab renders it) and the root `CHANGELOG.md`.
2. Land that on `main` — the listing page pulls its images from the
   `main` branch on raw.githubusercontent.com, so the README and images
   must be pushed **before** publishing.
3. Tag and push:

   ```bash
   git tag vscode-v1.1.0
   git push origin vscode-v1.1.0
   ```

The `Release — VS Code extension` workflow replays the tests, builds
the VSIX, refuses a tag that disagrees with `package.json`, publishes
to the Marketplace, attaches the VSIX + `latest.json` to a GitHub
release for installations outside the Marketplace, then publishes to
Open VSX if `OVSX_PAT` exists. Without `VSCE_PAT` the Marketplace step
is **skipped with a warning annotation** on the run's summary page — the
GitHub release still comes out, and its VSIX can be uploaded by hand on
[marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
(signed in, no PAT needed). The annotation is what keeps a green run
from silently passing for a Marketplace release.

**Rehearsal:** run the workflow by hand (Actions → Release — VS Code
extension → Run workflow). A manual run stops after packaging and
uploads the VSIX as an artifact — the full pipeline, no publishing, no
secrets required.

## VS Code extension — manual fallback

The workflow is only a driver around `vsce`; the same gestures work
locally:

```bash
npm ci
npm run build -w lutrin-vscode
npm run vsix  -w lutrin-vscode        # → lutrin-vscode-<version>.vsix
cd packages/vscode-extension
npx @vscode/vsce publish --packagePath lutrin-vscode-<version>.vsix
# vsce asks for the PAT; or: export VSCE_PAT=... beforehand
```

Useful checks before a first publish:

```bash
npx @vscode/vsce ls --no-dependencies      # exactly what the VSIX will contain
code --install-extension lutrin-vscode-<version>.vsix   # try it for real
```

## After the first publish

- Check the listing page: icon, banner color, README images, Changelog
  tab, categories, badges — the Marketplace caches aggressively, give
  it a few minutes.
- The listing URL is
  `https://marketplace.visualstudio.com/items?itemName=lutrin.lutrin-vscode`
  (already linked from the root README — fix it if the publisher ID
  changed in step 3).
- A listing improves with motion: a short GIF of the preview following
  the cursor, recorded once and committed under `docs/images/`, is worth
  adding to the extension README when convenient.
