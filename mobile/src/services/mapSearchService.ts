/**
 * Saarthi Map Search & Geocoding Service.
 *
 * Implements general-purpose, real-world destination search, reverse geocoding,
 * nearby amenity lookups, and spoken input normalization.
 *
 * Designed for general pedestrian navigation:
 * - Does NOT hardcode Chandigarh University as a mandatory boundary or default destination.
 * - Searches real addresses, cities, landmarks, hospitals, stations, and shops anywhere via OSM.
 * - Resolves "nearest hospital" and category queries using actual geodesic distance from user GPS.
 * - Preserves verified campus survey POIs when the user is actually on campus or searches for a campus block.
 * - Never hallucinates coordinates or destinations.
 */

import { CHANDIGARH_UNIVERSITY_POIS, CampusPoi, searchCampusPois } from "../data/campusSurveyData";
import { getBackendBaseUrl } from "../config/env";

export interface ReverseGeocodeResult {
  displayName: string;
  road?: string;
  suburb?: string;
  city?: string;
  state?: string;
  country?: string;
  landmark?: string;
  spokenDescription: string;
  latitude: number;
  longitude: number;
}

export interface MapSearchResult {
  id: string;
  name: string;
  displayName: string;
  latitude: number;
  longitude: number;
  category?: string;
  placeType?: string;
  distanceMeters?: number;
  isCampusPoi?: boolean;
}

export interface NearbyPlaceResult {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  address?: string;
}

export type NearbyCategory =
  | "hospital"
  | "food"
  | "atm"
  | "transit"
  | "college"
  | "fuel"
  | "pharmacy";

export interface NormalizedDestinationResult {
  normalizedQuery: string;
  category?: NearbyCategory | "hostel" | "academic";
  isCategorySearch: boolean;
  isNearestSearch: boolean;
}

/**
 * Normalizes a spoken or typed destination query.
 *
 * Strips common carrier phrases ("take me to", "navigate to", "where is", "find"),
 * resolves spoken number words ("block one" -> "block 1"), and detects common
 * place categories, synonyms, and "nearest" intent.
 */
export function normalizeDestinationQuery(raw: string): NormalizedDestinationResult {
  let cleaned = raw
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[.,?!:;'"-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip common carrier prefixes
  const carrierPrefixes = [
    /^take me to (?:the )?/,
    /^navigate to (?:the )?/,
    /^directions to (?:the )?/,
    /^how do i get to (?:the )?/,
    /^where is (?:the )?/,
    /^guide me to (?:the )?/,
    /^search for (?:the )?/,
    /^search (?:the )?/,
    /^find (?:the )?/,
    /^go to (?:the )?/,
    /^(?:the|a)\s+/,
  ];

  for (const prefix of carrierPrefixes) {
    if (prefix.test(cleaned)) {
      cleaned = cleaned.replace(prefix, "").trim();
      break;
    }
  }

  // Detect "nearest" or "near me" intent
  let isNearestSearch = false;
  if (/\b(nearest|closest|nearby|near me|near here)\b/i.test(cleaned)) {
    isNearestSearch = true;
    cleaned = cleaned
      .replace(/\b(nearest|closest|nearby|near me|near here)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Normalize speech-recognition number variations
  cleaned = cleaned
    .replace(/\bblock one\b/g, "block 1")
    .replace(/\bblock two\b/g, "block 2")
    .replace(/\bblock three\b/g, "block 3")
    .replace(/\bblock four\b/g, "block 4")
    .replace(/\bblock five\b/g, "block 5")
    .replace(/\bblock six\b/g, "block 6")
    .replace(/\bblock seven\b/g, "block 7")
    .replace(/\bblock eight\b/g, "block 8")
    .replace(/\bblock nine\b/g, "block 9")
    .replace(/\bblock ten\b/g, "block 10")
    .replace(/\bblock a one\b/g, "block a1")
    .replace(/\bblock a 1\b/g, "block a1")
    .replace(/\bblock a two\b/g, "block a2")
    .replace(/\bblock a 2\b/g, "block a2")
    .replace(/\bblock a three\b/g, "block a3")
    .replace(/\bblock a 3\b/g, "block a3")
    .replace(/\bblock b one\b/g, "block b1")
    .replace(/\bblock b 1\b/g, "block b1")
    .replace(/\bblock c one\b/g, "block c1")
    .replace(/\bblock c 1\b/g, "block c1")
    .replace(/\bblock c three\b/g, "block c3")
    .replace(/\bblock c 3\b/g, "block c3")
    .replace(/\bgate one\b/g, "gate 1")
    .replace(/\bgate two\b/g, "gate 2")
    .replace(/\btime table\b/g, "timetable")
    .replace(/\bmedical centre\b/g, "medical center")
    .replace(/\bhealth centre\b/g, "health center")
    .replace(/\brailway station\b/g, "station")
    .replace(/\btrain station\b/g, "station");

  // If query specifies a city or location (e.g. "hospital in ludhiana"), it's not a pure local category search
  const hasLocationQualifier = /\b(in|at|near)\s+[a-z]+/i.test(cleaned);

  // Determine category
  let category: NearbyCategory | "hostel" | "academic" | undefined = undefined;
  let isCategorySearch = false;

  // Medical / Hospital / Clinic
  if (
    cleaned === "hospital" ||
    cleaned === "hospitals" ||
    cleaned === "clinic" ||
    cleaned === "clinics" ||
    cleaned === "medical center" ||
    cleaned === "medical" ||
    cleaned === "dispensary" ||
    cleaned === "health center" ||
    cleaned === "doctor" ||
    cleaned === "pharmacy" ||
    cleaned === "chemist"
  ) {
    category = "hospital";
    isCategorySearch = !hasLocationQualifier;
  } else if (
    cleaned.includes("hospital") ||
    cleaned.includes("clinic") ||
    cleaned.includes("medical") ||
    cleaned.includes("dispensary") ||
    cleaned.includes("pharmacy")
  ) {
    category = "hospital";
  }

  // Food / Dining / Canteen
  else if (
    cleaned === "food" ||
    cleaned === "food court" ||
    cleaned === "canteen" ||
    cleaned === "cafeteria" ||
    cleaned === "restaurant" ||
    cleaned === "lunch" ||
    cleaned === "snacks" ||
    cleaned === "cafe" ||
    cleaned === "mess" ||
    cleaned === "dining"
  ) {
    category = "food";
    isCategorySearch = !hasLocationQualifier;
  } else if (
    cleaned.includes("food court") ||
    cleaned.includes("canteen") ||
    cleaned.includes("cafeteria") ||
    cleaned.includes("restaurant") ||
    cleaned.includes("cafe")
  ) {
    category = "food";
  }

  // ATM / Bank
  else if (
    cleaned === "atm" ||
    cleaned === "atms" ||
    cleaned === "bank" ||
    cleaned === "cash" ||
    cleaned === "money" ||
    cleaned === "state bank" ||
    cleaned === "sbi"
  ) {
    category = "atm";
    isCategorySearch = !hasLocationQualifier;
  } else if (cleaned.includes("atm") || cleaned.includes("bank") || cleaned.includes("sbi")) {
    category = "atm";
  }

  // Transit / Bus / Train Station
  else if (
    cleaned === "bus" ||
    cleaned === "buses" ||
    cleaned === "bus stop" ||
    cleaned === "bus stand" ||
    cleaned === "transit" ||
    cleaned === "station" ||
    cleaned === "metro" ||
    cleaned === "shuttle" ||
    cleaned === "bus terminal"
  ) {
    category = "transit";
    isCategorySearch = !hasLocationQualifier;
  } else if (
    cleaned.includes("bus") ||
    cleaned.includes("transit") ||
    cleaned.includes("station") ||
    cleaned.includes("shuttle")
  ) {
    category = "transit";
  }

  // Fuel / Petrol
  else if (
    cleaned === "fuel" ||
    cleaned === "petrol" ||
    cleaned === "petrol pump" ||
    cleaned === "gas" ||
    cleaned === "diesel"
  ) {
    category = "fuel";
    isCategorySearch = !hasLocationQualifier;
  } else if (cleaned.includes("petrol") || cleaned.includes("fuel")) {
    category = "fuel";
  }

  // Hostels / Residential
  else if (cleaned === "hostel" || cleaned === "hostels" || cleaned === "dorm" || cleaned === "dormitory") {
    category = "hostel";
    isCategorySearch = !hasLocationQualifier;
  }

  // Academic / Colleges / University
  else if (
    cleaned === "college" ||
    cleaned === "colleges" ||
    cleaned === "university" ||
    cleaned === "school" ||
    cleaned === "classroom" ||
    cleaned === "academic block"
  ) {
    category = "academic";
    isCategorySearch = !hasLocationQualifier;
  }

  if (isNearestSearch) {
    isCategorySearch = true;
  }

  return {
    normalizedQuery: cleaned,
    category,
    isCategorySearch,
    isNearestSearch,
  };
}

/**
 * Great-circle distance between two WGS84 coordinates in meters.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const r = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(r * c);
}

export class MapSearchService {
  private cachedReverseResult: ReverseGeocodeResult | null = null;
  private cachedReverseCoord: { lat: number; lon: number } | null = null;

  /**
   * Reverse-geocode coordinates into street name, neighborhood, and city.
   */
  public async reverseGeocode(lat: number, lon: number): Promise<ReverseGeocodeResult> {
    // 1. Check in-memory cache if requested point is within 15 meters
    if (this.cachedReverseResult && this.cachedReverseCoord) {
      const dist = calculateDistanceMeters(
        lat,
        lon,
        this.cachedReverseCoord.lat,
        this.cachedReverseCoord.lon
      );
      if (dist < 15) {
        return this.cachedReverseResult;
      }
    }

    // 2. Try Backend Reverse Geocode Endpoint
    try {
      const backendRes = await this.queryBackendReverse(lat, lon);
      if (backendRes) {
        this.cachedReverseResult = backendRes;
        this.cachedReverseCoord = { lat, lon };
        return backendRes;
      }
    } catch {
      // Fall through to direct OSM Nominatim
    }

    // 3. Fallback to direct Nominatim request
    const directRes = await this.queryDirectNominatimReverse(lat, lon);
    this.cachedReverseResult = directRes;
    this.cachedReverseCoord = { lat, lon };
    return directRes;
  }

  /**
   * Describe surroundings in natural spoken language for TTS.
   */
  public async describeSurroundings(lat: number, lon: number): Promise<string> {
    const geo = await this.reverseGeocode(lat, lon);
    return geo.spokenDescription;
  }

  /**
   * Search for destinations matching a typed or spoken query.
   *
   * General-Purpose Pedestrian Architecture:
   * - Queries OpenStreetMap Nominatim for real cities, addresses, landmarks, and places.
   * - Queries verified nearby amenities (Hospitals, Food, ATMs, Transit, etc.) based on user GPS.
   * - Supports "nearest hospital" by sorting by real geodesic distance.
   * - Includes campus survey POIs only when user is on campus or query specifically targets them.
   * - Never fabricates fake destinations or coordinates.
   */
  public async searchDestinations(
    query: string,
    userLat?: number,
    userLon?: number
  ): Promise<MapSearchResult[]> {
    const { normalizedQuery: q, category, isCategorySearch, isNearestSearch } = normalizeDestinationQuery(query);
    if (!q) return [];

    const candidates: MapSearchResult[] = [];
    const seenIds = new Set<string>();

    // 1. Campus POI Inclusion Policy:
    // Only search campus survey POIs if the user is physically near campus (<3km)
    // OR if the query explicitly mentions a campus building/block/gate/hostel.
    const isNearCampus =
      userLat !== undefined &&
      userLon !== undefined &&
      calculateDistanceMeters(userLat, userLon, 30.76864, 76.57505) < 3000;

    const isCampusSpecificQuery = /\b(cu|campus|block \d+|gate \d+|sukhna|shivalik|zakir|le corbusier)\b/i.test(q);

    if (isCampusSpecificQuery || isNearCampus) {
      const matchedPois = searchCampusPois(q);
      for (const poi of matchedPois) {
        if (!seenIds.has(poi.id)) {
          const dist =
            userLat !== undefined && userLon !== undefined
              ? calculateDistanceMeters(userLat, userLon, poi.latitude, poi.longitude)
              : undefined;

          candidates.push({
            id: poi.id,
            name: poi.name,
            displayName: `${poi.name} (${poi.shortCode}) - ${poi.description}`,
            latitude: poi.latitude,
            longitude: poi.longitude,
            category: poi.category,
            placeType: "campus_poi",
            distanceMeters: dist,
            isCampusPoi: true,
          });
          seenIds.add(poi.id);
        }
      }
    }

    // 2. If it is a category query (e.g. "hospital", "clinic", "pharmacy", "food", "atm", "station")
    // or an explicit "nearest" request, search real nearby verified amenities:
    if (category && (isCategorySearch || isNearestSearch || candidates.length === 0)) {
      if (userLat !== undefined && userLon !== undefined) {
        try {
          const nearbyCat =
            category === "hostel" || category === "academic" ? "college" : (category as NearbyCategory);
          // Query real amenities within a 15km radius
          const nearbyResults = await this.searchNearbyPlaces(nearbyCat, userLat, userLon, 15000);
          for (const place of nearbyResults) {
            if (!seenIds.has(place.id)) {
              candidates.push({
                id: place.id,
                name: place.name,
                displayName: place.address || `${place.name} (${place.category})`,
                latitude: place.latitude,
                longitude: place.longitude,
                category: place.category,
                placeType: "nearby_amenity",
                distanceMeters: place.distanceMeters,
                isCampusPoi: false,
              });
              seenIds.add(place.id);
            }
          }
        } catch {
          // Safe isolate
        }
      }
    }

    // 3. General Geographic Geocoding (Cities, addresses, landmarks, stations, buildings)
    // Run whenever not a pure "near me" category search or when candidates are few
    if (!isNearestSearch && candidates.length < 5) {
      try {
        const externalResults = await this.queryGeocodeSearch(q, userLat, userLon);
        for (const item of externalResults) {
          if (!seenIds.has(item.id)) {
            const dist =
              userLat !== undefined && userLon !== undefined
                ? calculateDistanceMeters(userLat, userLon, item.latitude, item.longitude)
                : undefined;

            candidates.push({
              ...item,
              distanceMeters: dist,
              isCampusPoi: false,
            });
            seenIds.add(item.id);
          }
        }
      } catch {
        // Keep existing results
      }
    }

    // 4. Sort Candidates:
    // If user coordinates are known, sort strictly by real geodesic proximity (closest first).
    // No artificial preference is given to campus POIs over real-world destinations!
    if (userLat !== undefined && userLon !== undefined) {
      candidates.sort((a, b) => (a.distanceMeters ?? 999999) - (b.distanceMeters ?? 999999));
    }

    return candidates.slice(0, 10);
  }

  /**
   * Search for verified nearby places by category.
   */
  public async searchNearbyPlaces(
    category: NearbyCategory | string,
    userLat: number,
    userLon: number,
    radiusMeters: number = 5000
  ): Promise<NearbyPlaceResult[]> {
    const catLower = category.toLowerCase();

    // 1. Try Backend Proxy
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const url = `${getBackendBaseUrl()}/api/v1/map/nearby?lat=${userLat}&lon=${userLon}&category=${encodeURIComponent(
        catLower
      )}&radius=${radiusMeters}`;

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          return data.results.map((r: any) => ({
            id: r.id,
            name: r.name,
            category: r.category,
            latitude: r.latitude,
            longitude: r.longitude,
            distanceMeters: r.distance_meters,
            address: r.address,
          }));
        }
      }
    } catch {
      // Fall through to direct query
    }

    // 2. Direct Nominatim Query Fallback
    return await this.queryDirectNominatimNearby(catLower, userLat, userLon, radiusMeters);
  }

  private async queryBackendReverse(lat: number, lon: number): Promise<ReverseGeocodeResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(
        `${getBackendBaseUrl()}/api/v1/map/reverse-geocode?lat=${lat}&lon=${lon}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      return {
        displayName: data.display_name,
        road: data.road,
        suburb: data.suburb,
        city: data.city,
        state: data.state,
        country: data.country,
        landmark: data.landmark,
        spokenDescription: data.spoken_description,
        latitude: lat,
        longitude: lon,
      };
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }

  private async queryDirectNominatimReverse(
    lat: number,
    lon: number
  ): Promise<ReverseGeocodeResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
      const res = await fetch(url, {
        headers: { "User-Agent": "SaarthiMobileApp/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const addr = data.address || {};
        const road = addr.road || addr.pedestrian || addr.path || addr.cycleway;
        const suburb =
          addr.suburb ||
          addr.neighbourhood ||
          addr.college ||
          addr.university ||
          addr.residential;
        const city = addr.city || addr.town || addr.county;
        const state = addr.state;
        const country = addr.country;
        const landmark = addr.amenity || addr.building || addr.tourism;

        const spokenParts: string[] = [];
        if (road && suburb) {
          spokenParts.push(`You are currently near ${road} in ${suburb}.`);
        } else if (road) {
          spokenParts.push(`You are currently on or near ${road}.`);
        } else if (suburb) {
          spokenParts.push(`You are currently in ${suburb}.`);
        } else if (city) {
          spokenParts.push(`You are currently in ${city}.`);
        } else {
          spokenParts.push("Your GPS location is ready on the map.");
        }

        if (landmark) {
          spokenParts.push(`There is ${landmark} nearby.`);
        }

        spokenParts.push("Where would you like to go?");

        return {
          displayName: data.display_name || `Location (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
          road,
          suburb,
          city,
          state,
          country,
          landmark,
          spokenDescription: spokenParts.join(" "),
          latitude: lat,
          longitude: lon,
        };
      }
    } catch {
      clearTimeout(timeout);
    }

    return {
      displayName: `GPS Location: ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      spokenDescription: `Your GPS position is active. Where would you like to go?`,
      latitude: lat,
      longitude: lon,
    };
  }

  private async queryGeocodeSearch(
    query: string,
    userLat?: number,
    userLon?: number
  ): Promise<MapSearchResult[]> {
    // Try backend proxy first
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let url = `${getBackendBaseUrl()}/api/v1/map/geocode?q=${encodeURIComponent(query)}`;
      if (userLat !== undefined && userLon !== undefined) {
        url += `&lat=${userLat}&lon=${userLon}`;
      }

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          return data.results.map((r: any) => ({
            id: r.id,
            name: r.name,
            displayName: r.display_name,
            latitude: r.latitude,
            longitude: r.longitude,
            category: r.category,
            placeType: r.place_type,
          }));
        }
      }
    } catch {
      // Fall through to direct query
    }

    // Direct Nominatim search
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      let url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
        query
      )}&limit=10&addressdetails=1`;
      if (userLat !== undefined && userLon !== undefined) {
        const delta = 0.8;
        url += `&viewbox=${userLon - delta},${userLat + delta},${userLon + delta},${
          userLat - delta
        }&bounded=0`;
      }

      const res = await fetch(url, {
        headers: { "User-Agent": "SaarthiMobileApp/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        return data.map((item: any) => ({
          id: String(item.place_id || `${item.lat}_${item.lon}`),
          name: item.name || (item.display_name ? item.display_name.split(",")[0] : query),
          displayName: item.display_name || "",
          latitude: parseFloat(item.lat),
          longitude: parseFloat(item.lon),
          category: item.category || item.type,
          placeType: item.type,
        }));
      }
    } catch {
      clearTimeout(timeout);
    }

    return [];
  }

  private async queryDirectNominatimNearby(
    category: string,
    lat: number,
    lon: number,
    radiusMeters: number
  ): Promise<NearbyPlaceResult[]> {
    let searchTerm = category;
    if (category.includes("hospital") || category.includes("clinic")) searchTerm = "hospital";
    else if (category.includes("food") || category.includes("restaurant") || category.includes("cafe"))
      searchTerm = "restaurant";
    else if (category.includes("atm") || category.includes("bank")) searchTerm = "atm";
    else if (category.includes("bus") || category.includes("transit") || category.includes("station"))
      searchTerm = "station";
    else if (category.includes("college") || category.includes("university"))
      searchTerm = "college";
    else if (category.includes("fuel") || category.includes("petrol")) searchTerm = "fuel";
    else if (category.includes("pharmacy") || category.includes("chemist")) searchTerm = "pharmacy";

    const delta = Math.max(radiusMeters / 111000.0, 0.05);
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      searchTerm
    )}&viewbox=${lon - delta},${lat + delta},${lon + delta},${
      lat - delta
    }&bounded=0&limit=15&addressdetails=1`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "SaarthiMobileApp/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const results: NearbyPlaceResult[] = [];
        for (const item of data) {
          const itemLat = parseFloat(item.lat);
          const itemLon = parseFloat(item.lon);
          const dist = calculateDistanceMeters(lat, lon, itemLat, itemLon);
          results.push({
            id: String(item.place_id || `${itemLat}_${itemLon}`),
            name: item.name || (item.display_name ? item.display_name.split(",")[0] : searchTerm),
            category: item.type || category,
            latitude: itemLat,
            longitude: itemLon,
            distanceMeters: dist,
            address: item.display_name,
          });
        }
        results.sort((a, b) => a.distanceMeters - b.distanceMeters);
        return results;
      }
    } catch {
      clearTimeout(timeout);
    }

    return [];
  }
}

export const mapSearchService = new MapSearchService();
