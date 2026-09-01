import React from "react";
import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { getProductBySlug, getBrandById, getAllProductsForPublicPage, getActiveBrandsForPublicPage } from "@/lib/services/wixCms";
import { transformWixImageUrl } from "@/lib/utils";
import { ProductHero } from "@/components/product/ProductHero";
import { ProductOverview } from "@/components/product/ProductOverview";
import { ProductSpecifications } from "@/components/product/ProductSpecifications";
import { ProductResources } from "@/components/product/ProductResources";
import { ProductCompatibility } from "@/components/product/ProductCompatibility";
import { RelatedProducts } from "@/components/product/RelatedProducts";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Dynamic SEO Metadata Generation
 */
export async function generateMetadata(
  props: PageProps,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);

  if (!product) {
    return {
      title: "Product Not Found",
      description: "The requested audiovisual equipment model could not be found in our catalog.",
    };
  }

  const brand = await getBrandById(product.Brand);
  const brandName = brand?.name || "AV Brand";
  const title = `${product.Title} - ${brandName} | AV Catalog Platform`;
  
  // Strip HTML for plain description
  const description = product.ProductOverview
    ? product.ProductOverview.replace(/<[^>]*>/g, "").substring(0, 160).trim() + "..."
    : `Explore specs, datasheet, resources, and room designs for the ${brandName} ${product.Product}.`;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://avcatalog.itwebsite.com";
  const canonicalUrl = `${baseUrl}/products/${slug}`;
  const imageUrl = transformWixImageUrl(product.image);

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: "AV Catalog Manager",
      images: [
        {
          url: imageUrl,
          width: 800,
          height: 600,
          alt: product.Title,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

/**
 * Main Product Detail Page (ISR Enabled)
 */
export default async function ProductDetailPage(props: PageProps) {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);

  if (!product) {
    notFound();
  }

  // Fetch all companion catalog items in parallel. Deliberately the
  // *PublicPage variants (ISR-cached) — the admin ones set `cache: "no-store"`
  // on their fetches, which would force this whole route dynamic on every
  // request and defeat `revalidate` below.
  const [brand, allProducts, brands] = await Promise.all([
    getBrandById(product.Brand),
    getAllProductsForPublicPage(),
    getActiveBrandsForPublicPage()
  ]);

  const brandName = brand?.name || "AV Brand";
  
  // Format description for JSON-LD
  const plainDescription = product.ProductOverview
    ? product.ProductOverview.replace(/<[^>]*>/g, "").substring(0, 250).trim() + "..."
    : `Technical datasheet, resources, and compatibilities for the ${brandName} ${product.Product}.`;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://avcatalog.itwebsite.com";
  const canonicalUrl = `${baseUrl}/products/${slug}`;
  const imageUrl = transformWixImageUrl(product.image);

  // JSON-LD Structured Schema Script
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": product.Title,
    "image": imageUrl,
    "description": plainDescription,
    "model": product.Product,
    "category": product.Category,
    "brand": {
      "@type": "Brand",
      "name": brandName
    },
    "offers": {
      "@type": "Offer",
      "priceCurrency": "VND",
      "price": "0",
      "priceSpecification": {
        "@type": "UnitPriceSpecification",
        "priceType": "Contact for pricing"
      },
      "availability": "https://schema.org/InStock",
      "url": canonicalUrl
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-24 space-y-12">
      {/* Dynamic Schema Injection */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero Header Area */}
      <div className="relative border-b bg-card/10 backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
          {/* Back Action breadcrumb */}
          <div>
            <Link 
              href="/"
              className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors group"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              Back to Catalog Manager
            </Link>
          </div>

          {/* Product Hero block */}
          <ProductHero product={product} brandName={brandName} />
        </div>
      </div>

      {/* Main Details Body */}
      <div className="max-w-[1400px] mx-auto px-6 grid grid-cols-1 gap-12">
        {/* 1. Overview */}
        <div className="border-b pb-12">
          <ProductOverview product={product} />
        </div>

        {/* 2. Specifications */}
        <div className="border-b pb-12">
          <ProductSpecifications technicalSpecifications={product.TechnicalSpecifications} />
        </div>

        {/* 3. Resources */}
        {product.Datasheet || product.Manual || product.Brochure || product.Firmware || product.Videos ? (
          <div className="border-b pb-12">
            <ProductResources product={product} />
          </div>
        ) : null}

        {/* 4. Compatibility */}
        <div className="border-b pb-12">
          <ProductCompatibility product={product} />
        </div>

        {/* 5. Related Products */}
        <div>
          <RelatedProducts 
            currentProduct={product}
            allProducts={allProducts}
            brands={brands}
          />
        </div>
      </div>
    </div>
  );
}

// Enable ISR revalidation
export const revalidate = 3600; // revalidate cache every hour
export const dynamicParams = true; // allow request-time generation of new product pages
