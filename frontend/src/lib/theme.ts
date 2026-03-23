export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "cf_toolkit:theme";

function normalizeThemeMode(raw: unknown): ThemeMode {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function getThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    return normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? getSystemTheme() : mode;
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;

  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  (root.style as any).colorScheme = resolved;

  if (typeof window === "undefined") return;
  try {
    if (mode === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore quota/security errors
  }
}

