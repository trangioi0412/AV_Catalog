import { WixExportRow, CMSRow, ValidationError, MappingResult, TranslationSummary, LocaleConfiguration, WixRowIdJson } from "../../../types/wix-translation-sync";
import { getMappedCmsField, isUnsupportedField } from "./translationMapper";
import { BASE_FIELD_MAPPING } from "../../../config/wix-translation-sync/fieldMappings";

export interface ProcessTranslationParams {
  wixRows: WixExportRow[];
  cmsRows: CMSRow[];
  localeConfig: LocaleConfiguration;
  customFieldMapping?: Record<string, string>;
  onProgress?: (progress: number) => void;
}

export interface ProcessTranslationResult {
  completedWixRows: WixExportRow[];
  validationErrors: ValidationError[];
  mappingResults: MappingResult[];
  summary: TranslationSummary;
}

export function processTranslationSync({
  wixRows,
  cmsRows,
  localeConfig,
  customFieldMapping = BASE_FIELD_MAPPING,
  onProgress,
}: ProcessTranslationParams): ProcessTranslationResult {
  const completedWixRows: WixExportRow[] = [];
  const validationErrors: ValidationError[] = [];
  const mappingResults: MappingResult[] = [];

  // Metrics counts
  let matchedRows = 0;
  let updatedRows = 0;
  let missingCmsRecords = 0;
  let unsupportedFieldsCount = 0;
  let errorsCount = 0;

  // 1. Index CMS rows by ID for O(1) lookup
  const cmsMap = new Map<string, CMSRow>();
  const duplicateCmsIds = new Set<string>();
  const cmsIdsSeen = new Set<string>();

  cmsRows.forEach((row, index) => {
    const id = (row.ID || row.id || "").toString().trim();
    if (!id) {
      validationErrors.push({
        rowNumber: index + 1,
        contentId: "",
        fieldId: "",
        severity: "warning",
        type: "MISSING_CONTENT_ID",
        details: "CMS row is missing an ID.",
      });
      return;
    }

    if (cmsIdsSeen.has(id)) {
      duplicateCmsIds.add(id);
      validationErrors.push({
        rowNumber: index + 1,
        contentId: id,
        fieldId: "",
        severity: "warning",
        type: "DUPLICATE_CMS_ID",
        details: `Duplicate CMS record ID: "${id}" found at row ${index + 1}.`,
      });
    } else {
      cmsIdsSeen.add(id);
      cmsMap.set(id, row);
    }
  });

  // Track duplicate combinations in Wix Multilingual Export
  const wixKeySeen = new Set<string>();

  // 2. Process Wix Export rows
  const totalWixRows = wixRows.length;
  const targetColName = localeConfig.wixTargetColumn;

  for (let i = 0; i < totalWixRows; i++) {
    const originalRow = wixRows[i];
    const rowNumber = i + 1;
    const completedRow = { ...originalRow };

    // Get the ID column
    const rawIdJson = originalRow["ID (do not edit)"];
    
    // Default fallback values
    let contentId = "";
    let fieldId = "";
    let hasParseError = false;

    if (!rawIdJson) {
      errorsCount++;
      validationErrors.push({
        rowNumber,
        contentId: "",
        fieldId: "",
        severity: "error",
        type: "PARSE_ERROR",
        details: 'Missing JSON in "ID (do not edit)" column.',
      });
      completedWixRows.push(completedRow);
      mappingResults.push({
        rowNumber,
        contentId: "",
        fieldId: "",
        cmsMatch: false,
        originalValue: originalRow[targetColName] || "",
        newValue: originalRow[targetColName] || "",
        status: "error",
        errorDetails: 'Missing JSON in "ID (do not edit)" column',
      });
      continue;
    }

    // Parse ID JSON
    try {
      const parsedId: WixRowIdJson = JSON.parse(rawIdJson);
      contentId = (parsedId.contentId || "").trim();
      fieldId = (parsedId.fieldId || "").trim();
    } catch (e: any) {
      hasParseError = true;
      errorsCount++;
      validationErrors.push({
        rowNumber,
        contentId: "",
        fieldId: "",
        severity: "error",
        type: "INVALID_JSON",
        details: `Malformed JSON in Wix row ID column: ${e.message}`,
      });
      completedWixRows.push(completedRow);
      mappingResults.push({
        rowNumber,
        contentId: "",
        fieldId: "",
        cmsMatch: false,
        originalValue: originalRow[targetColName] || "",
        newValue: originalRow[targetColName] || "",
        status: "error",
        errorDetails: `Invalid ID JSON format: ${e.message}`,
      });
      continue;
    }

    // Check contentId and fieldId existence
    if (!contentId) {
      errorsCount++;
      validationErrors.push({
        rowNumber,
        contentId: "",
        fieldId,
        severity: "error",
        type: "MISSING_CONTENT_ID",
        details: "Wix ID JSON is missing contentId value.",
      });
    }

    if (!fieldId) {
      errorsCount++;
      validationErrors.push({
        rowNumber,
        contentId,
        fieldId: "",
        severity: "error",
        type: "MISSING_FIELD_ID",
        details: "Wix ID JSON is missing fieldId value.",
      });
    }

    if (!contentId || !fieldId) {
      completedWixRows.push(completedRow);
      mappingResults.push({
        rowNumber,
        contentId,
        fieldId,
        cmsMatch: false,
        originalValue: originalRow[targetColName] || "",
        newValue: originalRow[targetColName] || "",
        status: "error",
        errorDetails: "Missing contentId or fieldId in Wix JSON.",
      });
      continue;
    }

    // Check for duplicate Wix records
    const wixKey = `${contentId}:${fieldId}`;
    if (wixKeySeen.has(wixKey)) {
      validationErrors.push({
        rowNumber,
        contentId,
        fieldId,
        severity: "warning",
        type: "DUPLICATE_WIX_RECORD",
        details: `Duplicate combination of contentId: "${contentId}" and fieldId: "${fieldId}" in Wix Multilingual Export.`,
      });
    } else {
      wixKeySeen.add(wixKey);
    }

    // Check if field is unsupported
    if (isUnsupportedField(fieldId)) {
      unsupportedFieldsCount++;
      validationErrors.push({
        rowNumber,
        contentId,
        fieldId,
        severity: "warning",
        type: "UNSUPPORTED_FIELD",
        details: `Field "${fieldId}" is unsupported (series, brand, mainFeature, datasheet).`,
      });
      completedWixRows.push(completedRow);
      mappingResults.push({
        rowNumber,
        contentId,
        fieldId,
        cmsMatch: false,
        originalValue: originalRow[targetColName] || "",
        newValue: originalRow[targetColName] || "",
        status: "warning",
        errorDetails: `Unsupported field: "${fieldId}"`,
      });
      continue;
    }

    // Find CMS Row by contentId
    const cmsRow = cmsMap.get(contentId);
    if (!cmsRow) {
      missingCmsRecords++;
      validationErrors.push({
        rowNumber,
        contentId,
        fieldId,
        severity: "warning",
        type: "MISSING_CMS_RECORD",
        details: `No matching CMS record found with ID "${contentId}".`,
      });
      completedWixRows.push(completedRow);
      mappingResults.push({
        rowNumber,
        contentId,
        fieldId,
        cmsMatch: false,
        originalValue: originalRow[targetColName] || "",
        newValue: originalRow[targetColName] || "",
        status: "warning",
        errorDetails: `Missing CMS record ID: "${contentId}"`,
      });
      continue;
    }

    // Determine mapped CMS column
    const cmsColumn = getMappedCmsField(fieldId, localeConfig, customFieldMapping);
    if (!cmsColumn) {
      errorsCount++;
      validationErrors.push({
        rowNumber,
        contentId,
        fieldId,
        severity: "error",
        type: "MISSING_MAPPING",
        details: `No field mapping defined for fieldId: "${fieldId}".`,
      });
      completedWixRows.push(completedRow);
      mappingResults.push({
        rowNumber,
        contentId,
        fieldId,
        cmsMatch: true,
        originalValue: originalRow[targetColName] || "",
        newValue: originalRow[targetColName] || "",
        status: "error",
        errorDetails: `No mapping defined for fieldId: "${fieldId}"`,
      });
      continue;
    }

    // Extract CMS value
    const cmsValue = cmsRow[cmsColumn];
    if (cmsValue === undefined) {
      errorsCount++;
      validationErrors.push({
        rowNumber,
        contentId,
        fieldId,
        severity: "error",
        type: "MISSING_MAPPING",
        details: `Column "${cmsColumn}" not found in CMS export file.`,
      });
      completedWixRows.push(completedRow);
      mappingResults.push({
        rowNumber,
        contentId,
        fieldId,
        cmsMatch: true,
        originalValue: originalRow[targetColName] || "",
        newValue: originalRow[targetColName] || "",
        status: "error",
        errorDetails: `Column "${cmsColumn}" not found in CMS export file`,
      });
      continue;
    }

    const trimmedCmsValue = String(cmsValue).trim();
    if (trimmedCmsValue === "") {
      validationErrors.push({
        rowNumber,
        contentId,
        fieldId,
        severity: "warning",
        type: "EMPTY_CMS_VALUE",
        details: `CMS column "${cmsColumn}" has an empty value for ID "${contentId}".`,
      });
    }

    // Update target language column
    completedRow[targetColName] = cmsValue;
    matchedRows++;
    updatedRows++;

    completedWixRows.push(completedRow);
    mappingResults.push({
      rowNumber,
      contentId,
      fieldId,
      cmsMatch: true,
      originalValue: originalRow[targetColName] || "",
      newValue: cmsValue,
      status: trimmedCmsValue === "" ? "warning" : "success",
      errorDetails: trimmedCmsValue === "" ? "Empty CMS value" : undefined,
    });

    // Report progress if callback is provided
    if (onProgress && i % 100 === 0) {
      onProgress(Math.min(Math.round(((i + 1) / totalWixRows) * 100), 99));
    }
  }

  // Final 100% progress
  if (onProgress) {
    onProgress(100);
  }

  const successRate = totalWixRows > 0 ? Math.round((matchedRows / totalWixRows) * 100) : 100;

  const summary: TranslationSummary = {
    totalRows: totalWixRows,
    matchedRows,
    updatedRows,
    missingCmsRecords,
    unsupportedFields: unsupportedFieldsCount,
    errorsCount,
    successRate,
  };

  return {
    completedWixRows,
    validationErrors,
    mappingResults,
    summary,
  };
}
