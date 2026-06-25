import { useState, useCallback } from "react";
import { WixExportRow, CMSRow, ValidationError, MappingResult, TranslationSummary, LocaleConfiguration } from "@/types/wix-translation-sync";
import { processTranslationSync } from "@/lib/services/wix-translation-sync/translationProcessor";
import { toast } from "sonner";

export interface UseTranslationProcessorResult {
  progress: number;
  isProcessing: boolean;
  completedWixRows: WixExportRow[];
  validationErrors: ValidationError[];
  mappingResults: MappingResult[];
  summary: TranslationSummary | null;
  processTranslation: (
    wixRows: WixExportRow[],
    cmsRows: CMSRow[],
    localeConfig: LocaleConfiguration,
    customFieldMapping?: Record<string, string>
  ) => Promise<void>;
  resetProcessor: () => void;
}

export function useTranslationProcessor(): UseTranslationProcessorResult {
  const [progress, setProgress] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [completedWixRows, setCompletedWixRows] = useState<WixExportRow[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [mappingResults, setMappingResults] = useState<MappingResult[]>([]);
  const [summary, setSummary] = useState<TranslationSummary | null>(null);

  const resetProcessor = useCallback(() => {
    setProgress(0);
    setIsProcessing(false);
    setCompletedWixRows([]);
    setValidationErrors([]);
    setMappingResults([]);
    setSummary(null);
  }, []);

  const processTranslation = useCallback(
    async (
      wixRows: WixExportRow[],
      cmsRows: CMSRow[],
      localeConfig: LocaleConfiguration,
      customFieldMapping?: Record<string, string>
    ) => {
      if (wixRows.length === 0 || cmsRows.length === 0) {
        toast.error("Both Wix export and CMS export files must contain records.");
        return;
      }

      setIsProcessing(true);
      setProgress(0);
      setCompletedWixRows([]);
      setValidationErrors([]);
      setMappingResults([]);
      setSummary(null);

      // We chunk the Wix rows processing to allow visual rendering and progress updating
      const batchSize = 500;
      const totalRows = wixRows.length;
      
      const allCompletedWixRows: WixExportRow[] = [];
      const allValidationErrors: ValidationError[] = [];
      const allMappingResults: MappingResult[] = [];
      
      let matchedRows = 0;
      let updatedRows = 0;
      let missingCmsRecords = 0;
      let unsupportedFields = 0;
      let errorsCount = 0;

      try {
        // Run indexing on CMS rows once (this is fast)
        // We can call processTranslationSync on batches of wixRows.
        // To do this, we slice wixRows and pass the full cmsRows to processTranslationSync,
        // then aggregate the results.
        
        let offset = 0;

        const executeNextBatch = async () => {
          if (offset >= totalRows) {
            // Processing complete!
            const successRate = totalRows > 0 ? Math.round((matchedRows / totalRows) * 100) : 100;
            const finalSummary: TranslationSummary = {
              totalRows,
              matchedRows,
              updatedRows,
              missingCmsRecords,
              unsupportedFields,
              errorsCount,
              successRate,
            };

            setCompletedWixRows(allCompletedWixRows);
            setValidationErrors(allValidationErrors);
            setMappingResults(allMappingResults);
            setSummary(finalSummary);
            setProgress(100);
            setIsProcessing(false);
            
            if (errorsCount > 0) {
              toast.warning(`Processing completed with ${errorsCount} errors. Check the validation report.`);
            } else {
              toast.success("Translation mapping completed successfully!");
            }
            return;
          }

          const limit = Math.min(offset + batchSize, totalRows);
          const wixSlice = wixRows.slice(offset, limit);

          // Process batch slice
          const batchResult = processTranslationSync({
            wixRows: wixSlice,
            cmsRows,
            localeConfig,
            customFieldMapping,
            // Offset row numbers in validation errors/mapping results in the processor
          });

          // Correct row numbers for validation errors and mapping results to match the original Wix export file
          const rowOffset = offset;
          const adjustedErrors = batchResult.validationErrors.map(err => ({
            ...err,
            rowNumber: err.rowNumber + rowOffset
          }));
          const adjustedMappings = batchResult.mappingResults.map(map => ({
            ...map,
            rowNumber: map.rowNumber + rowOffset
          }));

          // Aggregate
          allCompletedWixRows.push(...batchResult.completedWixRows);
          allValidationErrors.push(...adjustedErrors);
          allMappingResults.push(...adjustedMappings);

          matchedRows += batchResult.summary.matchedRows;
          updatedRows += batchResult.summary.updatedRows;
          missingCmsRecords += batchResult.summary.missingCmsRecords;
          unsupportedFields += batchResult.summary.unsupportedFields;
          errorsCount += batchResult.summary.errorsCount;

          // Update progress
          const currentProgress = Math.round((limit / totalRows) * 100);
          setProgress(Math.min(currentProgress, 99));
          
          offset = limit;

          // Yield to browser thread
          setTimeout(executeNextBatch, 0);
        };

        // Start processing
        setTimeout(executeNextBatch, 0);
      } catch (err: any) {
        setIsProcessing(false);
        const errMsg = err.message || "An unexpected error occurred during processing.";
        toast.error(`Processing failed: ${errMsg}`);
      }
    },
    []
  );

  return {
    progress,
    isProcessing,
    completedWixRows,
    validationErrors,
    mappingResults,
    summary,
    processTranslation,
    resetProcessor,
  };
}
