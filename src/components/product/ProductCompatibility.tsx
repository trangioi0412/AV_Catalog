import React from "react";
import { WixProduct } from "@/lib/services/wixCms";
import { CheckCircle2, ShieldCheck, HelpCircle } from "lucide-react";

interface ProductCompatibilityProps {
  product: WixProduct;
}

export function ProductCompatibility({ product }: ProductCompatibilityProps) {
  // Parse solutions, products, and rooms list dynamically
  const parseList = (str?: string): string[] => {
    if (!str) return [];
    return str
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const solutions = React.useMemo(() => {
    const list = parseList(product.CompatibleSolutions);
    if (list.length > 0) return list;

    // Smart fallbacks based on Category
    const category = (product.Category || "").toLowerCase();
    if (category.includes("camera") || category.includes("video") || category.includes("bar") || category.includes("speaker") || category.includes("mic")) {
      return ["Microsoft Teams Rooms", "Zoom Rooms", "Google Meet", "Cisco Webex"];
    }
    return ["Standard BYOD Rooms", "USB Plug-and-Play"];
  }, [product.CompatibleSolutions, product.Category]);

  const rooms = React.useMemo(() => {
    const list = parseList(product.CompatibleRooms);
    if (list.length > 0) return list;

    // Smart fallbacks based on product keywords
    const title = (product.Title || "").toLowerCase();
    if (title.includes("pro") || title.includes("large") || title.includes("511")) {
      return ["Large Conference Room", "Boardroom", "Training Room"];
    }
    if (title.includes("mini") || title.includes("small") || title.includes("huddle")) {
      return ["Huddle Space", "Focus Room", "Small Meeting Room"];
    }
    return ["Medium Conference Room", "Executive Suite"];
  }, [product.CompatibleRooms, product.Title]);

  const companionProducts = React.useMemo(() => {
    return parseList(product.CompatibleProducts);
  }, [product.CompatibleProducts]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Platform Compatibility & Room Ecosystems</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Verify certification standards and companion solutions compatible with this model.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Solutions & Platforms */}
        <div className="p-6 border bg-card/15 rounded-2xl space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
            <h3 className="font-bold text-base text-foreground">Certified Collaboration Platforms</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            This device has undergone rigorous technical certification tests to ensure zero-touch configuration and full compatibility with the following platforms:
          </p>
          <div className="flex flex-wrap gap-2.5 pt-2">
            {solutions.map((sol, idx) => (
              <span 
                key={idx}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-card/60 text-xs font-semibold text-foreground hover:bg-card hover:border-primary/20 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                {sol}
              </span>
            ))}
          </div>
        </div>

        {/* Room Sizes / Layouts */}
        <div className="p-6 border bg-card/15 rounded-2xl space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-base text-foreground">Recommended Room Deployments</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Optimized for coverage parameters, lens fields of view, and microphone pickup grids suitable for these space classes:
          </p>
          <div className="flex flex-wrap gap-2.5 pt-2">
            {rooms.map((room, idx) => (
              <span 
                key={idx}
                className="px-3 py-1.5 rounded-xl border bg-card/60 text-xs font-semibold text-foreground"
              >
                {room}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Companion Products / Companion hardware if specified */}
      {companionProducts.length > 0 && (
        <div className="p-6 border bg-card/15 rounded-2xl space-y-4">
          <h3 className="font-bold text-base text-foreground">Recommended Companion Hardware</h3>
          <p className="text-xs text-muted-foreground">
            Complete your setup with these recommended peripherals and controller systems:
          </p>
          <div className="flex flex-wrap gap-2.5">
            {companionProducts.map((prod, idx) => (
              <span 
                key={idx}
                className="px-3 py-2 rounded-xl bg-primary/5 border border-primary/10 text-xs font-mono text-primary font-semibold"
              >
                {prod}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
