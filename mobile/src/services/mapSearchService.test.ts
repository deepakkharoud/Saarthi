import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  mapSearchService,
  calculateDistanceMeters,
} from "./mapSearchService";

describe("mapSearchService — Grounded Geocoding & Distance Reasoning", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as any).fetch = jest.fn((url: any) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      })
    );
  });

  it("calculates accurate geodesic distance between coordinates using Haversine", () => {
    // Distance between Chandigarh University Block 1 and Main Gate (~145m)
    const dist = calculateDistanceMeters(30.770726, 76.576329, 30.769660, 76.575543);
    expect(dist).toBeGreaterThan(120);
    expect(dist).toBeLessThan(170);
  });

  it("searches local verified campus survey POIs accurately", async () => {
    const results = await mapSearchService.searchDestinations("Block 1", 30.77, 76.57);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toContain("Block 1");
    expect(results[0].isCampusPoi).toBe(true);
  });

  it("returns empty results gracefully for empty destination search query", async () => {
    const results = await mapSearchService.searchDestinations("   ");
    expect(results).toEqual([]);
  });

  it("falls back gracefully to GPS coordinates string if reverse geocoding is offline", async () => {
    (globalThis as any).fetch = jest.fn(() => Promise.reject(new Error("Network offline")));

    const res = await mapSearchService.reverseGeocode(30.7686, 76.5750);
    expect(res.latitude).toBeCloseTo(30.7686);
    expect(res.longitude).toBeCloseTo(76.5750);
    expect(res.spokenDescription).toContain("Where would you like to go?");
  });
});
