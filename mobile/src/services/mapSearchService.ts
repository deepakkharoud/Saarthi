/**
 * Saarthi Map Search, Reverse Geocoding, and Nearby Places Service.
 *
 * Implements grounded, zero-hallucination geocoding and reverse geocoding
 * backed by OpenStreetMap Nominatim and Saarthi backend proxy.
 *
 * Requirements:
 * - Convert GPS coordinates to human-readable street / surroundings description.
 * - Cache reverse-geocoding queries (<25m) to avoid repeat network calls on GPS fluctuations.
 * - Search destinations by voice or typed query (campus POIs + wider geographic search).
 * - Find verified nearby amenities (hospitals, food, ATMs, transit, colleges, petrol pumps).
 * - Truthful spoken output only (never hallucinate distances or non-existent roads).
 */

import { getBackendBaseUrl } from "../config/env";
import { CHANDIGARH_UNIVERSITY_POIS, CampusPoi, searchCampusPois } from "../data/campusSurveyData";

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

/**
 * Calculate geodesic distance between two points using Haversine formula (in meters).
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

class MapSearchService {
  private cachedReverseResult: ReverseGeocodeResult | null = null;
  private readonly CACHE_DISTANCE_THRESHOLD_METERS = 25;

  /**
   * Reverse-geocode coordinates into grounded address and spoken description.
   * Caches responses within 25m to prevent repeated queries during slight GPS jitter.
   */
  public async reverseGeocode(lat: number, lon: number): Promise<ReverseGeocodeResult> {
    // 1. Check cache
    if (this.cachedReverseResult) {
      const dist = calculateDistanceMeters(
        lat,
        lon,
        this.cachedReverseResult.latitude,
        this.cachedReverseResult.longitude
      );
      if (dist < this.CACHE_DISTANCE_THRESHOLD_METERS) {
        return this.cachedReverseResult;
      }
    }

    // 2. Try Backend Proxy first
    try {
      const backendRes = await this.queryBackendReverseGeocode(lat, lon);
      if (backendRes) {
        this.cachedReverseResult = backendRes;
        return backendRes;
      }
    } catch {
      // Fall through to direct OSM Nominatim
    }

    // 3. Fallback to direct Nominatim request
    const directRes = await this.queryDirectNominatimReverse(lat, lon);
    this.cachedReverseResult = directRes;
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
   * Returns a combination of verified campus POIs and real OpenStreetMap geocoded results.
   */
  public async searchDestinations(
    query: string,
    userLat?: number,
    userLon?: number
  ): Promise<MapSearchResult[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const candidates: MapSearchResult[] = [];
    const seenIds = new Set<string>();

    // 1. Match local verified campus survey POIs first
    const matchedPois = searchCampusPois(q);
    for (const poi of matchedPois) {
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

    // 2. Query backend geocode endpoint or direct OSM Nominatim for wider geographic search
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
      // Keep local POIs if network is unavailable
    }

    // Sort by proximity if user coordinates are known
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
    radiusMeters: number = 3000
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
      // Fall through to direct Nominatim query
    }

    // 2. Direct Nominatim amenity query
    return await this.queryDirectNominatimNearby(catLower, userLat, userLon, radiusMeters);
  }

  // --- Private Network Helpers ---

  private async queryBackendReverseGeocode(
    lat: number,
    lon: number
  ): Promise<ReverseGeocodeResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const url = `${getBackendBaseUrl()}/api/v1/map/reverse-geocode?lat=${lat}&lon=${lon}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) return null;
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
          spokenParts.push("Your GPS location is ready on the campus map.");
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
      )}&limit=6&addressdetails=1`;
      if (userLat !== undefined && userLon !== undefined) {
        const delta = 0.5;
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
      searchTerm = "bus stop";
    else if (category.includes("college") || category.includes("university"))
      searchTerm = "college";
    else if (category.includes("fuel") || category.includes("petrol")) searchTerm = "fuel";
    else if (category.includes("pharmacy") || category.includes("chemist")) searchTerm = "pharmacy";

    const delta = radiusMeters / 111000.0;
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      searchTerm
    )}&viewbox=${lon - delta},${lat + delta},${lon + delta},${
      lat - delta
    }&bounded=1&limit=10&addressdetails=1`;

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
          if (dist <= radiusMeters) {
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
