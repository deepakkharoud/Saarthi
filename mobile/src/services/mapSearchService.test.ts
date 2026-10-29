import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  mapSearchService,
  calculateDistanceMeters,
  normalizeDestinationQuery,
} from "./mapSearchService";
import { searchCampusPois } from "../data/campusSurveyData";

describe("mapSearchService — Grounded Geocoding & Distance Reasoning", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calculates accurate geodesic distance between coordinates using Haversine", () => {
    // Distance between CU Main Gate (30.770726, 76.576329) and Block 1 (30.769660, 76.575543)
    const dist = calculateDistanceMeters(30.770726, 76.576329, 30.769660, 76.575543);
    // Real distance is ~140-160 meters
    expect(dist).toBeGreaterThan(120);
    expect(dist).toBeLessThan(180);
  });

  it("searches local verified campus survey POIs accurately", () => {
    const results = searchCampusPois("block 1");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toContain("Block 1");
    expect(results[0].surveyStatus).toBe("verified_osm");
  });

  it("normalizes carrier prefixes and spoken number variations", () => {
    const r1 = normalizeDestinationQuery("take me to the block one");
    expect(r1.normalizedQuery).toBe("block 1");

    const r2 = normalizeDestinationQuery("navigate to gate two");
    expect(r2.normalizedQuery).toBe("gate 2");

    const r3 = normalizeDestinationQuery("where is medical centre");
    expect(r3.normalizedQuery).toBe("medical center");
    expect(r3.category).toBe("hospital");
  });

  it("resolves medical and hospital synonyms correctly", () => {
    const r1 = normalizeDestinationQuery("clinic");
    expect(r1.category).toBe("hospital");
    expect(r1.isCategorySearch).toBe(true);

    const r2 = normalizeDestinationQuery("dispensary");
    expect(r2.category).toBe("hospital");
    expect(r2.isCategorySearch).toBe(true);

    const r3 = normalizeDestinationQuery("pharmacy");
    expect(r3.category).toBe("hospital");
    expect(r3.isCategorySearch).toBe(true);
  });

  it("returns nearby amenities when searching for hospital category", async () => {
    // Mock fetch for nearby amenities
    const mockNearby = [
      {
        id: "osm_node_101",
        name: "Civil Hospital Kharar",
        category: "hospital",
        latitude: 30.745,
        longitude: 76.645,
        distance_meters: 6500,
        address: "Kharar, Punjab",
      },
    ];

    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ count: 1, results: mockNearby }),
      })
    );

    const results = await mapSearchService.searchDestinations("hospital", 30.7686, 76.575);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe("Civil Hospital Kharar");
    expect(results[0].isCampusPoi).toBe(false);
  });

  it("resolves multi-match campus categories like hostels", async () => {
    const results = await mapSearchService.searchDestinations("hostel", 30.7686, 76.575);
    // When near campus, should match Sukhna, Tagore, and LC Girls Hostel
    expect(results.length).toBeGreaterThanOrEqual(3);
    const names = results.map((r) => r.name);
    expect(names.some((n) => n.includes("Sukhna"))).toBe(true);
    expect(names.some((n) => n.includes("Tagore"))).toBe(true);
    expect(names.some((n) => n.includes("Hostel"))).toBe(true);
  });

  it("returns empty results gracefully for empty destination search query", async () => {
    const results = await mapSearchService.searchDestinations("   ");
    expect(results).toEqual([]);
  });

  it("falls back gracefully to GPS coordinates string if reverse geocoding is offline", async () => {
    (globalThis as any).fetch = jest.fn(() => Promise.reject(new Error("Network offline")));

    const res = await mapSearchService.reverseGeocode(30.7686, 76.575);
    expect(res.latitude).toBeCloseTo(30.7686);
    expect(res.longitude).toBeCloseTo(76.575);
    expect(res.spokenDescription).toContain("Where would you like to go?");
  });

  it("resolves destination in another city via geocoding without campus restriction", async () => {
    const mockGeocode = [
      {
        id: "ludhiana_stn",
        name: "Ludhiana Junction Railway Station",
        display_name: "Ludhiana Junction Railway Station, GT Road, Ludhiana, Punjab",
        latitude: 30.9103,
        longitude: 75.8569,
        category: "railway",
        place_type: "station",
      },
    ];

    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: mockGeocode }),
      })
    );

    // User is located in Naraingarh (~70km away) searching for Ludhiana
    const results = await mapSearchService.searchDestinations(
      "Ludhiana Junction Railway Station",
      30.48,
      77.13
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe("Ludhiana Junction Railway Station");
    expect(results[0].isCampusPoi).toBe(false);
    expect(results[0].latitude).toBeCloseTo(30.9103);
    expect(results[0].longitude).toBeCloseTo(75.8569);
  });

  it("ranks destinations strictly by geodesic distance from user location without preferring campus POIs", async () => {
    // User is located in Ambala (30.378, 76.776)
    // Destination 1: Ambala City Hospital (1.5 km away)
    // Destination 2: Chandigarh University Block 1 (~45 km away)
    const mockNearby = [
      {
        id: "ambala_hosp",
        name: "Civil Hospital Ambala City",
        category: "hospital",
        latitude: 30.380,
        longitude: 76.780,
        distance_meters: 1500,
        address: "Ambala City, Haryana",
      },
    ];

    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ count: 1, results: mockNearby }),
      })
    );

    const results = await mapSearchService.searchDestinations("hospital", 30.378, 76.776);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Nearest destination must be Ambala Hospital, NOT campus POIs
    expect(results[0].name).toBe("Civil Hospital Ambala City");
    expect(results[0].distanceMeters).toBeLessThan(3000);
  });

  it("handles nearest hospital by querying nearby amenities and sorting by distance", () => {
    const queryResult = normalizeDestinationQuery("take me to the nearest hospital");
    expect(queryResult.isNearestSearch).toBe(true);
    expect(queryResult.category).toBe("hospital");
    expect(queryResult.normalizedQuery).toBe("hospital");
  });
});
