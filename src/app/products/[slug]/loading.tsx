import React from "react";

export default function ProductDetailLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground pb-24 space-y-12 animate-pulse">
      {/* Hero Header Area Skeleton */}
      <div className="relative border-b bg-card/10 backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
          {/* Back button skeleton */}
          <div className="h-4 w-36 bg-muted rounded-md" />

          {/* Hero Content Grid Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
            {/* Gallery Column */}
            <div className="lg:col-span-5 space-y-4">
              <div className="aspect-4/3 w-full bg-muted rounded-2xl" />
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-20 aspect-square bg-muted rounded-xl" />
                ))}
              </div>
            </div>

            {/* Details Column */}
            <div className="lg:col-span-7 space-y-6">
              <div className="flex gap-2">
                <div className="h-6 w-20 bg-muted rounded-md" />
                <div className="h-6 w-24 bg-muted rounded-md" />
              </div>

              <div className="space-y-3">
                <div className="h-10 w-3/4 bg-muted rounded-xl" />
                <div className="h-5 w-1/3 bg-muted rounded-md" />
              </div>

              <div className="space-y-2">
                <div className="h-4 w-full bg-muted rounded-md" />
                <div className="h-4 w-5/6 bg-muted rounded-md" />
                <div className="h-4 w-4/5 bg-muted rounded-md" />
              </div>

              <div className="h-28 w-full bg-muted rounded-xl" />

              <div className="flex gap-4">
                <div className="h-12 flex-1 bg-muted rounded-xl" />
                <div className="h-12 flex-1 bg-muted rounded-xl" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Body Skeleton */}
      <div className="max-w-[1400px] mx-auto px-6 grid grid-cols-1 gap-12">
        {/* Overview Skeleton */}
        <div className="border-b pb-12 space-y-4">
          <div className="h-6 w-48 bg-muted rounded-md" />
          <div className="space-y-2">
            <div className="h-4 w-full bg-muted rounded-md" />
            <div className="h-4 w-full bg-muted rounded-md" />
            <div className="h-4 w-4/5 bg-muted rounded-md" />
          </div>
        </div>

        {/* Specifications Skeleton */}
        <div className="border-b pb-12 space-y-6">
          <div className="flex justify-between items-center">
            <div className="h-6 w-56 bg-muted rounded-md" />
            <div className="h-10 w-72 bg-muted rounded-md" />
          </div>
          <div className="border rounded-2xl overflow-hidden divide-y divide-border">
            <div className="h-12 bg-muted" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-muted/30" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
