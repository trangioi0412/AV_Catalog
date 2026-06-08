"use client";

import React from "react";
import Image from "next/image";
import { transformWixImageUrl } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";

interface ProductGalleryProps {
  mainImage?: string;
  galleryImages?: string[];
  productName: string;
}

export function ProductGallery({ mainImage, galleryImages = [], productName }: ProductGalleryProps) {
  // Combine mainImage and galleryImages into a single deduplicated list
  const allImages = React.useMemo(() => {
    const list: string[] = [];
    if (mainImage) list.push(mainImage);
    
    // Add gallery images, filtering out duplicates of the main image
    galleryImages.forEach((img) => {
      if (img && !list.includes(img)) {
        list.push(img);
      }
    });
    
    // If no images exist at all, we will use a fallback placeholder
    if (list.length === 0) {
      list.push("/placeholder-image.png");
    }
    
    return list;
  }, [mainImage, galleryImages]);

  const [activeIndex, setActiveIndex] = React.useState(0);
  const [isZoomed, setIsZoomed] = React.useState(false);

  const handlePrev = () => {
    setActiveIndex((prev) => (prev === 0 ? allImages.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev === allImages.length - 1 ? 0 : prev + 1));
  };

  const activeImageUrl = transformWixImageUrl(allImages[activeIndex]);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Main Display Area */}
      <div className="relative aspect-4/3 w-full bg-card/40 backdrop-blur-md border border-border/80 rounded-2xl overflow-hidden shadow-lg group">
        {/* Active Image */}
        <div 
          className="relative w-full h-full cursor-zoom-in overflow-hidden"
          onMouseEnter={() => setIsZoomed(true)}
          onMouseLeave={() => setIsZoomed(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={activeImageUrl}
            alt={`${productName} image ${activeIndex + 1}`}
            className={`w-full h-full object-contain p-6 transition-transform duration-500 ease-out ${
              isZoomed ? "scale-125" : "scale-100"
            }`}
          />
        </div>

        {/* Floating Badges / Tools */}
        <div className="absolute top-4 right-4 flex gap-2">
          <span className="text-[10px] px-2 py-1 font-semibold tracking-wider uppercase bg-black/60 text-white border border-white/10 rounded-full backdrop-blur-md">
            {activeIndex + 1} / {allImages.length}
          </span>
        </div>

        {/* Carousel Navigation Arrows (Only show if > 1 image) */}
        {allImages.length > 1 && (
          <>
            <button
              onClick={handlePrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/75 text-white border border-white/5 flex items-center justify-center backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 shadow-md"
              aria-label="Previous image"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={handleNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/75 text-white border border-white/5 flex items-center justify-center backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 shadow-md"
              aria-label="Next image"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* Thumbnails list (Only show if > 1 image) */}
      {allImages.length > 1 && (
        <div className="flex gap-2.5 overflow-x-auto py-2 px-1 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
          {allImages.map((imgUrl, idx) => {
            const isSelected = idx === activeIndex;
            return (
              <button
                key={idx}
                onClick={() => setActiveIndex(idx)}
                className={`relative flex-shrink-0 w-20 aspect-square rounded-xl overflow-hidden border-2 bg-card/60 transition-all duration-300 ${
                  isSelected 
                    ? "border-primary scale-95 shadow-md" 
                    : "border-border/40 hover:border-border/80 opacity-70 hover:opacity-100"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={transformWixImageUrl(imgUrl)}
                  alt={`${productName} thumbnail ${idx + 1}`}
                  className="w-full h-full object-contain p-1.5"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
