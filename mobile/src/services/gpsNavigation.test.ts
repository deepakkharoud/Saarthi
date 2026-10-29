import { describe, it, test, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mock native ESM modules
jest.mock(
  "expo-speech",
  () => ({
    speak: jest.fn(),
    stop: jest.fn(),
    isSpeakingAsync: jest.fn(async () => false),
    getAvailableVoicesAsync: jest.fn(async () => []),
  }),
  { virtual: true }
);

jest.mock(
  "react-native",
  () => ({
    Platform: { OS: "android" },
  }),
  { virtual: true }
);

jest.mock(
  "expo-location",
  () => ({
    hasServicesEnabledAsync: jest.fn(),
    getForegroundPermissionsAsync: jest.fn(),
    requestForegroundPermissionsAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
    watchPositionAsync: jest.fn(),
    Accuracy: {
      BestForNavigation: 6,
      High: 4,
      Balanced: 3,
      Low: 2,
    },
    PermissionStatus: {
      GRANTED: "granted",
      DENIED: "denied",
      UNDETERMINED: "undetermined",
    },
  }),
  { virtual: true }
);

import * as Location from "expo-location";
import {
  LocationService,
  RealGpsLocation,
} from "./locationService";
import {
  OutdoorRoutingService,
  decodeValhallaPolyline,
  OutdoorRoute,
} from "./outdoorRoutingService";
import {
  NavigationProgressService,
  haversineDistanceMeters,
  projectPointOntoSegment,
} from "./navigationProgressService";
import {
  CHANDIGARH_UNIVERSITY_POIS,
  searchCampusPois,
} from "../data/campusSurveyData";
import { speechService } from "./speech";

describe("PART C — Live GPS Location Service", () => {
  let service: LocationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LocationService();
  });

  afterEach(() => {
    service.stopAll();
  });

  test("Accuracy categorization maps to safety thresholds", () => {
    expect(service.evaluateAccuracy(3.5)).toBe("excellent");
    expect(service.evaluateAccuracy(8.0)).toBe("good");
    expect(service.evaluateAccuracy(15.0)).toBe("moderate");
    expect(service.evaluateAccuracy(28.0)).toBe("poor");
    expect(service.evaluateAccuracy(45.0)).toBe("unusable");
  });

  test("requestPermissions handles disabled GPS services", async () => {
    (Location.hasServicesEnabledAsync as any).mockResolvedValue(false);

    const res = await service.requestPermissions();
    expect(res.granted).toBe(false);
    expect(res.servicesEnabled).toBe(false);
    expect(res.errorMessage).toContain("turned off");
  });

  test("requestPermissions handles user permission denial", async () => {
    (Location.hasServicesEnabledAsync as any).mockResolvedValue(true);
    (Location.getForegroundPermissionsAsync as any).mockResolvedValue({
      status: Location.PermissionStatus.DENIED,
      canAskAgain: true,
    });
    (Location.requestForegroundPermissionsAsync as any).mockResolvedValue({
      status: Location.PermissionStatus.DENIED,
      canAskAgain: false,
    });

    const res = await service.requestPermissions();
    expect(res.granted).toBe(false);
    expect(res.servicesEnabled).toBe(true);
    expect(res.errorMessage).toContain("denied");
  });

  test("requestPermissions grants access when allowed", async () => {
    (Location.hasServicesEnabledAsync as any).mockResolvedValue(true);
    (Location.getForegroundPermissionsAsync as any).mockResolvedValue({
      status: Location.PermissionStatus.GRANTED,
      canAskAgain: true,
    });

    const res = await service.requestPermissions();
    expect(res.granted).toBe(true);
    expect(res.servicesEnabled).toBe(true);
  });

  test("getCurrentLocation acquires real GPS coordinates and flags staleness", async () => {
    (Location.hasServicesEnabledAsync as any).mockResolvedValue(true);
    (Location.getForegroundPermissionsAsync as any).mockResolvedValue({
      status: Location.PermissionStatus.GRANTED,
      canAskAgain: true,
    });
    (Location.getCurrentPositionAsync as any).mockResolvedValue({
      coords: {
        latitude: 30.770726,
        longitude: 76.576329,
        accuracy: 4.2,
        altitude: 310.5,
        heading: 180,
        speed: 1.2,
      },
      timestamp: Date.now(),
    });

    const fix = await service.getCurrentLocation();
    expect(fix).not.toBeNull();
    expect(fix?.latitude).toBe(30.770726);
    expect(fix?.longitude).toBe(76.576329);
    expect(fix?.accuracyMeters).toBe(4.2);
    expect(fix?.accuracyLevel).toBe("excellent");
    expect(fix?.isStale).toBe(false);
  });

  test("startWatchingLocation starts high-accuracy subscription and cleans up on stop", async () => {
    (Location.hasServicesEnabledAsync as any).mockResolvedValue(true);
    (Location.getForegroundPermissionsAsync as any).mockResolvedValue({
      status: Location.PermissionStatus.GRANTED,
      canAskAgain: true,
    });

    const mockRemove = jest.fn();
    (Location.watchPositionAsync as any).mockResolvedValue({
      remove: mockRemove,
    });

    const locListener = jest.fn();
    await service.startWatchingLocation(locListener);

    expect(Location.watchPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1500,
        distanceInterval: 2,
      }),
      expect.any(Function)
    );

    service.stopWatchingLocation(locListener);
    expect(mockRemove).toHaveBeenCalled();
  });
});

describe("PART D — Outdoor Walking Routing Service", () => {
  let router: OutdoorRoutingService;

  beforeEach(() => {
    jest.clearAllMocks();
    router = new OutdoorRoutingService();
  });

  test("decodeValhallaPolyline decodes precision 6 polyline to [lat, lon] tuples", () => {
    const encoded = "kabuy@qcz`qCbA?~DT";
    const coords = decodeValhallaPolyline(encoded, 6);
    expect(coords.length).toBeGreaterThanOrEqual(1);
    expect(typeof coords[0][0]).toBe("number");
    expect(typeof coords[0][1]).toBe("number");
    expect(coords[0][0]).toBeCloseTo(30.7707, 3);
    expect(coords[0][1]).toBeCloseTo(76.5763, 3);
  });

  test("calculateRoute returns parsed walking route when API succeeds", async () => {
    const mockValhallaResponse = {
      trip: {
        summary: { length: 0.154, time: 109 },
        legs: [
          {
            shape: "kabuy@qcz`qCbA?~DT",
            maneuvers: [
              { instruction: "Walk south.", length: 0.08, time: 55, begin_shape_index: 0 },
              { instruction: "Turn right.", length: 0.074, time: 54, begin_shape_index: 1 },
            ],
          },
        ],
      },
    };

    (globalThis as any).fetch = (jest.fn() as any).mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/routing/walk")) {
        return {
          ok: true,
          json: async () => ({
            status: "success",
            total_distance_meters: 154,
            total_time_seconds: 109,
            polyline: "kabuy@qcz`qCbA?~DT",
            coordinates: [
              [30.7707, 76.5763],
              [30.7696, 76.5755],
            ],
            maneuvers: [
              {
                instruction: "Walk south.",
                distance_meters: 80,
                time_seconds: 55,
                location: { latitude: 30.7707, longitude: 76.5763 },
              },
              {
                instruction: "Turn right.",
                distance_meters: 74,
                time_seconds: 54,
                location: { latitude: 30.7696, longitude: 76.5755 },
              },
            ],
            spoken_summary: "Walking route to Block 1 found. Total distance: 154 meters.",
          }),
        };
      }
      return {
        ok: true,
        json: async () => mockValhallaResponse,
      };
    });

    const route = await router.calculateRoute(
      { latitude: 30.770726, longitude: 76.576329 },
      { latitude: 30.769660, longitude: 76.575543 },
      { destinationName: "Block 1" }
    );

    expect(route.status).toBe("success");
    expect(route.totalDistanceMeters).toBe(154);
    expect(route.maneuvers.length).toBe(2);
    expect(route.spokenSummary).toContain("Block 1");
    expect(route.coordinates.length).toBeGreaterThanOrEqual(1);
  });

  test("calculateRoute returns no_route_found when path is disconnected in map data", async () => {
    (globalThis as any).fetch = (jest.fn() as any).mockResolvedValue({
      ok: false,
      status: 400,
    });

    const route = await router.calculateRoute(
      { latitude: 30.770726, longitude: 76.576329 },
      { latitude: 0, longitude: 0 },
      { destinationName: "Nowhere" }
    );

    expect(route.status).toBe("no_route_found");
    expect(route.spokenSummary).toContain("No pedestrian walking route found");
  });

  test("calculateRoute handles network failure gracefully", async () => {
    (globalThis as any).fetch = (jest.fn() as any).mockRejectedValue(new Error("Network connection dropped"));

    const route = await router.calculateRoute(
      { latitude: 30.770726, longitude: 76.576329 },
      { latitude: 30.769660, longitude: 76.575543 }
    );

    expect(route.status).toBe("error");
    expect(route.spokenSummary).toContain("network connection error");
  });
});

describe("PART E — Navigation Progress & Geometric Tracking", () => {
  let progressService: NavigationProgressService;

  const sampleRoute: OutdoorRoute = {
    status: "success",
    totalDistanceMeters: 150,
    totalTimeSeconds: 105,
    polyline: "test_polyline",
    coordinates: [
      [30.770726, 76.576329], // Gate 1 start
      [30.770000, 76.576000], // Middle point (~85m away)
      [30.769660, 76.575543], // Block 1 destination (~150m away)
    ],
    maneuvers: [
      {
        instruction: "Walk south along main university pathway.",
        distanceMeters: 85,
        timeSeconds: 60,
        location: { latitude: 30.770000, longitude: 76.576000 },
      },
      {
        instruction: "Turn right into Block 1 entrance lobby.",
        distanceMeters: 65,
        timeSeconds: 45,
        location: { latitude: 30.769660, longitude: 76.575543 },
      },
    ],
    spokenSummary: "Route to Block 1 found.",
    destinationName: "Block 1",
    hasStairs: false,
    accessibilityStatus: "verified_stair_free",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(speechService, "speak").mockImplementation(async () => {});
    jest.spyOn(speechService, "stop").mockImplementation(async () => {});
    progressService = new NavigationProgressService();
  });

  test("haversineDistanceMeters computes accurate spherical distances", () => {
    const dist = haversineDistanceMeters(30.770726, 76.576329, 30.769660, 76.575543);
    expect(dist).toBeGreaterThan(130);
    expect(dist).toBeLessThan(160);
  });

  test("projectPointOntoSegment projects user GPS onto route polyline", () => {
    const userLat = 30.77035;
    const userLon = 76.57625;
    const proj = projectPointOntoSegment(
      userLat,
      userLon,
      30.770726,
      76.576329,
      30.770000,
      76.576000
    );

    expect(proj.t).toBeGreaterThan(0);
    expect(proj.t).toBeLessThan(1);
    expect(proj.distanceMeters).toBeGreaterThan(0);
  });

  test("processGpsUpdate tracks along-track progress and distance along route geometry", () => {
    progressService.startNavigation(sampleRoute);

    const userGps: RealGpsLocation = {
      latitude: 30.770650,
      longitude: 76.576300,
      accuracyMeters: 3.5,
      altitudeMeters: null,
      headingDegrees: 180,
      speedMetersPerSec: 1.2,
      timestamp: Date.now(),
      isStale: false,
      accuracyLevel: "excellent",
    };

    const state = progressService.processGpsUpdate(userGps);
    expect(state.isActive).toBe(true);
    expect(state.isArrived).toBe(false);
    expect(state.remainingTotalDistanceMeters).toBeGreaterThan(120);
    expect(state.remainingTotalDistanceMeters).toBeLessThan(155);
  });

  test("Debounces approach cues and suppresses when GPS accuracy is poor (>15m)", () => {
    progressService.startNavigation(sampleRoute);

    const poorAccuracyGps: RealGpsLocation = {
      latitude: 30.770120,
      longitude: 76.576050,
      accuracyMeters: 25.0,
      altitudeMeters: null,
      headingDegrees: null,
      speedMetersPerSec: null,
      timestamp: Date.now(),
      isStale: false,
      accuracyLevel: "poor",
    };

    progressService.processGpsUpdate(poorAccuracyGps);
    expect(speechService.speak).not.toHaveBeenCalledWith(
      expect.stringContaining("In approximately"),
      expect.any(Object)
    );

    const goodAccuracyGps: RealGpsLocation = {
      ...poorAccuracyGps,
      accuracyMeters: 4.0,
      accuracyLevel: "excellent",
    };

    progressService.processGpsUpdate(goodAccuracyGps);
    expect(speechService.speak).toHaveBeenCalledWith(
      expect.stringContaining("In approximately"),
      expect.any(Object)
    );

    (speechService.speak as any).mockClear();
    progressService.processGpsUpdate(goodAccuracyGps);
    expect(speechService.speak).not.toHaveBeenCalledWith(
      expect.stringContaining("In approximately"),
      expect.any(Object)
    );
  });

  test("Detects off-route deviation after consecutive stable fixes and requests recalculation", () => {
    const onRecalculate = jest.fn();
    progressService.startNavigation(sampleRoute, onRecalculate);

    const offRouteGps: RealGpsLocation = {
      latitude: 30.770500,
      longitude: 76.577500,
      accuracyMeters: 5.0,
      altitudeMeters: null,
      headingDegrees: null,
      speedMetersPerSec: null,
      timestamp: Date.now(),
      isStale: false,
      accuracyLevel: "excellent",
    };

    progressService.processGpsUpdate(offRouteGps);
    expect(onRecalculate).not.toHaveBeenCalled();

    progressService.processGpsUpdate(offRouteGps);
    expect(onRecalculate).toHaveBeenCalled();
    expect(speechService.speak).toHaveBeenCalledWith(
      expect.stringContaining("deviated approximately"),
      expect.any(Object)
    );
  });

  test("Gates arrival by accuracy threshold: warns if accuracy is poor instead of claiming arrival", () => {
    progressService.startNavigation(sampleRoute);

    const poorArrivalGps: RealGpsLocation = {
      latitude: 30.769662,
      longitude: 76.575545,
      accuracyMeters: 22.0,
      altitudeMeters: null,
      headingDegrees: null,
      speedMetersPerSec: null,
      timestamp: Date.now(),
      isStale: false,
      accuracyLevel: "poor",
    };

    const state1 = progressService.processGpsUpdate(poorArrivalGps);
    expect(state1.isArrived).toBe(false);
    expect(speechService.speak).toHaveBeenCalledWith(
      expect.stringContaining("GPS uncertainty is plus or minus"),
      expect.any(Object)
    );

    const goodArrivalGps: RealGpsLocation = {
      ...poorArrivalGps,
      accuracyMeters: 5.0,
      accuracyLevel: "excellent",
    };

    progressService.processGpsUpdate(goodArrivalGps);
    const state2 = progressService.processGpsUpdate(goodArrivalGps);
    expect(state2.isArrived).toBe(true);
    expect(speechService.speak).toHaveBeenCalledWith(
      expect.stringContaining("You have arrived at Block 1"),
      expect.any(Object)
    );
  });

  test("repeatCurrentInstruction and stopSpeaking controls function correctly", async () => {
    progressService.startNavigation(sampleRoute);

    await progressService.repeatCurrentInstruction();
    expect(speechService.speak).toHaveBeenCalledWith(
      expect.stringContaining("Walk south"),
      expect.any(Object)
    );

    await progressService.stopSpeaking();
    expect(speechService.stop).toHaveBeenCalled();
  });
});

describe("Campus Survey POIs & University Map Validation", () => {
  test("All surveyed POIs have real coordinates within Chandigarh University bounding box", () => {
    for (const poi of CHANDIGARH_UNIVERSITY_POIS) {
      expect(poi.latitude).toBeGreaterThanOrEqual(30.763);
      expect(poi.latitude).toBeLessThanOrEqual(30.776);
      expect(poi.longitude).toBeGreaterThanOrEqual(76.568);
      expect(poi.longitude).toBeLessThanOrEqual(76.582);
      expect(poi.surveyStatus).toBe("verified_osm");
    }
  });

  test("searchCampusPois finds POIs by name, keyword, or shortCode", () => {
    const b1 = searchCampusPois("Block 1");
    expect(b1.length).toBeGreaterThan(0);
    expect(b1[0].name).toContain("Block 1");

    const hostels = searchCampusPois("hostel");
    expect(hostels.length).toBeGreaterThanOrEqual(2);

    const sbi = searchCampusPois("atm");
    expect(sbi.length).toBeGreaterThanOrEqual(1);
    expect(sbi[0].name).toContain("State Bank of India");
  });
});
