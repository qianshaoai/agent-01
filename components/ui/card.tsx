import { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: "sm" | "md" | "lg" | "none";
  hover?: boolean;
}

export function Card({ className, padding = "md", hover = false, ...props }: CardProps) {
  const pad = {
    none: "",
    sm: "p-3",
    md: "p-5",
    lg: "p-6",
  }[padding];
  return <div className={cn("card", pad, hover && "card-hover", className)} {...props} />;
}

interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function CardHeader({ title, description, action, className, ...props }: CardHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3 mb-4", className)} {...props}>
      <div className="min-w-0">
        <h3 className="h-card">{title}</h3>
        {description && <p className="t-xs t-muted mt-1">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
