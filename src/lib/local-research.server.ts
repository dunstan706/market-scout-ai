const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const USER_AGENT = "Localscope/1.0 (local market research demo)";

export type ResearchSource = {
  label: string;
  url: string;
  kind: "directory" | "website" | "reviews";
};

export type ResearchCompetitor = {
  name: string;
  distanceMeters: number;
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

export type ResearchSnapshot = {
  location: {
    displayName: string;
    latitude: number;
    longitude: number;
  };
  competitors: ResearchCompetitor[];
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

type WebsiteEvidence = {
  prices: string[];
  rating?: number | undefined;
  reviewCount?: number | undefined;
  reviewQuote?: string | undefined;
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
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
  if (!response.ok) throw new Error(`Research source returned ${response.status}`);
  return (await response.json()) as T;
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

function formatDistance(meters: number): string {
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

function readJsonLdEvidence(html: string): WebsiteEvidence {
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

async function collectWebsiteEvidence(url: string): Promise<WebsiteEvidence> {
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`Website returned ${response.status}`);
  const html = (await response.text()).slice(0, 600_000);
  return readJsonLdEvidence(html);
}

async function geocode(location: string): Promise<{ displayName: string; latitude: number; longitude: number }> {
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

async function fetchOpenStreetMapCompetitors(
  location: { latitude: number; longitude: number },
  businessName: string,
): Promise<ResearchCompetitor[]> {
  const query = `
[out:json][timeout:20];
(
  nwr(around:5000,${location.latitude},${location.longitude})["name"]["shop"~"hairdresser|beauty|cosmetics|perfumery"];
  nwr(around:5000,${location.latitude},${location.longitude})["name"]["amenity"~"spa|beauty_salon"];
  nwr(around:5000,${location.latitude},${location.longitude})["name"]["craft"="hairdresser"];
);
out center tags;`;
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Accept: "application/json", "User-Agent": USER_AGENT },
    body: query,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`);
  const payload = (await response.json()) as { elements?: OverpassElement[] };
  const normalizedName = businessName.toLocaleLowerCase().trim();
  const seen = new Set<string>();
  return (payload.elements ?? [])
    .map((element) => {
      const tags = element.tags ?? {};
      const latitude = element.lat ?? element.center?.lat;
      const longitude = element.lon ?? element.center?.lon;
      const name = text(tags["name"]);
      if (!name || latitude === undefined || longitude === undefined) return null;
      const key = `${name.toLocaleLowerCase()}|${Math.round(latitude * 10_000)}|${Math.round(longitude * 10_000)}`;
      if (seen.has(key) || name.toLocaleLowerCase() === normalizedName) return null;
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
        ...(address ? { address } : {}),
        ...(website ? { website } : {}),
        ...(text(tags["phone"] ?? tags["contact:phone"]) ? { phone: text(tags["phone"] ?? tags["contact:phone"]) } : {}),
        ...(text(tags["opening_hours"]) ? { openingHours: text(tags["opening_hours"]) } : {}),
        ...(text(tags["start_date"] ?? tags["opening_date"]) ? { openingDate: text(tags["start_date"] ?? tags["opening_date"]) } : {}),
        priceSamples,
        sourceUrl,
        sourceLabel: "OpenStreetMap",
      } satisfies ResearchCompetitor;
    })
    .filter((value): value is ResearchCompetitor => !!value)
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

async function fetchGoogleCompetitors(
  location: { latitude: number; longitude: number },
  businessType: string,
): Promise<ResearchCompetitor[]> {
  const apiKey = process.env["GOOGLE_PLACES_API_KEY"];
  if (!apiKey) return [];
  const response = await fetchJson<GoogleSearchResponse>(GOOGLE_PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.reviews",
    },
    body: JSON.stringify({
      textQuery: `${businessType === "other" ? "local business" : businessType} near ${location.latitude},${location.longitude}`,
      maxResultCount: 10,
      languageCode: "en",
      locationBias: {
        circle: {
          center: { latitude: location.latitude, longitude: location.longitude },
          radius: 5000,
        },
      },
    }),
  });
  return (response.places ?? []).flatMap((place) => {
    const name = text(place.displayName?.text);
    const latitude = number(place.location?.latitude);
    const longitude = number(place.location?.longitude);
    if (!name || latitude === undefined || longitude === undefined) return [];
    const review = place.reviews?.find((item) => text(item.text?.text));
    const mapUrl = text(place.googleMapsUri) ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
    const hours = place.currentOpeningHours?.weekdayDescriptions?.slice(0, 2).join(" · ");
    return [
      {
        name,
        distanceMeters: distanceInMeters(location.latitude, location.longitude, latitude, longitude),
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
}

function mergeCompetitors(osm: ResearchCompetitor[], google: ResearchCompetitor[]): ResearchCompetitor[] {
  const result = [...osm];
  for (const googlePlace of google.sort((a, b) => a.distanceMeters - b.distanceMeters)) {
    const match = result.find(
      (candidate) =>
        candidate.name.toLocaleLowerCase() === googlePlace.name.toLocaleLowerCase() ||
        (candidate.address && googlePlace.address && candidate.address.toLocaleLowerCase().includes(googlePlace.address.toLocaleLowerCase())),
    );
    if (!match) {
      result.push(googlePlace);
      continue;
    }
    Object.assign(match, {
      ...googlePlace,
      name: match.name,
      distanceMeters: Math.min(match.distanceMeters, googlePlace.distanceMeters),
      sourceUrl: googlePlace.sourceUrl,
      sourceLabel: googlePlace.sourceLabel,
      priceSamples: unique([...match.priceSamples, ...googlePlace.priceSamples]),
    });
  }
  return result.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 12);
}

export async function collectLocalResearch(input: {
  businessName: string;
  location: string;
  businessType: string;
}): Promise<ResearchSnapshot> {
  const resolvedLocation = await geocode(input.location);
  const warnings: string[] = [];
  const sources: ResearchSource[] = [
    { label: "OpenStreetMap", url: "https://www.openstreetmap.org/", kind: "directory" },
  ];

  const [osmResult, googleResult] = await Promise.allSettled([
    fetchOpenStreetMapCompetitors(resolvedLocation, input.businessName),
    fetchGoogleCompetitors(resolvedLocation, input.businessType),
  ]);
  const osmCompetitors = osmResult.status === "fulfilled" ? osmResult.value : [];
  const googleCompetitors = googleResult.status === "fulfilled" ? googleResult.value : [];
  if (osmResult.status === "rejected") warnings.push("OpenStreetMap could not be reached for this request.");
  if (process.env["GOOGLE_PLACES_API_KEY"]) {
    if (googleResult.status === "rejected") warnings.push("Google Places could not be reached for this request.");
    else sources.push({ label: "Google Places", url: "https://maps.google.com/", kind: "reviews" });
  } else {
    warnings.push("Google Places is not connected, so customer ratings and review quotes may be limited.");
  }

  const competitors = mergeCompetitors(osmCompetitors, googleCompetitors);
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
  const locationName = research.location.displayName.split(",").slice(0, 2).join(", ");
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