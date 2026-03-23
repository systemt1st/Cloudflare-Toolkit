import { refreshAccessToken } from "@/lib/api";
import { isAuthed } from "@/lib/auth";

export async function ensureAuthed(initialAuthed?: boolean): Promise<boolean> {
  if (isAuthed()) return true;
  if (!initialAuthed) return false;
  try {
    return await refreshAccessToken();
  } catch {
    return false;
  }
}

