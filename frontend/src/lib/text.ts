"use client";

export type ParseLinesOptions = {
  dedupe?: boolean;
  allowComments?: boolean;
  commentPrefixes?: string[];
};

export function parseLines(text: string, options: ParseLinesOptions = {}): string[] {
  const allowComments = options.allowComments ?? true;
  const commentPrefixes = options.commentPrefixes ?? ["#", "//"];
  const dedupe = options.dedupe ?? true;

  const seen = dedupe ? new Set<string>() : null;
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/g)) {
    const line = raw.trim();
    if (!line) continue;
    if (allowComments && commentPrefixes.some((p) => line.startsWith(p))) continue;
    if (seen) {
      if (seen.has(line)) continue;
      seen.add(line);
    }
    out.push(line);
  }
  return out;
}

