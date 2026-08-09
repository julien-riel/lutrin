/**
 * The one JSZip output type the .pptx pipeline asks for, chosen per runtime.
 *
 * Writing a deck is a chain of zip round-trips: PptxGenJS produces the package,
 * then eight passes reopen it, patch parts and write it back. Every one of them
 * asked JSZip for a `nodebuffer` — a type that exists only on Node, and that
 * throws `This platform does not support nodebuffer` in a browser, on the first
 * pass, with the package already half written.
 *
 * The playground runs THIS renderer in the page (site/assets/js/playground.js),
 * so the type has to be whichever binary container the runtime actually has:
 * `nodebuffer` on Node, `uint8array` in a browser. Both are accepted by
 * `JSZip.loadAsync` and by `fs.writeFileSync` — the real one and the shim — so
 * nothing else in the chain has to know which it got.
 *
 * Detected on `Buffer` rather than on `process`: the playground stubs
 * `window.process` before the compiler loads (deck/assets.mjs dereferences
 * `process.env` at module scope), so a `process` test would call the browser
 * Node and pick the type that throws.
 */
export const ZIP_BYTES = typeof Buffer === 'function' ? 'nodebuffer' : 'uint8array';
