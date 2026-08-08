/**
 * Last post-write pass: drop the zip's DIRECTORY ENTRIES.
 *
 * A .pptx is an OPC package, and OPC names parts by their full path — nothing
 * in the specification asks for the `ppt/`, `ppt/slides/` … entries our writer
 * leaves behind, and no package Office itself writes carries a single one
 * (`docs/reference-pptx.md`, measured across the whole reference corpus). They
 * come from JSZip, which materialises a folder for every parent of a path
 * handed to `file()`, and every load/generate round-trip since has carried
 * them forward.
 *
 * This is cosmetic and it is honest to say so: no consumer has ever objected.
 * It is done because "does our zip look like one PowerPoint wrote?" is the
 * question this whole corpus exists to answer, and this was the last line in
 * the answer that read "no" for a reason nobody chose.
 *
 * TWO THINGS TO KNOW BEFORE EDITING THIS FILE:
 *
 *   - `zip.remove(name)` on a folder deletes the folder AND EVERYTHING UNDER
 *     IT. Calling it here would empty the package. The entries are therefore
 *     deleted from the `files` map directly, which is the only removal that
 *     touches the directory entry alone.
 *   - the pass refuses to write if the count of real parts moved. A silent
 *     mistake here would corrupt every export lutrin produces, so the failure
 *     mode is "leave the file exactly as it was", not "hope".
 */

import fs from 'node:fs';
import JSZip from 'jszip';

export async function dropDirectoryEntries(pptxPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  const names = Object.keys(zip.files);
  const dirs = names.filter((n) => zip.files[n].dir);
  if (!dirs.length) return { count: 0, warnings: [] };

  const partsBefore = names.length - dirs.length;
  for (const n of dirs) delete zip.files[n];

  const partsAfter = Object.keys(zip.files).filter((n) => !zip.files[n].dir).length;
  if (partsAfter !== partsBefore) {
    // unreachable unless JSZip changes what deleting a folder key implies —
    // which is exactly the day this must not ship a truncated package
    return {
      count: 0,
      warnings: [
        `zip tidy: ${partsBefore} parts before, ${partsAfter} after — directory entries kept`,
      ],
    };
  }

  fs.writeFileSync(
    pptxPath,
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
  return { count: dirs.length, warnings: [] };
}
