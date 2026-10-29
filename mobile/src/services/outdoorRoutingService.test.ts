import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  outdoorRoutingService,
  decodeValhallaPolyline,
  computeCoordinatesBoundingBox,
  OutdoorRoute,
} from "./outdoorRoutingService";

describe("outdoorRoutingService — General-Purpose Pedestrian & Accessible Routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("decodes Valhalla polyline precision 6 correctly", () => {
    // Encodes coordinates between (30.770726, 76.576329) and (30.769660, 76.575543)
    const coords = decodeValhallaPolyline("kabuy@qcz`qCbA?~DT", 6);
    expect(coords.length).toBeGreaterThanOrEqual(1);
    expect(coords[0][0]).toBeCloseTo(30.7707, 3);
    expect(coords[0][1]).toBeCloseTo(76.5763, 3);
  });

  it("computes accurate bounding box for route camera framing", () => {
    const coords: [number, number][] = [
      [30.9103, 75.8569],
      [30.9150, 75.8600],
      [30.9080, 75.8640],
    ];
    const bbox = computeCoordinatesBoundingBox(coords);
    expect(bbox).toBeDefined();
    expect(bbox!.minLat).toBe(30.9080);
    expect(bbox!.maxLat).toBe(30.9150);
    expect(bbox!.minLon).toBe(75.8569);
    expect(bbox!.maxLon).toBe(75.8640);
  });

  it("requests blind-friendly pedestrian instructions and does not infer stair-free status from missing tags", async () => {
    const mockValhalla = {
      trip: {
        summary: { length: 0.85, time: 720 },
        legs: [
          {
            shape: "kabuy@qcz`qCbA?~DT",
            maneuvers: [
              {
                instruction: "Walk east on Station Road.",
                length: 0.45,
                time: 380,
                type: 1,
                begin_shape_index: 0,
              },
              {
                instruction: "Turn right onto Hospital Way.",
                length: 0.4,
                time: 340,
                type: 2,
                begin_shape_index: 1,
              },
            ],
          },
        ],
      },
    };

    let directRequestBody: any;
    (globalThis as any).fetch = jest.fn((url: any, options: any) => {
      if (String(url).includes("valhalla1.openstreetmap.de")) {
        directRequestBody = JSON.parse(options.body);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockValhalla),
      });
    });

    const route = await outdoorRoutingService.calculateRoute(
      { latitude: 30.9103, longitude: 75.8569 },
      { latitude: 30.9080, longitude: 75.8640 },
      { destinationName: "Civil Hospital", avoidStairs: true }
    );

    expect(route.status).toBe("success");
    expect(route.totalDistanceMeters).toBe(850);
    expect(route.hasStairs).toBe(false);
    expect(route.accessibilityStatus).toBe("unknown");
    expect(route.stairsWarning).toContain("cannot confirm");
    expect(route.spokenSummary).toContain("cannot confirm");
    expect(route.bounds).toBeDefined();
    expect(directRequestBody.costing_options.pedestrian.type).toBe("blind");
    expect(directRequestBody.costing_options.pedestrian).not.toHaveProperty("use_stairs");
  });

  it("falls back to direct Valhalla when the backend reports a route failure", async () => {
    const mockValhalla = {
      trip: {
        summary: { length: 0.5, time: 420 },
        legs: [{
          shape: "kabuy@qcz`qCbA?~DT",
          maneuvers: [{
            instruction: "Continue straight.",
            length: 0.5,
            time: 420,
            type: 1,
            begin_shape_index: 0,
          }],
        }],
      },
    };
    const responses: any[] = [
      { ok: true, json: () => Promise.resolve({ status: "error" }) },
      { ok: true, json: () => Promise.resolve(mockValhalla) },
    ];
    const fetchMock = jest.fn(async (): Promise<any> => responses.shift());
    (globalThis as any).fetch = fetchMock;

    const route = await outdoorRoutingService.calculateRoute(
      { latitude: 30.9103, longitude: 75.8569 },
      { latitude: 30.9080, longitude: 75.8640 },
      { destinationName: "Station" }
    );

    expect(route.status).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a success response without usable route geometry or maneuvers", async () => {
    const mockValhalla = {
      trip: { summary: { length: 0.5, time: 420 }, legs: [{ shape: "", maneuvers: [] }] },
    };
    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(mockValhalla) })
    );

    const route = await outdoorRoutingService.calculateRoute(
      { latitude: 30.9103, longitude: 75.8569 },
      { latitude: 30.9080, longitude: 75.8640 },
      { destinationName: "Station" }
    );

    expect(route.status).toBe("error");
    expect(route.coordinates).toEqual([]);
    expect(route.maneuvers).toEqual([]);
    expect(route.spokenSummary).toContain("incomplete route guidance");
  });

  it("detects stairs in route maneuvers and speaks a clear accessibility warning", async () => {
    const mockValhallaWithStairs = {
      trip: {
        summary: { length: 0.35, time: 300 },
        legs: [
          {
            shape: "kabuy@qcz`qCbA?~DT",
            maneuvers: [
              {
                instruction: "Walk south for 100 meters.",
                length: 0.1,
                time: 85,
                type: 1,
                begin_shape_index: 0,
              },
              {
                instruction: "Walk down stairs to footbridge.",
                length: 0.05,
                time: 60,
                type: 27, // kSteps
                begin_shape_index: 1,
              },
              {
                instruction: "Continue along pathway.",
                length: 0.2,
                time: 155,
                type: 1,
                begin_shape_index: 2,
              },
            ],
          },
        ],
      },
    };

    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockValhallaWithStairs),
      })
    );

    const route = await outdoorRoutingService.calculateRoute(
      { latitude: 30.9103, longitude: 75.8569 },
      { latitude: 30.9080, longitude: 75.8640 },
      { destinationName: "Footbridge Plaza", avoidStairs: true }
    );

    expect(route.status).toBe("success");
    expect(route.hasStairs).toBe(true);
    expect(route.accessibilityStatus).toBe("contains_stairs");
    expect(route.stairsWarning).toContain("map data marks stairs");
    expect(route.spokenSummary).toContain("map data marks stairs");
  });

  it("truthfully handles disconnected or unreachable destinations without falling back to campus data", async () => {
    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        text: () => Promise.resolve("No path found"),
      })
    );

    const route = await outdoorRoutingService.calculateRoute(
      { latitude: 30.0, longitude: 75.0 },
      { latitude: 0.0, longitude: 0.0 },
      { destinationName: "Island", avoidStairs: false }
    );

    expect(route.status).toBe("no_route_found");
    expect(route.coordinates).toHaveLength(0);
    expect(route.maneuvers).toHaveLength(0);
    expect(route.spokenSummary).toContain("No pedestrian walking route found");
    expect(route.spokenSummary).not.toContain("campus");
  });

  it("handles network failure gracefully with honest spoken status", async () => {
    (globalThis as any).fetch = jest.fn(() => Promise.reject(new Error("Connection refused")));

    const route = await outdoorRoutingService.calculateRoute(
      { latitude: 30.9103, longitude: 75.8569 },
      { latitude: 30.9080, longitude: 75.8640 },
      { destinationName: "Station", avoidStairs: false }
    );

    expect(route.status).toBe("error");
    expect(route.spokenSummary).toContain("network connection error");
  });
});
