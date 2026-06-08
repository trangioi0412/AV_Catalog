"use client";

import React, { useState, useMemo } from "react";
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
  ListFilter
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface CmsProductsPopupTriggerProps {
  products: WixProduct[];
  brands: WixBrand[];
}

export function CmsProductsPopupTrigger({ products, brands }: CmsProductsPopupTriggerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<WixProduct | null>(null);

  const itemsPerPage = 8;
  const brandMap = useMemo(() => new Map(brands.map((b) => [b._id, b.name])), [brands]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const query = searchQuery.toLowerCase().trim();
    return products.filter((prod) => {
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
  }, [products, searchQuery, brandMap]);

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

  // Helper to format values defensively in the detail view
  const renderDetailValue = (key: string, val: any) => {
    if (val === null || val === undefined || val === "") {
      return <span className="text-muted-foreground italic">Empty (N/A)</span>;
    }

    if (key === "image" || key === "galleryImages") {
      if (key === "galleryImages") {
        console.log("[CmsProductsPopupTrigger] Raw galleryImages value:", val);
      }
      const urls = Array.isArray(val) ? val : [val];
      return (
        <div className="flex flex-wrap gap-2">
          {urls.map((url, idx) => (
            <div key={idx} className="relative w-16 h-12 border rounded-md overflow-hidden bg-card flex items-center justify-center p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={transformWixImageUrl(url)} alt="preview" className="max-h-full max-w-full object-contain" />
            </div>
          ))}
        </div>
      );
    }

    if (typeof val === "object") {
      return (
        <pre className="text-xs bg-muted p-2.5 rounded-lg overflow-x-auto font-mono max-h-40">
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
          className="text-primary hover:underline flex items-center gap-1 text-xs font-semibold"
        >
          <FileText className="w-3.5 h-3.5" />
          Download Document
        </a>
      );
    }

    // Check if it looks like HTML rich text
    if (String(val).includes("<") && String(val).includes(">")) {
      return (
        <div 
          className="prose prose-xs border p-3 rounded-lg bg-card text-muted-foreground leading-normal max-h-40 overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: String(val) }}
        />
      );
    }

    return <span className="whitespace-pre-wrap break-all text-xs font-medium text-foreground">{String(val)}</span>;
  };

  return (
    <>
      {/* Show Detail Trigger button */}
      <Button 
        size="sm" 
        variant="outline" 
        className="h-7 text-xs px-3 border-primary/20 text-primary hover:bg-primary/5 cursor-pointer flex items-center gap-1"
        onClick={() => {
          setIsOpen(true);
          setSearchQuery("");
          setCurrentPage(1);
          setSelectedProduct(null);
        }}
      >
        <ListFilter className="w-3.5 h-3.5" />
        Show Detail
      </Button>

      {/* Main Modal Backdrop */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-hidden animate-in-fade">
          <div className="relative bg-card border rounded-2xl max-w-5xl w-full flex flex-col max-h-[90vh] shadow-2xl overflow-hidden">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-primary" />
                  Wix CMS Products Master Directory
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Total Synced: {products.length} products | Filtered: {filteredProducts.length} items
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
            <div className="flex-1 overflow-hidden flex flex-col">
              {!selectedProduct ? (
                /* VIEW 1: PRODUCTS LIST TABLE */
                <>
                  {/* Search bar */}
                  <div className="px-6 py-3 border-b flex items-center gap-4 bg-muted/20">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search products by brand, category, title, or model..."
                        value={searchQuery}
                        onChange={handleSearchChange}
                        className="w-full pl-9 pr-4 py-1.5 text-sm bg-card border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>

                  {/* Products Table */}
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <table className="w-full border-collapse text-left text-xs text-muted-foreground">
                      <thead className="bg-muted/40 text-foreground font-semibold sticky top-0 z-10 border-b">
                        <tr>
                          <th className="px-6 py-3.5 w-16">Preview</th>
                          <th className="px-6 py-3.5">Brand</th>
                          <th className="px-6 py-3.5">Model</th>
                          <th className="px-6 py-3.5">Title</th>
                          <th className="px-6 py-3.5">Category</th>
                          <th className="px-6 py-3.5 w-32 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {paginatedProducts.length > 0 ? (
                          paginatedProducts.map((prod) => {
                            const brandName = brandMap.get(prod.Brand) || "AV Brand";
                            const modelCode = prod.Product || prod.Title || "product";
                            const slug = prod.slug || String(modelCode).toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
                            return (
                              <tr key={prod._id} className="hover:bg-muted/10 transition-colors duration-150 odd:bg-card/5">
                                <td className="px-6 py-3">
                                  <div className="w-10 h-8 rounded border bg-card flex items-center justify-center p-0.5 overflow-hidden">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img 
                                      src={transformWixImageUrl(prod.image)} 
                                      alt="thumb" 
                                      className="max-h-full max-w-full object-contain"
                                    />
                                  </div>
                                </td>
                                <td className="px-6 py-3 font-semibold text-foreground uppercase">{brandName}</td>
                                <td className="px-6 py-3 font-mono font-bold text-foreground/80">{prod.Product}</td>
                                <td className="px-6 py-3 font-medium text-foreground line-clamp-1 max-w-[240px] pt-4" title={prod.Title || prod.Product || "Unnamed Product"}>
                                  {prod.Title || prod.Product || "Unnamed Product"}
                                </td>
                                <td className="px-6 py-3">
                                  <span className="px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-[10px] font-semibold">
                                    {prod.Category || "Device"}
                                  </span>
                                </td>
                                <td className="px-6 py-3 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      className="h-7 text-[10px] gap-1 cursor-pointer"
                                      onClick={() => setSelectedProduct(prod)}
                                      title="Show full key-value properties table"
                                    >
                                      <Eye className="w-3.5 h-3.5 text-primary" />
                                      View Data
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 cursor-pointer"
                                      asChild
                                      title="Open public page"
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
                              No synced products found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination footer */}
                  {totalPages > 1 && (
                    <div className="px-6 py-4 border-t flex items-center justify-between bg-muted/20">
                      <span className="text-xs text-muted-foreground">
                        Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> (showing {paginatedProducts.length} of {filteredProducts.length} items)
                      </span>
                      <div className="flex items-center gap-1">
                        <Button 
                          variant="outline" 
                          size="xs" 
                          onClick={handlePrevPage} 
                          disabled={currentPage === 1}
                          className="h-8 gap-1 cursor-pointer"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          Prev
                        </Button>
                        <Button 
                          variant="outline" 
                          size="xs" 
                          onClick={handleNextPage} 
                          disabled={currentPage === totalPages}
                          className="h-8 gap-1 cursor-pointer"
                        >
                          Next
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* VIEW 2: SINGLE PRODUCT DETAILED DATA TABLE */
                <div className="flex-1 overflow-hidden flex flex-col">
                  {/* Sub-Header */}
                  <div className="px-6 py-3 border-b flex items-center justify-between bg-muted/20">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setSelectedProduct(null)}
                      className="gap-1.5 cursor-pointer text-xs font-semibold"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Back to Directory
                    </Button>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">ID: {selectedProduct._id}</span>
                      <Button asChild size="xs" variant="outline" className="h-7 text-[10px] gap-1">
                        {(() => {
                          const modelCode = selectedProduct.Product || selectedProduct.Title || "product";
                          const slug = selectedProduct.slug || String(modelCode).toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
                          return (
                            <Link 
                              href={`/products/${slug}`} 
                              target="_blank"
                            >
                              <ExternalLink className="w-3 h-3" />
                              View Page
                            </Link>
                          );
                        })()}
                      </Button>
                    </div>
                  </div>

                  {/* Field-Value Table */}
                  <div className="flex-1 overflow-y-auto p-6">
                    <div className="border border-border/80 rounded-xl overflow-hidden bg-card shadow-sm">
                      <table className="w-full border-collapse text-left text-xs text-muted-foreground">
                        <thead>
                          <tr className="border-b bg-card/60 text-foreground font-semibold">
                            <th className="px-5 py-3 w-1/4">CMS Database Field Key</th>
                            <th className="px-5 py-3">Property Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {Object.entries(selectedProduct).map(([key, val]) => (
                            <tr key={key} className="hover:bg-muted/5 transition-colors odd:bg-card/5">
                              <td className="px-5 py-3.5 font-mono text-xs text-primary font-semibold align-top">{key}</td>
                              <td className="px-5 py-3.5 text-muted-foreground align-top">
                                {renderDetailValue(key, val)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t flex justify-end bg-card">
              <Button onClick={() => setIsOpen(false)} variant="secondary" className="cursor-pointer text-xs h-9">
                Close Directory
              </Button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
