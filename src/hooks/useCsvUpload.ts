import { useState, useCallback } from "react";
import { parseCsvText } from "@/services/csvParser";
import { toast } from "sonner";

export interface UseCsvUploadResult<T> {
  file: File | null;
  rows: T[];
  columns: string[];
  error: string | null;
  isLoading: boolean;
  handleUpload: (file: File) => Promise<void>;
  removeFile: () => void;
}

// 20MB Limit
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function useCsvUpload<T = any>(fileLabel: string): UseCsvUploadResult<T> {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<T[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleUpload = useCallback(
    async (uploadedFile: File) => {
      // 1. Validate extension
      const extension = uploadedFile.name.split(".").pop()?.toLowerCase();
      if (extension !== "csv") {
        const errMsg = "Invalid file type. Please upload a CSV file only.";
        setError(errMsg);
        toast.error(`${fileLabel}: ${errMsg}`);
        return;
      }

      // 2. Validate size
      if (uploadedFile.size > MAX_FILE_SIZE_BYTES) {
        const errMsg = `File is too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`;
        setError(errMsg);
        toast.error(`${fileLabel}: ${errMsg}`);
        return;
      }

      setIsLoading(true);
      setError(null);
      setFile(uploadedFile);

      try {
        const fileContent = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string) || "");
          reader.onerror = () => reject(new Error("Failed to read file."));
          reader.readAsText(uploadedFile, "utf-8"); // Force UTF-8 encoding
        });

        const parseResult = await parseCsvText<T>(fileContent);

        if (parseResult.errors.length > 0) {
          const warningCount = parseResult.errors.length;
          console.warn(`${fileLabel}: CSV parse reported ${warningCount} issues.`, parseResult.errors);
        }

        setRows(parseResult.data);
        setColumns(parseResult.meta.fields || []);
        toast.success(`${fileLabel}: Loaded ${parseResult.data.length} rows successfully!`);
      } catch (err: any) {
        const errMsg = err.message || "An unexpected error occurred during parsing.";
        setError(errMsg);
        setRows([]);
        setColumns([]);
        setFile(null);
        toast.error(`${fileLabel}: ${errMsg}`);
      } finally {
        setIsLoading(false);
      }
    },
    [fileLabel]
  );

  const removeFile = useCallback(() => {
    setFile(null);
    setRows([]);
    setColumns([]);
    setError(null);
    setIsLoading(false);
    toast.info(`${fileLabel}: File removed`);
  }, [fileLabel]);

  return {
    file,
    rows,
    columns,
    error,
    isLoading,
    handleUpload,
    removeFile,
  };
}
