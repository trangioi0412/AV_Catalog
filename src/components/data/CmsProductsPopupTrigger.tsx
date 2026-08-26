"use client";

import React, { useState, useMemo, useEffect, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WixProduct, WixBrand, isValidProductImageFormat } from "@/lib/services/wixCms";
import { transformWixImageUrl } from "@/lib/utils";
import { 
  X, 
  Search, 
  Eye, 
  ExternalLink, 
  ChevronLeft, 
  ChevronRight, 
  Building2, 
  FileText,
  ListFilter,
  ChevronDown,
  Copy,
  Check,
  Info,
  Layers,
  Image as ImageIcon,
  Sparkles,
  Filter,
  Trash2,
  AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download } from "lucide-react";
import {
  clearCmsDocumentFieldsAction,
} from "@/app/actions/cmsProduct";
import {
  getProductDocumentEntries,
  hasProductDocument,
  type DocumentEntry,
} from "@/lib/utils/documentFields";

interface CmsProductsPopupTriggerProps {
  products: WixProduct[];
  brands: WixBrand[];
  showOnlyNoImages?: boolean;
  showOnlyWithImages?: boolean;
  showOnlyNoDocuments?: boolean;
  showOnlyWithDocuments?: boolean;
  triggerLabel?: string;
}

export function CmsProductsPopupTrigger({ 
  products, 
  brands, 
  showOnlyNoImages = false, 
  showOnlyWithImages = false,
  showOnlyNoDocuments = false,
  showOnlyWithDocuments = false,
  triggerLabel 
}: CmsProductsPopupTriggerProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<WixProduct | null>(null);

  // States for detailed view
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRawMetaExpanded, setIsRawMetaExpanded] = useState(false);
  const [rawSearchQuery, setRawSearchQuery] = useState("");

  // ── Document deletion states ─────────────────────────────────────────────
  /** IDs of products that have been selected via checkbox for document clearing */
  const [checkedProductIds, setCheckedProductIds] = useState<Set<string>>(new Set());
  /** Confirm modal: null = closed, else the products to delete docs from */
  const [deleteConfirmProducts, setDeleteConfirmProducts] = useState<WixProduct[] | null>(null);
  /** Track which product IDs are currently being processed */
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  // ── Document deletion handlers ──────────────────────────────────────────

  /** Toggle checkbox for a single product in the list view */
  const handleToggleCheck = (id: string) => {
    setCheckedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** Select / deselect all products on the current page */
  const handleToggleAllOnPage = () => {
    const pageIds = paginatedProducts.map((p) => p._id!).filter(Boolean);
    const allChecked = pageIds.every((id) => checkedProductIds.has(id));
    setCheckedProductIds((prev) => {
      const next = new Set(prev);
      if (allChecked) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  /** Select batch of 100, 200, 300, or ALL items from filtered list */
  const handleSelectBatch = (count: number) => {
    const batch = filteredProducts.slice(0, count);
    const newSet = new Set<string>();
    batch.forEach((p) => {
      if (p._id) newSet.add(p._id);
    });
    setCheckedProductIds(newSet);
    toast.info(`Đã chọn nhanh ${newSet.size} sản phẩm trong danh sách.`);
  };

  /**
   * Execute the document-field clearing for ALL confirmed products in fast parallel batches.
   */
  const handleConfirmDeleteDocuments = () => {
    if (!deleteConfirmProducts || deleteConfirmProducts.length === 0) return;

    startTransition(async () => {
      const processing = deleteConfirmProducts;
      setDeleteConfirmProducts(null);

      const processingIds = new Set(processing.map((p) => p._id!).filter(Boolean));
      setDeletingIds((prev) => new Set([...prev, ...processingIds]));

      let successCount = 0;
      let failCount = 0;

      // Process in parallel chunks of 15 items for high performance
      const BATCH_SIZE = 15;
      for (let i = 0; i < processing.length; i += BATCH_SIZE) {
        const batch = processing.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (product) => {
            const docEntries: DocumentEntry[] = getProductDocumentEntries(product);
            const fieldsToClear = docEntries.map((e) => e.fieldKey);

            if (fieldsToClear.length === 0) {
              successCount++;
              return;
            }

            const result = await clearCmsDocumentFieldsAction(
              product._id!,
              product,
              fieldsToClear
            );

            if (result.success) {
              successCount++;
            } else {
              failCount++;
            }
          })
        );
      }

      setDeletingIds((prev) => {
        const next = new Set(prev);
        processingIds.forEach((id) => next.delete(id));
        return next;
      });
      setCheckedProductIds((prev) => {
        const next = new Set(prev);
        processingIds.forEach((id) => next.delete(id));
        return next;
      });

      if (successCount > 0) {
        toast.success(
          `Đã xóa document của ${successCount} sản phẩm khỏi CMS và Site Media.`
        );
        setSelectedProduct((prev) => {
          if (prev && processingIds.has(prev._id!)) {
            const updated = { ...prev };
            delete (updated as any).document;
            delete (updated as any).Document;
            return updated;
          }
          return prev;
        });
        router.refresh();
      }
      if (failCount > 0) {
        toast.warning(`${failCount} sản phẩm gặp lỗi khi xóa document.`);
      }
    });
  };

  const handleExportToExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const dataToExport = filteredProducts.map((p) => {
        const brandName = brandMap.get(p.Brand) || "AV Brand";
        
        let specsStr = "";
        if (p.TechnicalSpecifications) {
          if (typeof p.TechnicalSpecifications === "string") {
            specsStr = p.TechnicalSpecifications;
          } else {
            specsStr = JSON.stringify(p.TechnicalSpecifications, null, 2);
          }
        }

        let galleryStr = "";
        if (p.galleryImages) {
          if (Array.isArray(p.galleryImages)) {
            galleryStr = p.galleryImages.join(", ");
          } else if (typeof p.galleryImages === "string") {
            galleryStr = p.galleryImages;
          } else {
            galleryStr = JSON.stringify(p.galleryImages);
          }
        }

        // Base/known structured object with human-friendly headers in Vietnamese/English
        const baseExport: Record<string, any> = {
          "ID Sản Phẩm": p._id || "",
          "ID Thương Hiệu": p.Brand || "",
          "Thương Hiệu": brandName,
          "Mẫu Mã (Model)": p.Product || "",
          "Tiêu Đề": p.Title || "",
          "Danh Mục": p.Category || "",
          "Dòng Sản Phẩm (Series)": p.Series || "",
          "Mô Tả Tổng Quan": p.ProductOverview || "",
          "Đặc Điểm Chính": p.MainFeature || "",
          "Thông Số Kỹ Thuật": specsStr,
          "Ảnh Chính (Image)": p.image || "",
          "Thư Viện Ảnh (Gallery)": galleryStr,
          "Datasheet Link": p.Datasheet || "",
          "Manual Link": p.Manual || "",
          "Brochure Link": p.Brochure || "",
          "Firmware Link": p.Firmware || "",
          "Videos": p.Videos || "",
          "Sản Phẩm Tương Thích": p.CompatibleProducts || "",
          "Không Gian Phù Hợp": p.CompatibleRooms || "",
          "Giải Pháp Phù Hợp": p.CompatibleSolutions || "",
          "productItem": p.productItem || "",
          "Slug": p.slug || "",
        };

        // Dynamically add any other properties from raw data that might not be in baseExport
        const knownPropKeysLower = new Set([
          "_id", "brand", "product", "title", "category", "series", "productoverview", 
          "mainfeature", "technicalspecifications", "image", "galleryimages", 
          "datasheet", "manual", "brochure", "firmware", "videos", 
          "compatibleproducts", "compatiblerooms", "compatiblesolutions", 
          "productitem", "slug"
        ]);

        Object.entries(p).forEach(([key, val]) => {
          const keyLower = key.toLowerCase();
          if (!knownPropKeysLower.has(keyLower)) {
            if (val !== null && val !== undefined) {
              if (typeof val === "object") {
                baseExport[key] = JSON.stringify(val);
              } else {
                baseExport[key] = val;
              }
            } else {
              baseExport[key] = "";
            }
          }
        });

        return baseExport;
      });

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "SanPhamWixCMS");

      const maxWidths = dataToExport.reduce((acc: any, row: any) => {
        Object.keys(row).forEach((key, i) => {
          const val = row[key as keyof typeof row] ? row[key as keyof typeof row].toString() : "";
          acc[i] = Math.max(acc[i] || 0, val.length, key.length);
        });
        return acc;
      }, []);
      worksheet["!cols"] = maxWidths.map((w: number) => ({ w: Math.min(w, 50) }));

      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = showOnlyNoImages 
        ? `wix_products_missing_images_${dateStr}.xlsx` 
        : showOnlyWithImages
        ? `wix_products_with_images_${dateStr}.xlsx`
        : showOnlyNoDocuments
        ? `wix_products_missing_documents_${dateStr}.xlsx`
        : showOnlyWithDocuments
        ? `wix_products_with_documents_${dateStr}.xlsx`
        : `wix_products_all_${dateStr}.xlsx`;
      
      XLSX.writeFile(workbook, fileName);
      toast.success("Đã xuất file Excel thành công!");
    } catch (err) {
      console.error("Failed to export Excel:", err);
      toast.error("Gặp lỗi khi xuất file Excel.");
    }
  };

  const itemsPerPage = 8;
  const brandMap = useMemo(() => new Map((brands || []).map((b) => [b._id, b.name])), [brands]);

  const totalDisplayCount = useMemo(() => {
    if (showOnlyNoImages) {
      return products.filter((p) => !isValidProductImageFormat(p.image)).length;
    }
    if (showOnlyWithImages) {
      return products.filter((p) => isValidProductImageFormat(p.image)).length;
    }
    if (showOnlyNoDocuments) {
      return products.filter((p) => !hasProductDocument(p)).length;
    }
    if (showOnlyWithDocuments) {
      return products.filter((p) => hasProductDocument(p)).length;
    }
    return products.length;
  }, [products, showOnlyNoImages, showOnlyWithImages, showOnlyNoDocuments, showOnlyWithDocuments]);

  // Extract unique categories for filter
  const categories = useMemo(() => {
    const cats = (products || []).map((p) => p.Category).filter(Boolean);
    return Array.from(new Set(cats)).sort();
  }, [products]);

  // Sort brands for filter dropdown
  const sortedBrands = useMemo(() => {
    let filteredBrands = brands || [];
    if (showOnlyNoImages) {
      const bSet = new Set(products.filter((p) => !isValidProductImageFormat(p.image)).map((p) => p.Brand).filter(Boolean));
      filteredBrands = filteredBrands.filter((b) => bSet.has(b._id));
    } else if (showOnlyWithImages) {
      const bSet = new Set(products.filter((p) => isValidProductImageFormat(p.image)).map((p) => p.Brand).filter(Boolean));
      filteredBrands = filteredBrands.filter((b) => bSet.has(b._id));
    } else if (showOnlyNoDocuments) {
      const bSet = new Set(products.filter((p) => !hasProductDocument(p)).map((p) => p.Brand).filter(Boolean));
      filteredBrands = filteredBrands.filter((b) => bSet.has(b._id));
    } else if (showOnlyWithDocuments) {
      const bSet = new Set(products.filter((p) => hasProductDocument(p)).map((p) => p.Brand).filter(Boolean));
      filteredBrands = filteredBrands.filter((b) => bSet.has(b._id));
    }
    return [...filteredBrands].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [brands, products, showOnlyNoImages, showOnlyWithImages, showOnlyNoDocuments, showOnlyWithDocuments]);

  // Reset detailed view states when selected product changes
  const handleSelectProduct = (prod: WixProduct | null) => {
    setSelectedProduct(prod);
    setActiveImageIdx(0);
    setCopiedId(null);
    setIsRawMetaExpanded(false);
    setRawSearchQuery("");
  };

  // Filtered products list
  const filteredProducts = useMemo(() => {
    let result = products;

    if (showOnlyNoImages) {
      result = result.filter((p) => !isValidProductImageFormat(p.image));
    } else if (showOnlyWithImages) {
      result = result.filter((p) => isValidProductImageFormat(p.image));
    } else if (showOnlyNoDocuments) {
      result = result.filter((p) => !hasProductDocument(p));
    } else if (showOnlyWithDocuments) {
      result = result.filter((p) => hasProductDocument(p));
    }

    // Filter by Brand
    if (selectedBrandId !== "all") {
      result = result.filter((p) => p.Brand === selectedBrandId);
    }

    // Filter by Category
    if (selectedCategory !== "all") {
      result = result.filter((p) => p.Category === selectedCategory);
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((prod) => {
        const brandName = brandMap.get(prod.Brand)?.toLowerCase() || "";
        const title = prod.Title || "";
        const productCode = prod.Product || "";
        const category = prod.Category || "";
        return (
          title.toLowerCase().includes(query) ||
          productCode.toLowerCase().includes(query) ||
          category.toLowerCase().includes(query) ||
          brandName.includes(query)
        );
      });
    }

    return result;
  }, [products, searchQuery, selectedBrandId, selectedCategory, brandMap]);

  // Pagination bounds
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredProducts.slice(start, start + itemsPerPage);
  }, [filteredProducts, currentPage]);

  const handlePrevPage = () => {
    setCurrentPage((p) => Math.max(1, p - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((p) => Math.min(totalPages, p + 1));
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1); // reset to page 1 on new search
  };

  // Extract all images (main + gallery) into an array
  const allProductImages = useMemo(() => {
    if (!selectedProduct) return [];
    const imgs: string[] = [];
    if (selectedProduct.image) {
      imgs.push(selectedProduct.image);
    }
    
    const gallery = selectedProduct.galleryImages as any;
    if (gallery) {
      if (Array.isArray(gallery)) {
        imgs.push(...gallery);
      } else if (typeof gallery === "string") {
        const trimmed = gallery.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
              imgs.push(...parsed);
            } else {
              imgs.push(trimmed);
            }
          } catch {
            imgs.push(trimmed);
          }
        } else if (trimmed.includes(",")) {
          imgs.push(...trimmed.split(",").map((s: string) => s.trim()));
        } else {
          imgs.push(trimmed);
        }
      }
    }
    return Array.from(new Set(imgs.filter(Boolean)));
  }, [selectedProduct]);

  // Technical Specifications parser
  const parsedSpecs = useMemo(() => {
    const specs = selectedProduct?.TechnicalSpecifications;
    if (!specs) return [];

    // If it's already an array
    if (Array.isArray(specs)) {
      return specs as Array<{ label: string; value: string }>;
    }

    // If it's an object
    if (typeof specs === "object" && specs !== null) {
      return Object.entries(specs).map(([label, value]) => ({
        label,
        value: String(value),
      }));
    }

    // If it's a string, try to parse it
    if (typeof specs === "string") {
      const trimmed = specs.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed as Array<{ label: string; value: string }>;
          }
          if (typeof parsed === "object" && parsed !== null) {
            return Object.entries(parsed).map(([label, value]) => ({
              label,
              value: String(value),
            }));
          }
        } catch {
          // Fallback for invalid JSON string
        }
      }
      return [{ label: "Thông số", value: specs }];
    }

    return [];
  }, [selectedProduct]);

  // Copy to clipboard helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Helper to format values defensively in the raw detail view
  const renderDetailValue = (key: string, val: any) => {
    if (val === null || val === undefined || val === "") {
      return <span className="text-muted-foreground italic">Trống (N/A)</span>;
    }

    if (key === "image" || key === "galleryImages") {
      const urls = Array.isArray(val) ? val : [val];
      return (
        <div className="flex flex-wrap gap-1.5">
          {urls.map((url, idx) => (
            <div key={idx} className="relative w-12 h-10 border rounded bg-card flex items-center justify-center p-0.5 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={transformWixImageUrl(url)} alt="preview" className="max-h-full max-w-full object-contain" />
            </div>
          ))}
        </div>
      );
    }

    if (typeof val === "object") {
      return (
        <pre className="text-[10px] bg-muted p-2 rounded overflow-x-auto font-mono max-h-32">
          {JSON.stringify(val, null, 2)}
        </pre>
      );
    }

    if (String(val).startsWith("wix:document://v1/")) {
      return (
        <a 
          href={transformWixImageUrl(val)} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-primary hover:underline flex items-center gap-1 text-[11px] font-semibold"
        >
          <FileText className="w-3.5 h-3.5" />
          Tải Tài Liệu
        </a>
      );
    }

    if (String(val).includes("<") && String(val).includes(">")) {
      return (
        <div 
          className="prose prose-xs border p-2 rounded bg-card text-muted-foreground text-[11px] leading-relaxed max-h-32 overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: String(val) }}
        />
      );
    }

    return <span className="whitespace-pre-wrap break-all text-[11px] font-medium text-foreground">{String(val)}</span>;
  };

  return (
    <>
      {/* Show Detail Trigger button */}
      <Button 
        size="sm" 
        variant="outline" 
        className="h-7 text-xs px-3 border-primary/20 text-primary hover:bg-primary/5 cursor-pointer flex items-center gap-1.5 shadow-xs"
        onClick={() => {
          setIsOpen(true);
          setSearchQuery("");
          setSelectedBrandId("all");
          setSelectedCategory("all");
          setCurrentPage(1);
          handleSelectProduct(null);
        }}
      >
        <ListFilter className="w-3.5 h-3.5" />
        {triggerLabel || "Xem chi tiết CMS"}
      </Button>

      {/* Main Modal Backdrop */}
      {mounted && typeof document !== "undefined" && isOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-hidden animate-in fade-in-0 duration-200">
          <div className="relative bg-card border border-border/80 rounded-2xl max-w-5xl w-full flex flex-col max-h-[90vh] shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-card">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2 text-foreground">
                  <Building2 className="w-5 h-5 text-primary" />
                  {showOnlyNoImages 
                    ? "Sản phẩm Wix CMS chưa có ảnh" 
                    : showOnlyWithImages
                    ? "Sản phẩm Wix CMS ĐÃ CÓ ảnh"
                    : showOnlyNoDocuments
                    ? "Sản phẩm Wix CMS chưa có tài liệu (PDF)"
                    : showOnlyWithDocuments
                    ? "Sản phẩm Wix CMS ĐÃ CÓ tài liệu (PDF)"
                    : "Wix CMS Products Directory"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {showOnlyNoImages 
                    ? "Tổng sản phẩm chưa có ảnh" 
                    : showOnlyWithImages
                    ? "Tổng sản phẩm đã có ảnh"
                    : showOnlyNoDocuments
                    ? "Tổng sản phẩm chưa có tài liệu (PDF)"
                    : showOnlyWithDocuments
                    ? "Tổng sản phẩm đã có tài liệu (PDF)"
                    : "Tổng đồng bộ"}: {totalDisplayCount} sản phẩm | Kết quả lọc: {filteredProducts.length} mục
                </p>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body Container */}
            <div className="flex-1 overflow-hidden flex flex-col bg-muted/5">
              {!selectedProduct ? (
                /* VIEW 1: PRODUCTS LIST TABLE */
                <>
                  {/* Search and Filters Bar */}
                  <div className="px-6 py-3 border-b flex flex-col sm:flex-row gap-3 bg-muted/20">
                    {/* Text Search Input */}
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Tìm kiếm theo thương hiệu, mẫu mã, danh mục, tiêu đề..."
                        value={searchQuery}
                        onChange={handleSearchChange}
                        className="w-full pl-9 pr-4 py-1.5 text-xs bg-card border border-border/80 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground"
                      />
                    </div>

                    {/* Filter controls */}
                    <div className="flex gap-2 items-center">
                      <div className="flex items-center gap-1.5 bg-card border border-border/80 rounded-xl px-2.5 py-1 text-muted-foreground">
                        <Filter className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Lọc</span>
                      </div>

                      {/* Brand Select */}
                      <select
                        value={selectedBrandId}
                        onChange={(e) => {
                          setSelectedBrandId(e.target.value);
                          setCurrentPage(1);
                        }}
                        className="bg-card border border-border/80 text-xs rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/20 cursor-pointer font-medium"
                      >
                        <option value="all">Tất cả thương hiệu</option>
                        {sortedBrands.map((b) => (
                          <option key={b._id} value={b._id}>
                            {b.name}
                          </option>
                        ))}
                      </select>

                      {/* Category Select */}
                      <select
                        value={selectedCategory}
                        onChange={(e) => {
                          setSelectedCategory(e.target.value);
                          setCurrentPage(1);
                        }}
                        className="bg-card border border-border/80 text-xs rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/20 cursor-pointer font-medium"
                      >
                        <option value="all">Tất cả danh mục</option>
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>

                      {/* Export Button */}
                      <Button
                        size="sm"
                        variant="default"
                        onClick={handleExportToExcel}
                        className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl flex items-center gap-1.5 px-3 cursor-pointer shadow-sm transition-all"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Tải Excel ({filteredProducts.length})
                      </Button>
                    </div>
                  </div>

                  {/* Quick Batch Selection & Bulk Actions Sub-bar */}
                  <div className="px-6 py-2.5 border-b bg-card flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                        Thao tác hàng loạt:
                      </span>
                      <button
                        type="button"
                        onClick={() => handleSelectBatch(filteredProducts.length)}
                        className="px-3 py-1 text-xs font-semibold bg-primary/10 hover:bg-primary/20 text-primary rounded-lg cursor-pointer transition-colors border border-primary/30 shadow-2xs"
                        title={`Chọn toàn bộ ${filteredProducts.length} sản phẩm`}
                      >
                        Chọn toàn bộ ({filteredProducts.length} SP)
                      </button>
                    </div>

                    {checkedProductIds.size > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-red-600 dark:text-red-400">
                          Đã chọn {checkedProductIds.size} / {filteredProducts.length} SP
                        </span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs gap-1.5 cursor-pointer font-bold shadow-sm"
                          onClick={() => {
                            const chosen = filteredProducts.filter(
                              (p) => p._id && checkedProductIds.has(p._id)
                            );
                            setDeleteConfirmProducts(chosen);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Xóa Document ({checkedProductIds.size} SP)
                        </Button>
                        <button
                          type="button"
                          onClick={() => setCheckedProductIds(new Set())}
                          className="text-xs text-muted-foreground hover:text-foreground cursor-pointer underline px-1"
                        >
                          Bỏ chọn
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground italic">
                        Bấm &quot;Chọn toàn bộ&quot; hoặc tick chọn sản phẩm để thực hiện xóa hàng loạt.
                      </span>
                    )}
                  </div>

                  {/* Products Table */}
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <table className="w-full border-collapse text-left text-xs text-muted-foreground">
                      <thead className="bg-muted/40 text-foreground font-semibold sticky top-0 z-10 border-b">
                        <tr>
                          <th className="px-3 py-3 w-10">
                            <input
                              type="checkbox"
                              className="rounded cursor-pointer accent-red-500"
                              checked={
                                paginatedProducts.length > 0 &&
                                paginatedProducts.every((p) => p._id && checkedProductIds.has(p._id))
                              }
                              onChange={handleToggleAllOnPage}
                              title="Chọn / bỏ chọn tất cả trang này"
                            />
                          </th>
                          <th className="px-3 py-3 w-16">Xem Trước</th>
                          <th className="px-4 py-3 w-32">Thương Hiệu</th>
                          <th className="px-4 py-3 w-36">Mẫu Mã</th>
                          <th className="px-4 py-3">Tiêu Đề CMS</th>
                          <th className="px-4 py-3 w-32">Danh Mục</th>
                          <th className="px-4 py-3 w-36 text-right">Thao Tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {paginatedProducts.length > 0 ? (
                          paginatedProducts.map((prod) => {
                            const brandName = brandMap.get(prod.Brand) || "AV Brand";
                            const modelCode = prod.Product || prod.Title || "product";
                            const slug = prod.slug || String(modelCode).toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
                            const isChecked = !!prod._id && checkedProductIds.has(prod._id);
                            const isDeleting = !!prod._id && deletingIds.has(prod._id);
                            const docEntries = getProductDocumentEntries(prod);
                            const hasDocuments = docEntries.length > 0;
                            return (
                              <tr 
                                key={prod._id} 
                                className={`hover:bg-muted/10 transition-colors duration-150 odd:bg-card/5 group ${isChecked ? "bg-red-500/5 border-l-2 border-l-red-400" : ""} ${isDeleting ? "opacity-50 pointer-events-none" : ""}`}
                              >
                                <td className="px-3 py-3">
                                  <input
                                    type="checkbox"
                                    className="rounded cursor-pointer accent-red-500"
                                    checked={isChecked}
                                    onChange={() => prod._id && handleToggleCheck(prod._id)}
                                    disabled={isDeleting}
                                  />
                                </td>
                                <td className="px-3 py-3">
                                  <div className="w-10 h-8 rounded border bg-card flex items-center justify-center p-0.5 overflow-hidden shadow-xs">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img 
                                      src={transformWixImageUrl(prod.image)} 
                                      alt="thumb" 
                                      className="max-h-full max-w-full object-contain"
                                    />
                                  </div>
                                </td>
                                <td className="px-4 py-3 font-semibold text-foreground uppercase tracking-wide">{brandName}</td>
                                <td className="px-4 py-3 font-mono font-bold text-foreground/80">{prod.Product || "—"}</td>
                                <td className="px-4 py-3 font-medium text-foreground">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="max-w-[220px] truncate block" title={prod.Title || prod.Product || "Sản phẩm chưa đặt tên"}>
                                      {prod.Title || prod.Product || "Sản phẩm chưa đặt tên"}
                                    </span>
                                    {hasDocuments && (
                                      <span className="flex items-center gap-1 text-[9px] text-emerald-600 font-semibold">
                                        <FileText className="w-2.5 h-2.5" />
                                        {docEntries.map((d) => d.label).join(", ")}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-[10px] font-bold uppercase tracking-wider">
                                    {prod.Category || "Device"}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      className="h-7 text-[10px] gap-1 cursor-pointer border-primary/20 text-primary hover:bg-primary/5 shadow-xs"
                                      onClick={() => handleSelectProduct(prod)}
                                      title="Xem chi tiết dữ liệu thuộc tính"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      Chi Tiết
                                    </Button>
                                    {hasDocuments && (
                                      <Button
                                        size="xs"
                                        variant="ghost"
                                        className="h-7 w-7 p-0 cursor-pointer text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                        title="Xóa document của sản phẩm này"
                                        disabled={isDeleting}
                                        onClick={() => setDeleteConfirmProducts([prod])}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </Button>
                                    )}
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 cursor-pointer"
                                      asChild
                                      title="Xem trang sản phẩm chính thức"
                                    >
                                      <Link href={`/products/${slug}`} target="_blank">
                                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                                      </Link>
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground italic">
                              Không tìm thấy sản phẩm nào phù hợp với bộ lọc.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination footer */}
                  {totalPages > 1 && (
                    <div className="px-6 py-4 border-t flex items-center justify-between bg-card">
                      <span className="text-xs text-muted-foreground">
                        Trang <strong>{currentPage}</strong> trên <strong>{totalPages}</strong> (Hiển thị {paginatedProducts.length} / {filteredProducts.length} mục)
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button 
                          variant="outline" 
                          size="xs" 
                          onClick={handlePrevPage} 
                          disabled={currentPage === 1}
                          className="h-8 gap-1 cursor-pointer text-xs"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          Trước
                        </Button>
                        <Button 
                          variant="outline" 
                          size="xs" 
                          onClick={handleNextPage} 
                          disabled={currentPage === totalPages}
                          className="h-8 gap-1 cursor-pointer text-xs"
                        >
                          Sau
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* VIEW 2: REDESIGNED SINGLE PRODUCT PROFILE VIEW */
                <div className="flex-1 overflow-hidden flex flex-col bg-background/30">
                  {/* Detail Sub-Header */}
                  <div className="px-6 py-3 border-b flex items-center justify-between bg-card backdrop-blur-md sticky top-0 z-20">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => handleSelectProduct(null)}
                      className="gap-2 cursor-pointer text-xs font-semibold hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                    >
                      <ChevronLeft className="w-4 h-4 text-primary" />
                      Quay lại danh sách
                    </Button>
                    
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground bg-muted border border-border/40 px-2.5 py-1 rounded-md">
                        ID: {selectedProduct._id}
                      </span>

                      {/* Delete ALL document button for this product (detail view) */}
                      {(() => {
                        const docEntries = getProductDocumentEntries(selectedProduct);
                        if (docEntries.length === 0) return null;
                        return (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs gap-1.5 border-red-400/40 hover:bg-red-500/10 text-red-600"
                            onClick={() => setDeleteConfirmProducts([selectedProduct])}
                            disabled={isPending || (!!selectedProduct._id && deletingIds.has(selectedProduct._id))}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Xóa Tất Cả Document ({docEntries.length})
                          </Button>
                        );
                      })()}

                      <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5 border-primary/20 hover:bg-primary/5 text-primary">
                        {(() => {
                          const modelCode = selectedProduct.Product || selectedProduct.Title || "product";
                          const slug = selectedProduct.slug || String(modelCode).toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
                          return (
                            <Link 
                              href={`/products/${slug}`} 
                              target="_blank"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Xem trang Public
                            </Link>
                          );
                        })()}
                      </Button>
                    </div>
                  </div>

                  {/* Profile Layout Grid */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                      
                      {/* Left Column: Visuals & Links */}
                      <div className="lg:col-span-5 space-y-4">
                        {/* Main Image Container */}
                        <div className="relative aspect-square rounded-2xl bg-card border border-border/80 flex items-center justify-center p-6 shadow-xs overflow-hidden group/img">
                          <div className="absolute inset-0 bg-radial-gradient opacity-10 pointer-events-none" />
                          {allProductImages.length > 0 ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img 
                              src={transformWixImageUrl(allProductImages[activeImageIdx])} 
                              alt={selectedProduct.Product || "product preview"}
                              className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover/img:scale-105"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <ImageIcon className="w-12 h-12 opacity-30 animate-pulse" />
                              <span className="text-xs font-medium">Không có hình ảnh</span>
                            </div>
                          )}
                          
                          {/* Floating Image Counter */}
                          {allProductImages.length > 1 && (
                            <span className="absolute bottom-3 right-3 text-[10px] font-bold bg-black/60 text-white backdrop-blur-md px-2.5 py-0.5 rounded-full">
                              {activeImageIdx + 1} / {allProductImages.length}
                            </span>
                          )}
                        </div>

                        {/* Interactive Thumbnail Gallery */}
                        {allProductImages.length > 1 && (
                          <div className="flex flex-wrap gap-2 p-2 bg-card rounded-xl border border-border/60">
                            {allProductImages.map((imgUrl, idx) => (
                              <button
                                key={idx}
                                onClick={() => setActiveImageIdx(idx)}
                                className={`relative w-12 h-12 rounded-lg border-2 overflow-hidden bg-background flex items-center justify-center p-1 cursor-pointer transition-all duration-200 hover:border-primary/50 ${
                                  activeImageIdx === idx ? "border-primary shadow-xs ring-2 ring-primary/10" : "border-border/60"
                                }`}
                              >
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img 
                                  src={transformWixImageUrl(imgUrl)} 
                                  alt={`thumb-${idx}`} 
                                  className="max-h-full max-w-full object-contain"
                                />
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Document links + delete all button */}
                        <div className="space-y-2 pt-2">
                          {(() => {
                            const docEntries = getProductDocumentEntries(selectedProduct);
                            if (docEntries.length === 0) return null;
                            return (
                              <div className="border border-border/60 rounded-xl bg-card p-3 space-y-2">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                  <FileText className="w-3.5 h-3.5" />
                                  Tài liệu đính kèm ({docEntries.length})
                                </p>
                                <div className="space-y-1.5">
                                  {docEntries.map((entry) => (
                                    <a
                                      key={entry.fieldKey}
                                      href={transformWixImageUrl(entry.url)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-2 text-[11px] text-emerald-600 hover:text-emerald-700 hover:underline truncate"
                                    >
                                      <FileText className="w-3 h-3 shrink-0" />
                                      <span className="font-semibold font-mono mr-1 text-muted-foreground shrink-0">[{entry.label}]</span>
                                      <span className="truncate">{entry.url}</span>
                                    </a>
                                  ))}
                                </div>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="w-full h-8 text-xs gap-1.5"
                                  onClick={() => setDeleteConfirmProducts([selectedProduct])}
                                  disabled={isPending || (!!selectedProduct._id && deletingIds.has(selectedProduct._id))}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Xóa Toàn Bộ Document
                                </Button>
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Right Column: Information details */}
                      <div className="lg:col-span-7 space-y-6">
                        
                        {/* Header Details */}
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-1.5 items-center">
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 rounded-full">
                              {brandMap.get(selectedProduct.Brand) || "AV Brand"}
                            </span>
                            {selectedProduct.Category && (
                              <span className="text-[10px] font-bold uppercase tracking-wider bg-secondary text-secondary-foreground px-2.5 py-0.5 rounded-full">
                                {selectedProduct.Category}
                              </span>
                            )}
                            {selectedProduct.Series && (
                              <span className="text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground border border-border/80 px-2.5 py-0.5 rounded-full">
                                Series: {selectedProduct.Series}
                              </span>
                            )}
                          </div>
                          
                          <div className="space-y-1">
                            <h2 className="text-xl font-extrabold tracking-tight text-foreground leading-tight">
                              {selectedProduct.Title || "Sản phẩm chưa đặt tên"}
                            </h2>
                            <p className="text-xs font-mono text-muted-foreground font-bold flex items-center gap-1.5">
                              <span>Mã Model:</span>
                              <span className="text-foreground bg-muted/40 px-2 py-0.5 rounded border border-border/50">{selectedProduct.Product || "N/A"}</span>
                            </p>
                          </div>
                        </div>

                        {/* Product Overview Section */}
                        {selectedProduct.ProductOverview && (
                          <div className="space-y-2 bg-card p-4 rounded-2xl border border-border/60 shadow-2xs">
                            <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                              <Info className="w-3.5 h-3.5 text-primary" />
                              Mô tả sản phẩm
                            </h4>
                            <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-line">
                              {selectedProduct.ProductOverview}
                            </p>
                          </div>
                        )}

                        {/* Technical Specs section */}
                        <div className="space-y-2.5">
                          <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-primary" />
                            Thông số kỹ thuật chính
                          </h4>
                          
                          <div className="border border-border/60 rounded-xl overflow-hidden bg-card shadow-2xs">
                            {parsedSpecs.length === 0 ? (
                              <div className="p-4 text-center text-xs text-muted-foreground italic bg-muted/5">
                                Không có thông số kỹ thuật dạng bảng.
                              </div>
                            ) : (
                              <div className="divide-y divide-border/40 text-xs">
                                {parsedSpecs.map((spec, i) => (
                                  <div key={i} className="grid grid-cols-3 p-2.5 hover:bg-muted/10 transition-colors">
                                    <span className="font-semibold text-muted-foreground pr-2 col-span-1">{spec.label}</span>
                                    <span className="text-foreground font-medium col-span-2">{spec.value}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        
                      </div>
                    </div>

                    {/* Bottom Full-Width: Collapsible Raw JSON Data Accordion */}
                    <div className="border border-border/60 rounded-2xl bg-card shadow-2xs overflow-hidden">
                      <button
                        onClick={() => setIsRawMetaExpanded(!isRawMetaExpanded)}
                        className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-primary" />
                          <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                            Thông tin dữ liệu gốc từ CMS (Raw Metadata)
                          </span>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
                          isRawMetaExpanded ? "rotate-180" : ""
                        }`} />
                      </button>

                      {isRawMetaExpanded && (
                        <div className="px-6 pb-6 pt-2 border-t divide-y divide-border/40 text-xs bg-muted/5">
                          {/* Search Raw Keys Input */}
                          <div className="py-3 flex items-center gap-3">
                            <div className="relative flex-1 max-w-md">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                              <input
                                type="text"
                                placeholder="Lọc nhanh thuộc tính gốc..."
                                value={rawSearchQuery}
                                onChange={(e) => setRawSearchQuery(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 text-xs bg-card border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground"
                              />
                            </div>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleCopy(JSON.stringify(selectedProduct, null, 2), "json")}
                              className="h-8 gap-1.5 cursor-pointer ml-auto border-primary/20 text-primary text-[10px]"
                            >
                              {copiedId === "json" ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-green-500 animate-in zoom-in-50" />
                                  Đã sao chép!
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  Sao chép JSON gốc
                                </>
                              )}
                            </Button>
                          </div>

                          <div className="max-h-96 overflow-y-auto divide-y divide-border/40 font-mono text-[11px] pr-1 mt-2 border rounded-lg bg-card/60 shadow-inner">
                            {Object.entries(selectedProduct)
                              .filter(([key]) => {
                                if (!rawSearchQuery.trim()) return true;
                                return key.toLowerCase().includes(rawSearchQuery.toLowerCase());
                              })
                              .map(([key, val]) => (
                                <div key={key} className="grid grid-cols-1 sm:grid-cols-3 p-3 hover:bg-muted/15 transition-colors gap-2">
                                  <div className="text-primary font-semibold break-all">{key}</div>
                                  <div className="sm:col-span-2 text-muted-foreground break-all">
                                    {renderDetailValue(key, val)}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t flex justify-end bg-card">
              <Button onClick={() => setIsOpen(false)} variant="secondary" className="cursor-pointer text-xs h-9">
                Đóng Directory
              </Button>
            </div>

            {/* ── Confirm Delete Document Modal ───────────────────────────────── */}
            {deleteConfirmProducts && deleteConfirmProducts.length > 0 && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-2xl">
                <div className="bg-card border border-red-400/40 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4 animate-in fade-in-0 zoom-in-95 duration-150">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-red-500/10 shrink-0">
                      <AlertTriangle className="w-5 h-5 text-red-500" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-foreground">Xác nhận xóa Document</h4>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        Thao tác này sẽ:
                      </p>
                      <ul className="text-xs text-muted-foreground mt-1 space-y-0.5 list-disc list-inside">
                        <li>Xóa dữ liệu các trường document trong CMS</li>
                        <li>Xóa file thực tế khỏi Wix Site Media</li>
                        <li className="text-red-500 font-semibold">Không thể hoàn tác!</li>
                      </ul>

                      {/* Product list preview */}
                      <div className="mt-3 max-h-32 overflow-y-auto space-y-1">
                        {deleteConfirmProducts.map((p) => {
                          const docEntries = getProductDocumentEntries(p);
                          return (
                            <div key={p._id} className="text-[11px] bg-muted/40 px-2 py-1.5 rounded-lg">
                              <p className="font-semibold text-foreground">{p.Product || p.Title || p._id}</p>
                              {docEntries.length > 0 ? (
                                <p className="text-muted-foreground">
                                  Fields: {docEntries.map((e) => e.label).join(", ")}
                                </p>
                              ) : (
                                <p className="text-amber-500 italic">Không có document nào để xóa</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="cursor-pointer text-xs h-8"
                      onClick={() => setDeleteConfirmProducts(null)}
                    >
                      Hủy bỏ
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="cursor-pointer text-xs h-8 gap-1.5"
                      onClick={handleConfirmDeleteDocuments}
                      disabled={isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {isPending ? "Đang xóa..." : "Xác nhận xóa"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>,
        document.body
      )}
    </>
  );
}
