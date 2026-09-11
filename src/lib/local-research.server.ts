import { cacheGet, cacheSet } from "@/lib/cache.server";
import { collectSecondarySources, WEEKLY_MAIL_NOTE, type SecondaryMode } from "@/lib/research-sources.server";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 40_000;
const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const USER_AGENT = "theBizScope/1.0 (local market research demo)";
const NEARBY_RADIUS_METERS = 5_000;
const WIDE_RADIUS_METERS = 15_000;
const THIN_COVERAGE_COUNT = 3;
const SAME_PLACE_METERS = 150;
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // a place's coordinates rarely move
const PLACES_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // competitor data goes stale faster

export type ResearchSource = {
  label: string;
  url: string;
  kind: "directory" | "website" | "reviews";
};

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

export type OwnListingReview = {
  rating?: number | undefined;
  text?: string | undefined;
};

export type OwnListing = {
  name: string;
  /** Google Places ID of the matched listing. Persisted on the profile after
   *  a successful scan so future lookups key on the ID, not the typed name. */
  placeId?: string | undefined;
  rating?: number | undefined;
  reviewCount?: number | undefined;
  url?: string | undefined;
  address?: string | undefined;
  reviews?: OwnListingReview[] | undefined;
};

export type ResearchSnapshot = {
  location: {
    displayName: string;
    latitude: number;
    longitude: number;
  };
  competitors: ResearchCompetitor[];
  ownListing?: OwnListing | undefined;
  /** The matched listing's Google place ID, duplicated at the top level so
   *  callers can persist it on the profile even if ownListing is stripped
   *  downstream. */
  ownListingPlaceId?: string | undefined;
  sources: ResearchSource[];
  warnings: string[];
  capturedAt: string;
};

type NominatimResult = {
  display_name?: string;
  lat?: string;
  lon?: string;
};

type OverpassElement = {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  currentOpeningHours?: { weekdayDescriptions?: string[] };
  reviews?: Array<{
    rating?: number;
    text?: { text?: string };
  }>;
};

type GoogleSearchResponse = {
  places?: GooglePlace[];
};

type GoogleGeocodeResponse = {
  status?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
};

type WebsiteEvidence = {
  prices: string[];
  rating?: number | undefined;
  reviewCount?: number | undefined;
  reviewQuote?: string | undefined;
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function googleApiKey(): string | undefined {
  return process.env["GOOGLE_PLACES_API_KEY"] || process.env["GOOGLE_MAPS_API_KEY"];
}

const NAME_STOPWORDS = /\b(the|salon|spa|ltd|limited|llc|inc)\b/g;

export function normalizeName(value: string): string {
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

export function namesLikelyMatch(a: string, b: string): boolean {
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

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.replace(/\s+/g, " ").trim();
  return result || undefined;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
      const body = (await response.json()) as { error?: { message?: string; status?: string; details?: Array<{ reason?: string }> } };
      reason = body.error?.details?.[0]?.reason ?? body.error?.status ?? body.error?.message ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Research source returned ${response.status}${reason ? ` (${reason})` : ""}`);
  }
  return (await response.json()) as T;
}

export function distanceInMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const earthRadius = 6_371_000;
  const radians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = radians(bLat - aLat);
  const deltaLon = radians(bLon - aLon);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(deltaLon / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
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

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function readJsonLdEvidence(html: string): WebsiteEvidence {
  const evidence: WebsiteEvidence = { prices: [] };
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    const aggregate = record["aggregateRating"];
    if (aggregate && typeof aggregate === "object") {
      const aggregateRecord = aggregate as Record<string, unknown>;
      evidence.rating ??= number(aggregateRecord["ratingValue"]);
      evidence.reviewCount ??= number(aggregateRecord["reviewCount"] ?? aggregateRecord["ratingCount"]);
    }
    const review = record["review"];
    if (review && typeof review === "object" && !Array.isArray(review)) {
      const reviewRecord = review as Record<string, unknown>;
      const quote = text(
        typeof reviewRecord["reviewBody"] === "string"
          ? reviewRecord["reviewBody"]
          : typeof reviewRecord["description"] === "string"
            ? reviewRecord["description"]
            : undefined,
      );
      if (quote) evidence.reviewQuote ??= quote.slice(0, 180);
    }
    Object.values(record).forEach(visit);
  };

  for (const match of scripts) {
    try {
      visit(JSON.parse(match[1] ?? ""));
    } catch {
      // A malformed JSON-LD block should not prevent other source collection.
    }
  }

  const pageText = htmlToText(html);
  const moneyMatches = pageText.match(
    /(?:[$£€₹]\s?\d{1,4}(?:[,.]\d{1,2})?|\b(?:USD|GBP|EUR|INR)\s?\d{1,4}(?:[,.]\d{1,2})?)/gi,
  );
  evidence.prices = unique((moneyMatches ?? []).map((value) => value.replace(/\s+/g, " "))).slice(0, 8);
  return evidence;
}

// Competitor websites come from community-editable data (OpenStreetMap tags,
// directory listings), so the URL must be validated before the server fetches
// it — otherwise a crafted "website" tag could make us probe internal
// services (SSRF). Only public http(s) origins are allowed.
// Exported for tests.
export function isPublicWebsiteUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
      return false;
    }
    // Bare IPv4/IPv6 literals: only allow public ranges.
    if (/^[\d.]+$/.test(host)) {
      const parts = host.split(".").map((part) => Number(part));
      if (parts.length !== 4 || parts.some((part) => part > 255)) return false;
      const [a, b] = parts as [number, number, number, number];
      if (a === 0 || a === 10 || a === 127) return false; // this-network, private, loopback
      if (a === 169 && b === 254) return false; // link-local (cloud metadata)
      if (a === 172 && b >= 16 && b <= 31) return false; // private
      if (a === 192 && b === 168) return false; // private
      return true;
    }
    if (host.includes(":")) {
      // IPv6: loopback, unique-local (fc00::/7), link-local (fe80::/10).
      const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
      if (normalized === "::1" || normalized === "::") return false;
      if (/^f[cd]/.test(normalized)) return false;
      if (/^fe[89ab]/.test(normalized)) return false;
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

async function collectWebsiteEvidence(url: string): Promise<WebsiteEvidence> {
  if (!isPublicWebsiteUrl(url)) throw new Error(`Blocked non-public website URL`);
  const cacheKey = `website:${url}`;
  const cached = cacheGet<WebsiteEvidence>(cacheKey);
  if (cached) return cached;
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`Website returned ${response.status}`);
  const html = (await response.text()).slice(0, 600_000);
  const evidence = readJsonLdEvidence(html);
  return cacheSet(cacheKey, evidence, PLACES_CACHE_TTL_MS);
}

async function geocodeNominatim(location: string): Promise<{ displayName: string; latitude: number; longitude: number }> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", location);
  const results = await fetchJson<NominatimResult[]>(url.toString());
  const match = results[0];
  const latitude = number(match?.lat);
  const longitude = number(match?.lon);
  if (!match || latitude === undefined || longitude === undefined) {
    throw new Error(`We couldn't find "${location}". Try adding a city or postcode.`);
  }
  return {
    displayName: text(match.display_name) ?? location,
    latitude,
    longitude,
  };
}

async function geocodeGoogle(location: string): Promise<{ displayName: string; latitude: number; longitude: number } | undefined> {
  const apiKey = googleApiKey();
  if (!apiKey) return undefined;
  const url = new URL(GOOGLE_GEOCODE_URL);
  url.searchParams.set("address", location);
  url.searchParams.set("key", apiKey);
  const payload = await fetchJson<GoogleGeocodeResponse>(url.toString());
  const match = payload.results?.[0];
  const latitude = number(match?.geometry?.location?.lat);
  const longitude = number(match?.geometry?.location?.lng);
  if (payload.status !== "OK" || !match || latitude === undefined || longitude === undefined) {
    return undefined;
  }
  return {
    displayName: text(match.formatted_address) ?? location,
    latitude,
    longitude,
  };
}

async function geocode(location: string): Promise<{ displayName: string; latitude: number; longitude: number }> {
  const cacheKey = `geocode:${location.trim().toLocaleLowerCase()}`;
  const cached = cacheGet<{ displayName: string; latitude: number; longitude: number }>(cacheKey);
  if (cached) return cached;
  try {
    const result = await geocodeNominatim(location);
    return cacheSet(cacheKey, result, GEOCODE_CACHE_TTL_MS);
  } catch (error) {
    try {
      const googleMatch = await geocodeGoogle(location);
      if (googleMatch) return cacheSet(cacheKey, googleMatch, GEOCODE_CACHE_TTL_MS);
    } catch {
      // Fall through to the original Nominatim error.
    }
    throw error;
  }
}

function overpassTagFilters(businessType: string, relaxed: boolean): string[] {
  if (!relaxed && businessType === "salon") {
    return [
      '["name"]["shop"~"hairdresser|beauty|cosmetics|perfumery"]',
      '["name"]["amenity"~"spa|beauty_salon"]',
      '["name"]["craft"="hairdresser"]',
    ];
  }
  if (!relaxed && businessType === "spa") {
    return [
      '["name"]["amenity"~"spa|beauty_salon"]',
      '["name"]["leisure"="spa"]',
      '["name"]["shop"~"beauty|cosmetics|massage"]',
    ];
  }
  return [
    '["name"]["shop"]',
    '["name"]["craft"]',
    '["name"]["office"]',
    '["name"]["amenity"~"cafe|restaurant|fast_food|bar|pub|pharmacy|clinic|studio|marketplace|beauty_salon|spa"]',
  ];
}

async function queryOverpass(
  location: { latitude: number; longitude: number },
  radiusMeters: number,
  filters: string[],
): Promise<OverpassElement[]> {
  const around = `nwr(around:${radiusMeters},${location.latitude},${location.longitude})`;
  const query = `[out:json][timeout:20];
(
${filters.map((filter) => `  ${around}${filter};`).join("\n")}
);
out center tags;`;
  let lastError: unknown;
  for (const endpoint of OVERPASS_URLS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Accept: "application/json", "User-Agent": USER_AGENT },
        body: query,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`);
      const payload = (await response.json()) as { elements?: OverpassElement[] };
      return payload.elements ?? [];
    } catch (error) {
      lastError = error;
      console.warn(`overpass mirror failed: ${endpoint}`, error instanceof Error ? error.message : error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenStreetMap could not be reached");
}

function mapOpenStreetMapCompetitors(
  elements: OverpassElement[],
  location: { latitude: number; longitude: number },
  businessName: string,
): ResearchCompetitor[] {
  const seen = new Set<string>();
  return elements
    .map((element): ResearchCompetitor | null => {
      const tags = element.tags ?? {};
      const latitude = element.lat ?? element.center?.lat;
      const longitude = element.lon ?? element.center?.lon;
      const name = text(tags["name"]);
      if (!name || latitude === undefined || longitude === undefined) return null;
      const key = `${name.toLocaleLowerCase()}|${Math.round(latitude * 10_000)}|${Math.round(longitude * 10_000)}`;
      if (seen.has(key) || namesLikelyMatch(businessName, name)) return null;
      seen.add(key);
      const distanceMeters = distanceInMeters(location.latitude, location.longitude, latitude, longitude);
      const website = cleanWebsiteUrl(tags["website"] ?? tags["contact:website"]);
      const sourceUrl = `https://www.openstreetmap.org/${element.type}/${element.id}`;
      const priceSamples = [tags["price"], tags["fee"], tags["charge"]].map(text).filter((value): value is string => !!value);
      const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]]
        .map(text)
        .filter((value): value is string => !!value)
        .join(", ");
      return {
        name,
        distanceMeters,
        latitude,
        longitude,
        ...(address ? { address } : {}),
        ...(website ? { website } : {}),
        ...(text(tags["phone"] ?? tags["contact:phone"]) ? { phone: text(tags["phone"] ?? tags["contact:phone"]) } : {}),
        ...(text(tags["opening_hours"]) ? { openingHours: text(tags["opening_hours"]) } : {}),
        ...(text(tags["start_date"] ?? tags["opening_date"]) ? { openingDate: text(tags["start_date"] ?? tags["opening_date"]) } : {}),
        priceSamples,
        sourceUrl,
        sourceLabel: "OpenStreetMap",
      };
    })
    .filter((value): value is ResearchCompetitor => !!value);
}

async function fetchOpenStreetMapCompetitors(
  location: { latitude: number; longitude: number },
  businessName: string,
  businessType: string,
  options?: { radiusMeters?: number; relaxed?: boolean },
): Promise<ResearchCompetitor[]> {
  const radiusMeters = options?.radiusMeters ?? NEARBY_RADIUS_METERS;
  const relaxed = options?.relaxed ?? businessType === "other";
  const elements = await queryOverpass(location, radiusMeters, overpassTagFilters(businessType, relaxed));
  return mapOpenStreetMapCompetitors(elements, location, businessName)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 12);
}

function googlePriceLevel(value: string | undefined): string | undefined {
  const levels: Record<string, string> = {
    PRICE_LEVEL_FREE: "free",
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  };
  return value ? levels[value] : undefined;
}

function placesQueryLabel(businessType: string): string {
  if (businessType === "salon") return "hair salon beauty salon";
  if (businessType === "spa") return "spa wellness";
  return "local business";
}

async function fetchGoogleCompetitors(
  location: { displayName: string; latitude: number; longitude: number },
  businessName: string,
  businessType: string,
  radiusMeters = NEARBY_RADIUS_METERS,
): Promise<ResearchCompetitor[]> {
  const apiKey = googleApiKey();
  if (!apiKey) return [];
  // Cache by place + query, not by user-typed text, so repeat lookups of the
  // same area (or abuse of the public form) don't re-bill Google each time.
  const cacheKey = `places:${businessType}|${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}|${radiusMeters}`;
  const cached = cacheGet<ResearchCompetitor[]>(cacheKey);
  if (cached) return cached;
  const response = await fetchJson<GoogleSearchResponse>(GOOGLE_PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.reviews",
    },
    body: JSON.stringify({
      textQuery: `${placesQueryLabel(businessType)} near ${location.displayName}`,
      maxResultCount: 12,
      languageCode: "en",
      locationBias: {
        circle: {
          center: { latitude: location.latitude, longitude: location.longitude },
          radius: radiusMeters,
        },
      },
    }),
  });
  const competitors = (response.places ?? []).flatMap((place) => {
    const name = text(place.displayName?.text);
    const latitude = number(place.location?.latitude);
    const longitude = number(place.location?.longitude);
    if (!name || latitude === undefined || longitude === undefined) return [];
    if (namesLikelyMatch(businessName, name)) return [];
    const review = place.reviews?.find((item) => text(item.text?.text));
    const mapUrl = text(place.googleMapsUri) ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
    const hours = place.currentOpeningHours?.weekdayDescriptions?.slice(0, 2).join(" · ");
    return [
      {
        name,
        distanceMeters: distanceInMeters(location.latitude, location.longitude, latitude, longitude),
        latitude,
        longitude,
        ...(text(place.formattedAddress) ? { address: text(place.formattedAddress) } : {}),
        ...(text(place.websiteUri) ? { website: text(place.websiteUri) } : {}),
        ...(text(place.nationalPhoneNumber) ? { phone: text(place.nationalPhoneNumber) } : {}),
        ...(hours ? { openingHours: hours } : {}),
        ...(googlePriceLevel(place.priceLevel) ? { priceLevel: googlePriceLevel(place.priceLevel) } : {}),
        priceSamples: [],
        ...(number(place.rating) !== undefined ? { rating: number(place.rating) } : {}),
        ...(number(place.userRatingCount) !== undefined ? { reviewCount: number(place.userRatingCount) } : {}),
        ...(text(review?.text?.text) ? { reviewQuote: text(review?.text?.text)?.slice(0, 180) } : {}),
        sourceUrl: mapUrl,
        sourceLabel: "Google Places",
      } satisfies ResearchCompetitor,
    ];
  });
  return cacheSet(cacheKey, competitors, PLACES_CACHE_TTL_MS);
}

const OWN_LISTING_RADIUS_METERS = 1_500;

// Looks up the business's own Google listing (by stored place ID when
// available, otherwise by name near the geocoded location) so reputation —
// rating, review count, newest reviews — can be tracked across scans and
// benchmarked against the field. Returns undefined when there is no API key or
// no matching listing; small businesses without a Google presence are common,
// so the absence surfaces as a UI nudge instead of an error. Negative results
// are not cached, so a listing that appears later is picked up on a future
// scan — and once a match does land, its place ID is persisted on the profile,
// after which the typed name stops mattering entirely.
async function fetchOwnListing(
  location: { displayName: string; latitude: number; longitude: number },
  input: { businessName: string; businessType: string },
  options?: { knownPlaceId?: string | undefined },
): Promise<OwnListing | undefined> {
  const apiKey = googleApiKey();
  if (!apiKey) return undefined;
  const knownPlaceId = options?.knownPlaceId?.trim() || undefined;

  // A stored place ID is authoritative: one direct lookup, no name matching,
  // no proximity filter. Immune to typos, word order, and rebrands.
  if (knownPlaceId) {
    try {
      const response = await fetchJson<GooglePlace>("https://places.googleapis.com/v1/places/" + encodeURIComponent(knownPlaceId), {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "id,displayName,formattedAddress,googleMapsUri,rating,userRatingCount,reviews",
        },
      });
      const name = text(response.displayName?.text);
      if (!name) return undefined;
      const reviews: OwnListingReview[] = (response.reviews ?? [])
        .map((review) => ({
          ...(number(review.rating) !== undefined ? { rating: number(review.rating) } : {}),
          ...(text(review.text?.text) ? { text: text(review.text?.text)?.slice(0, 240) } : {}),
        }))
        .filter((review) => review.text !== undefined);
      const listing: OwnListing = {
        name,
        placeId: response.id ?? knownPlaceId,
        ...(number(response.rating) !== undefined ? { rating: number(response.rating) } : {}),
        ...(number(response.userRatingCount) !== undefined ? { reviewCount: number(response.userRatingCount) } : {}),
        ...(text(response.googleMapsUri) ? { url: text(response.googleMapsUri) } : {}),
        ...(text(response.formattedAddress) ? { address: text(response.formattedAddress) } : {}),
        ...(reviews.length > 0 ? { reviews } : {}),
      };
      return listing;
    } catch (error) {
      // The pinned listing can vanish (permanently closed, delisted). Fall
      // back to a name lookup below rather than failing the scan.
      console.error(
        "own listing lookup by place id failed",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const cacheKey = `own:${input.businessName.trim().toLocaleLowerCase()}|${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`;
  const cached = cacheGet<OwnListing>(cacheKey);
  if (cached) return cached;
  try {
    // Runs one Google text search and filters candidates down to the own
    // business by fuzzy name match plus proximity.
    const search = async (textQuery: string, radiusMeters: number) => {
      const response = await fetchJson<GoogleSearchResponse>(GOOGLE_PLACES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.rating,places.userRatingCount,places.location,places.reviews",
        },
        body: JSON.stringify({
          textQuery,
          maxResultCount: 8,
          languageCode: "en",
          locationBias: {
            circle: {
              center: { latitude: location.latitude, longitude: location.longitude },
              radius: radiusMeters,
            },
          },
        }),
      });
      return (response.places ?? []).flatMap<{
        place: GooglePlace;
        name: string;
        distanceMeters: number;
        reviews: OwnListingReview[];
      }>((place) => {
        const name = text(place.displayName?.text);
        const latitude = number(place.location?.latitude);
        const longitude = number(place.location?.longitude);
        if (!name || latitude === undefined || longitude === undefined) return [];
        if (!namesLikelyMatch(input.businessName, name)) return [];
        const distanceMeters = distanceInMeters(location.latitude, location.longitude, latitude, longitude);
        if (distanceMeters > radiusMeters) return [];
        const reviews: OwnListingReview[] = (place.reviews ?? [])
          .map((review) => ({
            ...(number(review.rating) !== undefined ? { rating: number(review.rating) } : {}),
            ...(text(review.text?.text) ? { text: text(review.text?.text)?.slice(0, 240) } : {}),
          }))
          .filter((review) => review.text !== undefined);
        return [{ place, name, distanceMeters, reviews }];
      });
    };

    // First pass: the bare name near the geocoded location. The fuzzy matcher
    // usually lands it even when the typed name isn't word-for-word — but when
    // it can't (e.g. a paraphrase of Google's canonical name), retry with the
    // category appended ("Radiance hair salon beauty salon") over a wider
    // radius, where Google's own text matching is far more forgiving.
    let matches = await search(input.businessName, OWN_LISTING_RADIUS_METERS);
    if (matches.length === 0 && input.businessType !== "other") {
      matches = await search(
        `${input.businessName} ${placesQueryLabel(input.businessType)}`,
        NEARBY_RADIUS_METERS,
      );
    }
    matches.sort((a, b) => a.distanceMeters - b.distanceMeters);
    const best = matches[0];
    if (!best) return undefined;
    const listing: OwnListing = {
      name: best.name,
      ...(text(best.place.id) ? { placeId: text(best.place.id) } : {}),
      ...(number(best.place.rating) !== undefined ? { rating: number(best.place.rating) } : {}),
      ...(number(best.place.userRatingCount) !== undefined ? { reviewCount: number(best.place.userRatingCount) } : {}),
      ...(text(best.place.googleMapsUri) ? { url: text(best.place.googleMapsUri) } : {}),
      ...(text(best.place.formattedAddress) ? { address: text(best.place.formattedAddress) } : {}),
      ...(best.reviews.length > 0 ? { reviews: best.reviews } : {}),
    };
    return cacheSet(cacheKey, listing, PLACES_CACHE_TTL_MS);
  } catch (error) {
    console.error("own listing lookup failed", error instanceof Error ? error.message : error);
    return undefined;
  }
}

export function isSameCompetitor(a: ResearchCompetitor, b: ResearchCompetitor): boolean {
  if (!namesLikelyMatch(a.name, b.name)) return false;
  if (
    a.latitude !== undefined &&
    a.longitude !== undefined &&
    b.latitude !== undefined &&
    b.longitude !== undefined
  ) {
    return distanceInMeters(a.latitude, a.longitude, b.latitude, b.longitude) <= SAME_PLACE_METERS;
  }
  return Math.abs(a.distanceMeters - b.distanceMeters) <= 250;
}

function enrichFromSecondary(primary: ResearchCompetitor, secondary: ResearchCompetitor): ResearchCompetitor {
  return {
    ...primary,
    distanceMeters: Math.min(primary.distanceMeters, secondary.distanceMeters),
    latitude: primary.latitude ?? secondary.latitude,
    longitude: primary.longitude ?? secondary.longitude,
    address: primary.address ?? secondary.address,
    website: primary.website ?? secondary.website,
    phone: primary.phone ?? secondary.phone,
    openingHours: primary.openingHours ?? secondary.openingHours,
    openingDate: primary.openingDate ?? secondary.openingDate,
    priceLevel: primary.priceLevel ?? secondary.priceLevel,
    rating: primary.rating ?? secondary.rating,
    reviewCount: primary.reviewCount ?? secondary.reviewCount,
    reviewQuote: primary.reviewQuote ?? secondary.reviewQuote,
    priceSamples: unique([...primary.priceSamples, ...secondary.priceSamples]),
  };
}

export function mergeCompetitors(google: ResearchCompetitor[], osm: ResearchCompetitor[]): ResearchCompetitor[] {
  const result = [...google].sort((a, b) => a.distanceMeters - b.distanceMeters);
  for (const osmPlace of osm.sort((a, b) => a.distanceMeters - b.distanceMeters)) {
    const match = result.find((candidate) => isSameCompetitor(candidate, osmPlace));
    if (!match) {
      result.push(osmPlace);
      continue;
    }
    Object.assign(match, enrichFromSecondary(match, osmPlace));
  }
  return result.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 12);
}

function mergeDirectoryLists(primary: ResearchCompetitor[], extra: ResearchCompetitor[]): ResearchCompetitor[] {
  const result = [...primary];
  for (const candidate of extra) {
    if (!result.some((existing) => isSameCompetitor(existing, candidate))) {
      result.push(candidate);
    }
  }
  return result;
}

export async function collectLocalResearch(
  input: {
    businessName: string;
    location: string;
    businessType: string;
    /** Place ID persisted from a previous successful scan. When present, the
     *  own-listing lookup targets it directly instead of re-matching names. */
    googlePlaceId?: string | undefined;
  },
  options?: { mode?: SecondaryMode },
): Promise<ResearchSnapshot> {
  const mode = options?.mode ?? "preview";
  const resolvedLocation = await geocode(input.location);
  const warnings: string[] = [];
  const sources: ResearchSource[] = [];
  const placesKey = googleApiKey();

  // Own-listing lookup runs in parallel with the competitor fetches — it's
  // an independent Google call and blocks nothing. It is never reported as a
  // competitor. Only runs when a Google key is connected.
  const [ownListingResult, osmResult, googleResult] = await Promise.allSettled([
    placesKey
      ? fetchOwnListing(resolvedLocation, input, { knownPlaceId: input.googlePlaceId })
      : Promise.resolve(undefined as OwnListing | undefined),
    fetchOpenStreetMapCompetitors(resolvedLocation, input.businessName, input.businessType),
    fetchGoogleCompetitors(resolvedLocation, input.businessName, input.businessType),
  ]);
  const ownListing = ownListingResult.status === "fulfilled" ? ownListingResult.value : undefined;
  let osmCompetitors = osmResult.status === "fulfilled" ? osmResult.value : [];
  let googleCompetitors = googleResult.status === "fulfilled" ? googleResult.value : [];
  let googleReached = googleResult.status === "fulfilled";
  if (osmResult.status === "rejected") warnings.push("OpenStreetMap could not be reached for this request.");

  if (mergeCompetitors(googleCompetitors, osmCompetitors).length < THIN_COVERAGE_COUNT) {
    const fallbacks = await Promise.allSettled([
      fetchOpenStreetMapCompetitors(resolvedLocation, input.businessName, input.businessType, {
        radiusMeters: WIDE_RADIUS_METERS,
        relaxed: true,
      }),
      placesKey
        ? fetchGoogleCompetitors(resolvedLocation, input.businessName, input.businessType, WIDE_RADIUS_METERS)
        : Promise.resolve([] as ResearchCompetitor[]),
    ]);
    if (fallbacks[0].status === "fulfilled") {
      osmCompetitors = mergeDirectoryLists(osmCompetitors, fallbacks[0].value);
    }
    if (fallbacks[1].status === "fulfilled") {
      googleReached = googleReached || Boolean(placesKey);
      googleCompetitors = mergeDirectoryLists(googleCompetitors, fallbacks[1].value);
    }
  }

  if (placesKey) {
    if (googleReached) {
      sources.push({ label: "Google Places", url: "https://maps.google.com/", kind: "reviews" });
    } else {
      const reason = googleResult.status === "rejected" && googleResult.reason instanceof Error ? googleResult.reason.message : "";
      console.error("google places failed", reason);
      if (/403|PERMISSION_DENIED|API_KEY_SERVICE_BLOCKED|REQUEST_DENIED/i.test(reason)) {
        warnings.push(
          "Google Places rejected the API key: enable \"Places API (New)\" for the key's project and allow it in the key's API restrictions.",
        );
      } else {
        warnings.push(`Google Places could not be reached for this request${reason ? ` (${reason})` : ""}.`);
      }
    }
  } else {
    warnings.push("Google Places is not connected, so coverage in lesser-known areas may be limited.");
  }
  sources.push({ label: "OpenStreetMap", url: "https://www.openstreetmap.org/", kind: "directory" });

  let competitors = mergeCompetitors(googleCompetitors, osmCompetitors);

  // Watch-tier secondary sources (Foursquare, Geoapify, Overture) run after the
  // primary pass. Preview (user-initiated scans) is conservative — one call per
  // source, capped results, cached; full (the weekly mail cron) pulls the
  // richest allowed picture. Extra coverage is deduped against the primary list
  // so a place found by three sources still appears once.
  const secondary = await collectSecondarySources(resolvedLocation, input.businessType, mode);
  const mergedCompetitors = mergeDirectoryLists(competitors, secondary.competitors);
  // Preview stays tight (the brief is a teaser); full gets a wider field but a
  // sane ceiling so prompts and the mail don't drown in listings.
  competitors = (mode === "full" ? mergedCompetitors : mergedCompetitors.slice(0, 15)).slice(0, 24);
  for (const label of secondary.sourceLabels) {
    const url =
      label === "Foursquare Places"
        ? "https://foursquare.com/"
        : label === "Geoapify Places"
          ? "https://www.geoapify.com/"
          : "https://overturemaps.org/";
    if (!sources.some((source) => source.label === label)) {
      sources.push({ label, url, kind: "directory" });
    }
  }
  warnings.push(...secondary.warnings);
  // Every user-initiated generation points at the richer weekly mail. Not added
  // in full mode — the weekly mail is that richer result.
  if (mode === "preview") warnings.push(WEEKLY_MAIL_NOTE);

  const websiteCandidates = competitors.filter((competitor) => competitor.website).slice(0, 6);
  const websiteResults = await Promise.allSettled(
    websiteCandidates.map(async (competitor) => ({
      competitor,
      evidence: await collectWebsiteEvidence(competitor.website as string),
    })),
  );
  for (const result of websiteResults) {
    if (result.status !== "fulfilled") continue;
    const { competitor, evidence } = result.value;
    competitor.priceSamples = unique([...competitor.priceSamples, ...evidence.prices]).slice(0, 8);
    competitor.rating ??= evidence.rating;
    competitor.reviewCount ??= evidence.reviewCount;
    competitor.reviewQuote ??= evidence.reviewQuote;
    if (!sources.some((source) => source.url === competitor.website)) {
      sources.push({ label: `${competitor.name} website`, url: competitor.website as string, kind: "website" });
    }
  }

  if (!competitors.length) {
    warnings.push("No named nearby businesses were found in the public directory for this location.");
  }
  if (!competitors.some((competitor) => competitor.priceSamples.length || competitor.priceLevel)) {
    warnings.push("No public competitor pricing was found. The brief will not invent prices.");
  }
  if (!competitors.some((competitor) => competitor.rating || competitor.reviewCount || competitor.reviewQuote)) {
    warnings.push("No public review ratings or quotes were found for nearby businesses.");
  }
  if (!competitors.some((competitor) => competitor.openingDate)) {
    warnings.push("Public sources did not include opening dates, so nearby businesses are not labelled as new.");
  }

  return {
    location: {
      displayName: resolvedLocation.displayName,
      latitude: resolvedLocation.latitude,
      longitude: resolvedLocation.longitude,
    },
    competitors,
    sources,
    warnings,
    ownListing,
    // Surfaced separately so callers can pin the matched listing on the
    // profile even when ownListing itself is undefined (e.g. the brief
    // writer stripped it) — this is what ends the name-lookup dependency.
    ownListingPlaceId: ownListing?.placeId,
    capturedAt: new Date().toISOString(),
  };
}

export function researchForPrompt(research: ResearchSnapshot): string {
  return JSON.stringify({
    location: research.location,
    businesses: research.competitors.map((competitor) => ({
      name: competitor.name,
      distance: formatDistance(competitor.distanceMeters),
      address: competitor.address,
      website: competitor.website,
      openingHours: competitor.openingHours,
      openingDate: competitor.openingDate,
      priceLevel: competitor.priceLevel,
      publishedPrices: competitor.priceSamples,
      rating: competitor.rating,
      reviewCount: competitor.reviewCount,
      reviewQuote: competitor.reviewQuote,
      source: competitor.sourceLabel,
      sourceUrl: competitor.sourceUrl,
    })),
    warnings: research.warnings,
    ownListing: research.ownListing
      ? {
          name: research.ownListing.name,
          rating: research.ownListing.rating,
          reviewCount: research.ownListing.reviewCount,
          url: research.ownListing.url,
          latestReviews: (research.ownListing.reviews ?? [])
            .slice(0, 2)
            .map((review) => ({ rating: review.rating, text: review.text })),
        }
      : undefined,
  });
}

export function buildEvidenceBrief(input: {
  businessName: string;
  location: string;
  businessType: string;
}, research: ResearchSnapshot) {
  const nearest = research.competitors[0];
  const priced = research.competitors.find((competitor) => competitor.priceSamples.length || competitor.priceLevel);
  const reviewed = research.competitors.find((competitor) => competitor.rating || competitor.reviewCount || competitor.reviewQuote);
  const newBusiness = research.competitors.find((competitor) => competitor.openingDate);
  const locationName = research.location.displayName.split(",").slice(0, 2).map((part) => part.trim()).join(", ");
  return {
    title: `${input.businessName}, ${locationName}`,
    signals: [
      {
        tone: "amber" as const,
        label: "Price evidence",
        headline: priced
          ? `${priced.name} publishes ${priced.priceSamples[0] ?? `${priced.priceLevel} price level`} online`
          : "No public competitor prices were found",
        detail: priced
          ? `${formatDistance(priced.distanceMeters)} away · source: ${priced.sourceLabel}.`
          : "No price claim is shown because the connected public sources did not expose one.",
      },
      {
        tone: "green" as const,
        label: "Review evidence",
        headline: reviewed
          ? `${reviewed.name} is rated ${reviewed.rating?.toFixed(1) ?? "—"}/5`
          : "Public review data is unavailable",
        detail: reviewed
          ? `${reviewed.reviewCount ? `${reviewed.reviewCount} ratings` : "Rating found"} · ${formatDistance(reviewed.distanceMeters)} away · source: ${reviewed.sourceLabel}.`
          : "Connect Google Places or publish review markup on a business website to include this signal.",
      },
      {
        tone: "red" as const,
        label: "Nearby market",
        headline: newBusiness
          ? `${newBusiness.name} lists an opening date of ${newBusiness.openingDate}`
          : nearest
            ? `${research.competitors.length} named ${input.businessType} businesses found nearby`
            : "No named nearby businesses found",
        detail: newBusiness
          ? `${formatDistance(newBusiness.distanceMeters)} away · source: ${newBusiness.sourceLabel}.`
          : nearest
            ? `Nearest: ${nearest.name}, ${formatDistance(nearest.distanceMeters)} away · source: ${nearest.sourceLabel}.`
            : "The public directory returned no nearby businesses for this search.",
      },
    ],
    recommendation: "Use the linked sources as a starting point, then validate the most relevant competitor before changing your offer.",
    why: "This brief reports public evidence collected for the requested location and avoids guessing when a source is incomplete.",
  };
}