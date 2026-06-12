"use client";

import React, { useEffect, useState, useRef } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { 
  startImageDiscoveryAction, 
  getImageDiscoveryStatusAction, 
  resetImageDiscoveryAction,
  stopImageDiscoveryAction 
} from "@/app/actions/imageDiscovery";
import { getDashboardStatsAction } from "@/app/actions/discovery";
import { ImageSearchToggle } from "@/components/data/ImageSearchToggle";
import { 
  Play, 
  RotateCcw, 
  Loader2, 
  Sparkles, 
  FileText, 
  ImageIcon, 
  CheckCircle2, 
  AlertCircle,
  StopCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function ImageDiscoveryPage() {
  const [inProgress, setInProgress] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [isImageSearchEnabled, setIsImageSearchEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial settings and status
  useEffect(() => {
    async function init() {
      try {
        const stats = await getDashboardStatsAction();
        setIsImageSearchEnabled(!!stats.isImageSearchEnabled);

        const status = await getImageDiscoveryStatusAction();
        setInProgress(status.inProgress);
        setLogs(status.logs);
      } catch (err) {
        console.error("Failed to load initial discovery settings:", err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Poll status when inProgress is true
  useEffect(() => {
    if (inProgress) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const status = await getImageDiscoveryStatusAction();
          setLogs(status.logs);
          setInProgress(status.inProgress);

          if (!status.inProgress) {
            toast.success("AI Image Discovery job finished!");
            setIsStopping(false);
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          }
        } catch (err) {
          console.error("Failed to poll discovery status:", err);
        }
      }, 1500);
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsStopping(false);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [inProgress]);

  // Scroll to bottom of logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleStart = async () => {
    if (!isImageSearchEnabled) {
      toast.error("Please enable 'AI Image Searching' in settings first.");
      return;
    }

    setInProgress(true);
    setLogs(["[SYSTEM] Starting AI Image Discovery job..."]);

    try {
      const result = await startImageDiscoveryAction();
      if (result.success) {
        toast.success("AI Image Discovery has started in the background.");
      } else {
        setInProgress(false);
        toast.error(result.error || "Failed to start AI Image Discovery.");
      }
    } catch (err: any) {
      setInProgress(false);
      toast.error(`Error starting scan: ${err.message || err}`);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    toast.loading("Đang yêu cầu dừng tìm kiếm...", { id: "stop-image-toast" });
    try {
      const result = await stopImageDiscoveryAction();
      if (result.success) {
        toast.success("Đã yêu cầu dừng tìm kiếm hình ảnh. Hệ thống đang dừng...", { id: "stop-image-toast" });
      } else {
        toast.error(result.error || "Không thể dừng tìm kiếm.", { id: "stop-image-toast" });
        setIsStopping(false);
      }
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message || err}`, { id: "stop-image-toast" });
      setIsStopping(false);
    }
  };

  const handleReset = async () => {
    if (confirm("Are you sure you want to force reset the scanner status? Use this only if the scanner gets stuck.")) {
      try {
        await resetImageDiscoveryAction();
        setInProgress(false);
        setIsStopping(false);
        toast.success("Scanner status has been reset.");
      } catch (err: any) {
        toast.error(`Failed to reset: ${err.message}`);
      }
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-5xl">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent flex items-center gap-2">
            <Sparkles className="w-8 h-8 text-primary animate-pulse" />
            AI Image Discovery
          </h1>
          <p className="text-muted-foreground mt-1">
            Automatically search manufacturer websites for missing product images and upload them directly to Wix Media Manager.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Settings / Controls Card */}
          <div className="md:col-span-1 space-y-6">
            {/* Toggle switch component */}
            {!loading && (
              <ImageSearchToggle 
                initialEnabled={isImageSearchEnabled} 
              />
            )}

            {/* Run Discovery Controller */}
            <Card className="border-primary/10 bg-card/40 backdrop-blur-md shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Play className="w-4 h-4 text-primary" />
                  Control Panel
                </CardTitle>
                <CardDescription>
                  Start or stop the scanner. The scanner runs asynchronously in the background.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  onClick={handleStart}
                  disabled={inProgress || loading}
                  className="w-full gap-2 h-11 text-base font-semibold shadow-lg shadow-primary/20 transition-all"
                >
                  {inProgress ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Scanning Products...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-current" />
                      Start Image Search
                    </>
                  )}
                </Button>

                {inProgress && (
                  <div className="flex flex-col gap-2 w-full">
                    <Button
                      variant="destructive"
                      onClick={handleStop}
                      disabled={isStopping || loading}
                      className="w-full gap-2 h-10 font-semibold shadow-lg shadow-destructive/20 transition-all"
                    >
                      {isStopping ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Đang dừng...
                        </>
                      ) : (
                        <>
                          <StopCircle className="w-4 h-4" />
                          Dừng tìm kiếm ảnh
                        </>
                      )}
                    </Button>
                    
                    <Button
                      variant="outline"
                      onClick={handleReset}
                      disabled={isStopping || loading}
                      className="w-full gap-2 text-muted-foreground border-muted-foreground/20 hover:bg-muted/10"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Khôi phục trạng thái (Reset)
                    </Button>
                  </div>
                )}

                <div className="p-3.5 bg-muted/40 rounded-xl border border-primary/5 text-xs text-muted-foreground space-y-2">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    How it works
                  </div>
                  <p>1. Scans Wix CMS for products without images.</p>
                  <p>2. Uses brand domain mappings to target manufacturer sites.</p>
                  <p>3. Runs Gemini Search Grounding as an AI fallback.</p>
                  <p>4. Validates and downloads 1 high-resolution product image.</p>
                  <p>5. Uploads directly to Wix Media Manager and links to CMS.</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Progress / Logs Card */}
          <div className="md:col-span-2">
            <Card className="border-primary/10 bg-card/40 backdrop-blur-md shadow-sm h-full flex flex-col">
              <CardHeader className="pb-3 border-b border-primary/5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  Console output logs
                </CardTitle>
                <CardDescription>
                  Real-time logs showing crawler activities and download completions.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 p-0 flex flex-col min-h-[400px]">
                <div className="flex-1 bg-black/95 text-green-400 font-mono text-xs p-6 overflow-y-auto max-h-[500px] custom-scrollbar rounded-b-xl space-y-1">
                  {logs.length === 0 ? (
                    <div className="text-muted-foreground italic flex items-center gap-2 justify-center h-full py-20">
                      <AlertCircle className="w-4 h-4" />
                      No logs recorded. Start search to see activity.
                    </div>
                  ) : (
                    logs.map((log, index) => {
                      let color = "text-green-400";
                      if (log.includes("[ERROR]")) color = "text-red-400 font-semibold";
                      if (log.includes("[WARN]")) color = "text-yellow-400 font-semibold";
                      if (log.includes("[SYSTEM]")) color = "text-blue-400 font-semibold";
                      
                      return (
                        <div key={index} className={color}>
                          {log}
                        </div>
                      );
                    })
                  )}
                  <div ref={logEndRef} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
