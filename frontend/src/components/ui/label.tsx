import * as React from "react";

import { cn } from "@/lib/utils";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "text-[10px] font-bold uppercase tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
