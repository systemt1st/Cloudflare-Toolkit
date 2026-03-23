import {
  CreditCard,
  FileText,
  Globe,
  Gauge,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Network,
  Route,
  Trash2,
  Zap,
  ListChecks,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type SidebarItem = {
  href: string;
  icon: LucideIcon;
  labelKey: string;
  permissions?: string[];
};

export const sidebarConfig: SidebarItem[] = [
  { href: "/accounts", icon: Settings, labelKey: "accounts", permissions: ["user"] },
  { href: "/domains", icon: Globe, labelKey: "domains", permissions: ["user"] },
  { href: "/domains/add", icon: PlusCircle, labelKey: "domainsAdd", permissions: ["user"] },
  { href: "/domains/delete", icon: Trash2, labelKey: "domainsDelete", permissions: ["user"] },
  { href: "/dns/resolve", icon: Search, labelKey: "dnsResolve", permissions: ["user"] },
  { href: "/dns/replace", icon: RefreshCw, labelKey: "dnsReplace", permissions: ["user"] },
  { href: "/dns/delete", icon: Trash2, labelKey: "dnsDelete", permissions: ["user"] },
  { href: "/dns/proxy", icon: Network, labelKey: "dnsProxy", permissions: ["user"] },
  { href: "/ssl/batch", icon: Shield, labelKey: "sslBatch", permissions: ["user"] },
  { href: "/cache/batch", icon: Zap, labelKey: "cacheBatch", permissions: ["user"] },
  { href: "/cache/purge", icon: Trash2, labelKey: "cachePurge", permissions: ["user"] },
  { href: "/speed/batch", icon: Gauge, labelKey: "speedBatch", permissions: ["user"] },
  { href: "/rules", icon: Route, labelKey: "rules", permissions: ["user"] },
  { href: "/other/batch", icon: SlidersHorizontal, labelKey: "otherBatch", permissions: ["user"] },
  { href: "/tasks", icon: ListChecks, labelKey: "tasks", permissions: ["user"] },
  { href: "/operation-logs", icon: FileText, labelKey: "operationLogs", permissions: ["user"] },
  { href: "/subscription", icon: CreditCard, labelKey: "subscription", permissions: ["user"] },
];
