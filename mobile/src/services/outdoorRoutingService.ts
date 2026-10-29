/**
 * Saarthi Outdoor Pedestrian Routing Service.
 *
 * Implements real walking route calculation using the open-source Valhalla routing engine
 * (or Saarthi backend proxy) backed by OpenStreetMap pedestrian way data.
 *
 * Safety & Reliability Constraints:
 * - Never invents routes or silently falls back to fabricated geometry.
 * - Always reports real start/end coordinates, maneuvers, distances, and polyline.
 * - Exposes disconnected or inaccessible paths honestly.
 * - Never claims a route is stair-free unless verified by routing data.
 * - Marks accessibility as unknown when stair metadata cannot be determined.
 */

import { getBackendBaseUrl } from "../config/env";

export interface RouteCoordinates {
  latitude: number;
  longitude: number;
}

export interface RouteManeuver {
  instruction: string;
  distanceMeters: number;
  timeSeconds: number;
  bearingDegrees?: number;
  maneuverType?: string;
  location: RouteCoordinates;
  hasStairs?: boolean;
}

export type OutdoorRouteStatus = "success" | "no_route_found" | "error";

export type RouteAccessibilityStatus = "verified_stair_free" | "contains_stairs" | "unknown";

export interface RouteBoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface OutdoorRoute {
  status: OutdoorRouteStatus;
  totalDistanceMeters: number;
  totalTimeSeconds: number;
  polyline: string;
  coordinates: [number, number][]; // [latitude, longitude] tuples
  maneuvers: RouteManeuver[];
  spokenSummary: string;
  destinationName?: string;
  errorMessage?: string;
  hasStairs: boolean;
  accessibilityStatus: RouteAccessibilityStatus;
  stairsWarning?: string;
  bounds?: RouteBoundingBox;
}

export interface RouteOptions {
  avoidStairs?: boolean;
  destinationName?: string;
}

/**
 * Decode a Valhalla encoded polyline string (precision 6) into [lat, lon] tuples.
 */
export function decodeValhallaPolyline(encoded: string, precision: number = 6): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = Math.pow(10, precision);

  while (index < encoded.length) {
    let byte = 0;
    let shift = 0;
    let result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push([Math.round((lat / factor) * 1000000) / 1000000, Math.round((lng / factor) * 1000000) / 1000000]);
  }

  return coordinates;
}

export function computeCoordinatesBoundingBox(coords: [number, number][]): RouteBoundingBox | undefined {
  if (!coords || coords.length === 0) return undefined;
  let minLat = coords[0][0];
  let maxLat = coords[0][0];
  let minLon = coords[0][1];
  let maxLon = coords[0][1];

  for (let i = 1; i < coords.length; i++) {
    const [lat, lon] = coords[i];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  return { minLat, maxLat, minLon, maxLon };
}

function hasUsableWalkingRoute(
  coordinates: [number, number][],
  maneuvers: RouteManeuver[]
): boolean {
  return (
    coordinates.length >= 2 &&
    coordinates.every(
      ([latitude, longitude]) =>
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180
    ) &&
    maneuvers.length > 0 &&
    maneuvers.every(
      (maneuver) =>
        Number.isFinite(maneuver.location.latitude) &&
        Number.isFinite(maneuver.location.longitude)
    )
  );
}

const STAIRS_REGEX = /\b(stairs|steps|stairway|staircase)\b/i;

export class OutdoorRoutingService {
  private defaultValhallaUrl: string = "https://valhalla1.openstreetmap.de/route";

  /**
   * Request a real walking route from start to destination coordinates.
   */
  public async calculateRoute(
    start: RouteCoordinates,
    destination: RouteCoordinates,
    options: RouteOptions = {}
  ): Promise<OutdoorRoute> {
    // 1. Try the backend proxy. Only accept a complete successful route;
    // otherwise try the direct provider instead of stopping on a backend error/no-route response.
    try {
      const backendRes = await this.queryBackendRoute(start, destination, options);
      if (backendRes) {
        return backendRes;
      }
    } catch {
      // Fall through to direct Valhalla query if backend is offline
    }

    // 2. Direct Valhalla query fallback
    return await this.queryDirectValhalla(start, destination, options);
  }

  private async queryBackendRoute(
    start: RouteCoordinates,
    destination: RouteCoordinates,
    options: RouteOptions
  ): Promise<OutdoorRoute | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(`${getBackendBaseUrl()}/api/v1/routing/walk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: { latitude: start.latitude, longitude: start.longitude },
          destination: { latitude: destination.latitude, longitude: destination.longitude },
          destination_name: options.destinationName,
          avoid_stairs: Boolean(options.avoidStairs),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      if (!data || data.status !== "success") {
        return null;
      }
      const coords: [number, number][] = (data.coordinates || []).map((pt: number[]) => [pt[0], pt[1]] as [number, number]);
      const maneuvers: RouteManeuver[] = (data.maneuvers || []).map((m: any) => ({
        instruction: m.instruction,
        distanceMeters: m.distance_meters,
        timeSeconds: m.time_seconds,
        bearingDegrees: m.bearing_degrees,
        maneuverType: m.maneuver_type,
        hasStairs: Boolean(m.has_stairs),
        location: {
          latitude: m.location.latitude,
          longitude: m.location.longitude,
        },
      }));
      if (!hasUsableWalkingRoute(coords, maneuvers)) {
        return null;
      }
      const hasStairs = maneuvers.some((maneuver) => Boolean(maneuver.hasStairs));
      const accessibilityStatus: RouteAccessibilityStatus = hasStairs ? "contains_stairs" : "unknown";
      const stairsWarning = data.stairs_warning || (hasStairs
        ? options.avoidStairs
          ? "Warning: Valhalla map data marks stairs on this route; no stair-free alternative was found."
          : "Warning: Valhalla map data marks stairs on this route."
        : options.avoidStairs
          ? "Stair avoidance was requested, but map data cannot confirm that this route is stair-free."
          : "Stair details may be incomplete in map data; this route may include stairs.");

      return {
        status: data.status,
        totalDistanceMeters: data.total_distance_meters,
        totalTimeSeconds: data.total_time_seconds,
        polyline: data.polyline,
        coordinates: coords,
        maneuvers,
        spokenSummary: data.spoken_summary,
        destinationName: options.destinationName,
        errorMessage: data.error_message,
        hasStairs,
        // Ignore legacy server claims of "verified stair-free"; Valhalla step penalties are not hard exclusions.
        accessibilityStatus,
        stairsWarning,
        bounds: computeCoordinatesBoundingBox(coords),
      };
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }

  private async queryDirectValhalla(
    start: RouteCoordinates,
    destination: RouteCoordinates,
    options: RouteOptions
  ): Promise<OutdoorRoute> {
    const valhallaBody = {
      locations: [
        { lat: start.latitude, lon: start.longitude, type: "break" },
        { lat: destination.latitude, lon: destination.longitude, type: "break" },
      ],
      costing: "pedestrian",
      costing_options: {
        pedestrian: {
          walking_speed: 4.2,
          // Valhalla uses a penalty, not a hard stair exclusion. This cannot prove the route is stair-free.
          step_penalty: options.avoidStairs ? 300.0 : 0.0,
          use_hills: options.avoidStairs ? 0.2 : 0.5,
          use_lit: 0.0,
          type: "blind",
        },
      },
      directions_options: {
        units: "kilometers",
        language: "en-US",
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    try {
      const res = await fetch(this.defaultValhallaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valhallaBody),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        return {
          status: "no_route_found",
          totalDistanceMeters: 0,
          totalTimeSeconds: 0,
          polyline: "",
          coordinates: [],
          maneuvers: [],
          spokenSummary: `No pedestrian walking route found to ${options.destinationName || "destination"}. Pedestrian path may be unmapped or disconnected.`,
          destinationName: options.destinationName,
          errorMessage: "Valhalla could not find a walking route between points.",
          hasStairs: false,
          accessibilityStatus: "unknown",
        };
      }

      const data = await res.json();
      const trip = data?.trip;
      const summary = trip?.summary;
      const legs = trip?.legs;

      if (!legs || legs.length === 0) {
        return {
          status: "no_route_found",
          totalDistanceMeters: 0,
          totalTimeSeconds: 0,
          polyline: "",
          coordinates: [],
          maneuvers: [],
          spokenSummary: `No walking route could be calculated to ${options.destinationName || "destination"}.`,
          destinationName: options.destinationName,
          errorMessage: "Route legs were empty.",
          hasStairs: false,
          accessibilityStatus: "unknown",
        };
      }

      const primaryLeg = legs[0];
      const encodedShape = primaryLeg.shape || "";
      const coordinates = decodeValhallaPolyline(encodedShape, 6);

      const totalDistMeters = Math.round((summary?.length || 0) * 1000);
      const totalTimeSeconds = Math.round(summary?.time || 0);

      let routeHasStairs = false;
      const maneuvers: RouteManeuver[] = (primaryLeg.maneuvers || []).map((m: any) => {
        const shapeIdx = m.begin_shape_index || 0;
        const pt = coordinates[shapeIdx] || [start.latitude, start.longitude];
        const instruction = m.instruction || "";
        const mType = String(m.type ?? "");
        const isStairs = mType === "27" || STAIRS_REGEX.test(instruction);
        if (isStairs) routeHasStairs = true;

        return {
          instruction,
          distanceMeters: Math.round((m.length || 0) * 1000),
          timeSeconds: Math.round(m.time || 0),
          bearingDegrees: m.bearing,
          maneuverType: mType,
          hasStairs: isStairs,
          location: { latitude: pt[0], longitude: pt[1] },
        };
      });

      if (!hasUsableWalkingRoute(coordinates, maneuvers)) {
        return {
          status: "error",
          totalDistanceMeters: 0,
          totalTimeSeconds: 0,
          polyline: "",
          coordinates: [],
          maneuvers: [],
          spokenSummary: "The routing service returned incomplete route guidance. Please try again or choose another destination.",
          destinationName: options.destinationName,
          errorMessage: "Valhalla returned a route without usable geometry and turn instructions.",
          hasStairs: false,
          accessibilityStatus: "unknown",
        };
      }

      // Determine genuine accessibility status
      let accessibilityStatus: RouteAccessibilityStatus = "unknown";
      let stairsWarning: string | undefined = undefined;

      if (routeHasStairs) {
        accessibilityStatus = "contains_stairs";
        stairsWarning = options.avoidStairs
          ? "Warning: Valhalla map data marks stairs on this route; no stair-free alternative was found."
          : "Warning: Valhalla map data marks stairs on this route.";
      } else {
        accessibilityStatus = "unknown";
        stairsWarning = options.avoidStairs
          ? "Stair avoidance was requested, but map data cannot confirm that this route is stair-free."
          : "Stair details may be incomplete in map data; this route may include stairs.";
      }

      const destLabel = options.destinationName || "your destination";
      const distStr =
        totalDistMeters >= 1000
          ? `${(totalDistMeters / 1000).toFixed(1)} kilometers`
          : `${totalDistMeters} meters`;
      const timeStr = `${Math.max(1, Math.round(totalTimeSeconds / 60))} minutes walk`;

      const summaryParts = [
        `Walking route to ${destLabel} found.`,
        `Total distance: ${distStr}, approximately ${timeStr}.`,
      ];
      if (stairsWarning) {
        summaryParts.push(stairsWarning);
      }
      if (maneuvers.length > 0) {
        summaryParts.push(`First step: ${maneuvers[0].instruction}`);
      } else {
        summaryParts.push("Proceed towards destination.");
      }

      return {
        status: "success",
        totalDistanceMeters: totalDistMeters,
        totalTimeSeconds: totalTimeSeconds,
        polyline: encodedShape,
        coordinates,
        maneuvers,
        spokenSummary: summaryParts.join(" "),
        destinationName: options.destinationName,
        hasStairs: routeHasStairs,
        accessibilityStatus,
        stairsWarning,
        bounds: computeCoordinatesBoundingBox(coordinates),
      };
    } catch (err: any) {
      clearTimeout(timeout);
      return {
        status: "error",
        totalDistanceMeters: 0,
        totalTimeSeconds: 0,
        polyline: "",
        coordinates: [],
        maneuvers: [],
        spokenSummary: "Could not calculate walking route due to a network connection error. Please check your data connection.",
        destinationName: options.destinationName,
        errorMessage: err?.message || "Network request failed",
        hasStairs: false,
        accessibilityStatus: "unknown",
      };
    }
  }
}

export const outdoorRoutingService = new OutdoorRoutingService();
