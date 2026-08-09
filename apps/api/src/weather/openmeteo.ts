// Open-Meteo historical archive (free, no key, CC BY 4.0): hourly weather for
// any coordinates back to 1940. One URL = one grid cell × one calendar day —
// small responses (~1KB), and past weather never changes, so each URL is
// effectively immutable and fetch_cache makes re-runs free.

const BASE = "https://archive-api.open-meteo.com/v1/archive";

export type ArchiveResponse = {
  hourly?: {
    time?: (string | null)[];
    temperature_2m?: (number | null)[];
    dew_point_2m?: (number | null)[];
    relative_humidity_2m?: (number | null)[];
  };
};

// Takes the cell's geo_key, not raw coordinates: identical cells build
// byte-identical URLs, so the fetch_cache dedupe holds by construction.
// The timezone makes Open-Meteo return local wall-clock hours, matching
// events.start_time — no offset math, no DST cases.
export function archiveDayUrl(
  geoKey: string,
  dateIso: string,
  timezone: string,
): string {
  const [latitude = "", longitude = ""] = geoKey.split(",");
  const params = new URLSearchParams({
    latitude,
    longitude,
    start_date: dateIso,
    end_date: dateIso,
    hourly: "temperature_2m,dew_point_2m,relative_humidity_2m",
    temperature_unit: "fahrenheit",
    timezone,
  });
  return `${BASE}?${params}`;
}

export type HourReading = {
  hour: number;
  temp: number | null;
  dew: number | null;
  humidity: number | null;
};

// Zips Open-Meteo's parallel hourly arrays (index i of every array is the
// same hour) into one reading per hour, dropping entries whose timestamp is
// missing or malformed. Individual values may still be null — ERA5 has gaps.
export function hourReadings(data: ArchiveResponse | null): HourReading[] {
  const hourly = data?.hourly;
  const readings: HourReading[] = [];
  for (const [i, time] of (hourly?.time ?? []).entries()) {
    const hour = time ? Number(time.slice(11, 13)) : NaN;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    readings.push({
      hour,
      temp: hourly?.temperature_2m?.[i] ?? null,
      dew: hourly?.dew_point_2m?.[i] ?? null,
      humidity: hourly?.relative_humidity_2m?.[i] ?? null,
    });
  }
  return readings;
}
