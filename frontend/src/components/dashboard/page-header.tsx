"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type Props = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
};

export default function DashboardPageHeader({ title, subtitle, className }: Props) {
  return (
    <div className={cn("space-y-1", className)}>
      <h1 className="text-4xl font-extrabold tracking-tight text-foreground">{title}</h1>
      {subtitle ? <p className="text-lg text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

