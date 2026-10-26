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
}

export type OutdoorRouteStatus = "success" | "no_route_found" | "error";

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
    // 1. Try Backend Proxy endpoint first
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
      return {
        status: data.status,
        totalDistanceMeters: data.total_distance_meters,
        totalTimeSeconds: data.total_time_seconds,
        polyline: data.polyline,
        coordinates: (data.coordinates || []).map((pt: number[]) => [pt[0], pt[1]] as [number, number]),
        maneuvers: (data.maneuvers || []).map((m: any) => ({
          instruction: m.instruction,
          distanceMeters: m.distance_meters,
          timeSeconds: m.time_seconds,
          bearingDegrees: m.bearing_degrees,
          maneuverType: m.maneuver_type,
          location: {
            latitude: m.location.latitude,
            longitude: m.location.longitude,
          },
        })),
        spokenSummary: data.spoken_summary,
        destinationName: options.destinationName,
        errorMessage: data.error_message,
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
          walking_speed: 4.5,
          step_penalty: options.avoidStairs ? 40.0 : 0.0,
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
          spokenSummary: "No walking route found.",
          destinationName: options.destinationName,
          errorMessage: "Route legs were empty.",
        };
      }

      const primaryLeg = legs[0];
      const encodedShape = primaryLeg.shape || "";
      const coordinates = decodeValhallaPolyline(encodedShape, 6);

      const totalDistMeters = Math.round((summary?.length || 0) * 1000);
      const totalTimeSeconds = Math.round(summary?.time || 0);

      const maneuvers: RouteManeuver[] = (primaryLeg.maneuvers || []).map((m: any) => {
        const shapeIdx = m.begin_shape_index || 0;
        const pt = coordinates[shapeIdx] || [start.latitude, start.longitude];
        return {
          instruction: m.instruction || "",
          distanceMeters: Math.round((m.length || 0) * 1000),
          timeSeconds: Math.round(m.time || 0),
          bearingDegrees: m.bearing,
          maneuverType: m.type,
          location: { latitude: pt[0], longitude: pt[1] },
        };
      });

      const destLabel = options.destinationName || "your destination";
      const spokenSummary = `Walking route to ${destLabel} found. Total distance: ${totalDistMeters} meters, approximately ${Math.max(1, Math.round(totalTimeSeconds / 60))} minutes walk. ${maneuvers[0]?.instruction || ""}`;

      return {
        status: "success",
        totalDistanceMeters: totalDistMeters,
        totalTimeSeconds: totalTimeSeconds,
        polyline: encodedShape,
        coordinates,
        maneuvers,
        spokenSummary,
        destinationName: options.destinationName,
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
      };
    }
  }
}

export const outdoorRoutingService = new OutdoorRoutingService();
