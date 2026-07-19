# Security policy

## Reporting a vulnerability

**Do not open a public issue.** Go through **GitHub Security Advisories**:
the repository's *Security* tab → *Report a vulnerability*, or directly
<https://github.com/julien-riel/lutrin/security/advisories/new>. The report
stays private between you and the maintainer until a fix exists.

A good report contains the archive, the deck or the minimal URL that
reproduces it, the command that was run, the version of Lutrin and of Node,
what was expected and what happened.

Target turnaround: acknowledgement within 7 days, diagnosis within 30 days.
The project is maintained by one person — if nothing comes, follow up.

Versions covered: the latest published release, only.

## Threat model

Compiling a deck is a local operation, but three surfaces bring bytes from
elsewhere into the process. The guardrails below are in the code; the headers
of `packages/core/src/kit/archive.mjs` and
`packages/vscode-extension/src/updater.ts` give the long version.

### 1. Installing a kit (`lutrin kit install`)

This is the only place in the project that **writes bytes from the outside to
the user's disk**, possibly from a URL. Six protections, none of which is
optional:

- **No code, ever.** A kit is data: an allowlist of extensions (`.json`,
  `.md`, `.txt`, fonts, images). Neither `.js`, nor `.mjs`, nor `.node` get
  in. It is this property — and this property alone — that makes installing
  from a URL defensible: nothing that is installed will ever be executed.
- **No path traversal.** Any entry whose normalized path leaves the target
  directory is refused, absolute paths and `..` included ("zip slip"). The
  manifest's `name` field is itself constrained, since it becomes a
  directory name.
- **Bounds.** Archive size (20 MB), decompressed total (100 MB), entry count
  (500). The total is checked **during** decompression, not after: the size
  an archive announces is a third party's claim.
- **HTTPS only**, and never a redirect to another protocol.
- **sha256 digest** shown at creation and at installation, and reproducible.
  It is **not** a signature: it lets you compare what you received against
  what the author says they published; it does not authenticate the source.
- **Atomic extraction**: everything is written to an adjacent temporary
  directory, validated, then swapped in by a `rename()`. An interrupted
  installation never leaves a half-written kit.

What is **not** covered: Lutrin does not verify *who* published a kit.
Installing a kit amounts to trusting its provenance, as with any downloaded
file — the project's guarantee covers what the kit can do once installed
(nothing executable), not where it came from.

### 2. Remote resources at compile time

Compiling a deck can trigger outbound network requests:

- the deck's `![](https://…)` images are downloaded and then embedded in the
  deliverable — the presentation, once opened, has no network dependency
  left. That is not merely a side effect of embedding: the HTML produced
  cannot acquire one either through an SVG coming from a kit, an icon or a
  Mermaid diagram. The HTML renderer's sanitizer accepts an `http(s)` scheme
  only on the attributes through which an `<a>` **navigates**, that is, on a
  reader's click; everywhere else — `<image>`, `<use>`, `<feImage>`, a CSS
  `url()` — a remote URL would be fetched on its own at render time, on every
  recipient's machine, and it does not get in. The refusal is not limited to
  the offending URL, nor even to remote URLs: an **entire style sheet** that
  carries a `url()` other than a `#…` fragment is dropped wholesale — even
  when the target is a local file or a `data:` — as is an `@import` or an
  `@namespace`; and a presentation attribute carrying one — `fill`, `filter`,
  `mask`, `clip-path`, `style` — is removed in its entirety. Telling a local
  target from a remote one would mean resolving the paths of CSS that came
  from a third party, and a resolution that gets it wrong reopens the
  network: only the fragment, which can designate nothing but the current
  document, is admitted without examination. Excising the offending rule
  alone would mean rewriting CSS, and a miscounted brace would re-enable
  everything that follows: we refuse wholesale — that is what deny by default
  means;
- a `lucide:` icon missing from `node_modules` is looked up in the user
  cache, then downloaded from unpkg and cached.

The URLs are the ones **the deck's author wrote**. Compiling a deck received
from a third party therefore triggers requests to hosts of their choosing,
which reveals the IP address of the machine doing the compiling. Downloads
are bounded in size, and the running total is checked during the transfer (a
server that lies about `content-length` has its transfer cut off). By
default, the copies go to the user cache `~/.cache/lutrin/`: compiling writes
nothing into the deck's directory.

One exception, and it is the deck that asks for it: `assets: vendor` in the
frontmatter (or `--vendor-assets`, or `lutrin vendor`) deliberately copies
the remote images into `assets/remote/` **next to the `.md`**, to make the
directory self-contained. That is the case for `examples/demo.deck.md`, and
therefore for the first `build` the README suggests: two JPEGs, about one
megabyte in all, appear in `examples/assets/remote/` (a gitignored
directory). A compilation can therefore write into the source tree — never
without the document, or the command line, having asked for it.

To compile offline, or to freeze these dependencies before passing a
directory on: `lutrin vendor <deck.md>`.

### 3. Fonts, logos and themes

A theme names its fonts (`.ttf` and their `.woff2` twin) and its logos by
paths **resolved relative to the theme file**, hence inside the kit; a
manifest cannot name an arbitrary file on the host system. Fonts are embedded
as is in the `.pptx` and inlined as base64 in the HTML: **check that your
fonts' license allows this redistribution** before publishing a kit — it is a
legal question before it is a technical one.

Font family names are interpolated into the CSS of the generated HTML
document: they are validated (letters, digits, spaces and `.,'-` only) so
that a theme cannot inject anything into the style sheet.

An invalid theme entry never interrupts a compilation: it is dropped with a
`THEME_*` diagnostic.

### 4. Updating the VS Code extension

A feature **disabled by default** (`lutrin.updateUrl` empty). Enabled, it
downloads a manifest and then a VSIX — and a VSIX runs inside the extension
host. What is done, and what is not:

- the VSIX's sha256 digest is **mandatory** and verified against the
  downloaded buffer before any disk write; it protects against a corrupted
  download and against the compromise of a VSIX host distinct from the
  manifest's;
- it does **not** protect against a compromised manifest server: the digest
  travels in the same `latest.json` as the pointer, so whoever controls the
  manifest supplies the digest of their own VSIX. Guarding against that would
  require a signature, with the public key embedded in the extension — that
  is not implemented;
- `http:` URLs are refused, for the manifest as for the VSIX.

Enable this feature only if you control the server that hosts the manifest.

## Out of scope

- The content of a deck: the compiled Markdown produces a document, not code.
- The trust placed in a third-party kit (see above).
- Vulnerabilities in upstream dependencies — report them to their own
  project; open an ordinary issue here if Lutrin must change version.
