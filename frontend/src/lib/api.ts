import { markAuthed, markLoggedOut } from "./auth";
import { dispatchGlobalNotice } from "./events";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Array<{ field?: string; message?: string }>;
  };
};

const CSRF_COOKIE_KEY = "csrf_token";
const CSRF_HEADER_KEY = "X-CSRF-Token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

let refreshPromise: Promise<boolean> | null = null;

export class ApiError extends Error {
  code: string;
  details?: ApiErrorBody["error"]["details"];
  status: number;

  constructor(status: number, body: ApiErrorBody["error"]) {
    super(body.message || "Request failed");
    this.name = "ApiError";
    this.status = status;
    this.code = body.code || "UNKNOWN";
    this.details = body.details;
  }
}

export function getApiBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  const normalized = raw.replace(/\/+$/, "");
  if (normalized) return normalized;
  if (process.env.NODE_ENV === "development") return "http://localhost:8000";
  return "";
}

export async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const csrfToken = getCookieValue(CSRF_COOKIE_KEY);
      const res = await fetch(`/api/v1/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(csrfToken ? { [CSRF_HEADER_KEY]: csrfToken } : {}),
        },
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) markLoggedOut();
        return false;
      }
      markAuthed();
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

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

export async function apiRequest<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : path.startsWith("/")
      ? path
      : `${getApiBaseUrl()}/${path}`;
  const wantAuth = init.auth !== false;

  function buildHeaders(): Headers {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }

    const method = (init.method || "GET").toUpperCase();
    if (!SAFE_METHODS.has(method) && !headers.has(CSRF_HEADER_KEY)) {
      const csrfToken = getCookieValue(CSRF_COOKIE_KEY);
      if (csrfToken) headers.set(CSRF_HEADER_KEY, csrfToken);
    }
    return headers;
  }

  let headers = buildHeaders();
  let res = await fetch(url, { ...init, headers, credentials: init.credentials ?? "include" });
  if (res.status === 401 && wantAuth) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers = buildHeaders();
      res = await fetch(url, { ...init, headers, credentials: init.credentials ?? "include" });
    }
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const body: ApiErrorBody["error"] =
      data?.error || ({ code: "HTTP_ERROR", message: res.statusText } as const);
    if (body.code === "QUOTA_EXCEEDED" || res.status === 410) {
      dispatchGlobalNotice({ type: "quota_exceeded", code: body.code, status: res.status });
    }
    throw new ApiError(res.status, body);
  }

  return data as T;
}
