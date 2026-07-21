## Diagnostics on the exact line

The deck doctor validates every deck as you edit:

- **Measured overflows** — a slide that will not fit says so before
  you present it.
- **Unknown layout or effect names** — with a "did you mean…?" that
  becomes a quick fix (lightbulb, `Ctrl+.` / `Cmd+.`).
- **Under-resolved images** — files missing or too small for the slot
  they land in.
- **Structure suggestions** — when the content clearly asks for a
  layout, the validator proposes it and the quick fix applies it.

The same doctor runs in the `lutrin` CLI (`lutrin validate --json`) —
what is green here is green in CI.
