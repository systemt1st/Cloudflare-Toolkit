export const DASHBOARD_MOBILE_MENU_TOGGLE_EVENT = "cf_toolkit_dashboard_mobile_menu_toggle";
export const GLOBAL_NOTICE_EVENT = "cf_toolkit_global_notice";

export type GlobalNotice = {
  type: "quota_exceeded";
  code?: string;
  status?: number;
};

export function dispatchDashboardMobileMenuToggle(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DASHBOARD_MOBILE_MENU_TOGGLE_EVENT));
}

export function subscribeDashboardMobileMenuToggle(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(DASHBOARD_MOBILE_MENU_TOGGLE_EVENT, listener);
  return () => window.removeEventListener(DASHBOARD_MOBILE_MENU_TOGGLE_EVENT, listener);
}

export function dispatchGlobalNotice(notice: GlobalNotice): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<GlobalNotice>(GLOBAL_NOTICE_EVENT, { detail: notice }));
}

export function subscribeGlobalNotice(listener: (notice: GlobalNotice) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const custom = event as CustomEvent<GlobalNotice>;
    if (!custom.detail) return;
    listener(custom.detail);
  };
  window.addEventListener(GLOBAL_NOTICE_EVENT, handler);
  return () => window.removeEventListener(GLOBAL_NOTICE_EVENT, handler);
}
