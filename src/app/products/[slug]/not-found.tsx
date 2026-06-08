import React from "react";
import Link from "next/link";
import { Search, ArrowLeft, Home, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ProductNotFound() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-6 text-center animate-in-fade">
      {/* 404 Visual Icon */}
      <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
        <AlertCircle className="w-10 h-10 text-destructive" />
      </div>

      {/* Message */}
      <div className="max-w-md space-y-3">
        <h1 className="text-3xl font-extrabold tracking-tight">Product Not Found</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          The product model slug you are trying to access does not exist in the Wix CMS collection or is currently offline. 
        </p>
      </div>

      {/* Suggested Actions */}
      <div className="mt-8 flex flex-col sm:flex-row gap-4">
        <Button asChild variant="default" className="shadow-lg shadow-primary/20 gap-2 h-11 px-6">
          <Link href="/">
            <Home className="w-4 h-4" />
            Go to Catalog Manager
          </Link>
        </Button>
        <Button asChild variant="outline" className="gap-2 h-11 px-6">
          <Link href="/admin/dashboard">
            <Search className="w-4 h-4" />
            Check Discovery Queue
          </Link>
        </Button>
      </div>

      {/* Help text */}
      <p className="text-xs text-muted-foreground mt-8">
        If you just added this product, it may take a few moments to sync or revalidate.
      </p>
    </div>
  );
}
