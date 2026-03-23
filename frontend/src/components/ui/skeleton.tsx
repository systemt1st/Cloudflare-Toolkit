import * as React from "react"

import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-2xl bg-black/5 dark:bg-white/10",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
