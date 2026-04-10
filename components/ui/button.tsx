"use client";
import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost" | "danger" | "subtle";
  size?: "xs" | "sm" | "md" | "lg";
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, children, disabled, ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center gap-1.5 font-medium rounded-[10px] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed select-none whitespace-nowrap";

    const variants = {
      primary:
        "bg-[#002FA7] text-white hover:bg-[#1a47c0] active:bg-[#001f7a] shadow-sm focus-visible:ring-[#002FA7]",
      outline:
        "border border-[#002FA7]/30 text-[#002FA7] bg-white hover:bg-[#002FA7]/5 hover:border-[#002FA7]/50 active:bg-[#002FA7]/10",
      subtle:
        "bg-[#002FA7]/8 text-[#002FA7] hover:bg-[#002FA7]/12 active:bg-[#002FA7]/15",
      ghost:
        "text-gray-600 bg-transparent hover:bg-gray-100 active:bg-gray-200",
      danger:
        "bg-red-500 text-white hover:bg-red-600 active:bg-red-700 shadow-sm focus-visible:ring-red-500",
    };

    const sizes = {
      xs: "h-7 px-2.5 text-[13px]",
      sm: "h-8 px-3 text-[13px]",
      md: "h-9 px-4 text-sm",
      lg: "h-11 px-5 text-[15px]",
    };

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button };
