"use client";

import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { WixProduct, WixBrand } from "@/lib/services/wixCms";
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
  Filter
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Download } from "lucide-react";

interface CmsProductsPopupTriggerProps {
  products: WixProduct[];
  brands: WixBrand[];
  showOnlyNoImages?: boolean;
  triggerLabel?: string;
}

export function CmsProductsPopupTrigger({ 
  products, 
  brands, 
  showOnlyNoImages = false, 
  triggerLabel 
}: CmsProductsPopupTriggerProps) {
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

  const handleExportToExcel = () => {
    try {
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

        return {
          "Thương Hiệu": brandName,
          "Mẫu Mã (Model)": p.Product || "",
          "Tiêu Đề": p.Title || "",
          "Danh Mục": p.Category || "",
          "Dòng Sản Phẩm (Series)": p.Series || "",
          "Mô Tả Tổng Quan": p.ProductOverview || "",
          "Đặc Điểm Chính": p.MainFeature || "",
          "Thông Số Kỹ Thuật": specsStr,
          "Datasheet Link": p.Datasheet || "",
          "Slug": p.slug || "",
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "SanPhamChuaCoAnh");

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
      return products.filter((p) => !p.image || p.image.trim() === "").length;
    }
    return products.length;
  }, [products, showOnlyNoImages]);

  // Extract unique categories for filter
  const categories = useMemo(() => {
    const cats = (products || []).map((p) => p.Category).filter(Boolean);
    return Array.from(new Set(cats)).sort();
  }, [products]);

  // Sort brands for filter dropdown
  const sortedBrands = useMemo(() => {
    return [...(brands || [])].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [brands]);

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
      result = result.filter((p) => !p.image || p.image.trim() === "");
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
                  {showOnlyNoImages ? "Sản phẩm Wix CMS chưa có ảnh" : "Wix CMS Products Directory"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {showOnlyNoImages ? "Tổng sản phẩm chưa có ảnh" : "Tổng đồng bộ"}: {totalDisplayCount} sản phẩm | Kết quả lọc: {filteredProducts.length} mục
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

                  {/* Products Table */}
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <table className="w-full border-collapse text-left text-xs text-muted-foreground">
                      <thead className="bg-muted/40 text-foreground font-semibold sticky top-0 z-10 border-b">
                        <tr>
                          <th className="px-6 py-3 w-16">Xem Trước</th>
                          <th className="px-6 py-3 w-32">Thương Hiệu</th>
                          <th className="px-6 py-3 w-36">Mẫu Mã</th>
                          <th className="px-6 py-3">Tiêu Đề CMS</th>
                          <th className="px-6 py-3 w-32">Danh Mục</th>
                          <th className="px-6 py-3 w-32 text-right">Thao Tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {paginatedProducts.length > 0 ? (
                          paginatedProducts.map((prod) => {
                            const brandName = brandMap.get(prod.Brand) || "AV Brand";
                            const modelCode = prod.Product || prod.Title || "product";
                            const slug = prod.slug || String(modelCode).toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
                            return (
                              <tr key={prod._id} className="hover:bg-muted/10 transition-colors duration-150 odd:bg-card/5 group">
                                <td className="px-6 py-3">
                                  <div className="w-10 h-8 rounded border bg-card flex items-center justify-center p-0.5 overflow-hidden shadow-xs">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img 
                                      src={transformWixImageUrl(prod.image)} 
                                      alt="thumb" 
                                      className="max-h-full max-w-full object-contain"
                                    />
                                  </div>
                                </td>
                                <td className="px-6 py-3 font-semibold text-foreground uppercase tracking-wide">{brandName}</td>
                                <td className="px-6 py-3 font-mono font-bold text-foreground/80">{prod.Product || "—"}</td>
                                <td className="px-6 py-3 font-medium text-foreground">
                                  <span className="max-w-[260px] truncate block" title={prod.Title || prod.Product || "Sản phẩm chưa đặt tên"}>
                                    {prod.Title || prod.Product || "Sản phẩm chưa đặt tên"}
                                  </span>
                                </td>
                                <td className="px-6 py-3">
                                  <span className="px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-[10px] font-bold uppercase tracking-wider">
                                    {prod.Category || "Device"}
                                  </span>
                                </td>
                                <td className="px-6 py-3 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
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
                            <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground italic">
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

                        {/* Action buttons */}
                        <div className="space-y-2 pt-2">
                          {selectedProduct.Datasheet && (
                            <a 
                              href={transformWixImageUrl(selectedProduct.Datasheet)} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="w-full flex items-center justify-center gap-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 px-4 rounded-xl transition-all shadow-xs active:scale-[0.99] cursor-pointer"
                            >
                              <FileText className="w-4 h-4" />
                              Xem Tài Liệu Datasheet (PDF)
                            </a>
                          )}
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

          </div>
        </div>,
        document.body
      )}
    </>
  );
}
