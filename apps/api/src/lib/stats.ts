// Shared pipeline statistics. Lives in lib/ because two stages need it:
// ingest (median finish time) and weather (median temp/dew point).

// Median, not mean, everywhere the pipeline summarizes history: one outlier
// year (a freak cold front, a walk-heavy charity field) shouldn't drag the
// "typical" number. Returns the exact midpoint — callers that store INTEGER
// columns round at the call site.
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
