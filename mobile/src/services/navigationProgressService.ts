/**
 * Saarthi Dedicated Real-Time Navigation Progress Service.
 *
 * Implements actual along-route geometric distance tracking, approach cues,
 * maneuver progress, debounce/hysteresis, and accuracy-gated arrival detection.
 *
 * Safety Rules (Part E & Standing Rules):
 * - Distance is derived strictly from real polyline route geometry and GPS projection.
 * - Never manufactures remaining distance if geometry or GPS is unavailable.
 * - Accuracy gating: Refuses to claim arrival or precision cues when GPS accuracy > threshold.
 * - Debouncing & Hysteresis: Prevents repeated cue spamming caused by GPS jitter.
 * - Off-route deviation: Recalculates only with consecutive stable off-track fixes.
 * - No fake timers or assumed walking speed progress.
 */

import { RealGpsLocation } from "./locationService";
import { OutdoorRoute, RouteManeuver } from "./outdoorRoutingService";
import { speechService } from "./speech";

export interface NavigationProgressState {
  isActive: boolean;
  isArrived: boolean;
  isOffRoute: boolean;
  currentManeuverIndex: number;
  currentManeuver: RouteManeuver | null;
  distanceToNextManeuverMeters: number;
  remainingTotalDistanceMeters: number;
  crossTrackDistanceMeters: number;
  gpsAccuracyMeters: number;
  isAccuracyUncertain: boolean;
  lastAnnouncement: string | null;
}

export type ProgressListener = (state: NavigationProgressState) => void;

// Conversion constants
const EARTH_RADIUS_METERS = 6371000;
const DEG_TO_RAD = Math.PI / 180;

// Configurable safety thresholds
export const ARRIVAL_DISTANCE_THRESHOLD_METERS = 10.0;
export const ARRIVAL_ACCURACY_CONFIDENCE_METERS = 14.0;
export const DEVIATION_DISTANCE_THRESHOLD_METERS = 24.0;
export const APPROACH_CUE_ACCURACY_THRESHOLD_METERS = 15.0;

/**
 * Great-circle distance between two [lat, lon] points.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Project point (pLat, pLon) onto line segment from (aLat, aLon) to (bLat, bLon).
 * Returns snapped point and fraction t in [0, 1].
 */
export function projectPointOntoSegment(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): { snappedLat: number; snappedLon: number; t: number; distanceMeters: number } {
  const dx = (bLon - aLon) * Math.cos(((aLat + bLat) / 2) * DEG_TO_RAD);
  const dy = bLat - aLat;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const d = haversineDistanceMeters(pLat, pLon, aLat, aLon);
    return { snappedLat: aLat, snappedLon: aLon, t: 0, distanceMeters: d };
  }

  const px = (pLon - aLon) * Math.cos(((aLat + bLat) / 2) * DEG_TO_RAD);
  const py = pLat - aLat;

  let t = (px * dx + py * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const snappedLat = aLat + t * (bLat - aLat);
  const snappedLon = aLon + t * (bLon - aLon);
  const distanceMeters = haversineDistanceMeters(pLat, pLon, snappedLat, snappedLon);

  return { snappedLat, snappedLon, t, distanceMeters };
}

export class NavigationProgressService {
  private activeRoute: OutdoorRoute | null = null;
  private listeners: Set<ProgressListener> = new Set();
  private announcedCues: Set<string> = new Set();
  private consecutiveOffRouteCount: number = 0;
  private consecutiveArrivalCount: number = 0;
  private hasAnnouncedArrivalWarning: boolean = false;
  private onRecalculateCallback: ((currentGps: RealGpsLocation) => void) | null = null;

  private state: NavigationProgressState = {
    isActive: false,
    isArrived: false,
    isOffRoute: false,
    currentManeuverIndex: 0,
    currentManeuver: null,
    distanceToNextManeuverMeters: 0,
    remainingTotalDistanceMeters: 0,
    crossTrackDistanceMeters: 0,
    gpsAccuracyMeters: 0,
    isAccuracyUncertain: false,
    lastAnnouncement: null,
  };

  /**
   * Start tracking an active outdoor route.
   */
  public startNavigation(
    route: OutdoorRoute,
    onRecalculate?: (currentGps: RealGpsLocation) => void
  ): void {
    this.activeRoute = route;
    this.onRecalculateCallback = onRecalculate || null;
    this.announcedCues.clear();
    this.consecutiveOffRouteCount = 0;
    this.consecutiveArrivalCount = 0;
    this.hasAnnouncedArrivalWarning = false;

    this.state = {
      isActive: true,
      isArrived: false,
      isOffRoute: false,
      currentManeuverIndex: 0,
      currentManeuver: route.maneuvers[0] || null,
      distanceToNextManeuverMeters: route.maneuvers[0]?.distanceMeters || 0,
      remainingTotalDistanceMeters: route.totalDistanceMeters,
      crossTrackDistanceMeters: 0,
      gpsAccuracyMeters: 0,
      isAccuracyUncertain: false,
      lastAnnouncement: null,
    };

    this.emitState();
  }

  /**
   * Stop active navigation session.
   */
  public stopNavigation(): void {
    this.activeRoute = null;
    this.announcedCues.clear();
    this.state = {
      ...this.state,
      isActive: false,
      isArrived: false,
    };
    this.emitState();
  }

  /**
   * Receive a real live GPS location update and advance route progress.
   */
  public processGpsUpdate(location: RealGpsLocation): NavigationProgressState {
    if (!this.state.isActive || !this.activeRoute || this.activeRoute.coordinates.length < 2) {
      return this.state;
    }

    const { latitude, longitude, accuracyMeters, isStale } = location;
    const coords = this.activeRoute.coordinates;

    // 1. Find nearest segment along route polyline (Cross-track projection)
    let bestSegmentIndex = 0;
    let minCrossTrackDistance = Number.MAX_VALUE;
    let bestSnappedPoint = { lat: coords[0][0], lon: coords[0][1], t: 0 };

    for (let i = 0; i < coords.length - 1; i++) {
      const proj = projectPointOntoSegment(
        latitude,
        longitude,
        coords[i][0],
        coords[i][1],
        coords[i + 1][0],
        coords[i + 1][1]
      );

      if (proj.distanceMeters < minCrossTrackDistance) {
        minCrossTrackDistance = proj.distanceMeters;
        bestSegmentIndex = i;
        bestSnappedPoint = { lat: proj.snappedLat, lon: proj.snappedLon, t: proj.t };
      }
    }

    // 2. Compute along-track remaining route distance
    let remainingMeters = haversineDistanceMeters(
      bestSnappedPoint.lat,
      bestSnappedPoint.lon,
      coords[bestSegmentIndex + 1][0],
      coords[bestSegmentIndex + 1][1]
    );

    for (let i = bestSegmentIndex + 1; i < coords.length - 1; i++) {
      remainingMeters += haversineDistanceMeters(
        coords[i][0],
        coords[i][1],
        coords[i + 1][0],
        coords[i + 1][1]
      );
    }

    // 3. Maneuver matching and tracking
    const maneuvers = this.activeRoute.maneuvers;
    let currentManeuverIdx = this.state.currentManeuverIndex;
    let currentManeuver = maneuvers[currentManeuverIdx] || null;

    let distanceToNextManeuver = currentManeuver
      ? haversineDistanceMeters(
          latitude,
          longitude,
          currentManeuver.location.latitude,
          currentManeuver.location.longitude
        )
      : 0;

    // Advance maneuver if arrived at current maneuver waypoint and there is a next step
    if (distanceToNextManeuver <= 10.0 && currentManeuverIdx < maneuvers.length - 1) {
      currentManeuverIdx++;
      currentManeuver = maneuvers[currentManeuverIdx];
      const cueKey = `maneuver_step_${currentManeuverIdx}`;
      if (!this.announcedCues.has(cueKey)) {
        this.announcedCues.add(cueKey);
        speechService.speak(currentManeuver.instruction, { force: true });
      }
      distanceToNextManeuver = haversineDistanceMeters(
        latitude,
        longitude,
        currentManeuver.location.latitude,
        currentManeuver.location.longitude
      );
    }

    // 4. Off-Route Detection with Consecutive Fixes Hysteresis
    const isCurrentlyOffTrack = minCrossTrackDistance > DEVIATION_DISTANCE_THRESHOLD_METERS;
    if (isCurrentlyOffTrack && accuracyMeters <= 22.0 && !isStale) {
      this.consecutiveOffRouteCount++;
    } else {
      this.consecutiveOffRouteCount = Math.max(0, this.consecutiveOffRouteCount - 1);
    }

    const isOffRouteNow = this.consecutiveOffRouteCount >= 2;
    if (isOffRouteNow && !this.state.isOffRoute) {
      const devDist = Math.round(minCrossTrackDistance);
      const devMsg = `You appear to have deviated approximately ${devDist} meters from the route. Recalculating walking route...`;
      speechService.speak(devMsg, { force: true });
      if (this.onRecalculateCallback) {
        this.onRecalculateCallback(location);
      }
    }

    // 5. Approach cues with Debouncing & Accuracy Gating
    const isAccuracyConfident = accuracyMeters <= APPROACH_CUE_ACCURACY_THRESHOLD_METERS && !isStale;
    if (currentManeuver && isAccuracyConfident && !this.state.isArrived) {
      const thresholds = [15, 30];
      for (const th of thresholds) {
        const cueKey = `maneuver_${currentManeuverIdx}_cue_${th}`;
        if (distanceToNextManeuver <= th && !this.announcedCues.has(cueKey)) {
          if (th === 15) {
            this.announcedCues.add(`maneuver_${currentManeuverIdx}_cue_30`);
          }
          this.announcedCues.add(cueKey);
          const approachMsg = `In approximately ${th} meters, ${currentManeuver.instruction}`;
          speechService.speak(approachMsg, { force: true });
          this.state.lastAnnouncement = approachMsg;
          break;
        }
      }
    }

    // 6. Arrival Detection with Mapped Coordinates & Accuracy Gating
    const destinationCoord = coords[coords.length - 1];
    const distanceToFinalDestination = haversineDistanceMeters(
      latitude,
      longitude,
      destinationCoord[0],
      destinationCoord[1]
    );

    const isNearDestination =
      distanceToFinalDestination <= ARRIVAL_DISTANCE_THRESHOLD_METERS ||
      remainingMeters <= ARRIVAL_DISTANCE_THRESHOLD_METERS;

    let isArrivedNow = false;
    if (isNearDestination) {
      if (accuracyMeters <= ARRIVAL_ACCURACY_CONFIDENCE_METERS && !isStale) {
        this.consecutiveArrivalCount++;
        if (this.consecutiveArrivalCount >= 2 && !this.state.isArrived) {
          isArrivedNow = true;
          const arrivalMsg = `You have arrived at ${this.activeRoute.destinationName || "your destination"}.`;
          speechService.speak(arrivalMsg, { force: true });
          this.state.lastAnnouncement = arrivalMsg;
        }
      } else if (!this.hasAnnouncedArrivalWarning) {
        this.hasAnnouncedArrivalWarning = true;
        const uncertMsg = `You are near ${this.activeRoute.destinationName || "destination"}, but GPS uncertainty is plus or minus ${Math.round(accuracyMeters)} meters. Please confirm the building entrance landmark or scan a door sign.`;
        speechService.speak(uncertMsg, { force: true });
        this.state.lastAnnouncement = uncertMsg;
      }
    } else {
      this.consecutiveArrivalCount = 0;
    }

    this.state = {
      isActive: !isArrivedNow,
      isArrived: isArrivedNow || this.state.isArrived,
      isOffRoute: isOffRouteNow,
      currentManeuverIndex: currentManeuverIdx,
      currentManeuver,
      distanceToNextManeuverMeters: Math.round(distanceToNextManeuver),
      remainingTotalDistanceMeters: Math.round(remainingMeters),
      crossTrackDistanceMeters: Math.round(minCrossTrackDistance),
      gpsAccuracyMeters: accuracyMeters,
      isAccuracyUncertain: !isAccuracyConfident,
      lastAnnouncement: this.state.lastAnnouncement,
    };

    this.emitState();
    return this.state;
  }

  /**
   * Spoken instruction repeat.
   */
  public async repeatCurrentInstruction(): Promise<void> {
    if (!this.state.isActive && !this.state.isArrived) {
      await speechService.speak("No active route guidance to repeat.", { force: true });
      return;
    }

    if (this.state.isArrived) {
      await speechService.speak(
        `You have arrived at ${this.activeRoute?.destinationName || "your destination"}.`,
        { force: true }
      );
      return;
    }

    const current = this.state.currentManeuver;
    const remaining = this.state.remainingTotalDistanceMeters;
    const msg = current
      ? `${current.instruction}. Remaining route distance: approximately ${remaining} meters.`
      : `Remaining distance: ${remaining} meters to destination.`;

    await speechService.speak(msg, { force: true });
  }

  /**
   * Immediate silence / stop speaking.
   */
  public async stopSpeaking(): Promise<void> {
    await speechService.stop();
  }

  public subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public getState(): NavigationProgressState {
    return this.state;
  }

  private emitState(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // Safe isolate
      }
    }
  }
}

export const navigationProgressService = new NavigationProgressService();
