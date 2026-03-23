"use client";

import { recordRecentTaskFromFormCache } from "./recent-tasks";

const PREFIX = "cf_toolkit:form:";

export function buildFormCacheKey(namespace: string): string {
  return `${PREFIX}${namespace}`;
}

export function loadFormCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveFormCache(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota/security errors
  }
  try {
    recordRecentTaskFromFormCache(key, value);
  } catch {
    // ignore
  }
}

export function removeFormCache(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
