import { BASE_FIELD_MAPPING, UNSUPPORTED_FIELDS } from "../../../config/wix-translation-sync/fieldMappings";
import { LocaleConfiguration } from "../../../types/wix-translation-sync";

/**
 * Resolves the mapped CMS field name for a given Wix field ID and locale config.
 * E.g., fieldId "productOverview" + locale "EN" -> "productOverview_EN"
 */
export function getMappedCmsField(
  fieldId: string,
  localeConfig: LocaleConfiguration,
  customFieldMapping: Record<string, string> = BASE_FIELD_MAPPING
): string | null {
  const baseField = customFieldMapping[fieldId];
  if (!baseField) {
    return null;
  }
  return `${baseField}${localeConfig.cmsFieldSuffix}`;
}

/**
 * Checks if a fieldId is unsupported (e.g. series, brand, mainFeature, datasheet).
 */
export function isUnsupportedField(fieldId: string): boolean {
  return UNSUPPORTED_FIELDS.includes(fieldId);
}
