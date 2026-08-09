// Pure pieces of the weather-normals stage (issue #5): the grid key, the
// sampling window, and the heat score. No I/O here — the rounding rules and
// thresholds are the opinionated part of this stage, so they get tests.

// Grid cell key, 'lat,lon' rounded to 2dp (~1km): nearby races share a cell,
// which is the whole dedupe — 182 races collapse to ~61 cells. This function
// is the ONLY place the key is derived; readers (e.g. /debug) must call it
// too, never re-round in SQL, so writer and reader can't disagree on float
// edge cases. toFixed keeps trailing zeros ('25.70'), keeping keys stable.
export function geoKey(lat: number, lon: number): string {
  const part = (n: number) => {
    const fixed = n.toFixed(2);
    return fixed === "-0.00" ? "0.00" : fixed;
  };
  return `${part(lat)},${part(lon)}`;
}

// The same calendar day across the N years before currentYear: a 2026-10-17
// race samples the ten Oct 17ths of 2016–2025. Anchoring on completed years
// (not "10 years back from the race date") keeps every sampled date safely
// inside the archive — Open-Meteo lags ~5 days behind realtime — and keeps
// normals stable within a calendar year. Feb 29 only exists in leap years;
// invalid dates are skipped and years_sampled records the truth.
export function sampleDates(
  monthDay: string,
  currentYear: number,
  years = 10,
): string[] {
  const dates: string[] = [];
  for (let year = currentYear - years; year < currentYear; year++) {
    const iso = `${year}-${monthDay}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) continue;
    if (parsed.toISOString().slice(0, 10) !== iso) continue;
    dates.push(iso);
  }
  return dates;
}

// Heat score 1–5 from dew point alone, not heat index or humidity %: relative
// humidity swings with air temp (100% RH at 50°F is a pleasant morning), and
// heat index models shade-at-rest, while dew point measures the absolute
// moisture that blocks sweat evaporation — the number runners actually check.
// Bands follow common running guidance: under 55°F is comfortable, 70°F+ is
// oppressive. GOAL.md's flagship example (55°F dew point in Miami) lands at 1.
export function heatScore(dewPointF: number | null): number | null {
  if (dewPointF === null) return null;
  if (dewPointF <= 55) return 1;
  if (dewPointF <= 60) return 2;
  if (dewPointF <= 65) return 3;
  if (dewPointF <= 70) return 4;
  return 5;
}
