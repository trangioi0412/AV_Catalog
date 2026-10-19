"use client";

/**
 * /admin/image-discovery
 * ─────────────────────────────────────────────────────────────────────────────
 * "Tra cứu sản phẩm bằng AI" — admin types in a brand name (any AV brand,
 * does not need to already exist in Wix CMS's Brand collection) and this
 * calls runBrandDiscoveryAction, which uses Gemini Search Grounding
 * (discoverProductsWithGeminiAgent) to find that brand's professional AV
 * products on the open web, enriches each new one, and appends it to the
 * same Discovery Queue (/admin/discovery) a scheduled per-brand scan uses —
 * so results go through the existing review/approve flow.
 *
 * Replaces this page's previous purpose (scanning existing CMS products for
 * MISSING IMAGES via imageDiscoveryService.ts) per an explicit request to
 * repurpose it into a brand product lookup tool instead. The old image-scan
 * action/service files are left in place (imageDiscoveryService.ts,
 * app/actions/imageDiscovery.ts) since nothing else references them, but
 * they're no longer wired to any page — only the ImageSearchToggle it also
 * used still appears on /admin/dashboard.
 *
 * Reuses discoveryEngine.ts's shared scan state (activeScanLogs /
 * isScanInProgress, the same module runProductDiscovery already uses) via
 * the existing /api/scan-status polling route and stopDiscoveryAction — the
 * established pattern in ScannerConsole.tsx — rather than building a
 * parallel status-tracking mechanism.
 */

import React from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { runBrandDiscoveryAction, getDiscoveryLogsAction, stopDiscoveryAction, SyncLogEntry } from "@/app/actions/discovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Search,
  Loader2,
  Sparkles,
  Terminal,
  History,
  StopCircle,
  AlertTriangle,
  Info,
  CheckCircle,
  Link as LinkIcon,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import Link from "next/link";
import { Lock } from "lucide-react";

// Temporarily disabled in favor of the new DataCrawler manufacturer-sync
// page (/admin/manufacturer-sync) taking this slot in the sidebar. Flip
// back to false (and remove `locked: true` on this route in
// DashboardLayout.tsx's navDiscovery) to re-enable.
const FEATURE_LOCKED = true;

export default function BrandDiscoveryPage() {
  const [brandName, setBrandName] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [provider, setProvider] = React.useState<"gemini" | "ollama">("gemini");
  const [skipDedup, setSkipDedup] = React.useState(false);
  const [isScanning, setIsScanning] = React.useState(false);
  const [isStopping, setIsStopping] = React.useState(false);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [historicalLogs, setHistoricalLogs] = React.useState<SyncLogEntry[]>([]);
  const [activeTab, setActiveTab] = React.useState("console");
  const [lastResult, setLastResult] = React.useState<{ totalNew: number; totalScanned: number; brandMatched: boolean } | null>(null);

  const terminalEndRef = React.useRef<HTMLDivElement>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    if (FEATURE_LOCKED) return;
    getDiscoveryLogsAction().then(setHistoricalLogs).catch(() => {});
  }, []);

  React.useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleSearch = async () => {
    const trimmed = brandName.trim();
    if (!trimmed) {
      toast.error("Nhập tên hãng cần tra cứu.");
      return;
    }

    setIsScanning(true);
    setActiveTab("console");
    setLastResult(null);
    setLogs([`[SYSTEM] Đang gửi yêu cầu tra cứu sản phẩm cho hãng "${trimmed}"...`]);
    toast.loading(`Đang tra cứu sản phẩm của "${trimmed}"...`, { id: "brand-discovery-toast" });

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/scan-status");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.logs) && data.logs.length > 0) {
            setLogs([`[SYSTEM] Đang gửi yêu cầu tra cứu sản phẩm cho hãng "${trimmed}"...`, ...data.logs]);
          }
        }
      } catch (err) {
        console.error("Error polling scan status:", err);
      }
    }, 800);

    try {
      const res = await runBrandDiscoveryAction(trimmed, keyword.trim() || undefined, provider, skipDedup);
      if (res.success) {
        setLogs((prev) => [...prev, ...res.logs, `[SYSTEM] Hoàn tất. Tìm được ${res.totalNew} sản phẩm mới.`]);
        setLastResult({ totalNew: res.totalNew ?? 0, totalScanned: res.totalScanned ?? 0, brandMatched: Boolean(res.brandMatched) });
        if ((res.totalNew ?? 0) > 0) {
          toast.success(`Tìm được ${res.totalNew} sản phẩm mới cho "${trimmed}".`, { id: "brand-discovery-toast" });
        } else {
          toast.info(`Không tìm thấy sản phẩm mới nào cho "${trimmed}" (có thể đã có trong catalog).`, { id: "brand-discovery-toast" });
        }
      } else {
        setLogs((prev) => [...prev, ...res.logs, "[SYSTEM] [ERROR] Tra cứu thất bại — xem log phía trên."]);
        toast.error(`Tra cứu thất bại: ${res.error || "Lỗi không xác định"}`, { id: "brand-discovery-toast" });
      }
    } catch (err) {
      setLogs((prev) => [...prev, `[SYSTEM] [ERROR] ${err instanceof Error ? err.message : String(err)}`]);
      toast.error(`Lỗi: ${err instanceof Error ? err.message : String(err)}`, { id: "brand-discovery-toast" });
    } finally {
      if (pollRef.current) clearInterval(pollRef.current);
      setIsScanning(false);
      setIsStopping(false);
      getDiscoveryLogsAction().then(setHistoricalLogs).catch(() => {});
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    toast.loading("Đang yêu cầu dừng tra cứu...", { id: "brand-discovery-stop" });
    try {
      const res = await stopDiscoveryAction();
      if (res.success) {
        toast.success("Đã gửi yêu cầu dừng. Hệ thống đang dừng...", { id: "brand-discovery-stop" });
      } else {
        toast.error(res.error || "Không thể dừng tra cứu.", { id: "brand-discovery-stop" });
        setIsStopping(false);
      }
    } catch (err) {
      toast.error(`Lỗi: ${err instanceof Error ? err.message : String(err)}`, { id: "brand-discovery-stop" });
      setIsStopping(false);
    }
  };

  const formatLogTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  if (FEATURE_LOCKED) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center">
            <Lock className="w-6 h-6 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-semibold">Tính năng đang tạm khóa</h1>
          <p className="text-sm text-muted-foreground">
            &quot;Tra Cứu Sản Phẩm Bằng AI&quot; đang được tạm khóa để nhường chỗ cho tính năng Đồng Bộ Dữ Liệu
            Nhà Sản Xuất (DataCrawler) đang được phát triển. Chức năng này sẽ được mở lại sau.
          </p>
          <Link
            href="/admin/manufacturer-sync"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Đi tới Đồng Bộ NSX (DataCrawler)
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-6xl">
        <PageHeader
          title="Tra Cứu Sản Phẩm Bằng AI"
          description="Nhập tên một hãng AV (không cần đã có trong hệ thống) — AI sẽ tra cứu trên mạng để tìm toàn bộ sản phẩm chuyên dụng AV của hãng đó và đưa vào Discovery Queue để duyệt."
          icon={<Sparkles className="w-5 h-5" />}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Search Controls */}
          <Card className="lg:col-span-1 border-primary/10 bg-card/40 backdrop-blur-md shadow-sm h-fit">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Search className="w-4 h-4 text-primary" />
                Tra cứu theo hãng
              </CardTitle>
              <CardDescription>AI dùng Gemini Search Grounding để tìm sản phẩm thật của hãng trên mạng.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Tên hãng *</label>
                <Input
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="Ví dụ: Shure, Biamp, BZBGEAR..."
                  disabled={isScanning}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isScanning) handleSearch();
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Từ khoá thêm (tuỳ chọn)</label>
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Ví dụ: camera hội nghị, DSP..."
                  disabled={isScanning}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isScanning) handleSearch();
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Nguồn AI tra cứu</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setProvider("gemini")}
                    disabled={isScanning}
                    className={`text-xs px-2 py-2 rounded-md border transition-colors ${
                      provider === "gemini" ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border/60 text-muted-foreground hover:bg-muted/30"
                    }`}
                  >
                    Gemini
                  </button>
                  <button
                    type="button"
                    onClick={() => setProvider("ollama")}
                    disabled={isScanning}
                    className={`text-xs px-2 py-2 rounded-md border transition-colors ${
                      provider === "ollama" ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border/60 text-muted-foreground hover:bg-muted/30"
                    }`}
                  >
                    Ollama qwen3.5:9b
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {provider === "gemini"
                    ? "Google Search Grounding thật — đáng tin cậy hơn cho việc tìm sản phẩm hoàn toàn mới."
                    : "Miễn phí, tự lưu trữ — tra cứu qua DuckDuckGo rồi để Ollama tổng hợp. Có thể bỏ sót sản phẩm so với Gemini."}
                </p>
              </div>

              <label className="flex items-start gap-2 text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/20 rounded-md p-2">
                <Checkbox checked={skipDedup} onCheckedChange={(v) => setSkipDedup(Boolean(v))} disabled={isScanning} className="mt-0.5" />
                <span>
                  <span className="font-medium text-amber-600">Tạm tắt kiểm tra sản phẩm đã có</span> — bỏ qua bước lọc trùng lặp, dùng để kiểm tra xem AI có thật sự không tìm được sản phẩm nào, hay do bị lọc hết vì tưởng đã có. Bật lên có thể đưa sản phẩm đã tồn tại vào Discovery Queue lần nữa.
                </span>
              </label>

              <Button onClick={handleSearch} disabled={isScanning} className="w-full gap-2 h-11 font-semibold shadow-lg shadow-primary/20">
                {isScanning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang tra cứu...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Tra cứu sản phẩm
                  </>
                )}
              </Button>

              {isScanning && (
                <Button variant="destructive" onClick={handleStop} disabled={isStopping} className="w-full gap-2">
                  {isStopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <StopCircle className="w-4 h-4" />}
                  {isStopping ? "Đang dừng..." : "Dừng tra cứu"}
                </Button>
              )}

              {lastResult && (
                <div className="p-3 rounded-lg border border-primary/10 bg-muted/30 text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    Tìm được {lastResult.totalScanned} sản phẩm, {lastResult.totalNew} sản phẩm mới.
                  </div>
                  {!lastResult.brandMatched && lastResult.totalNew > 0 && (
                    <div className="flex items-start gap-1.5 text-amber-600">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Hãng này chưa có trong Brand collection trên CMS — cần thêm hãng trước khi duyệt các sản phẩm này.</span>
                    </div>
                  )}
                  {lastResult.totalNew > 0 && (
                    <Link href="/admin/discovery" className="flex items-center gap-1.5 text-primary hover:underline">
                      <LinkIcon className="w-3.5 h-3.5" />
                      Xem trong Discovery Queue
                    </Link>
                  )}
                </div>
              )}

              <div className="p-3.5 bg-muted/40 rounded-xl border border-primary/5 text-xs text-muted-foreground space-y-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Info className="w-3.5 h-3.5 text-primary shrink-0" />
                  Cách hoạt động
                </div>
                <p>1. AI tra cứu Google Search để tìm các model sản phẩm AV chuyên dụng thật của hãng.</p>
                <p>2. Với mỗi sản phẩm mới, AI tra cứu tiếp để bổ sung Category, Series, tính năng, thông số, ảnh, datasheet.</p>
                <p>3. Sản phẩm mới được thêm vào Discovery Queue để admin duyệt trước khi đồng bộ lên CMS.</p>
              </div>
            </CardContent>
          </Card>

          {/* Console / History */}
          <div className="lg:col-span-2">
            <Card className="border-primary/10 bg-card/40 backdrop-blur-md shadow-sm h-full flex flex-col">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                <CardHeader className="pb-2 flex flex-row items-center justify-between border-b border-primary/5">
                  <div>
                    <CardTitle className="text-sm font-semibold">Kết quả tra cứu</CardTitle>
                    <CardDescription>Log thời gian thực và lịch sử các lần tra cứu.</CardDescription>
                  </div>
                  <TabsList className="bg-muted/50 border">
                    <TabsTrigger value="console" className="gap-1.5 text-xs">
                      <Terminal className="w-3.5 h-3.5" />
                      Console
                    </TabsTrigger>
                    <TabsTrigger value="history" className="gap-1.5 text-xs">
                      <History className="w-3.5 h-3.5" />
                      Lịch sử
                    </TabsTrigger>
                  </TabsList>
                </CardHeader>

                <TabsContent value="console" className="flex-1 p-4 pt-3 flex flex-col min-h-[400px]">
                  <div className="flex-1 bg-black/95 text-green-400 font-mono text-xs p-4 overflow-y-auto max-h-[500px] custom-scrollbar rounded-xl space-y-1">
                    {logs.length === 0 ? (
                      <div className="text-muted-foreground italic flex items-center gap-2 justify-center h-full py-20">
                        <AlertTriangle className="w-4 h-4" />
                        Chưa có log — nhập tên hãng và bắt đầu tra cứu.
                      </div>
                    ) : (
                      logs.map((log, index) => {
                        let color = "text-green-400";
                        if (log.includes("[ERROR]")) color = "text-red-400 font-semibold";
                        else if (log.includes("[WARN]")) color = "text-yellow-400 font-semibold";
                        else if (log.includes("[SYSTEM]")) color = "text-primary font-semibold";
                        return (
                          <div key={index} className={color}>
                            {log}
                          </div>
                        );
                      })
                    )}
                    <div ref={terminalEndRef} />
                  </div>
                </TabsContent>

                <TabsContent value="history" className="flex-1 p-4 pt-3 overflow-y-auto custom-scrollbar min-h-[400px]">
                  {historicalLogs.length === 0 ? (
                    <div className="text-center text-muted-foreground italic py-20">Chưa có lịch sử.</div>
                  ) : (
                    <div className="space-y-3">
                      {historicalLogs.map((log, idx) => (
                        <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border border-primary/5 bg-background/40 text-xs">
                          {log.level === "ERROR" ? (
                            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                          ) : log.level === "WARNING" ? (
                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                          ) : (
                            <Info className="w-4 h-4 text-primary shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center gap-2">
                              <span className="font-bold text-foreground">{log.brand ? `[${log.brand}]` : "[SYSTEM]"}</span>
                              <span className="text-xs text-muted-foreground font-mono">{formatLogTime(log.timestamp)}</span>
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
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
