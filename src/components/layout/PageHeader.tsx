import React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Main page title */
  title: string;
  /** Optional subtitle / description below the title */
  description?: string;
  /** Optional JSX rendered to the right (action buttons, badges, etc.) */
  actions?: React.ReactNode;
  /** Optional icon rendered to the left of the title */
  icon?: React.ReactNode;
  /** Extra className on the wrapper */
  className?: string;
  /** Use gradient brand text for the title (default: true) */
  gradient?: boolean;
}

/**
 * PageHeader — standardised header component used across all admin pages.
 * Provides a consistent title / subtitle / actions layout with optional
 * brand-gradient text and an icon slot.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
  gradient = true,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4",
        className
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0 mt-0.5" aria-hidden="true">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1
            className={cn(
              "text-xl sm:text-2xl font-bold tracking-tight leading-tight text-balance",
              gradient && "text-gradient-brand"
            )}
          >
            {title}
          </h1>
          {description && (
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed max-w-3xl">
              {description}
            </p>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
}
