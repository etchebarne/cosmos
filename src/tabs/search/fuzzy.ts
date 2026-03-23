export function fuzzyMatch(
  query: string,
  target: string,
): { score: number; indices: number[] } | null {
  const qLower = query.toLowerCase();
  const tLower = target.toLowerCase();

  let qi = 0;
  const indices: number[] = [];

  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (tLower[i] === qLower[qi]) {
      indices.push(i);
      qi++;
    }
  }

  if (qi !== query.length) return null;

  let score = 0;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (i > 0 && idx === indices[i - 1] + 1) score += 10;
    if (idx === 0 || "/.-_ \\".includes(target[idx - 1])) score += 5;
    if (target[idx] === query[i]) score += 1;
  }
  score -= target.length * 0.1;
  const lastSlash = target.lastIndexOf("/");
  if (lastSlash >= 0 && indices[0] > lastSlash) score += 8;

  return { score, indices };
}

export function highlightedParts(
  text: string,
  indices: number[],
): { text: string; highlighted: boolean }[] {
  const set = new Set(indices);
  const parts: { text: string; highlighted: boolean }[] = [];
  let current = "";
  let isHighlighted = set.has(0);

  for (let i = 0; i < text.length; i++) {
    const h = set.has(i);
    if (h !== isHighlighted) {
      if (current) parts.push({ text: current, highlighted: isHighlighted });
      current = "";
      isHighlighted = h;
    }
    current += text[i];
  }
  if (current) parts.push({ text: current, highlighted: isHighlighted });

  return parts;
}
