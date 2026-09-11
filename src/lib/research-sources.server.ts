import { cacheGet, cacheSet } from "@/lib/cache.server";

// ResearchCompetitor shape is duplicated below (instead of imported from
// local-research.server.ts) to keep this module runtime-independent of it —
// local-research imports this module, so a runtime import would create a cycle.
// The same approach is used by change-detection.ts.

export type ResearchCompetitor = {
  name: string;
  distanceMeters: number;
  latitude?: number | undefined;
  longitude?: number | undefined;
  address?: string | undefined;
  website?: string | undefined;
  phone?: string | undefined;
  openingHours?: string | undefined;
  openingDate?: string | undefined;
  priceLevel?: string | undefined;
  priceSamples: string[];
  rating?: number | undefined;
  reviewCount?: number | undefined;
  reviewQuote?: string | undefined;
  sourceUrl: string;
  sourceLabel: string;
};

// Secondary research sources behind the Watch tier. These run *after* the
// primary Google Places + OpenStreetMap pass and enrich the same competitor
// snapshot (deduped by name/position) with whatever extra coverage each source
// has: Foursquare ratings/price tiers, Geoapify categories/hours, Overture's
// merged global place data with contact details.
//
// Rate-limit strategy — every source is billed, so the *preview* mode used by
// user-initiated scans is deliberately conservative:
//   - at most ONE call per source per generation
//   - small result caps (5–8 places per source)
//   - results cached for 6h, so repeat scans of the same area re-bill nothing
// The weekly mail runs on *full* mode: still one call per source, but the
// cron fires weekly so the budget is a non-issue — it gets the richest caps
// (10–15 places) and every connected source.
//
// A source with no key configured is skipped silently; a source that errors is
// reported as a warning, never fatal.

export type SecondaryMode = "preview" | "full";

const RESULT_CAPS = {
  preview: { foursquare: 5, geoapify: 5, overture: 8 },
  full: { foursquare: 10, geoapify: 10, overture: 15 },
} as const;

const SECONDARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const NEARBY_RADIUS_METERS = 5_000;
const USER_AGENT = "theBizScope/1.0 (local market research demo)";

const FOURSQUARE_V3_URL = "https://api.foursquare.com/v3/places/search";
const FOURSQUARE_V2_URL = "https://api.foursquare.com/v2/venues/search";
const GEOAPIFY_URL = "https://api.geoapify.com/v2/places";
const OVERTURE_URL = "https://api.overturemapsapi.com/places";

function foursquareV3Key(): string | undefined {
  // New Foursquare Places API (v3) — single API key in the Authorization header.
  return process.env["FOURSQUARE_SERVICE_API"];
}

function foursquareClientId(): string | undefined {
  return process.env["FOURSQUARE_CLIENT_ID"];
}

function foursquareClientSecret(): string | undefined {
  return process.env["FOURSQUARE_CLIENT_SECRET"];
}

function geoapifyKey(): string | undefined {
  return process.env["GEOAPIFY_API_KEY"];
}

function overtureKey(): string | undefined {
  // Overture Maps Foundation's own hosted API (api.overturemaps.org) has been
  // retired; overturemapsapi.com serves the same Overture data with a free key.
  return process.env["OVERTURE_API_KEY"];
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.replace(/\s+/g, " ").trim();
  return result || undefined;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// --- Identity helpers (kept in sync with local-research.server.ts) ---

const NAME_STOPWORDS = /\b(the|salon|spa|ltd|limited|llc|inc)\b/g;

function normalizeName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/'s\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(NAME_STOPWORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(" ").filter(Boolean));
}

// Fraction of the larger name's tokens covered by the smaller name's tokens,
// with partial (0.75) credit for prefix/nickname matches like "sam" vs
// "samantha" and near-identical tokens like "raddiance" vs "radiance".
// Tolerates word order, dropped words, shortened first names, and typos —
// while keeping genuinely distinct names ("Hair Studio" vs "Nail Studio")
// apart, because whole-string edit distance would wrongly merge those.
function tokenCoverage(aTokens: Set<string>, bTokens: Set<string>): number {
  const larger = aTokens.size >= bTokens.size ? aTokens : bTokens;
  const smaller = aTokens === larger ? bTokens : aTokens;
  if (larger.size === 0) return 0;
  let matched = 0;
  for (const token of smaller) {
    if (larger.has(token)) {
      matched += 1;
      continue;
    }
    let best = 0;
    for (const other of larger) {
      const min = Math.min(token.length, other.length);
      if (min >= 3 && (token.startsWith(other) || other.startsWith(token))) {
        best = Math.max(best, 0.75);
        continue;
      }
      if (min >= 3 && editDistance(token, other) / Math.max(token.length, other.length) <= 0.25) {
        best = Math.max(best, 0.75);
      }
    }
    matched += best;
  }
  return matched / larger.size;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const insert = current[j - 1]! + 1;
      const remove = previous[j]! + 1;
      const replace = previous[j - 1]! + cost;
      current[j] = Math.min(insert, remove, replace);
    }
    previous = current;
  }
  return previous[b.length]!;
}

function namesLikelyMatch(a: string, b: string): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // A longer full name containing the shorter one ("Radiance" inside
  // "Radiance Studio"). Guarded by length so short words like "Anna" don't
  // collapse distinct names ("Anna Nails" vs "Anna Spa" -> "anna").
  if (Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  return tokenCoverage(tokenSet(left), tokenSet(right)) >= 0.6;
}

function distanceInMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const earthRadius = 6_371_000;
  const radians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = radians(bLat - aLat);
  const deltaLon = radians(bLon - aLon);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(deltaLon / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function samePlace(a: ResearchCompetitor, b: ResearchCompetitor): boolean {
  if (!namesLikelyMatch(a.name, b.name)) return false;
  if (
    a.latitude !== undefined &&
    a.longitude !== undefined &&
    b.latitude !== undefined &&
    b.longitude !== undefined
  ) {
    return distanceInMeters(a.latitude, a.longitude, b.latitude, b.longitude) <= 150;
  }
  return Math.abs(a.distanceMeters - b.distanceMeters) <= 250;
}

function cleanWebsiteUrl(value: string | undefined): string | undefined {
  const candidate = text(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) {
    let reason = "";
    try {
      const body = (await response.json()) as { message?: string; error?: { message?: string } };
      reason = body.message ?? body.error?.message ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Research source returned ${response.status}${reason ? ` (${reason})` : ""}`);
  }
  return (await response.json()) as T;
}

// --- Query shaping per business type ---

function queryLabel(businessType: string): string {
  if (businessType === "salon") return "hair salon beauty";
  if (businessType === "spa") return "spa wellness";
  return "local business";
}

function geoapifyCategories(businessType: string): string | undefined {
  if (businessType === "salon") return "commercial.hairdresser,commercial.beauty";
  if (businessType === "spa") return "leisure.spa,commercial.beauty";
  return undefined; // generic types search by name/query instead of category
}

function overtureTaxonomy(businessType: string): string | undefined {
  // Overture's L0 taxonomy: beauty covers salons, spas and wellness venues.
  if (businessType === "salon" || businessType === "spa") return "beauty";
  return undefined;
}

// --- Foursquare ---

type FoursquareV3Response = {
  results?: Array<{
    fsq_id?: string;
    name?: string;
    geocodes?: { main?: { latitude?: number; longitude?: number } };
    location?: { formatted_address?: string; address?: string; locality?: string };
    distance?: number;
    rating?: number;
    website?: string;
    tel?: string;
    price?: number;
  }>;
};

type FoursquareV2Response = {
  response?: {
    venues?: Array<{
      id?: string;
      name?: string;
      location?: { lat?: number; lng?: number; formattedAddress?: string[] };
      rating?: number;
      url?: string;
      contact?: { phone?: string };
      price?: { tier?: number };
    }>;
  };
};

function foursquarePriceTier(tier: number | undefined): string | undefined {
  if (!tier || tier < 1) return undefined;
  return "$".repeat(Math.min(tier, 4));
}

// Foursquare rates venues on a 0–10 scale; every other source (and the whole
// product) speaks 0–5. Normalize at the boundary so FSQ-only venues don't
// show "8.7/5" or inflate rating medians. Exported for tests.
export function foursquareRating(value: number | undefined): number | undefined {
  const rating = number(value);
  if (rating === undefined || rating <= 0) return undefined;
  return Math.round((rating > 5 ? rating / 2 : rating) * 10) / 10;
}

async function fetchFoursquare(
  location: { latitude: number; longitude: number },
  businessType: string,
  cap: number,
): Promise<ResearchCompetitor[]> {
  const v3Key = foursquareV3Key();
  const clientId = foursquareClientId();
  const clientSecret = foursquareClientSecret();

  if (v3Key) {
    const url = new URL(FOURSQUARE_V3_URL);
    url.searchParams.set("query", queryLabel(businessType));
    url.searchParams.set("ll", `${location.latitude},${location.longitude}`);
    url.searchParams.set("radius", String(NEARBY_RADIUS_METERS));
    url.searchParams.set("limit", String(cap));
    url.searchParams.set("sort", "DISTANCE");
    const payload = await fetchJson<FoursquareV3Response>(url.toString(), {
      headers: { Authorization: v3Key },
    });
    return (payload.results ?? []).flatMap((place): ResearchCompetitor[] => {
      const name = text(place.name);
      const latitude = number(place.geocodes?.main?.latitude);
      const longitude = number(place.geocodes?.main?.longitude);
      if (!name || latitude === undefined || longitude === undefined) return [];
      const address = text(place.location?.formatted_address ?? place.location?.address);
      const distanceMeters =
        number(place.distance) ?? distanceInMeters(location.latitude, location.longitude, latitude, longitude);
      return [
        {
          name,
          distanceMeters,
          latitude,
          longitude,
          ...(address ? { address } : {}),
          ...(cleanWebsiteUrl(place.website) ? { website: cleanWebsiteUrl(place.website) } : {}),
          ...(text(place.tel) ? { phone: text(place.tel) } : {}),
          ...(foursquarePriceTier(place.price) ? { priceLevel: foursquarePriceTier(place.price) } : {}),
          priceSamples: [],
          ...(foursquareRating(place.rating) !== undefined ? { rating: foursquareRating(place.rating) } : {}),
          sourceUrl: place.fsq_id
            ? `https://foursquare.com/v/${place.fsq_id}`
            : `https://foursquare.com/explore?ll=${latitude},${longitude}&q=${encodeURIComponent(name)}`,
          sourceLabel: "Foursquare Places",
        },
      ];
    });
  }

  if (clientId && clientSecret) {
    // Legacy v2 fallback — still works for many projects, but v3 is preferred.
    const url = new URL(FOURSQUARE_V2_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("client_secret", clientSecret);
    url.searchParams.set("v", "20240101");
    url.searchParams.set("ll", `${location.latitude},${location.longitude}`);
    url.searchParams.set("radius", String(NEARBY_RADIUS_METERS));
    url.searchParams.set("query", queryLabel(businessType));
    url.searchParams.set("limit", String(cap));
    url.searchParams.set("intent", "browse");
    const payload = await fetchJson<FoursquareV2Response>(url.toString());
    return (payload.response?.venues ?? []).flatMap((venue): ResearchCompetitor[] => {
      const name = text(venue.name);
      const latitude = number(venue.location?.lat);
      const longitude = number(venue.location?.lng);
      if (!name || latitude === undefined || longitude === undefined) return [];
      const address = (venue.location?.formattedAddress ?? []).join(", ");
      return [
        {
          name,
          distanceMeters: distanceInMeters(location.latitude, location.longitude, latitude, longitude),
          latitude,
          longitude,
          ...(text(address) ? { address: text(address) } : {}),
          ...(cleanWebsiteUrl(venue.url) ? { website: cleanWebsiteUrl(venue.url) } : {}),
          ...(text(venue.contact?.phone) ? { phone: text(venue.contact?.phone) } : {}),
          ...(foursquarePriceTier(venue.price?.tier) ? { priceLevel: foursquarePriceTier(venue.price?.tier) } : {}),
          priceSamples: [],
          ...(foursquareRating(venue.rating) !== undefined ? { rating: foursquareRating(venue.rating) } : {}),
          sourceUrl: venue.id
            ? `https://foursquare.com/v/${venue.id}`
            : `https://foursquare.com/explore?ll=${latitude},${longitude}&q=${encodeURIComponent(name)}`,
          sourceLabel: "Foursquare Places",
        },
      ];
    });
  }

  return [];
}

// --- Geoapify ---

type GeoapifyResponse = {
  features?: Array<{
    properties?: {
      name?: string;
      lat?: number;
      lon?: number;
      distance?: number;
      address_line1?: string;
      address_line2?: string;
      website?: string;
      opening_hours?: string;
      categories?: string[];
      place_id?: string;
    };
  }>;
};

async function fetchGeoapify(
  location: { latitude: number; longitude: number },
  businessType: string,
  cap: number,
): Promise<ResearchCompetitor[]> {
  const apiKey = geoapifyKey();
  if (!apiKey) return [];
  const url = new URL(GEOAPIFY_URL);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("lat", String(location.latitude));
  url.searchParams.set("lon", String(location.longitude));
  url.searchParams.set("radius", String(NEARBY_RADIUS_METERS));
  url.searchParams.set("limit", String(cap));
  url.searchParams.set("bias", `proximity:${location.latitude},${location.longitude}`);
  const categories = geoapifyCategories(businessType);
  if (categories) url.searchParams.set("categories", categories);
  else url.searchParams.set("text", queryLabel(businessType));
  const payload = await fetchJson<GeoapifyResponse>(url.toString());
  return (payload.features ?? []).flatMap((feature): ResearchCompetitor[] => {
    const props = feature.properties ?? {};
    const name = text(props.name);
    const latitude = number(props.lat);
    const longitude = number(props.lon);
    if (!name || latitude === undefined || longitude === undefined) return [];
    const address = text([props.address_line1, props.address_line2].filter(Boolean).join(", "));
    const distanceMeters =
      number(props.distance) ?? distanceInMeters(location.latitude, location.longitude, latitude, longitude);
    return [
      {
        name,
        distanceMeters,
        latitude,
        longitude,
        ...(address ? { address } : {}),
        ...(cleanWebsiteUrl(props.website) ? { website: cleanWebsiteUrl(props.website) } : {}),
        ...(text(props.opening_hours) ? { openingHours: text(props.opening_hours) } : {}),
        priceSamples: [],
        sourceUrl: props.place_id
          ? `https://geoapify.com/place/${props.place_id}`
          : `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${name}, ${location.latitude}, ${location.longitude}`)}`,
        sourceLabel: "Geoapify Places",
      },
    ];
  });
}

// --- Overture Maps (hosted via overturemapsapi.com) ---

type OvertureResponse = Array<{
  id?: string;
  geometry?: { coordinates?: [number, number] };
  properties?: {
    names?: { primary?: string };
    ext_name?: string;
    addresses?: Array<{ freeform?: string }>;
    websites?: string[];
    phones?: string[];
    categories?: { primary?: string };
    confidence?: number;
  };
}>;

async function fetchOverture(
  location: { latitude: number; longitude: number },
  businessType: string,
  cap: number,
): Promise<ResearchCompetitor[]> {
  const apiKey = overtureKey();
  if (!apiKey) return [];
  const url = new URL(OVERTURE_URL);
  url.searchParams.set("lat", String(location.latitude));
  url.searchParams.set("lng", String(location.longitude));
  url.searchParams.set("radius", String(NEARBY_RADIUS_METERS));
  url.searchParams.set("limit", String(cap));
  const taxonomy = overtureTaxonomy(businessType);
  if (taxonomy) url.searchParams.set("taxonomy", taxonomy);
  const payload = await fetchJson<OvertureResponse>(url.toString(), {
    headers: { "x-api-key": apiKey },
  });
  return (payload ?? []).flatMap((place): ResearchCompetitor[] => {
    const props = place.properties ?? {};
    const name = text(props.names?.primary ?? props.ext_name);
    const coordinates = place.geometry?.coordinates;
    const longitude = number(coordinates?.[0]);
    const latitude = number(coordinates?.[1]);
    if (!name || latitude === undefined || longitude === undefined) return [];
    const address = text((props.addresses ?? []).map((entry) => entry.freeform).filter(Boolean).join(", "));
    const distanceMeters = distanceInMeters(location.latitude, location.longitude, latitude, longitude);
    return [
      {
        name,
        distanceMeters,
        latitude,
        longitude,
        ...(address ? { address } : {}),
        ...(cleanWebsiteUrl(props.websites?.[0]) ? { website: cleanWebsiteUrl(props.websites?.[0]) } : {}),
        ...(text(props.phones?.[0]) ? { phone: text(props.phones?.[0]) } : {}),
        priceSamples: [],
        sourceUrl: place.id
          ? `https://explore.overturemaps.org/#/place/${place.id}`
          : `https://explore.overturemaps.org/`,
        sourceLabel: "Overture Maps",
      },
    ];
  });
}

// --- Public entry point ---

// Result caps per source per mode — exported for tests: preview is always
// conservative, full is the weekly mail's richest allowed picture.
export function resultCapsFor(mode: SecondaryMode) {
  return RESULT_CAPS[mode];
}

// Dedupe a competitor list by name/position (a venue found by Foursquare and
// Overture at once still appears once). Exported for tests.
export function dedupeByPlace(competitors: ResearchCompetitor[]): ResearchCompetitor[] {
  const deduped: ResearchCompetitor[] = [];
  for (const candidate of [...competitors].sort((a, b) => a.distanceMeters - b.distanceMeters)) {
    if (!deduped.some((existing) => samePlace(existing, candidate))) {
      deduped.push(candidate);
    }
  }
  return deduped;
}

export function secondarySourceLabels(): string[] {
  const labels: string[] = [];
  if (foursquareV3Key() || (foursquareClientId() && foursquareClientSecret())) labels.push("Foursquare Places");
  if (geoapifyKey()) labels.push("Geoapify Places");
  if (overtureKey()) labels.push("Overture Maps");
  return labels;
}

export async function collectSecondarySources(
  location: { latitude: number; longitude: number },
  businessType: string,
  mode: SecondaryMode,
): Promise<{ competitors: ResearchCompetitor[]; sourceLabels: string[]; warnings: string[] }> {
  const caps = RESULT_CAPS[mode];
  const warnings: string[] = [];
  const sourceLabels = secondarySourceLabels();

  // One call per source per generation, cached by area so repeat scans of the
  // same place (preview or full) never re-bill within the TTL.
  const cacheKey = `secondary:${mode}|${businessType}|${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`;
  const cached = cacheGet<ResearchCompetitor[]>(cacheKey);
  if (cached) return { competitors: cached, sourceLabels, warnings };

  const results = await Promise.allSettled([
    fetchFoursquare(location, businessType, caps.foursquare),
    fetchGeoapify(location, businessType, caps.geoapify),
    fetchOverture(location, businessType, caps.overture),
  ]);

  const competitors: ResearchCompetitor[] = [];
  const sourceName = ["Foursquare Places", "Geoapify Places", "Overture Maps"];
  results.forEach((result, index) => {
    const label = sourceName[index] ?? "Secondary source";
    if (result.status === "fulfilled") {
      competitors.push(...result.value);
    } else if (sourceLabels.includes(label)) {
      console.error(`${label} failed`, result.reason instanceof Error ? result.reason.message : result.reason);
      warnings.push(`${label} could not be reached for this request.`);
    }
  });

  const deduped = dedupeByPlace(competitors);
  return { competitors: cacheSet(cacheKey, deduped, SECONDARY_CACHE_TTL_MS), sourceLabels, warnings };
}

// The one-line note shown on every user-initiated generation, pointing at the
// richer weekly mail. Constant so stored snapshots diff cleanly.
export const WEEKLY_MAIL_NOTE =
  "This is a quick preview — your weekly email will include a more detailed market picture.";