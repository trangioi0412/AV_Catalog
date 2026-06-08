import React from "react";
import { WixProduct } from "@/lib/services/wixCms";
import { transformWixImageUrl } from "@/lib/utils";
import { FileDown, Video, Laptop, Download, FileCode2, ExternalLink } from "lucide-react";

interface ProductResourcesProps {
  product: WixProduct;
}

export function ProductResources({ product }: ProductResourcesProps) {
  // Collect all available resources in an organized format
  const resources = React.useMemo(() => {
    const items = [];

    if (product.Datasheet) {
      items.push({
        title: "Product Datasheet",
        description: "Official technical datasheet containing product parameters, audio metrics, and structural layouts.",
        url: transformWixImageUrl(product.Datasheet),
        type: "pdf",
        label: "PDF Datasheet",
      });
    }

    if (product.Manual) {
      items.push({
        title: "User Manual & Setup Guide",
        description: "Installation handbook detailing physical mounting, wiring diagrams, and first-time configuration steps.",
        url: transformWixImageUrl(product.Manual),
        type: "pdf",
        label: "PDF Manual",
      });
    }

    if (product.Brochure) {
      items.push({
        title: "Sales Brochure",
        description: "Promotional catalog overview highlighting core value propositions and brand applications.",
        url: transformWixImageUrl(product.Brochure),
        type: "pdf",
        label: "PDF Brochure",
      });
    }

    if (product.Firmware) {
      items.push({
        title: "Device Firmware Updates",
        description: "Retrieve official software updates, drivers, and device utilities to enable new features and security patches.",
        url: product.Firmware,
        type: "firmware",
        label: "Software Portal",
      });
    }

    if (product.Videos) {
      items.push({
        title: "Walkthrough & Installation Video",
        description: "Video tutorial demonstrating setup, physical alignment, and performance calibration.",
        url: product.Videos,
        type: "video",
        label: "Watch Video",
      });
    }

    return items;
  }, [product]);

  if (resources.length === 0) {
    return null; // Don't render resources section at all if empty
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Downloads & Companion Resources</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Access manuals, technical specifications, brochures, and device utilities.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {resources.map((res, idx) => {
          // Select icon based on resource type
          let Icon = FileDown;
          let colorClass = "text-red-500 bg-red-500/10";
          let actionIcon = <Download className="w-4 h-4" />;
          
          if (res.type === "video") {
            Icon = Video;
            colorClass = "text-blue-500 bg-blue-500/10";
            actionIcon = <ExternalLink className="w-4 h-4" />;
          } else if (res.type === "firmware") {
            Icon = Laptop;
            colorClass = "text-purple-500 bg-purple-500/10";
            actionIcon = <ExternalLink className="w-4 h-4" />;
          }

          return (
            <div 
              key={idx}
              className="flex flex-col h-full bg-card/45 border rounded-2xl p-5 hover:bg-card/75 transition-all duration-300 hover:shadow-md group justify-between"
            >
              <div className="space-y-4">
                {/* Header Icon */}
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                  <Icon className="w-6 h-6" />
                </div>

                {/* Details */}
                <div className="space-y-1">
                  <h3 className="font-bold text-base text-foreground group-hover:text-primary transition-colors">
                    {res.title}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {res.description}
                  </p>
                </div>
              </div>

              {/* Action Trigger */}
              <div className="mt-5 pt-4 border-t">
                <a
                  href={res.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between w-full text-xs font-semibold text-primary hover:text-primary-foreground group/btn"
                >
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/20 hover:bg-primary/10 transition-colors w-full justify-between">
                    <span>{res.label}</span>
                    {actionIcon}
                  </span>
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
