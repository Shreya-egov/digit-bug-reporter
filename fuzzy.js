// Fuzzy matching for the assignee filter: the query's characters must appear in order, not necessarily together.
// Higher scores for matches at the start, after a separator (-_. or space), in a row, or as a plain substring.

const SEPARATOR = /[-_.\s]/;

// Returns { score, positions } or null when `query` is not a subsequence of `text`. Case-insensitive.
export function fuzzyMatch(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return { score: 0, positions: [] };

  const sub = t.indexOf(q);
  if (sub >= 0) {
    const atWord = sub === 0 || SEPARATOR.test(t[sub - 1]);
    return { score: 1000 + (sub === 0 ? 200 : atWord ? 100 : 0) - sub - t.length, positions: [...q].map((_, i) => sub + i) };
  }

  // Greedy left-to-right, preferring a nearby word start, but only when the rest of the query still fits after it.
  const fits = (rest, start) => {
    for (const c of rest) { start = t.indexOf(c, start); if (start < 0) return false; start++; }
    return true;
  };
  const positions = [];
  let score = 0;
  let from = 0;
  for (let k = 0; k < q.length; k++) {
    const ch = q[k];
    let i = t.indexOf(ch, from);
    if (i < 0) return null;
    for (let j = i + 1; j <= i + 3 && j < t.length; j++) {
      if (t[j] === ch && SEPARATOR.test(t[j - 1]) && fits(q.slice(k + 1), j + 1)) { i = j; break; }
    }
    const prev = positions[positions.length - 1];
    if (i === 0) score += 15;
    else if (SEPARATOR.test(t[i - 1])) score += 10;
    if (prev !== undefined && i === prev + 1) score += 8;
    else if (prev !== undefined) score -= Math.min(i - prev - 1, 5);
    positions.push(i);
    from = i + 1;
  }
  return { score: score - t.length / 10, positions };
}
