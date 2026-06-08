"use client";

import React from "react";
import { PendingProduct } from "@/app/actions/discovery";
import { approveProductAction, rejectProductAction, deleteProductAction, clearBlacklistAction, clearQueueAction } from "@/app/actions/approval";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Eye, 
  Check, 
  Ban, 
  Trash2, 
  Search, 
  FileText, 
  ExternalLink, 
  ImageOff,
  Loader2
} from "lucide-react";
import { toast } from "sonner";

interface DiscoveryQueueTableProps {
  initialProducts: PendingProduct[];
}

export function DiscoveryQueueTable({ initialProducts }: DiscoveryQueueTableProps) {
  const [products, setProducts] = React.useState<PendingProduct[]>(initialProducts);

  // Log pending discovery products to browser console for inspection
  React.useEffect(() => {
    console.log("[Discovery Queue] List of pending products (devices):", products);
  }, [products]);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedProduct, setSelectedProduct] = React.useState<PendingProduct | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = React.useState(false);
  const [processingId, setProcessingId] = React.useState<string | null>(null);

  // Clear Actions States
  const [isClearQueueConfirmOpen, setIsClearQueueConfirmOpen] = React.useState(false);
  const [isClearBlacklistConfirmOpen, setIsClearBlacklistConfirmOpen] = React.useState(false);
  const [isClearingQueue, setIsClearingQueue] = React.useState(false);
  const [isClearingBlacklist, setIsClearingBlacklist] = React.useState(false);

  const handleClearQueue = async () => {
    setIsClearingQueue(true);
    const res = await clearQueueAction();
    setIsClearingQueue(false);
    setIsClearQueueConfirmOpen(false);
    if (res.success) {
      toast.success("Successfully cleared all pending products from queue!");
      setProducts([]);
    } else {
      toast.error(res.error || "Failed to clear queue.");
    }
  };

  const handleClearBlacklist = async () => {
    setIsClearingBlacklist(true);
    const res = await clearBlacklistAction();
    setIsClearingBlacklist(false);
    setIsClearBlacklistConfirmOpen(false);
    if (res.success) {
      toast.success("Successfully cleared all products from blacklist!");
    } else {
      toast.error(res.error || "Failed to clear blacklist.");
    }
  };

  // Filters
  const filteredProducts = React.useMemo(() => {
    return products.filter((p) => {
      const brand = (p.brandName || p.Brand || "").toLowerCase();
      const product = (p.Product || "").toLowerCase();
      const category = (p.Category || "").toLowerCase();
      const title = (p.Title || "").toLowerCase();
      const query = searchQuery.toLowerCase();

      return brand.includes(query) || product.includes(query) || category.includes(query) || title.includes(query);
    });
  }, [products, searchQuery]);

  const getProductKey = (p: PendingProduct) => {
    return `${p.Brand}-${p.Product}-${p.Title}`;
  };

  const handleAction = async (
    product: PendingProduct, 
    action: "approve" | "reject" | "delete"
  ) => {
    const key = getProductKey(product);
    setProcessingId(`${key}-${action}`);

    let res;
    if (action === "approve") {
      res = await approveProductAction(product, product.rowIndex);
    } else if (action === "reject") {
      res = await rejectProductAction(product, product.rowIndex);
    } else {
      res = await deleteProductAction(product, product.rowIndex);
    }

    setProcessingId(null);

    if (res.success) {
      toast.success(
        action === "approve" 
          ? `Synced ${product.Product} to Wix CMS!`
          : action === "reject"
          ? `Moved ${product.Product} to blacklist.`
          : `Removed ${product.Product} from queue.`
      );
      // Remove from local state
      setProducts((prev) => prev.filter((p) => getProductKey(p) !== key));
      if (selectedProduct && getProductKey(selectedProduct) === key) {
        setIsDetailsOpen(false);
      }
    } else {
      toast.error(res.error || "Action failed. Please try again.");
    }
  };

  const parseSpecs = (specsStr: string) => {
    try {
      const parsed = JSON.parse(specsStr);
      if (Array.isArray(parsed)) return parsed as Array<{ label: string; value: string }>;
      if (typeof parsed === "object") {
        return Object.entries(parsed).map(([label, value]) => ({ label, value: String(value) }));
      }
      return [];
    } catch {
      return [];
    }
  };

  return (
    <div className="space-y-6">
      {/* Search & Stats Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-card/30 backdrop-blur-md p-4 rounded-xl border border-primary/5">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search brand, category, product..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-background/50 focus-visible:ring-primary/20"
          />
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto sm:justify-end">
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            <span>Showing <strong>{filteredProducts.length}</strong> of <strong>{products.length}</strong> pending products</span>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsClearQueueConfirmOpen(true)}
              className="text-red-500 hover:text-red-600 hover:bg-red-500/10 border-red-500/20 text-xs w-full sm:w-auto"
              disabled={products.length === 0}
            >
              Clear Queue
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsClearBlacklistConfirmOpen(true)}
              className="text-slate-500 hover:text-slate-600 hover:bg-slate-500/10 border-slate-500/20 text-xs w-full sm:w-auto"
            >
              Clear Blacklist
            </Button>
          </div>
        </div>
      </div>

      {/* Main Queue Table */}
      <div className="border border-primary/5 rounded-xl bg-card/25 backdrop-blur-md overflow-hidden shadow-md">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Brand</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Category</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Product</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Title</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Series</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-40 text-center text-muted-foreground italic">
                  No products pending in discovery queue.
                </TableCell>
              </TableRow>
            ) : (
              filteredProducts.map((p) => {
                const key = getProductKey(p);
                return (
                  <TableRow key={key} className="hover:bg-muted/20 transition-all duration-200">
                    <TableCell className="font-bold text-primary/90">{p.brandName || p.Brand}</TableCell>
                    <TableCell className="max-w-[120px] truncate text-muted-foreground">{p.Category}</TableCell>
                    <TableCell className="font-semibold">{p.Product}</TableCell>
                    <TableCell className="max-w-[200px] truncate" title={p.Title}>{p.Title}</TableCell>
                    <TableCell className="text-muted-foreground">{p.Series || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px] font-bold uppercase tracking-wider">
                        Product_New
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* View Action */}
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => {
                            setSelectedProduct(p);
                            setIsDetailsOpen(true);
                          }}
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        
                        {/* Approve Action */}
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleAction(p, "approve")}
                          disabled={processingId !== null}
                          className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-500/10"
                          title="Approve & Sync"
                        >
                          {processingId === `${key}-approve` ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                        </Button>

                        {/* Reject Action */}
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleAction(p, "reject")}
                          disabled={processingId !== null}
                          className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-500/10"
                          title="Reject & Blacklist"
                        >
                          {processingId === `${key}-reject` ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Ban className="w-4 h-4" />
                          )}
                        </Button>

                        {/* Delete Action */}
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleAction(p, "delete")}
                          disabled={processingId !== null}
                          className="h-8 w-8 text-slate-500 hover:text-slate-700 hover:bg-slate-500/10"
                          title="Delete Row"
                        >
                          {processingId === `${key}-delete` ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto custom-scrollbar bg-card/95 border-primary/10 backdrop-blur-xl">
          {selectedProduct && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-primary/20 text-primary font-bold">
                    {selectedProduct.brandName}
                  </Badge>
                  <Badge variant="secondary" className="text-muted-foreground">
                    {selectedProduct.Category}
                  </Badge>
                </div>
                <DialogTitle className="text-2xl font-bold mt-2">{selectedProduct.Product}</DialogTitle>
                <DialogDescription className="font-semibold text-foreground/80 mt-1">
                  {selectedProduct.Title}
                </DialogDescription>
              </DialogHeader>

              {/* Main Dialog Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 border-t pt-4">
                
                {/* Left Column: Image, Series, Datasheet */}
                <div className="space-y-4">
                  {/* Image Container */}
                  <div className="relative aspect-video rounded-xl bg-muted/40 border border-primary/5 flex items-center justify-center overflow-hidden">
                    {selectedProduct.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img 
                        src={selectedProduct.image} 
                        alt={selectedProduct.Product}
                        className="object-contain w-full h-full max-h-[220px]"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <ImageOff className="w-8 h-8 opacity-40" />
                        <span className="text-xs">No image available</span>
                      </div>
                    )}
                  </div>

                  {/* Metadata Fields */}
                  <div className="grid grid-cols-2 gap-4 text-sm bg-muted/20 p-4 rounded-xl">
                    <div>
                      <span className="text-xs text-muted-foreground block">Series</span>
                      <strong className="font-medium text-foreground">{selectedProduct.Series || "—"}</strong>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Main Feature</span>
                      <strong className="font-medium text-foreground">{selectedProduct.MainFeature || "—"}</strong>
                    </div>
                  </div>

                  {/* Links */}
                  <div className="space-y-2">
                    {selectedProduct.productItem && (
                      <a 
                        href={selectedProduct.productItem} 
                        target="_blank" 
                        rel="noreferrer"
                        className="flex items-center justify-between text-xs text-primary hover:underline bg-primary/5 p-3 rounded-lg border border-primary/10"
                      >
                        <span className="font-medium">Original Product URL</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {selectedProduct.Datasheet && (
                      <a 
                        href={selectedProduct.Datasheet} 
                        target="_blank" 
                        rel="noreferrer"
                        className="flex items-center justify-between text-xs text-green-600 hover:underline bg-green-500/5 p-3 rounded-lg border border-green-500/10"
                      >
                        <span className="font-medium flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5" />
                          View Technical Datasheet
                        </span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Right Column: Overview and Technical Specs */}
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                      Product Overview
                    </h3>
                    <p className="text-sm text-foreground/80 leading-relaxed bg-muted/10 p-3 rounded-lg">
                      {selectedProduct.ProductOverview || "No overview description available."}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                      Technical Specifications
                    </h3>
                    <div className="max-h-[220px] overflow-y-auto custom-scrollbar border rounded-lg bg-card text-xs">
                      {parseSpecs(selectedProduct.TechnicalSpecifications).length === 0 ? (
                        <div className="p-3 text-center text-muted-foreground italic">
                          No specification attributes found.
                        </div>
                      ) : (
                        <div className="divide-y">
                          {parseSpecs(selectedProduct.TechnicalSpecifications).map((spec, i) => (
                            <div key={i} className="flex justify-between p-2.5 hover:bg-muted/10">
                              <span className="font-semibold text-muted-foreground w-1/3 pr-2 truncate" title={spec.label}>
                                {spec.label}
                              </span>
                              <span className="text-foreground w-2/3 truncate" title={spec.value}>
                                {spec.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>

              {/* Dialog Footer Actions */}
              <DialogFooter className="mt-6 border-t pt-4 flex flex-row items-center justify-between sm:justify-end gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setIsDetailsOpen(false)}
                  className="sm:mr-auto"
                >
                  Close
                </Button>
                
                <div className="flex gap-2">
                  <Button 
                    variant="destructive"
                    onClick={() => handleAction(selectedProduct, "reject")}
                    disabled={processingId !== null}
                    className="gap-1.5"
                  >
                    {processingId === `${getProductKey(selectedProduct)}-reject` ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Ban className="w-4 h-4" />
                    )}
                    Reject
                  </Button>
                  <Button 
                    variant="default"
                    onClick={() => handleAction(selectedProduct, "approve")}
                    disabled={processingId !== null}
                    className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                  >
                    {processingId === `${getProductKey(selectedProduct)}-approve` ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Approve & Sync
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Clear Queue Confirmation Dialog */}
      <Dialog open={isClearQueueConfirmOpen} onOpenChange={setIsClearQueueConfirmOpen}>
        <DialogContent className="max-w-md bg-card/95 border-primary/10 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-red-500 flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              Clear Pending Queue?
            </DialogTitle>
            <DialogDescription className="mt-2 text-foreground/80">
              Are you sure you want to clear **all** pending products in the approval queue? This will permanently delete all rows from the `Product_New` Google Sheet. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setIsClearQueueConfirmOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleClearQueue} 
              disabled={isClearingQueue}
              className="gap-1.5"
            >
              {isClearingQueue ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Yes, Clear Queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Blacklist Confirmation Dialog */}
      <Dialog open={isClearBlacklistConfirmOpen} onOpenChange={setIsClearBlacklistConfirmOpen}>
        <DialogContent className="max-w-md bg-card/95 border-primary/10 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Ban className="w-5 h-5" />
              Clear Product Blacklist?
            </DialogTitle>
            <DialogDescription className="mt-2 text-foreground/80">
              Are you sure you want to clear **all** products in the blacklist? This will permanently delete all rows from the `Product_Delete` Google Sheet. 
              <br />
              <span className="text-amber-600 dark:text-amber-400 font-semibold text-xs mt-2 block">
                Note: This means the next product discovery scan might re-detect and queue previously rejected products again.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setIsClearBlacklistConfirmOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleClearBlacklist} 
              disabled={isClearingBlacklist}
              className="gap-1.5 bg-slate-700 hover:bg-slate-800 text-white"
            >
              {isClearingBlacklist ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Yes, Clear Blacklist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
