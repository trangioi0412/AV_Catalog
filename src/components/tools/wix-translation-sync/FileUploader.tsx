import React from "react";
import { UploadCard } from "./UploadCard";
import { UseCsvUploadResult } from "@/hooks/wix-translation-sync/useCsvUpload";
import { LOCALE_CONFIGS } from "@/config/wix-translation-sync/localeMappings";
import { FIELD_HELP_TEXT } from "@/constants/wix-translation-sync/translationTool";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Globe } from "lucide-react";

interface FileUploaderProps {
  wixFileState: UseCsvUploadResult<any>;
  cmsFileState: UseCsvUploadResult<any>;
  selectedLocale: string;
  onLocaleChange: (locale: string) => void;
  disabled?: boolean;
}

export function FileUploader({
  wixFileState,
  cmsFileState,
  selectedLocale,
  onLocaleChange,
  disabled = false,
}: FileUploaderProps) {
  return (
    <div className="space-y-6">
      {/* Locale Selector Banner */}
      <Card className="border border-border/60 bg-card/40 backdrop-blur-md shadow-sm rounded-xl">
        <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-inner">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Target Translation Locale</Label>
              <p className="text-[11px] text-muted-foreground/90 mt-0.5">Select the target language to map from CMS columns to the Wix Export.</p>
            </div>
          </div>
          <div className="w-full sm:w-[220px] shrink-0">
            <Select
              value={selectedLocale}
              onValueChange={onLocaleChange}
              disabled={disabled || wixFileState.isLoading || cmsFileState.isLoading}
            >
              <SelectTrigger className="w-full text-xs font-medium">
                <SelectValue placeholder="Chọn ngôn ngữ dịch" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(LOCALE_CONFIGS).map((config) => (
                  <SelectItem key={config.code} value={config.code} className="text-xs font-medium">
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* File Upload Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <UploadCard
          title="Wix Multilingual Export CSV"
          description={`Tải lên file export ngôn ngữ từ Wix (Ví dụ: export_${selectedLocale.toLowerCase()}.csv)`}
          helpText={FIELD_HELP_TEXT.wixFile}
          file={wixFileState.file}
          isLoading={wixFileState.isLoading}
          error={wixFileState.error}
          rowsCount={wixFileState.rows.length}
          onUpload={wixFileState.handleUpload}
          onRemove={wixFileState.removeFile}
        />

        <UploadCard
          title="AV_Catalog CMS Export CSV"
          description="Tải lên file kết xuất sản phẩm từ hệ thống AV_Catalog CMS chứa các cột ngôn ngữ dịch"
          helpText={FIELD_HELP_TEXT.cmsFile}
          file={cmsFileState.file}
          isLoading={cmsFileState.isLoading}
          error={cmsFileState.error}
          rowsCount={cmsFileState.rows.length}
          onUpload={cmsFileState.handleUpload}
          onRemove={cmsFileState.removeFile}
        />
      </div>
    </div>
  );
}
