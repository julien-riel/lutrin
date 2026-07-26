/**
 * ttf.js — minimal client-side reader of the TrueType/OpenType `name` table,
 * just enough to learn the real family name of an uploaded .ttf and propose
 * it as theme.fonts.body. No dependency, no DOM.
 *
 * Records considered: nameID 16 (typographic family) over nameID 1 (family);
 * platform 3 (Windows, UTF-16BE) preferred, then platform 0 (Unicode,
 * UTF-16BE), then platform 1/0 (Macintosh, MacRoman). Anything unreadable —
 * not an sfnt, truncated, exotic encoding — yields null: the caller treats
 * the family as unknown, never as an error.
 */

// MacRoman 0x80–0xFF in order (the low half is ASCII). 0xF0 is the Apple
// logo (private use U+F8FF) — never expected in a family name, kept exact.
const MAC_ROMAN_HIGH =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø' +
  '¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

function utf16be(view, start, length) {
  let out = '';
  for (let i = 0; i + 1 < length; i += 2) out += String.fromCharCode(view.getUint16(start + i));
  return out;
}

function macRoman(view, start, length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    const b = view.getUint8(start + i);
    out += b < 0x80 ? String.fromCharCode(b) : MAC_ROMAN_HIGH[b - 0x80];
  }
  return out;
}

function readFamily(view, base) {
  const sfnt = view.getUint32(base);
  // 0x00010000 (TrueType), 'OTTO' (CFF outlines), 'true' (old Mac TrueType)
  if (sfnt !== 0x00010000 && sfnt !== 0x4f54544f && sfnt !== 0x74727565) return null;
  const numTables = view.getUint16(base + 4);
  let nameAt = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    if (view.getUint32(rec) === 0x6e616d65) {
      // 'name'
      nameAt = view.getUint32(rec + 8);
      break;
    }
  }
  if (nameAt < 0) return null;
  const count = view.getUint16(nameAt + 2);
  const stringsAt = nameAt + view.getUint16(nameAt + 4);
  let best = null; // {score, start, length, decode}
  for (let i = 0; i < count; i++) {
    const rec = nameAt + 6 + i * 12;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const language = view.getUint16(rec + 4);
    const nameId = view.getUint16(rec + 6);
    const length = view.getUint16(rec + 8);
    const start = stringsAt + view.getUint16(rec + 10);
    if ((nameId !== 1 && nameId !== 16) || length === 0 || length > 512) continue;
    if (start + length > view.byteLength) continue;
    let score = nameId === 16 ? 8 : 0;
    let decode = null;
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      score += 4 + (language === 0x0409 ? 2 : 0); // Windows, en-US first
      decode = utf16be;
    } else if (platform === 0) {
      score += 3; // Unicode platform
      decode = utf16be;
    } else if (platform === 1 && encoding === 0) {
      score += language === 0 ? 2 : 1; // Macintosh Roman, English first
      decode = macRoman;
    } else continue;
    if (!best || score > best.score) best = { score, start, length, decode };
  }
  if (!best) return null;
  // strip stray control characters, then trim
  const name = best.decode(view, best.start, best.length).replace(/[\x00-\x1f\x7f]/g, '').trim();
  return name || null;
}

/**
 * The family name declared inside a .ttf/.otf (nameID 16, else 1), or null
 * when the bytes cannot be read as one. Accepts an ArrayBuffer or any typed
 * array view; a .ttc collection is read through its first face.
 * @param {ArrayBuffer|Uint8Array} data raw font bytes
 * @returns {string|null}
 */
export function ttfFamilyName(data) {
  try {
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset ?? 0, data.byteLength);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const base = view.getUint32(0) === 0x74746366 ? view.getUint32(12) : 0; // 'ttcf'
    return readFamily(view, base);
  } catch {
    return null; // truncated or not a font — unknown family, not an error
  }
}
