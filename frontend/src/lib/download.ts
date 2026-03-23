import { ApiError, refreshAccessToken } from "./api";

function parseFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const m = /filename=\"?([^\";]+)\"?/i.exec(contentDisposition);
  return m?.[1] || null;
}

export async function downloadFromApi(path: string, defaultFilename: string): Promise<void> {
  const url = path.startsWith("http") ? path : path.startsWith("/") ? path : `/${path}`;

  async function request(): Promise<Response> {
    return fetch(url, { method: "GET", credentials: "include" });
  }

  let res = await request();
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await request();
    }
  }

  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    const data = contentType.includes("application/json") ? await res.json().catch(() => null) : null;
    const body = data?.error || ({ code: "HTTP_ERROR", message: res.statusText } as const);
    throw new ApiError(res.status, body);
  }

  const blob = await res.blob();
  const filename = parseFilename(res.headers.get("content-disposition")) || defaultFilename;

  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
