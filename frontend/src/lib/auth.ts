export const AUTH_CHANGED_EVENT = "cf_toolkit_auth_changed";
export const AUTH_STATUS_COOKIE_KEY = "cf_toolkit_authed";

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const parts = document.cookie ? document.cookie.split("; ") : [];
  for (const part of parts) {
    if (!part.startsWith(prefix)) continue;
    return decodeURIComponent(part.slice(prefix.length));
  }
  return null;
}

function clearCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function setCookieValue(name: string, value: string): void {
  if (typeof document === "undefined") return;
  const maxAgeSeconds = 60 * 60 * 24 * 365;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
    value
  )}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

function dispatchAuthChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function subscribeAuthChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(AUTH_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener(AUTH_CHANGED_EVENT, listener);
  };
}

export function isAuthed(): boolean {
  return getCookieValue(AUTH_STATUS_COOKIE_KEY) === "1";
}

export function markAuthed(): void {
  setCookieValue(AUTH_STATUS_COOKIE_KEY, "1");
  dispatchAuthChanged();
}

export function markLoggedOut(): void {
  clearCookie(AUTH_STATUS_COOKIE_KEY);
  dispatchAuthChanged();
}
