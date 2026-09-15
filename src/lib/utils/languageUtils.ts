/**
 * Vietnamese-specific diacritic characters (all tones × all base letters that
 * carry them, both cases). Used as a cheap heuristic for "is this text
 * already Vietnamese" — avoids calling a translation model on every field of
 * every product during a CMS sync check; only text that doesn't match gets
 * sent through translateToVietnamese.
 */
const VIETNAMESE_DIACRITIC_REGEX =
  /[àáạảãăằắặẳẵâầấậẩẫèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃĂẰẮẶẲẴÂẦẤẬẨẪÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;

/**
 * Minimum share of "real" words (2+ letters) that must carry a Vietnamese
 * diacritic for text to count as Vietnamese. A genuine Vietnamese sentence
 * carries tone marks on most of its words; content that's actually mixed
 * English/Vietnamese (the "mixed_language" case this whole file exists for)
 * only has them on the stray Vietnamese fragment, so a single-match check
 * (the old behavior) would wrongly call a mostly-English paragraph
 * "Vietnamese" just because one Vietnamese word appears in it.
 */
const VIETNAMESE_WORD_RATIO_THRESHOLD = 0.25;

/**
 * Heuristic: does this text look like it's already (fully) Vietnamese? Text
 * under 3 characters is treated as "fine as-is" (too short to judge reliably,
 * and forcing e.g. a short code through translation would be pointless).
 */
export function looksVietnamese(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 3) return true;

  const words = trimmed.split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, "").length >= 2);
  if (words.length === 0) return true;

  const diacriticWordCount = words.filter((w) => VIETNAMESE_DIACRITIC_REGEX.test(w)).length;
  return diacriticWordCount / words.length >= VIETNAMESE_WORD_RATIO_THRESHOLD;
}
