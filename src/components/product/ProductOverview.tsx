import React from "react";
import { WixProduct } from "@/lib/services/wixCms";
import { Check, Info, Layers, Target } from "lucide-react";

interface ProductOverviewProps {
  product: WixProduct;
}

export function ProductOverview({ product }: ProductOverviewProps) {
  // Split features
  const features = React.useMemo(() => {
    if (!product.MainFeature) return [];
    return product.MainFeature.split(";")
      .map((f) => f.trim())
      .filter(Boolean);
  }, [product.MainFeature]);

  // Clean overview HTML text defensively
  const hasOverview = !!product.ProductOverview;

  return (
    <div className="space-y-10">
      {/* Overview rich text details */}
      {hasOverview && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight">Product Overview</h2>
          </div>
          <div 
            className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground leading-relaxed space-y-4"
            dangerouslySetInnerHTML={{ __html: product.ProductOverview || "" }}
          />
        </div>
      )}

      {/* Grid of Key Features */}
      {features.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight">Key Features & Technical Capabilities</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((feature, idx) => (
              <div 
                key={idx}
                className="flex items-start gap-3 p-4 rounded-xl border bg-card/20 hover:bg-card/50 transition-all duration-300 hover:shadow-sm"
              >
                <div className="w-6 h-6 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <span className="text-sm font-medium text-foreground">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Target Use Cases stub (If Series or Category provides context) */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/5 to-primary/0 border border-primary/10">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-5 h-5 text-primary" />
          <h3 className="text-base font-semibold text-foreground">Ideal Applications & Use Cases</h3>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Designed specifically for {product.Category?.toLowerCase() || "enterprise AV"} deployments. This solution is highly optimized for corporate conference rooms, training rooms, educational setups, and remote workspaces requiring professional-grade hardware.
        </p>
      </div>
    </div>
  );
}
