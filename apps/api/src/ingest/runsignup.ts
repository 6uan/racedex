// RunSignup REST API: response shapes (the fields we read, verified against
// live responses) and URL builders. Free and unauthenticated for public race
// data. Quirks: booleans are "T"/"F" strings, dates are "M/D/YYYY [HH:MM]",
// money is "$15.00", and single-object endpoints wrap everything one level
// deep ({"race": {...}}).

const BASE = "https://runsignup.com/rest";

export type RsuAddress = {
  street?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  country_code?: string | null;
};

export type RsuRegistrationPeriod = {
  registration_opens?: string | null;
  registration_closes?: string | null;
  race_fee?: string | null;
  processing_fee?: string | null;
};

export type RsuEvent = {
  event_id: number;
  name: string;
  start_time?: string | null;
  event_type?: string | null;
  distance?: string | null;
  registration_periods?: RsuRegistrationPeriod[];
};

export type RsuRace = {
  race_id: number;
  name: string;
  next_date?: string | null;
  is_draft_race?: string;
  is_private_race?: string;
  description?: string | null;
  url?: string | null;
  address?: RsuAddress | null;
  timezone?: string | null;
  // Search returns the next occurrence's events; the detail endpoint returns
  // the full history (past years included) — that's how results are found.
  events?: RsuEvent[];
};

export type RsuSearchResponse = { races?: { race: RsuRace }[] };
export type RsuRaceDetailResponse = { race?: RsuRace };

export type RsuResult = {
  place?: number | null;
  chip_time?: string | null;
  clock_time?: string | null;
};

export type RsuResultSet = {
  individual_result_set_id: number;
  individual_result_set_name?: string | null;
  public_results?: string;
  results?: RsuResult[];
};

export type RsuResultSetsResponse = {
  individual_results_sets?: RsuResultSet[];
};

export const SEARCH_PAGE_SIZE = 100;
export const RESULTS_PAGE_SIZE = 1000;

export function searchUrl(
  zip: string,
  radiusMiles: number,
  page: number,
): string {
  const params = new URLSearchParams({
    format: "json",
    zipcode: zip,
    radius: String(radiusMiles),
    start_date: "today", // future occurrences only; history comes via detail
    events: "T", // include events + registration periods inline
    page: String(page),
    results_per_page: String(SEARCH_PAGE_SIZE),
  });
  return `${BASE}/races?${params}`;
}

export function raceDetailUrl(raceId: number): string {
  return `${BASE}/race/${raceId}?format=json`;
}

export function resultSetsUrl(raceId: number, eventId: number): string {
  return `${BASE}/race/${raceId}/results/get-result-sets?format=json&event_id=${eventId}`;
}

export function resultsUrl(
  raceId: number,
  eventId: number,
  resultSetId: number,
  page: number,
): string {
  const params = new URLSearchParams({
    format: "json",
    event_id: String(eventId),
    individual_result_set_id: String(resultSetId),
    page: String(page),
    results_per_page: String(RESULTS_PAGE_SIZE),
  });
  return `${BASE}/race/${raceId}/results/get-results?${params}`;
}
