"use client";

import React from "react";
import { WixProduct } from "@/lib/services/wixCms";
import { ProductGallery } from "./ProductGallery";
import { Button } from "@/components/ui/button";
import { Send, FileText, ArrowLeftRight, HelpCircle } from "lucide-react";
import Link from "next/link";

interface ProductHeroProps {
  product: WixProduct;
  brandName: string;
}

export function ProductHero({ product, brandName }: ProductHeroProps) {
  // Extract summary description or provide fallback
  const summary = product.ProductOverview 
    ? product.ProductOverview.replace(/<[^>]*>/g, "").substring(0, 250) + "..."
    : "No product overview available. Please contact sales for technical specs.";

  // Dynamic CTAs email payload
  const requestQuoteMailto = `mailto:sales@itwebsite.com?subject=Quote Request: ${encodeURIComponent(
    brandName + " " + product.Title
  )}&body=Hello,%0A%0AI would like to request a quote for the following product:%0AProduct: ${encodeURIComponent(
    product.Title
  )}%0AModel: ${encodeURIComponent(product.Product)}%0ABrand: ${encodeURIComponent(
    brandName
  )}%0A%0APlease send pricing and availability.%0A%0AThanks!`;

  const contactSalesMailto = `mailto:support@itwebsite.com?subject=Product Inquiry: ${encodeURIComponent(
    brandName + " " + product.Title
  )}&body=Hello,%0A%0AI have questions regarding the following product:%0AProduct: ${encodeURIComponent(
    product.Title
  )}%0AModel: ${encodeURIComponent(product.Product)}%0ABrand: ${encodeURIComponent(
    brandName
  )}%0A%0APlease get in touch with me.%0A%0AThanks!`;

  return (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start animate-in-fade">
      {/* Left Column: Product Gallery */}
      <div className="lg:col-span-5 w-full">
        <ProductGallery
          mainImage={product.image}
          galleryImages={product.galleryImages}
          productName={product.Title}
        />
      </div>

      {/* Right Column: Title and Details */}
      <div className="lg:col-span-7 flex flex-col h-full justify-between">
        <div className="space-y-6">
          {/* Tags / Breadcrumbs */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 font-semibold rounded-md bg-primary/10 text-primary uppercase tracking-wider">
              {brandName}
            </span>
            <span className="text-muted-foreground">/</span>
            <span className="px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground font-medium">
              {product.Category || "AV Device"}
            </span>
            {product.Series && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="text-muted-foreground font-medium">{product.Series}</span>
              </>
            )}
          </div>

          {/* Product Name and Code */}
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gradient">
              {product.Title}
            </h1>
            <p className="text-lg font-mono text-muted-foreground">
              Model Code: <span className="text-foreground font-semibold">{product.Product}</span>
            </p>
          </div>

          {/* Short Description */}
          <div className="text-muted-foreground leading-relaxed text-base">
            <p>{summary}</p>
          </div>

          {/* Quick Specifications Preview */}
          {product.MainFeature && (
            <div className="space-y-2 bg-card/30 border rounded-xl p-4">
              <h4 className="text-sm font-semibold text-foreground">Key Highlights:</h4>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-muted-foreground list-disc pl-5">
                {product.MainFeature.split(";")
                  .map((f) => f.trim())
                  .filter(Boolean)
                  .slice(0, 4)
                  .map((feature, idx) => (
                    <li key={idx} className="hover:text-foreground transition-colors duration-200">
                      {feature}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>

        {/* CTA Actions */}
        <div className="mt-8 flex flex-col sm:flex-row gap-4">
          <Button asChild size="lg" className="flex-1 shadow-lg shadow-primary/20 gap-2 h-12">
            <a href={requestQuoteMailto}>
              <Send className="w-4 h-4" />
              Request Quote
            </a>
          </Button>
          <Button asChild variant="outline" size="lg" className="flex-1 gap-2 h-12">
            <a href={contactSalesMailto}>
              <HelpCircle className="w-4 h-4" />
              Contact Sales
            </a>
          </Button>
        </div>

        {/* Extra Actions row */}
        <div className="mt-6 pt-6 border-t flex flex-wrap gap-4 text-xs text-muted-foreground">
          {product.Datasheet && (
            <Link 
              href={product.Datasheet}
              target="_blank" 
              className="flex items-center gap-1.5 hover:text-primary transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Official Datasheet
            </Link>
          )}
          <span className="hidden sm:inline text-muted-foreground/30">|</span>
          <button 
            onClick={() => alert("Comparison feature coming soon!")}
            className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Add to Compare
          </button>
        </div>
      </div>
    </section>
  );
}
