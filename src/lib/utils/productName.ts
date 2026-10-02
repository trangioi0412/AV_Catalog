/**
 * productName.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure product-name matching helpers, shared by server services (wixCms.ts,
 * image sync, catalog upload) and client components (CMS data-quality
 * checks). No I/O, safe to import anywhere. Re-exported from wixCms.ts.
 */

/**
 * Normalize a product name for case-insensitive, format-agnostic matching.
 *
 * Handles:
 *   - ALL_CAPS, Title Case, camelCase, PascalCase
 *   - Hyphens, underscores, slashes, backslashes → space (list separators)
 *   - "+", ":", "*" dropped entirely (not replaced with space)
 *   - Characters a Windows filename can't contain ('"', "?", "<", ">", "|")
 *     plus curly/prime quote variants dropped too, so a CMS name like
 *     '11.6" Paperless ...' matches an image file named "11.6 Paperless ..."
 *   - All other special characters (parentheses, brackets, ...) are kept as
 *     literal characters — they still count when comparing names
 *   - Number–letter boundaries: "MXA920" → "mxa 920", "Gen2" → "gen 2"
 *   - Extra whitespace collapsed
 *
 * Examples:
 *   "Neat Board Pro"      → "neat board pro"
 *   "NEAT-BOARD-PRO"      → "neat board pro"
 *   "Neat_Board_Pro"      → "neat board pro"
 *   "Shure MXA920"        → "shure mxa 920"
 *   "Logitech RallyBarMini" → "logitech rally bar mini"
 *   "Neat Bar (Gen 2)"    → "neat bar (gen 2)"
 *   "4x1 Switcher (ARC/eARC)" → "4 x 1 switcher (arc earc)"
 *
 * Bug fixed 2026-09-24: "/" used to be dropped with no replacement (so
 * "ARC/eARC" fused into "ARCeARC"), and the CamelCase-boundary rule below
 * then misfired on that fused run, splitting it in the wrong place
 * ("ARCe" + "ARC" instead of "ARC" + "eARC") -- so a real CMS product
 * named "...(ARC/eARC)" and an uploaded image plainly named
 * "...(ARC eARC)" normalized to two *different* keys and silently never
 * matched. Checked against every one of this catalog's 1014 real product
 * names: every existing "/" is a list separator (e.g. "HDBaseT 3.0/USB/
 * Dante", "(150m/USB)"), never the "fuse into one word" case the old
 * behavior assumed, and switching it to a space introduces zero key
 * collisions while fixing 74 other similarly-garbled keys (e.g.
 * "usbdante" → "usb dante").
 */
export function normalizeName(name: string): string {
  return (
    name
      // Convert Vietnamese d/D with stroke (đ/Đ) to standard d/D
      .replace(/[đĐ]/g, "d")
      // Split accented characters into base character + diacritical marks
      .normalize("NFD")
      // Remove diacritical marks (e.g. "Parlé" → "Parle")
      .replace(/[\u0300-\u036f]/g, "")
      // 1. Replace word separators with space: "-", "_", "/", "\" -- all
      //    of them are used as list separators in real product names
      //    (see the 2026-09-24 note above), so none should fuse adjacent
      //    words together. Other special characters (e.g. "(", ")") are
      //    kept as-is so they still count when comparing names.
      .replace(/[-_/\\]/g, " ")
      // 2. Drop remaining punctuation entirely (not replaced with space).
      .replace(/[+:*"?<>|“”″]/g, "")
      // 3. Insert space between letter→digit boundary: "MXA920" → "MXA 920", "Gen2" → "Gen 2"
      .replace(/([a-zA-Z])(\d)/g, "$1 $2")
      // 4. Insert space between digit→letter boundary: "920A" → "920 A"
      .replace(/(\d)([a-zA-Z])/g, "$1 $2")
      // 5. Insert space at CamelCase boundaries: "RallyBar" → "Rally Bar".
      //    Only splits before the START of a new Capitalized word (the
      //    uppercase letter is followed by a lowercase one) -- NOT before
      //    a run of 2+ capitals, so acronyms like "eARC" or "HDBaseT"
      //    stay intact instead of being split mid-acronym.
      .replace(/([a-z])([A-Z])(?=[a-z])/g, "$1 $2")
      // 6. Lowercase everything
      .toLowerCase()
      // 7. Collapse multiple spaces
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Space-insensitive form of a `normalizeName()` key, for exact matching only.
 *
 * `normalizeName` inserts spaces at CamelCase / letter-digit boundaries, but
 * it can only see those boundaries when the input carries them: "5G WiFi"
 * becomes "5 g wi fi" while a lowercase filename "5 g wifi" stays "5 g wifi",
 * so the two never matched. Dropping the spaces makes the comparison ignore
 * where words were split ("WiFi" / "Wi-Fi" / "wifi", "RallyBar" / "Rally Bar").
 * Keep the spaced `normalizeName` key for display and word-based similarity.
 * Checked against all 1267 real CMS products: introduces no new collisions.
 */
export function matchKey(normalizedKey: string): string {
  return normalizedKey.replace(/ /g, "");
}
