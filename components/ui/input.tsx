"use client";
import { cn } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  inputSize?: "sm" | "md";
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, inputSize = "md", ...props }, ref) => {
    const h = inputSize === "sm" ? "h-9" : "h-10";
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-[13px] font-medium text-gray-700">{label}</label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={cn(
              `w-full ${h} bg-white border border-gray-200 rounded-[10px] px-3.5 text-sm text-gray-900 placeholder:text-gray-400`,
              "focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10",
              "transition-all duration-150",
              icon && "pl-9",
              error && "border-red-400 focus:border-red-400 focus:ring-red-400/10",
              className
            )}
            {...props}
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
