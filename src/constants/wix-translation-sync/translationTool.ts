export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit

export const TOOL_DESCRIPTION = 
  "Synchronize Wix Multilingual export translation files with product data exported from the AV_Catalog CMS. This tool maps properties by ID, checks for discrepancies, formats correctly, and exports ready-to-import Wix Multilingual files.";

export const FIELD_HELP_TEXT = {
  wixFile: "Wix Multilingual Export file (e.g. export_en.csv). Columns: ID (do not edit), Content type, Element type, Source language, Target language.",
  cmsFile: "AV_Catalog CMS Export file (e.g. WIX_CMS_Import_EN.csv). Columns must include ID, and field names corresponding to mapped languages.",
};
