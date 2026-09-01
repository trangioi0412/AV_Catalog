import React from "react";
import Link from "next/link";
import Image from "next/image";
import { WixProduct, WixBrand } from "@/lib/services/wixCms";
import { transformWixImageUrl } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

interface RelatedProductsProps {
  currentProduct: WixProduct;
  allProducts: WixProduct[];
  brands: WixBrand[];
}

export function RelatedProducts({ currentProduct, allProducts, brands }: RelatedProductsProps) {
  // Compute recommendation scores in-memory
  const recommendations = React.useMemo(() => {
    const brandMap = new Map(brands.map((b) => [b._id, b.name]));

    return allProducts
      .filter((prod) => prod._id !== currentProduct._id) // exclude current
      .map((prod) => {
        let score = 0;
        
        // Match brand
        if (prod.Brand && prod.Brand === currentProduct.Brand) {
          score += 3;
        }
        
        // Match category
        if (prod.Category && prod.Category.toLowerCase() === currentProduct.Category?.toLowerCase()) {
          score += 2;
        }

        // Match series
        if (prod.Series && prod.Series === currentProduct.Series) {
          score += 1;
        }

        return {
          product: prod,
          score,
          brandName: brandMap.get(prod.Brand) || "AV Brand",
        };
      })
      .filter((rec) => rec.score > 0) // only include relevant ones
      .sort((a, b) => b.score - a.score) // sort by highest score first
      .slice(0, 4); // return top 4
  }, [allProducts, currentProduct, brands]);

  if (recommendations.length === 0) {
    return null; // Don't render if there are no related items
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Recommended Related Products</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Explore companion components and similar AV hardware from the catalog.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {recommendations.map(({ product, brandName }, idx) => {
          // Fallback slug to model code in lowercase if slug is not defined
          const slug = product.slug || product.Product.toLowerCase().replace(/\s+/g, "-");
          const imgUrl = transformWixImageUrl(product.image);

          return (
            <Link 
              key={idx}
              href={`/products/${slug}`}
              className="group flex flex-col h-full bg-card/45 border rounded-2xl overflow-hidden hover:bg-card/85 transition-all duration-300 hover:shadow-md border-border/70 hover:border-primary/20"
            >
              {/* Product Image Cover */}
              <div className="relative aspect-4/3 w-full bg-card/60 border-b overflow-hidden flex items-center justify-center p-4">
                <Image
                  src={imgUrl}
                  alt={product.Title}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                  loading="lazy"
                  className="object-contain group-hover:scale-105 transition-transform duration-300 p-2"
                />
              </div>

              {/* Details Content */}
              <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="font-semibold text-primary/80 uppercase">
                      {brandName}
                    </span>
                    <span className="text-muted-foreground/50">•</span>
                    <span className="text-muted-foreground">
                      {product.Category}
                    </span>
                  </div>
                  <h3 className="font-bold text-sm text-foreground line-clamp-2 group-hover:text-primary transition-colors">
                    {product.Title}
                  </h3>
                </div>

                <div className="flex items-center justify-between pt-2 text-xs font-semibold text-primary border-t border-border/40">
                  <span className="font-mono text-muted-foreground text-[10px]">
                    Model: {product.Product}
                  </span>
                  <span className="flex items-center gap-0.5 group-hover:translate-x-1 transition-transform">
                    View
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
