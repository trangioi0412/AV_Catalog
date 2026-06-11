"use client";

import React, { useState, useTransition } from "react";
import { updateImageSearchConfigAction } from "@/app/actions/discovery";
import { toast } from "sonner";
import { ImageIcon, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ImageSearchToggleProps {
  initialEnabled: boolean;
}

export function ImageSearchToggle({ initialEnabled }: ImageSearchToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    const newValue = !enabled;
    setEnabled(newValue);

    startTransition(async () => {
      const result = await updateImageSearchConfigAction(newValue);
      if (result.success) {
        toast.success(
          newValue 
            ? "AI Image Searching has been enabled." 
            : "AI Image Searching has been disabled."
        );
      } else {
        // Rollback on failure
        setEnabled(enabled);
        toast.error(`Failed to update setting: ${result.error}`);
      }
    });
  };

  return (
    <Card className="border-primary/10 bg-card/40 backdrop-blur-md shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          AI Image Discovery Settings
        </CardTitle>
        <CardDescription>
          Toggle AI image searching when scanning and importing new products.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border border-primary/5">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg transition-colors ${enabled ? "bg-amber-500/10 text-amber-500" : "bg-muted text-muted-foreground"}`}>
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">AI Image Searching</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {enabled 
                  ? "System will search and download product images using Google Search Grounding." 
                  : "Image downloading is disabled during sitemap scans."}
              </p>
            </div>
          </div>

          <button
            onClick={handleToggle}
            disabled={isPending}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
              enabled ? "bg-primary" : "bg-muted-foreground/30"
            } ${isPending ? "opacity-50 pointer-events-none" : ""}`}
            type="button"
            aria-checked={enabled}
            role="switch"
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out flex items-center justify-center ${
                enabled ? "translate-x-5" : "translate-x-0"
              }`}
            >
              {isPending && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
            </span>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
