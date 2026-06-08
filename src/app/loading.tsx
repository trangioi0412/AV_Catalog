"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";

export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-md">
      <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-card border shadow-xl max-w-sm w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        {/* Animated outer ring */}
        <div className="relative w-16 h-16 flex items-center justify-center">
          <motion.div
            className="absolute inset-0 border-4 border-primary/20 rounded-full"
            initial={{ opacity: 0.5 }}
          />
          <motion.div
            className="absolute inset-0 border-4 border-t-primary rounded-full"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          />
          <Loader2 className="w-6 h-6 text-primary animate-pulse" />
        </div>

        <div className="text-center space-y-2 mt-2">
          <h3 className="font-bold text-lg tracking-tight">Loading Page</h3>
          <p className="text-sm text-muted-foreground">
            Fetching latest data from catalog and services...
          </p>
        </div>

        {/* Shimmer loading progress bar */}
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden relative">
          <motion.div
            className="absolute top-0 bottom-0 left-0 bg-primary rounded-full"
            animate={{ 
              left: ["-100%", "100%"],
              width: ["30%", "30%"]
            }}
            transition={{ 
              repeat: Infinity, 
              duration: 1.5, 
              ease: "easeInOut" 
            }}
          />
        </div>
      </div>
    </div>
  );
}
