"use client";

import React from "react";
import { WixBrand } from "@/lib/services/wixCms";
import { SyncLogEntry, runDiscoveryAction, getDiscoveryLogsAction, stopDiscoveryAction } from "@/app/actions/discovery";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Play, 
  RefreshCw, 
  Terminal, 
  History, 
  Loader2, 
  AlertTriangle,
  Info,
  CheckCircle,
  FileText,
  StopCircle
} from "lucide-react";
import { toast } from "sonner";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from "@/components/ui/dialog";

interface ScannerConsoleProps {
  brands: WixBrand[];
  initialLogs: SyncLogEntry[];
}

export function ScannerConsole({ brands, initialLogs }: ScannerConsoleProps) {
  const [selectedBrandId, setSelectedBrandId] = React.useState<string>("all");
  const [isScanning, setIsScanning] = React.useState(false);
  const [isStopping, setIsStopping] = React.useState(false);
  const [scanLogs, setScanLogs] = React.useState<string[]>([]);
  const [historicalLogs, setHistoricalLogs] = React.useState<SyncLogEntry[]>(initialLogs);
  const [activeTab, setActiveTab] = React.useState<string>("console");

  const terminalEndRef = React.useRef<HTMLDivElement>(null);

  // Scroll terminal to bottom on new log entries
  React.useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [scanLogs]);

  const handleScan = async (isAll: boolean) => {
    setIsScanning(true);
    setActiveTab("console");
    
    const brandName = isAll ? "All Brands" : brands.find((b) => b._id === selectedBrandId)?.name || "Selected Brand";
    setScanLogs([
      `[SYSTEM] [${new Date().toLocaleTimeString()}] Requesting scan for ${brandName}...`,
      `[SYSTEM] Connecting to Wix CMS to load brand configurations...`,
    ]);

    toast.loading(`Scanning ${brandName}...`, { id: "scan-toast" });

    let pollInterval: NodeJS.Timeout | null = null;
    
    // Start polling status and logs from server in-memory storage every 800ms
    pollInterval = setInterval(async () => {
      try {
        const response = await fetch("/api/scan-status");
        if (response.ok) {
          const data = await response.json();
          if (data.logs && data.logs.length > 0) {
            setScanLogs([
              `[SYSTEM] [${new Date().toLocaleTimeString()}] Requesting scan for ${brandName}...`,
              `[SYSTEM] Connecting to Wix CMS to load brand configurations...`,
              ...data.logs
            ]);
          }
        }
      } catch (pollErr) {
        console.error("Error polling scan status:", pollErr);
      }
    }, 800);

    try {
      const res = await runDiscoveryAction(isAll ? undefined : selectedBrandId);
      
      if (res.success) {
        setScanLogs((prev) => [
          ...prev,
          ...res.logs,
          `[SYSTEM] [${new Date().toLocaleTimeString()}] Scan completed successfully. Found ${res.totalNew} new products.`,
        ]);
        toast.success(`Scan completed. Found ${res.totalNew} new products!`, { id: "scan-toast" });
      } else {
        setScanLogs((prev) => [
          ...prev,
          ...res.logs,
          `[SYSTEM] [ERROR] Scan failed. Check the logs above.`,
        ]);
        toast.error(`Scan failed: ${res.error || "Unknown error"}`, { id: "scan-toast" });
      }
    } catch (err) {
      setScanLogs((prev) => [
        ...prev,
        `[SYSTEM] [ERROR] Failed to run action: ${(err as Error).message}`,
      ]);
      toast.error(`Scan action error: ${(err as Error).message}`, { id: "scan-toast" });
    } finally {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      setIsScanning(false);
      setIsStopping(false);
      // Reload historical logs
      const updatedLogs = await getDiscoveryLogsAction();
      setHistoricalLogs(updatedLogs);
    }
  };

  const handleStopScan = async () => {
    setIsStopping(true);
    toast.loading("Đang yêu cầu dừng quét...", { id: "scan-toast" });
    try {
      const res = await stopDiscoveryAction();
      if (res.success) {
        toast.success("Đã gửi yêu cầu dừng quét. Hệ thống đang dừng...", { id: "scan-toast" });
      } else {
        toast.error(`Không thể dừng quét: ${res.error}`, { id: "scan-toast" });
        setIsStopping(false);
      }
    } catch (err) {
      toast.error(`Lỗi: ${(err as Error).message}`, { id: "scan-toast" });
      setIsStopping(false);
    }
  };

  const getLogLevelIcon = (level: string) => {
    switch (level) {
      case "ERROR":
        return <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />;
      case "WARNING":
        return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
      default:
        return <Info className="w-4 h-4 text-blue-500 shrink-0" />;
    }
  };

  const formatLogTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      
      {/* Controls Card */}
      <Card className="lg:col-span-1 border-primary/5 bg-card/30 backdrop-blur-md shadow-md h-fit">
        <CardHeader>
          <CardTitle>Scanner Controls</CardTitle>
          <CardDescription>
            Trigger product scans manually. The engine fetches brand sitemaps and checks for updates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          
          {/* Scan All */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Bulk Action</h3>
            <Button 
              className="w-full gap-2 shadow-lg shadow-primary/10" 
              onClick={() => handleScan(true)}
              disabled={isScanning}
            >
              {isScanning && selectedBrandId === "all" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Scan All Brands
            </Button>
          </div>

          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold">Single Brand Action</h3>
            
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Select Brand</label>
              <Select 
                value={selectedBrandId} 
                onValueChange={setSelectedBrandId}
                disabled={isScanning}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="Choose a brand" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" disabled>Select brand...</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b._id} value={b._id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button 
              variant="outline" 
              className="w-full gap-2"
              onClick={() => handleScan(false)}
              disabled={isScanning || selectedBrandId === "all"}
            >
              {isScanning && selectedBrandId !== "all" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4 text-primary" />
              )}
              Scan Selected Brand
            </Button>
          </div>

        </CardContent>
      </Card>

      {/* Console and History Logs Card */}
      <Card className="lg:col-span-2 border-primary/5 bg-card/25 backdrop-blur-md shadow-md flex flex-col h-[600px]">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle>Scanner Output</CardTitle>
              <CardDescription>Live execution logs and historical audit trail.</CardDescription>
            </div>
            
            <TabsList className="bg-muted/50 border">
              <TabsTrigger value="console" className="gap-1.5 text-xs">
                <Terminal className="w-3.5 h-3.5" />
                Console
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5 text-xs">
                <History className="w-3.5 h-3.5" />
                History Logs
              </TabsTrigger>
            </TabsList>
          </CardHeader>

          {/* Console Tab Content */}
          <TabsContent value="console" className="flex-1 p-6 pt-2 flex flex-col min-h-0">
            <div className="flex-1 bg-black/90 text-zinc-300 font-mono text-xs p-4 rounded-xl overflow-y-auto border border-zinc-800 shadow-inner space-y-1.5 custom-scrollbar">
              {scanLogs.length === 0 ? (
                <div className="text-zinc-500 italic h-full flex items-center justify-center">
                  Terminal ready. Choose a scan action to start.
                </div>
              ) : (
                scanLogs.map((log, idx) => {
                  let textClass = "text-zinc-300";
                  if (log.includes("[ERROR]")) textClass = "text-red-400 font-bold";
                  else if (log.includes("[SYSTEM]")) textClass = "text-blue-400 font-semibold";
                  else if (log.includes("Found") || log.includes("completed")) textClass = "text-green-400";
                  
                  return (
                    <div key={idx} className={textClass}>
                      {log}
                    </div>
                  );
                })
              )}
              <div ref={terminalEndRef} />
            </div>
          </TabsContent>

          {/* History Log Tab Content */}
          <TabsContent value="history" className="flex-1 p-6 pt-2 overflow-y-auto custom-scrollbar min-h-0">
            {historicalLogs.length === 0 ? (
              <div className="text-center text-muted-foreground italic py-20">
                No logs recorded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {historicalLogs.map((log, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-start gap-3 p-3 rounded-lg border border-primary/5 bg-background/40 hover:bg-muted/10 transition-all text-xs"
                  >
                    {getLogLevelIcon(log.level)}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center gap-2">
                        <span className="font-bold text-foreground">
                          {log.brand ? `[${log.brand}]` : "[SYSTEM]"}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {formatLogTime(log.timestamp)}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-1 leading-relaxed break-words">{log.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

        </Tabs>
      </Card>

      {/* Live Scan Status Dialog Popup */}
      <Dialog open={isScanning}>
        <DialogContent 
          className="max-w-md bg-card/95 border-primary/10 backdrop-blur-xl"
          showCloseButton={false}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center relative">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <div className="absolute inset-0 rounded-full border border-primary/20 animate-ping opacity-25" />
            </div>
            
            <div className="space-y-2">
              <DialogTitle className="text-xl font-bold tracking-tight">
                Đang quét & Tối ưu AI
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground leading-relaxed px-4" asChild>
                <div>
                  Hệ thống đang tiến hành chạy quy trình quét tự động từ:
                  <div className="flex items-center justify-center gap-1.5 mt-2 font-semibold text-primary">
                    <span>Sitemap</span>
                    <span>&rarr;</span>
                    <span>Playwright</span>
                    <span>&rarr;</span>
                    <span>Gemini AI</span>
                  </div>
                  <span className="block mt-2 font-medium text-xs text-amber-500">
                    Vui lòng chờ trong giây lát, không tắt trình duyệt...
                  </span>
                </div>
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">
              Trạng thái live:
            </span>
            <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 font-mono text-[11px] text-zinc-400 min-h-[120px] flex flex-col justify-end shadow-inner gap-1.5 overflow-hidden">
              {scanLogs.length === 0 ? (
                <div className="w-full break-words leading-relaxed text-zinc-500">
                  <span className="text-zinc-500 mr-2 font-bold">&gt;</span>
                  Đang khởi tạo tiến trình...
                </div>
              ) : (
                scanLogs.slice(-4).map((log, idx) => {
                  let textClass = "text-zinc-400";
                  if (log.includes("[ERROR]")) textClass = "text-red-400 font-bold";
                  else if (log.includes("[SYSTEM]")) textClass = "text-blue-400 font-semibold";
                  else if (log.includes("Found") || log.includes("completed")) textClass = "text-green-400";
                  
                  return (
                    <div key={idx} className={`w-full break-words leading-relaxed transition-all duration-300 ${textClass}`}>
                      <span className="text-zinc-500 mr-1.5 font-bold">&gt;</span>
                      {log}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              variant="destructive"
              className="w-full h-10 gap-2 font-semibold shadow-lg shadow-destructive/20 transition-all pointer-events-auto"
              onClick={handleStopScan}
              disabled={isStopping}
            >
              {isStopping ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang dừng...
                </>
              ) : (
                <>
                  <StopCircle className="w-4 h-4" />
                  Dừng Quét
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
