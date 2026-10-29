/**
 * Saarthi Campus Map & GPS Navigation Screen.
 *
 * Implements a real-time, interactive, location-aware map with voice-guided navigation.
 * Resembles Google Maps combined with Saarthi's voice assistant.
 *
 * Key Capabilities:
 * - Real OpenStreetMap interactive map centered on live GPS coordinates.
 * - Automatic grounded description of user's surroundings via reverse geocoding on GPS fix.
 * - Destination search (typed or spoken) for campus POIs and wider destinations.
 * - Nearby amenities search (Hospitals, Food, ATMs, Transit, Colleges, Fuel).
 * - Real outdoor pedestrian walking route calculation (via backend / Valhalla).
 * - Spoken turn-by-turn guidance with maneuver updates, distance tracking, repeat, and arrival.
 * - Continuous in-map voice interaction ("Take me to...", "Find hospital nearby", "Stop navigation", "Where am I", "Recenter").
 * - Universal accessibility (>= 56dp touch targets, TalkBack props, WCAG AAA contrast).
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Switch,
  ActivityIndicator,
  AccessibilityInfo,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "../theme/colors";
import { speechService } from "../services/speech";
import { hapticsService } from "../services/haptics";
import {
  locationService,
  RealGpsLocation,
  LocationDiagnostics,
} from "../services/locationService";
import {
  outdoorRoutingService,
  OutdoorRoute,
  RouteCoordinates,
} from "../services/outdoorRoutingService";
import {
  navigationProgressService,
  NavigationProgressState,
} from "../services/navigationProgressService";
import {
  mapSearchService,
  calculateDistanceMeters,
  MapSearchResult,
  NearbyPlaceResult,
  NearbyCategory,
} from "../services/mapSearchService";
import {
  CHANDIGARH_UNIVERSITY_POIS,
  CampusPoi,
  searchCampusPois,
} from "../data/campusSurveyData";
import { CampusMapView } from "../components/CampusMapView";
import { NavigationRoute } from "../navigation/campusRouter";
import { globalVoiceService } from "../services/globalVoiceService";
import { voiceRecognitionService } from "../services/voiceRecognition";
import { parseVoiceCommand } from "../services/voiceCommands";

export type MapVoiceState = "IDLE" | "LISTENING" | "PROCESSING" | "RESPONDING";

export interface PendingDisambiguation {
  query: string;
  candidates: MapSearchResult[];
}

export interface CampusNavigationVoiceActions {
  onSearchDestination: (query: string) => Promise<void>;
  onSearchNearby: (category: string) => Promise<void>;
  onStopNavigation: () => Promise<void>;
  onRepeatInstruction: () => Promise<void>;
  onRecenter: () => Promise<void>;
  onWhereAmI: () => Promise<void>;
  onGetStatus: () => Promise<void>;
}

export interface CampusNavigationScreenProps {
  initialStartNodeId?: string;
  initialDestinationQuery?: string;
  onNavigateBack: () => void;
  onActiveRouteChanged?: (route: NavigationRoute | null) => void;
  onOpenLiveAssist?: () => void;
  onRegisterNavigationActions?: (actions: CampusNavigationVoiceActions | null) => void;
}

export const CampusNavigationScreen: React.FC<CampusNavigationScreenProps> = ({
  initialDestinationQuery,
  onNavigateBack,
  onActiveRouteChanged,
  onOpenLiveAssist,
  onRegisterNavigationActions,
}) => {
  const insets = useSafeAreaInsets();

  // Location & GPS State
  const [currentLocation, setCurrentLocation] = useState<RealGpsLocation | null>(null);
  const [gpsDiagnostics, setGpsDiagnostics] = useState<LocationDiagnostics | null>(null);
  const [isLocationDenied, setIsLocationDenied] = useState<boolean>(false);
  const [isGpsDisabled, setIsGpsDisabled] = useState<boolean>(false);
  const [locationErrorMessage, setLocationErrorMessage] = useState<string | null>(null);
  const hasSpokenWelcomeDescription = useRef<boolean>(false);

  // Search & Destination State
  const [searchQuery, setSearchQuery] = useState<string>(initialDestinationQuery || "");
  const [selectedPoi, setSelectedPoi] = useState<CampusPoi | null>(null);
  const [avoidStairs, setAvoidStairs] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<MapSearchResult[]>([]);
  const [isSearchingDestinations, setIsSearchingDestinations] = useState<boolean>(false);

  // Nearby Amenities State
  const [activeNearbyCategory, setActiveNearbyCategory] = useState<NearbyCategory | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlaceResult[]>([]);
  const [isLoadingNearby, setIsLoadingNearby] = useState<boolean>(false);

  // Navigation & Route State
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [activeOutdoorRoute, setActiveOutdoorRoute] = useState<OutdoorRoute | null>(null);
  const [navProgress, setNavProgress] = useState<NavigationProgressState>(
    navigationProgressService.getState()
  );
  const [routeError, setRouteError] = useState<string | null>(null);

  // Map Controls State
  const [isRecenterRequested, setIsRecenterRequested] = useState<boolean>(false);
  const [navigationMode, setNavigationMode] = useState<"outdoor_gps" | "indoor_landmark">("outdoor_gps");

  // Map-Scoped Voice & Disambiguation State Machine: IDLE -> LISTENING -> PROCESSING -> RESPONDING
  const mapVoiceStateRef = useRef<MapVoiceState>("IDLE");
  const [mapVoiceState, setMapVoiceState] = useState<MapVoiceState>("IDLE");
  const [isMapVoiceActive, setIsMapVoiceActive] = useState<boolean>(false);
  const [isMapListening, setIsMapListening] = useState<boolean>(false);
  const [mapVoiceStatus, setMapVoiceStatus] = useState<string>("Voice mode off");
  const [pendingDisambiguation, setPendingDisambiguation] = useState<PendingDisambiguation | null>(null);

  const wasGlobalVoiceActiveRef = useRef<boolean>(false);
  const mapVoiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const latestTranscriptRef = useRef<string>("");
  const hasProcessedTranscriptRef = useRef<boolean>(false);
  const consecutiveSilencesRef = useRef<number>(0);
  const consecutiveErrorsRef = useRef<number>(0);
  const hasSpokenWelcomePromptRef = useRef<boolean>(false);

  // Active destinations for map rendering:
  // Render campus POIs only when physically near campus (<3km)
  // Otherwise, only render the selected destination pin to keep the general map clean
  const activeDestinations = useMemo(() => {
    const isNearCampus =
      currentLocation &&
      !currentLocation.isStale &&
      calculateDistanceMeters(currentLocation.latitude, currentLocation.longitude, 30.76864, 76.57505) < 3000;

    if (isNearCampus) {
      return CHANDIGARH_UNIVERSITY_POIS;
    }
    if (selectedPoi) {
      return [selectedPoi];
    }
    return [];
  }, [currentLocation, selectedPoi]);

  // Filtered Campus Survey POIs
  const localCampusPois = useMemo(() => {
    return searchCampusPois(searchQuery);
  }, [searchQuery]);

  // Subscribe to navigation progress updates
  useEffect(() => {
    const unsubscribe = navigationProgressService.subscribe((state) => {
      setNavProgress(state);
    });
    return () => unsubscribe();
  }, []);

  // Search destinations when search query changes
  useEffect(() => {
    let isCancelled = false;
    const query = searchQuery.trim();

    if (query.length >= 2) {
      setIsSearchingDestinations(true);
      const timer = setTimeout(async () => {
        try {
          const results = await mapSearchService.searchDestinations(
            query,
            currentLocation?.latitude,
            currentLocation?.longitude
          );
          if (!isCancelled) {
            setSearchResults(results);
            setIsSearchingDestinations(false);
          }
        } catch {
          if (!isCancelled) {
            setIsSearchingDestinations(false);
          }
        }
      }, 350);

      return () => {
        isCancelled = true;
        clearTimeout(timer);
      };
    } else {
      setSearchResults([]);
      setIsSearchingDestinations(false);
    }
  }, [searchQuery, currentLocation?.latitude, currentLocation?.longitude]);

  // --- Map-Scoped Voice State Machine (IDLE -> LISTENING -> PROCESSING -> RESPONDING) ---

  const clearVoiceTimer = useCallback(() => {
    if (mapVoiceTimerRef.current) {
      clearTimeout(mapVoiceTimerRef.current);
      mapVoiceTimerRef.current = null;
    }
  }, []);

  const transitionTo = useCallback((nextState: MapVoiceState, statusText?: string) => {
    mapVoiceStateRef.current = nextState;
    setMapVoiceState(nextState);
    if (nextState === "LISTENING") {
      setIsMapVoiceActive(true);
      setIsMapListening(true);
    } else if (nextState === "IDLE") {
      setIsMapVoiceActive(false);
      setIsMapListening(false);
    } else {
      // PROCESSING or RESPONDING
      setIsMapVoiceActive(true);
      setIsMapListening(false);
    }
    if (statusText) {
      setMapVoiceStatus(statusText);
    }
  }, []);

  const startMapListeningSessionRef = useRef<() => void>(() => {});
  const handleMapVoiceTranscriptRef = useRef<(rawText: string) => Promise<void>>(async () => {});

  const speakAndThenListen = useCallback((speechText: string, listenDelayMs: number = 300) => {
    if (!isMountedRef.current) return;
    clearVoiceTimer();
    voiceRecognitionService.cancelListening();
    transitionTo("RESPONDING", speechText);

    speechService.speak(speechText, {
      force: true,
      onDone: () => {
        if (!isMountedRef.current || mapVoiceStateRef.current === "IDLE") return;
        clearVoiceTimer();
        mapVoiceTimerRef.current = setTimeout(() => {
          if (!isMountedRef.current || mapVoiceStateRef.current === "IDLE") return;
          if (speechService.isSpeaking()) {
            mapVoiceTimerRef.current = setTimeout(() => {
              if (isMountedRef.current && mapVoiceStateRef.current !== "IDLE") {
                startMapListeningSessionRef.current();
              }
            }, 250);
            return;
          }
          startMapListeningSessionRef.current();
        }, listenDelayMs);
      },
      onError: () => {
        if (!isMountedRef.current || mapVoiceStateRef.current === "IDLE") return;
        clearVoiceTimer();
        mapVoiceTimerRef.current = setTimeout(() => {
          if (!isMountedRef.current || mapVoiceStateRef.current === "IDLE") return;
          startMapListeningSessionRef.current();
        }, listenDelayMs);
      },
    });
  }, [clearVoiceTimer, transitionTo]);

  const speakResponseAndIdle = useCallback((speechText: string) => {
    if (!isMountedRef.current) return;
    clearVoiceTimer();
    voiceRecognitionService.cancelListening();
    transitionTo("RESPONDING", speechText);

    speechService.speak(speechText, {
      force: true,
      onDone: () => {
        if (!isMountedRef.current) return;
        transitionTo("IDLE", "Voice mode off");
      },
      onError: () => {
        if (!isMountedRef.current) return;
        transitionTo("IDLE", "Voice mode off");
      },
    });
  }, [clearVoiceTimer, transitionTo]);

  const handleCustomNavigateBack = useCallback(() => {
    clearVoiceTimer();
    voiceRecognitionService.cancelListening();
    speechService.stop();
    transitionTo("IDLE", "Map voice is off.");

    if (wasGlobalVoiceActiveRef.current) {
      globalVoiceService.resumeListening(true);
    }
    onNavigateBack();
  }, [clearVoiceTimer, transitionTo, onNavigateBack]);

  // Lifecycle Coordination: Suspends Home voice on map mount, speaks prompt ONCE, restores Home voice on unmount
  useEffect(() => {
    isMountedRef.current = true;

    // Check if Home / Global Voice was active when entering map
    const globalState = globalVoiceService.getState();
    const wasActive = globalState.isActive && !globalState.isPaused;
    wasGlobalVoiceActiveRef.current = wasActive;

    if (wasActive && !hasSpokenWelcomePromptRef.current) {
      hasSpokenWelcomePromptRef.current = true;
      // Suspend global voice immediately so Home prompts do not fire
      globalVoiceService.pauseListening(false);
      speechService.stop();

      // Launch scoped map voice mode ONCE with short, non-looping prompt
      speakAndThenListen("Where would you like to go?");
    }

    return () => {
      isMountedRef.current = false;
      clearVoiceTimer();
      voiceRecognitionService.cancelListening();
      speechService.stop();

      // Restore Home voice mode cleanly if it was active when entering map
      if (wasGlobalVoiceActiveRef.current) {
        globalVoiceService.resumeListening(true);
      }
    };
  }, [clearVoiceTimer, speakAndThenListen]);

  // Handle route recalculation when user deviates
  const handleRecalculateRoute = useCallback(
    async (devGps: RealGpsLocation) => {
      if (!selectedPoi) return;

      const startCoord: RouteCoordinates = {
        latitude: devGps.latitude,
        longitude: devGps.longitude,
      };
      const destCoord: RouteCoordinates = {
        latitude: selectedPoi.latitude,
        longitude: selectedPoi.longitude,
      };

      try {
        const newRoute = await outdoorRoutingService.calculateRoute(startCoord, destCoord, {
          avoidStairs,
          destinationName: selectedPoi.name,
        });

        if (newRoute.status === "success") {
          setActiveOutdoorRoute(newRoute);
          navigationProgressService.startNavigation(newRoute, handleRecalculateRoute);
          await speechService.speak(
            `New route calculated. Distance: ${newRoute.totalDistanceMeters} meters. ${newRoute.maneuvers[0]?.instruction || ""}`,
            { force: true }
          );
        }
      } catch {
        // Safe isolate
      }
    },
    [selectedPoi, avoidStairs]
  );

  // START ROUTE CALCULATION AND GUIDANCE FOR A GIVEN DESTINATION
  const calculateAndStartRoute = useCallback(
    async (poi: CampusPoi, avoidStairsOverride?: boolean) => {
      if (!currentLocation || currentLocation.isStale) {
        const locationMessage = currentLocation?.isStale
          ? "GPS fix is stale. Waiting for a fresh location before starting navigation."
          : "Waiting for GPS location fix. Please ensure location is enabled.";
        setRouteError(locationMessage);
        speakAndThenListen(locationMessage);
        return;
      }

      await hapticsService.triggerButtonPress();
      setIsCalculatingRoute(true);
      setRouteError(null);
      transitionTo("PROCESSING", `Finding route to ${poi.name}...`);

      const startCoord: RouteCoordinates = {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
      };
      const destCoord: RouteCoordinates = {
        latitude: poi.latitude,
        longitude: poi.longitude,
      };

      try {
        const route = await outdoorRoutingService.calculateRoute(startCoord, destCoord, {
          avoidStairs: avoidStairsOverride ?? avoidStairs,
          destinationName: poi.name,
        });

        setIsCalculatingRoute(false);

        if (route.status === "success") {
          setActiveOutdoorRoute(route);
          navigationProgressService.startNavigation(route, handleRecalculateRoute);
          await hapticsService.triggerSuccess();

          if (onActiveRouteChanged) {
            onActiveRouteChanged({
              status: "success",
              startNode: {
                id: "gps_start",
                label: "Current Location",
                type: "landmark",
                building: "Outdoor",
                floor: 0,
              },
              destinationNode: {
                id: poi.id,
                label: poi.name,
                type: "landmark",
                building: poi.category || "Outdoor",
                floor: 0,
              },
              totalDistanceMeters: route.totalDistanceMeters,
              steps: route.maneuvers.map((m, idx) => ({
                stepIndex: idx,
                fromNode: { id: `m_${idx}`, label: `Step ${idx + 1}`, type: "junction", building: "Outdoor", floor: 0 },
                toNode: { id: `m_${idx + 1}`, label: m.instruction, type: "landmark", building: "Outdoor", floor: 0 },
                distanceMeters: m.distanceMeters,
                hasStairs: Boolean(m.hasStairs),
                spokenInstruction: m.instruction,
                hazards: m.hasStairs ? ["Contains steps / stairs"] : [],
              })),
              usesStairs: route.hasStairs,
              spokenSummary: route.spokenSummary,
              isDemoData: false,
            });
          }

          const distStr =
            route.totalDistanceMeters >= 1000
              ? (route.totalDistanceMeters / 1000).toFixed(1) + " kilometers"
              : route.totalDistanceMeters + " meters";
          const durationStr = `${Math.max(1, Math.round(route.totalTimeSeconds / 60))} minutes walk`;

          let accessibilityAnnounce = "";
          if (route.stairsWarning) {
            accessibilityAnnounce = ` ${route.stairsWarning}`;
          } else if (route.accessibilityStatus === "verified_stair_free") {
            accessibilityAnnounce = " Route is confirmed stair-free.";
          } else if (route.hasStairs) {
            accessibilityAnnounce = " Notice: route includes stairs.";
          } else if (route.accessibilityStatus === "unknown") {
            accessibilityAnnounce = " Stair-free status could not be confirmed from map data.";
          }

          const spokenAnnouncement = `Walking route to ${poi.name} found. Distance: ${distStr}, approximately ${durationStr}.${accessibilityAnnounce} First step: ${route.maneuvers[0]?.instruction || "Proceed along route."}`;

          // Transition to IDLE once route is underway (turn-by-turn navigation engine provides live maneuver speech)
          speakResponseAndIdle(spokenAnnouncement);
        } else {
          setActiveOutdoorRoute(null);
          const failMsg = route.spokenSummary || "No direct pedestrian route found.";
          setRouteError(failMsg);
          speakAndThenListen(failMsg + " Please try another destination.");
        }
      } catch (err: any) {
        setIsCalculatingRoute(false);
        const errMsg = "Failed to calculate walking route. Please check your data connection.";
        setRouteError(errMsg);
        speakAndThenListen(errMsg + " Please try again.");
      }
    },
    [currentLocation, avoidStairs, handleRecalculateRoute, onActiveRouteChanged, speakAndThenListen, speakResponseAndIdle, transitionTo]
  );

  // Select a destination POI or search result
  const handleSelectPoi = useCallback(
    async (poi: CampusPoi, autoStart: boolean = false) => {
      setSelectedPoi(poi);
      setRouteError(null);
      setPendingDisambiguation(null);

      if (autoStart) {
        await calculateAndStartRoute(poi);
      } else {
        speakAndThenListen(`Selected destination: ${poi.name}. Say start route to begin navigation.`);
      }
    },
    [calculateAndStartRoute, speakAndThenListen]
  );

  // Convert a search result to CampusPoi and select
  const handleSelectSearchResult = useCallback(
    async (item: MapSearchResult, autoStart: boolean = false) => {
      const poi: CampusPoi = {
        id: item.id,
        name: item.name,
        shortCode: item.name.length > 12 ? item.name.slice(0, 10) + ".." : item.name,
        category: (item.category as any) || "service",
        latitude: item.latitude,
        longitude: item.longitude,
        description: item.displayName,
        searchKeywords: [item.name.toLowerCase()],
        surveyStatus: "verified_osm",
      };
      await handleSelectPoi(poi, autoStart);
    },
    [handleSelectPoi]
  );

  // Select a nearby place result and select
  const handleSelectNearbyPlace = useCallback(
    async (place: NearbyPlaceResult, autoStart: boolean = false) => {
      const poi: CampusPoi = {
        id: place.id,
        name: place.name,
        shortCode: place.name.length > 12 ? place.name.slice(0, 10) + ".." : place.name,
        category: "service",
        latitude: place.latitude,
        longitude: place.longitude,
        description: place.address || `${place.category} (${Math.round(place.distanceMeters)}m away)`,
        searchKeywords: [place.name.toLowerCase(), place.category],
        surveyStatus: "verified_osm",
      };
      await handleSelectPoi(poi, autoStart);
    },
    [handleSelectPoi]
  );

  // Search nearby places by category
  const handleSearchNearbyCategory = useCallback(
    async (category: NearbyCategory) => {
      await hapticsService.triggerButtonPress();
      setActiveNearbyCategory(category);
      setIsLoadingNearby(true);
      transitionTo("PROCESSING", `Finding nearby ${category}...`);

      const lat = currentLocation?.latitude ?? 30.76864;
      const lon = currentLocation?.longitude ?? 76.57505;

      try {
        const places = await mapSearchService.searchNearbyPlaces(category, lat, lon, 4000);
        setNearbyPlaces(places);
        setIsLoadingNearby(false);

        if (places.length > 0) {
          const nearest = places[0];
          const distStr =
            nearest.distanceMeters >= 1000
              ? (nearest.distanceMeters / 1000).toFixed(1) + " kilometers"
              : Math.round(nearest.distanceMeters) + " meters";
          const spoken = `Found ${places.length} nearby ${category} locations. The nearest is ${nearest.name}, approximately ${distStr} away. Say take me to ${nearest.name} to navigate.`;
          speakAndThenListen(spoken);
        } else {
          const spoken = `No ${category} found within four kilometers. Please try another search.`;
          speakAndThenListen(spoken);
        }
      } catch {
        setIsLoadingNearby(false);
        speakAndThenListen(`Could not retrieve nearby ${category}. Please check your connection.`);
      }
    },
    [currentLocation, speakAndThenListen, transitionTo]
  );

  // START NAVIGATION BUTTON ACTION
  const handleStartNavigation = useCallback(async () => {
    if (!selectedPoi) {
      setRouteError("Please select a destination from the list or search above.");
      speakAndThenListen("Please select a destination first.");
      return;
    }
    await calculateAndStartRoute(selectedPoi);
  }, [selectedPoi, calculateAndStartRoute, speakAndThenListen]);

  // REPEAT INSTRUCTION
  const handleRepeatInstruction = useCallback(async () => {
    await hapticsService.triggerBottomLeft();
    if (activeOutdoorRoute && navProgress.isActive) {
      await navigationProgressService.repeatCurrentInstruction();
    } else {
      await speechService.repeatLast();
    }
  }, [activeOutdoorRoute, navProgress.isActive]);

  // STOP SPEAKING / SILENCE
  const handleStopSpeaking = useCallback(async () => {
    await hapticsService.triggerBottomLeft();
    await navigationProgressService.stopSpeaking();
    await speechService.stop();
  }, []);

  // END NAVIGATION
  const handleEndNavigation = useCallback(async () => {
    await hapticsService.triggerBottomLeft();
    navigationProgressService.stopNavigation();
    setActiveOutdoorRoute(null);
    onActiveRouteChanged?.(null);
    speakAndThenListen("Campus navigation stopped. Where would you like to go next?");
  }, [onActiveRouteChanged, speakAndThenListen]);

  // RECENTER MAP
  const handleRecenter = useCallback(async () => {
    await hapticsService.triggerButtonPress();
    setIsRecenterRequested(true);
    const msg = currentLocation
      ? `Centering map on current location. Accuracy: plus or minus ${Math.round(currentLocation.accuracyMeters)} meters.`
      : "Centering map.";
    speakAndThenListen(msg);
  }, [currentLocation, speakAndThenListen]);

  // DESCRIBE SURROUNDINGS / WHERE AM I
  const handleDescribeSurroundings = useCallback(async () => {
    if (currentLocation && !currentLocation.isStale) {
      const description = await mapSearchService.describeSurroundings(
        currentLocation.latitude,
        currentLocation.longitude
      );
      speakAndThenListen(description);
    } else {
      speakAndThenListen("Waiting for GPS location fix. Please ensure location is enabled and you are outdoors with clear sky view.");
    }
  }, [currentLocation, speakAndThenListen]);

  // GET STATUS
  const handleGetStatus = useCallback(async () => {
    if (activeOutdoorRoute && navProgress.isActive) {
      const distStr =
        navProgress.remainingTotalDistanceMeters >= 1000
          ? (navProgress.remainingTotalDistanceMeters / 1000).toFixed(1) + " kilometers"
          : navProgress.remainingTotalDistanceMeters + " meters";
      const statusMsg = `You are approximately ${distStr} from your destination. ${navProgress.currentManeuver?.instruction || ""}`;
      speakAndThenListen(statusMsg);
    } else {
      speakAndThenListen("Navigation is not active. Say where you would like to go to begin.");
    }
  }, [activeOutdoorRoute, navProgress, speakAndThenListen]);

  // SEARCH NEARBY FROM VOICE
  const handleSearchNearbyFromVoice = useCallback(
    async (cat: string) => {
      let normalizedCat: NearbyCategory = "hospital";
      const c = cat.toLowerCase();
      if (c.includes("hospital") || c.includes("clinic") || c.includes("pharmacy")) normalizedCat = "hospital";
      else if (c.includes("food") || c.includes("restaurant") || c.includes("cafe")) normalizedCat = "food";
      else if (c.includes("atm") || c.includes("bank") || c.includes("cash")) normalizedCat = "atm";
      else if (c.includes("bus") || c.includes("transit") || c.includes("station")) normalizedCat = "transit";
      else if (c.includes("college") || c.includes("university")) normalizedCat = "college";
      else if (c.includes("fuel") || c.includes("petrol") || c.includes("gas")) normalizedCat = "fuel";

      await handleSearchNearbyCategory(normalizedCat);
    },
    [handleSearchNearbyCategory]
  );

  // SEARCH DESTINATION & DISAMBIGUATION
  const handleVoiceSearchDestination = useCallback(
    async (destQuery: string, autoStart: boolean = true) => {
      const q = destQuery.trim();
      if (!q) {
        speakAndThenListen("Where would you like to go? You can say an address, hospital, station, shop, or landmark.");
        return;
      }

      setSearchQuery(q);
      setRouteError(null);
      transitionTo("PROCESSING", `Finding "${q}"...`);

      const lat = currentLocation?.latitude;
      const lon = currentLocation?.longitude;
      const candidates = await mapSearchService.searchDestinations(q, lat, lon);

      if (candidates.length === 0) {
        setPendingDisambiguation(null);
        const msg = `I couldn't find "${q}". Please try another destination.`;
        setRouteError(msg);
        speakAndThenListen(msg);
        return;
      }

      if (candidates.length === 1) {
        setPendingDisambiguation(null);
        await handleSelectSearchResult(candidates[0], autoStart);
        return;
      }

      // Multiple matches: ask the user which one they mean before starting a route!
      const top = candidates.slice(0, 3);
      setPendingDisambiguation({ query: q, candidates: top });

      const optionsSpoken = top
        .map((c, idx) => {
          const detail = c.displayName && c.displayName !== c.name ? `, ${c.displayName.split(",")[1] || ""}` : "";
          const distStr = c.distanceMeters ? ` (${c.distanceMeters >= 1000 ? (c.distanceMeters / 1000).toFixed(1) + " kilometers" : c.distanceMeters + " meters"} away)` : "";
          return `${idx + 1}, ${c.name}${detail}${distStr}`;
        })
        .join(". ");

      const promptMsg = `I found ${top.length} destinations matching ${q}: ${optionsSpoken}. Which one would you like? Say 1, 2, or 3.`;
      speakAndThenListen(promptMsg);
    },
    [currentLocation, handleSelectSearchResult, speakAndThenListen, transitionTo]
  );

  // HANDLE RECOGNIZED TRANSCRIPT
  const handleMapVoiceTranscript = useCallback(
    async (rawText: string) => {
      consecutiveSilencesRef.current = 0;
      consecutiveErrorsRef.current = 0;
      transitionTo("PROCESSING", `Processing: "${rawText}"`);

      const cleaned = rawText
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[.,?!:;'"-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // 1. Check pending disambiguation answering
      if (pendingDisambiguation && pendingDisambiguation.candidates.length > 0) {
        const candidates = pendingDisambiguation.candidates;

        // Cancel / None
        if (
          cleaned === "cancel" ||
          cleaned === "stop" ||
          cleaned === "none" ||
          cleaned === "neither" ||
          cleaned === "never mind" ||
          cleaned === "nevermind"
        ) {
          setPendingDisambiguation(null);
          speakAndThenListen("Cancelled destination selection. What would you like to search for?");
          return;
        }

        // Choice 1
        if (
          cleaned === "1" ||
          cleaned === "one" ||
          cleaned === "first" ||
          cleaned === "option 1" ||
          cleaned === "the first one" ||
          cleaned === "number 1" ||
          cleaned.startsWith("1") ||
          cleaned.startsWith("option 1") ||
          cleaned.startsWith("first") ||
          candidates[0].name.toLowerCase().includes(cleaned)
        ) {
          setPendingDisambiguation(null);
          await handleSelectSearchResult(candidates[0], true);
          return;
        }

        // Choice 2
        if (
          candidates.length > 1 &&
          (cleaned === "2" ||
            cleaned === "two" ||
            cleaned === "second" ||
            cleaned === "option 2" ||
            cleaned === "the second one" ||
            cleaned === "number 2" ||
            cleaned.startsWith("2") ||
            cleaned.startsWith("option 2") ||
            cleaned.startsWith("second") ||
            candidates[1].name.toLowerCase().includes(cleaned))
        ) {
          setPendingDisambiguation(null);
          await handleSelectSearchResult(candidates[1], true);
          return;
        }

        // Choice 3
        if (
          candidates.length > 2 &&
          (cleaned === "3" ||
            cleaned === "three" ||
            cleaned === "third" ||
            cleaned === "option 3" ||
            cleaned === "the third one" ||
            cleaned === "number 3" ||
            cleaned.startsWith("3") ||
            cleaned.startsWith("option 3") ||
            cleaned.startsWith("third") ||
            candidates[2].name.toLowerCase().includes(cleaned))
        ) {
          setPendingDisambiguation(null);
          await handleSelectSearchResult(candidates[2], true);
          return;
        }

        // Spoke another intent/query -> clear disambiguation and fall through
        setPendingDisambiguation(null);
      }

      // 2. Parse general voice intents
      const parsed = parseVoiceCommand(rawText);

      if (parsed.intent === "exit_voice_mode") {
        speakResponseAndIdle("Map voice mode is off.");
        return;
      }

      if (parsed.intent === "stop_listening") {
        voiceRecognitionService.cancelListening();
        speakResponseAndIdle("Listening paused. Tap the microphone to resume.");
        return;
      }

      if (parsed.intent === "resume_listening") {
        speakAndThenListen("Where would you like to go?");
        return;
      }

      if (parsed.intent === "stop") {
        await handleStopSpeaking();
        transitionTo("IDLE", "Voice mode off");
        return;
      }

      if (parsed.intent === "repeat") {
        await handleRepeatInstruction();
        speakAndThenListen("Instruction repeated. Where would you like to go?");
        return;
      }

      if (parsed.intent === "stop_navigation") {
        await handleEndNavigation();
        return;
      }

      if (
        cleaned === "start route" ||
        cleaned === "start navigation" ||
        cleaned === "start" ||
        cleaned === "begin navigation" ||
        cleaned === "begin route"
      ) {
        await handleStartNavigation();
        return;
      }

      if (parsed.intent === "recenter_map") {
        await handleRecenter();
        return;
      }

      if (parsed.intent === "where_am_i") {
        await handleDescribeSurroundings();
        return;
      }

      if (parsed.intent === "navigation_status") {
        await handleGetStatus();
        return;
      }

      if (parsed.intent === "nearby_places") {
        const cat = parsed.categoryQuery || "places";
        await handleSearchNearbyFromVoice(cat);
        return;
      }

      if (
        parsed.intent === "go_back" ||
        parsed.intent === "open_home" ||
        cleaned === "exit map" ||
        cleaned === "close map"
      ) {
        handleCustomNavigateBack();
        return;
      }

      // Avoid stairs toggle via voice
      if (
        cleaned.includes("avoid stairs") ||
        cleaned.includes("no stairs") ||
        cleaned.includes("without stairs") ||
        cleaned.includes("stair free")
      ) {
        setAvoidStairs(true);
        if (selectedPoi && currentLocation) {
          await calculateAndStartRoute(selectedPoi, true);
        } else {
          speakAndThenListen("Stair avoidance enabled. Where would you like to go?");
        }
        return;
      }

      // Allow stairs via voice
      if (
        cleaned.includes("allow stairs") ||
        cleaned.includes("use stairs") ||
        cleaned.includes("shortest route")
      ) {
        setAvoidStairs(false);
        if (selectedPoi && currentLocation) {
          await calculateAndStartRoute(selectedPoi, false);
        } else {
          speakAndThenListen("Stair avoidance disabled. Where would you like to go?");
        }
        return;
      }

      // Alternative route / recalculate
      if (
        cleaned.includes("alternative route") ||
        cleaned.includes("recalculate") ||
        cleaned.includes("different route")
      ) {
        if (selectedPoi && currentLocation) {
          speakAndThenListen("Recalculating pedestrian route.");
          await calculateAndStartRoute(selectedPoi);
        } else {
          speakAndThenListen("No active destination to recalculate. Please say your destination.");
        }
        return;
      }

      if (parsed.intent === "what_can_i_do") {
        const helpMsg =
          "On Campus Map, you can say: take me to the hospital, find a pharmacy, stop navigation, where am I, or repeat.";
        speakAndThenListen(helpMsg);
        return;
      }

      // 3. Fall through to destination query
      const destQuery = parsed.destinationQuery || rawText;
      await handleVoiceSearchDestination(destQuery);
    },
    [
      pendingDisambiguation,
      handleSelectSearchResult,
      speakAndThenListen,
      speakResponseAndIdle,
      transitionTo,
      handleStopSpeaking,
      handleRepeatInstruction,
      handleEndNavigation,
      handleStartNavigation,
      handleRecenter,
      handleDescribeSurroundings,
      handleGetStatus,
      handleSearchNearbyFromVoice,
      handleCustomNavigateBack,
      selectedPoi,
      currentLocation,
      calculateAndStartRoute,
      handleVoiceSearchDestination,
    ]
  );

  handleMapVoiceTranscriptRef.current = handleMapVoiceTranscript;

  // START MAP LISTENING SESSION (Reliable State Machine)
  const startMapListeningSession = useCallback(() => {
    if (!isMountedRef.current) return;
    clearVoiceTimer();

    // Guard: Never listen while speech output is playing
    if (speechService.isSpeaking()) {
      mapVoiceTimerRef.current = setTimeout(() => {
        if (isMountedRef.current && mapVoiceStateRef.current !== "IDLE") {
          startMapListeningSession();
        }
      }, 250);
      return;
    }

    const avail = voiceRecognitionService.checkAvailability();
    if (!avail.available) {
      speakResponseAndIdle("Voice input is unavailable. You can enter your destination manually.");
      return;
    }

    latestTranscriptRef.current = "";
    hasProcessedTranscriptRef.current = false;
    transitionTo("LISTENING", "Listening for destination...");

    try {
      voiceRecognitionService.startListening({
        onStart: () => {
          if (!isMountedRef.current || mapVoiceStateRef.current !== "LISTENING") return;
          transitionTo("LISTENING", "Listening...");
          latestTranscriptRef.current = "";
          hasProcessedTranscriptRef.current = false;
        },
        onResult: (res) => {
          if (!isMountedRef.current || mapVoiceStateRef.current !== "LISTENING") return;
          const text = res.transcript.trim();
          if (text) {
            latestTranscriptRef.current = text;
          }
          if (res.isFinal && text && !hasProcessedTranscriptRef.current) {
            hasProcessedTranscriptRef.current = true;
            voiceRecognitionService.stopListening();
            transitionTo("PROCESSING", `Processing: "${text}"`);
            handleMapVoiceTranscriptRef.current(text);
          }
        },
        onEnd: () => {
          if (!isMountedRef.current || mapVoiceStateRef.current !== "LISTENING") return;
          if (!hasProcessedTranscriptRef.current) {
            const captured = latestTranscriptRef.current.trim();
            if (captured) {
              // Successfully captured speech even if native isFinal flag was not emitted
              hasProcessedTranscriptRef.current = true;
              transitionTo("PROCESSING", `Processing: "${captured}"`);
              handleMapVoiceTranscriptRef.current(captured);
            } else {
              // Do not automatically restart after silence: on devices where
              // speech recognition ends early that creates a prompt loop and
              // makes it appear that the microphone never accepts input.
              consecutiveSilencesRef.current = 0;
              speakResponseAndIdle(
                "I didn't hear a destination. Voice input is paused. Tap the microphone and speak after the prompt."
              );
            }
          }
        },
        onError: (err) => {
          if (!isMountedRef.current || mapVoiceStateRef.current !== "LISTENING") return;
          console.warn("[CampusMapVoice] Recognition error:", err);
          consecutiveErrorsRef.current = 0;
          speakResponseAndIdle(
            `Voice recognition stopped: ${err}. Tap the microphone to try again, or type your destination.`
          );
        },
      });
    } catch {
      speakResponseAndIdle("Could not start voice recognition. Tap the microphone to retry.");
    }
  }, [clearVoiceTimer, transitionTo, speakAndThenListen, speakResponseAndIdle]);

  startMapListeningSessionRef.current = startMapListeningSession;

  // TOGGLE MAP VOICE MODE FROM UI
  const handleToggleMapVoice = useCallback(async () => {
    await hapticsService.triggerButtonPress();
    if (mapVoiceStateRef.current === "LISTENING") {
      clearVoiceTimer();
      voiceRecognitionService.cancelListening();
      speakResponseAndIdle("Listening paused. Tap the microphone to resume.");
    } else {
      consecutiveSilencesRef.current = 0;
      consecutiveErrorsRef.current = 0;
      speakAndThenListen("Where would you like to go?");
    }
  }, [clearVoiceTimer, speakAndThenListen, speakResponseAndIdle]);

  // VOICE ACTIONS DISPATCHER REGISTRATION (Enables seamless continuous in-map conversation)
  useEffect(() => {
    if (!onRegisterNavigationActions) return;

    const voiceActions: CampusNavigationVoiceActions = {
      onSearchDestination: async (destQuery: string) => {
        await handleVoiceSearchDestination(destQuery);
      },
      onSearchNearby: async (cat: string) => {
        await handleSearchNearbyFromVoice(cat);
      },
      onStopNavigation: async () => {
        await handleEndNavigation();
      },
      onRepeatInstruction: async () => {
        await handleRepeatInstruction();
      },
      onRecenter: async () => {
        await handleRecenter();
      },
      onWhereAmI: async () => {
        await handleDescribeSurroundings();
      },
      onGetStatus: async () => {
        await handleGetStatus();
      },
    };

    onRegisterNavigationActions(voiceActions);
    return () => {
      onRegisterNavigationActions(null);
    };
  }, [
    onRegisterNavigationActions,
    handleVoiceSearchDestination,
    handleSearchNearbyFromVoice,
    handleEndNavigation,
    handleRepeatInstruction,
    handleRecenter,
    handleDescribeSurroundings,
    handleGetStatus,
  ]);

  // Initial destination preset if provided via navigation props
  useEffect(() => {
    if (initialDestinationQuery && !selectedPoi) {
      (async () => {
        const matches = searchCampusPois(initialDestinationQuery);
        if (matches.length > 0) {
          setSelectedPoi(matches[0]);
        } else {
          const extMatches = await mapSearchService.searchDestinations(initialDestinationQuery);
          if (extMatches.length > 0) {
            handleSelectSearchResult(extMatches[0], false);
          }
        }
      })();
    }
  }, [initialDestinationQuery]);

  // Initialize and watch device location
  useEffect(() => {
    let isMounted = true;

    const handleLocationUpdate = async (loc: RealGpsLocation) => {
      if (!isMounted) return;
      setCurrentLocation(loc);
      navigationProgressService.processGpsUpdate(loc);

      // Speak grounded surroundings introduction once immediately upon acquiring first reliable GPS fix
      if (!hasSpokenWelcomeDescription.current && !loc.isStale && loc.accuracyMeters <= 60) {
        hasSpokenWelcomeDescription.current = true;
        if (mapVoiceStateRef.current === "IDLE" && !wasGlobalVoiceActiveRef.current) {
          try {
            const surroundingsSpoken = await mapSearchService.describeSurroundings(loc.latitude, loc.longitude);
            if (isMounted) {
              await speechService.speak(surroundingsSpoken, { force: false });
            }
          } catch {
            // Safe isolate
          }
        }
      }
    };

    const handleDiagnostics = (diag: LocationDiagnostics) => {
      if (!isMounted) return;
      setGpsDiagnostics(diag);
      setIsLocationDenied(!diag.permissionGranted);
      setIsGpsDisabled(!diag.servicesEnabled);
    };

    (async () => {
      const perm = await locationService.startWatchingLocation(
        handleLocationUpdate,
        handleDiagnostics
      );

      if (!isMounted) return;

      if (!perm.granted) {
        setIsLocationDenied(true);
        setLocationErrorMessage(perm.errorMessage || "Location permission denied.");
        await speechService.speak(
          "Location permission is required for campus map navigation. Please allow location access in phone Settings.",
          { force: true }
        );
      } else if (!perm.servicesEnabled) {
        setIsGpsDisabled(true);
        setLocationErrorMessage("Device GPS is turned off. Please turn on Location in Settings.");
        await speechService.speak("Device location is turned off. Please enable GPS in phone Settings.", {
          force: true,
        });
      }
    })();

    return () => {
      isMounted = false;
      locationService.stopWatchingLocation(handleLocationUpdate);
    };
  }, []);

  const accuracyBadgeColor = useMemo(() => {
    if (!currentLocation || currentLocation.isStale) return Colors.textMuted;
    switch (currentLocation.accuracyLevel) {
      case "excellent":
      case "good":
        return "#05DF72";
      case "moderate":
        return "#FACC15";
      case "poor":
      case "unusable":
        return "#FB923C";
      default:
        return Colors.error;
    }
  }, [currentLocation]);

  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top, 8) }]}>
      {/* 1. TOP HEADER BAR */}
      <View style={styles.topHeader}>
        <Pressable
          onPress={handleCustomNavigateBack}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Back to Home Screen"
          accessibilityHint="Returns to main four-corner home screen"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </Pressable>

        <Text style={styles.headerTitle} accessibilityRole="header">
          Campus Map & GPS
        </Text>

        <View style={styles.headerRightActions}>
          {onOpenLiveAssist && (
            <Pressable
              onPress={onOpenLiveAssist}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Look Ahead with Live Camera Assist"
              accessibilityHint="Opens camera assist to describe doors, signs, and landmarks in front of you"
              style={styles.headerAssistButton}
            >
              <Ionicons name="camera" size={20} color="#38BDF8" />
            </Pressable>
          )}

          <Pressable
            onPress={handleRecenter}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Recenter map camera on your current GPS location"
            accessibilityHint="Re-aligns map to your position"
            style={styles.recenterButton}
          >
            <Ionicons name="locate" size={22} color="#38BDF8" />
          </Pressable>
        </View>
      </View>

      {/* 2. LIVE GPS DIAGNOSTICS BAR */}
      <View style={styles.gpsStatusBar} accessible={true} accessibilityRole="summary">
        <View style={styles.gpsStatusIndicator}>
          <View style={[styles.gpsDot, { backgroundColor: accuracyBadgeColor }]} />
          <Text style={styles.gpsStatusText}>
            {currentLocation && !currentLocation.isStale
              ? `GPS: ${currentLocation.accuracyLevel.toUpperCase()} (±${Math.round(currentLocation.accuracyMeters)}m)`
              : "GPS: Acquiring fix..."}
          </Text>
        </View>

        {/* Mode Toggle between Outdoor GPS & Indoor Confirmation */}
        <Pressable
          onPress={() => {
            const newMode = navigationMode === "outdoor_gps" ? "indoor_landmark" : "outdoor_gps";
            setNavigationMode(newMode);
            speechService.speak(
              newMode === "indoor_landmark"
                ? "Switched to Indoor Landmark Mode. Indoor positioning relies on door-sign OCR and verified room plaques."
                : "Switched to Outdoor GPS Navigation.",
              { force: true }
            );
          }}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Current mode is ${navigationMode === "outdoor_gps" ? "Outdoor GPS" : "Indoor Landmark"}. Double-tap to switch.`}
          style={styles.modeTogglePill}
        >
          <Ionicons
            name={navigationMode === "outdoor_gps" ? "navigate-circle" : "business-outline"}
            size={14}
            color="#C084FC"
          />
          <Text style={styles.modeToggleText}>
            {navigationMode === "outdoor_gps" ? "Outdoor GPS" : "Indoor Landmark"}
          </Text>
        </Pressable>
      </View>

      {/* 2b. MAP-SCOPED VOICE STATUS BAR (Fix 2) */}
      {isMapVoiceActive && (
        <View style={styles.mapVoiceBar} accessible={true} accessibilityRole="summary">
          <View style={styles.mapVoiceInfo}>
            <View
              style={[
                styles.mapVoiceDot,
                { backgroundColor: isMapListening ? "#05DF72" : "#FB923C" },
              ]}
            />
            <Text style={styles.mapVoiceText}>
              {isMapListening ? "Map Voice: Listening..." : "Map Voice: Paused"}
            </Text>
          </View>
          <Pressable
            onPress={handleToggleMapVoice}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={isMapListening ? "Pause map voice" : "Resume map voice"}
            accessibilityHint="Toggles microphone listening in map mode"
            style={styles.mapVoicePillButton}
          >
            <Text style={styles.mapVoicePillButtonText}>
              {isMapListening ? "Pause" : "Resume"}
            </Text>
          </Pressable>
        </View>
      )}

      {/* 3. PERMISSION / GPS DISABLED WARNING */}
      {(isLocationDenied || isGpsDisabled) && (
        <View style={styles.warningBanner} accessible={true} accessibilityRole="alert">
          <Ionicons name="warning-outline" size={20} color={Colors.warning} />
          <Text style={styles.warningBannerText}>
            {locationErrorMessage || "GPS Location is required for real outdoor turn-by-turn guidance."}
          </Text>
        </View>
      )}

      {/* 4. PRIMARY CONTENT AREA: INTERACTIVE FULL MAP */}
      <View style={styles.mapContainer}>
        <CampusMapView
          currentLocation={currentLocation}
          selectedDestination={selectedPoi}
          destinations={activeDestinations}
          nearbyPlaces={nearbyPlaces}
          routeCoordinates={activeOutdoorRoute?.coordinates || []}
          onSelectPoi={(poi) => handleSelectPoi(poi, false)}
          onSelectNearbyPlace={(place) => handleSelectNearbyPlace(place, false)}
          isRecenterRequested={isRecenterRequested}
          onRecenterComplete={() => setIsRecenterRequested(false)}
        />
      </View>

      {/* 5. GUIDANCE & ACTION AREA (BOTTOM SHEET) */}
      <View style={styles.bottomSheetArea}>
        {/* ACTIVE NAVIGATION INSTRUCTION CARD */}
        {activeOutdoorRoute && navProgress.isActive && (
          <View style={styles.activeNavCard} accessible={true}>
            <View style={styles.navHeaderRow}>
              <View style={styles.navActivePill}>
                <Text style={styles.navActivePillText}>NAVIGATING</Text>
              </View>
              <Text style={styles.navRemainingDistText}>
                ~{navProgress.remainingTotalDistanceMeters >= 1000
                  ? (navProgress.remainingTotalDistanceMeters / 1000).toFixed(1) + "km"
                  : navProgress.remainingTotalDistanceMeters + "m"}{" "}
                remaining
              </Text>
            </View>

            <Text style={styles.navNextInstructionText}>
              {navProgress.currentManeuver?.instruction || "Proceed along route."}
            </Text>

            {/* Accuracy Uncertainty Notice if needed */}
            {navProgress.isAccuracyUncertain && (
              <View style={styles.navCautionRow}>
                <Ionicons name="alert-circle-outline" size={16} color={Colors.warning} />
                <Text style={styles.navCautionText}>
                  GPS uncertainty ±{Math.round(navProgress.gpsAccuracyMeters)}m. Confirm visual landmarks.
                </Text>
              </View>
            )}

            {/* Navigation Controls: Repeat, Silence, Look Ahead, End */}
            <View style={styles.navControlsRow}>
              <Pressable
                onPress={handleRepeatInstruction}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Repeat current spoken instruction"
                style={styles.navActionButtonSecondary}
              >
                <Ionicons name="volume-high" size={20} color="#FFFFFF" />
                <Text style={styles.navActionButtonText}>Repeat</Text>
              </Pressable>

              {onOpenLiveAssist && (
                <Pressable
                  onPress={onOpenLiveAssist}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Look Ahead with Live Camera Assist"
                  accessibilityHint="Inspect doors, signs, and path with camera"
                  style={styles.navActionButtonSecondary}
                >
                  <Ionicons name="camera" size={20} color="#38BDF8" />
                  <Text style={styles.navActionButtonText}>Look</Text>
                </Pressable>
              )}

              <Pressable
                onPress={handleStopSpeaking}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Stop current speech"
                style={styles.navActionButtonSecondary}
              >
                <Ionicons name="volume-mute" size={20} color="#FFFFFF" />
                <Text style={styles.navActionButtonText}>Silence</Text>
              </Pressable>

              <Pressable
                onPress={handleEndNavigation}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="End navigation session"
                style={styles.navActionButtonEnd}
              >
                <Ionicons name="close-circle" size={20} color="#FFFFFF" />
                <Text style={styles.navActionButtonText}>End</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ARRIVED STATE CARD */}
        {activeOutdoorRoute && navProgress.isArrived && (
          <View style={styles.arrivedCard} accessible={true}>
            <Ionicons name="checkmark-circle" size={42} color={Colors.success} />
            <Text style={styles.arrivedTitle}>Destination Reached</Text>
            <Text style={styles.arrivedSubtitle}>
              You have arrived at {selectedPoi?.name}.
            </Text>
            <Pressable
              onPress={handleEndNavigation}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Finish navigation session"
              style={styles.finishNavButton}
            >
              <Text style={styles.finishNavButtonText}>Finish Navigation</Text>
            </Pressable>
          </View>
        )}

        {/* ROUTE SETUP SECTION (When not actively navigating) */}
        {(!activeOutdoorRoute || (!navProgress.isActive && !navProgress.isArrived)) && (
          <ScrollView
            style={styles.setupScrollView}
            contentContainerStyle={styles.setupScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Multi-Match Disambiguation Selection Card (Fix 1) */}
            {pendingDisambiguation && pendingDisambiguation.candidates.length > 1 && (
              <View style={styles.disambiguationCard} accessible={true}>
                <View style={styles.disambiguationHeaderRow}>
                  <Ionicons name="help-circle" size={22} color="#C084FC" />
                  <Text style={styles.disambiguationTitle} accessibilityRole="header">
                    Which destination do you mean?
                  </Text>
                </View>
                <Text style={styles.disambiguationSubtitle}>
                  Found {pendingDisambiguation.candidates.length} options matching &quot;{pendingDisambiguation.query}&quot;. Say or tap 1, 2, or 3:
                </Text>

                <View style={styles.disambiguationList}>
                  {pendingDisambiguation.candidates.map((cand, idx) => (
                    <Pressable
                      key={cand.id}
                      onPress={() => handleSelectSearchResult(cand, true)}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel={`Option ${idx + 1}: ${cand.name}. Tap to navigate here.`}
                      accessibilityHint="Selects this destination and begins walking route"
                      style={({ pressed }) => [
                        styles.disambiguationOptionRow,
                        pressed && styles.disambiguationOptionRowPressed,
                      ]}
                    >
                      <View style={styles.disambiguationBadge}>
                        <Text style={styles.disambiguationBadgeText}>{idx + 1}</Text>
                      </View>
                      <View style={styles.disambiguationInfo}>
                        <Text style={styles.disambiguationName} numberOfLines={1}>
                          {cand.name}
                        </Text>
                        <Text style={styles.disambiguationDetail} numberOfLines={1}>
                          {cand.distanceMeters !== undefined
                            ? `${Math.round(cand.distanceMeters)}m away • `
                            : ""}
                          {cand.category || "destination"}
                        </Text>
                      </View>
                      <Ionicons name="arrow-forward-circle" size={24} color="#38BDF8" />
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  onPress={() => {
                    setPendingDisambiguation(null);
                    speechService.speak("Cancelled selection.", { force: true });
                  }}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel selection"
                  accessibilityHint="Closes disambiguation options"
                  style={styles.disambiguationCancelButton}
                >
                  <Text style={styles.disambiguationCancelText}>Cancel</Text>
                </Pressable>
              </View>
            )}

            {/* Search Input Bar with Voice Microphone Button */}
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={20} color="#94A3B8" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search destination, building, hospital..."
                placeholderTextColor="#64748B"
                value={searchQuery}
                onChangeText={setSearchQuery}
                accessible={true}
                accessibilityLabel="Destination search field"
                accessibilityHint="Type or use speech to search university points of interest or city destinations"
              />
              {searchQuery ? (
                <Pressable
                  onPress={() => setSearchQuery("")}
                  accessible={true}
                  accessibilityLabel="Clear search text"
                  style={styles.clearSearchButton}
                >
                  <Ionicons name="close-circle" size={18} color="#94A3B8" />
                </Pressable>
              ) : null}

              <Pressable
                onPress={handleToggleMapVoice}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={
                  isMapVoiceActive
                    ? isMapListening
                      ? "Map voice active and listening. Tap to pause."
                      : "Map voice active and paused. Tap to listen."
                    : "Speak destination"
                }
                accessibilityHint="Toggles map-scoped voice mode"
                style={[styles.micButton, isMapVoiceActive && styles.micButtonActive]}
              >
                <Ionicons
                  name={isMapVoiceActive && isMapListening ? "mic" : "mic-outline"}
                  size={20}
                  color={isMapVoiceActive && isMapListening ? "#05DF72" : "#38BDF8"}
                />
              </Pressable>
            </View>

            {/* Quick Nearby Category Filter Chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.nearbyChipsRow}
            >
              {[
                { label: "Hospitals", cat: "hospital", icon: "medical" },
                { label: "Food & Cafe", cat: "food", icon: "restaurant" },
                { label: "ATMs & Banks", cat: "atm", icon: "cash" },
                { label: "Transit & Buses", cat: "transit", icon: "bus" },
                { label: "Colleges", cat: "college", icon: "school" },
                { label: "Petrol / Fuel", cat: "fuel", icon: "speedometer" },
              ].map((chip) => {
                const isActive = activeNearbyCategory === chip.cat;
                return (
                  <Pressable
                    key={chip.cat}
                    onPress={() => handleSearchNearbyCategory(chip.cat as NearbyCategory)}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`Find nearby ${chip.label}`}
                    style={[styles.nearbyChip, isActive && styles.nearbyChipActive]}
                  >
                    <Ionicons
                      name={chip.icon as any}
                      size={15}
                      color={isActive ? "#FFFFFF" : "#38BDF8"}
                    />
                    <Text style={[styles.nearbyChipText, isActive && styles.nearbyChipTextActive]}>
                      {chip.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Selected Destination Card */}
            {selectedPoi && (
              <View style={styles.selectedPoiCard}>
                <Ionicons name="location" size={24} color="#05DF72" />
                <View style={styles.selectedPoiInfo}>
                  <Text style={styles.selectedPoiTitle}>{selectedPoi.name}</Text>
                  <Text style={styles.selectedPoiDesc}>
                    {selectedPoi.category.toUpperCase()} • {selectedPoi.description}
                  </Text>
                </View>
              </View>
            )}

            {/* Avoid Stairs Toggle Switch */}
            <View style={styles.stairsToggleRow}>
              <View style={styles.stairsTextWrap}>
                <Text style={styles.stairsTitle}>Avoid Stairs (Accessible Routing)</Text>
                <Text style={styles.stairsSubtitle}>Requires step-free paved ramps and pathways</Text>
              </View>
              <Switch
                value={avoidStairs}
                onValueChange={setAvoidStairs}
                trackColor={{ false: "#334155", true: "#005CE6" }}
                thumbColor="#FFFFFF"
                accessible={true}
                accessibilityLabel="Avoid stairs toggle switch"
              />
            </View>

            {/* Route Calculation Error */}
            {routeError && (
              <View style={styles.errorCard} accessible={true} accessibilityRole="alert">
                <Ionicons name="alert-circle" size={20} color={Colors.error} />
                <Text style={styles.errorCardText}>{routeError}</Text>
              </View>
            )}

            {/* One Clear Start Navigation Button */}
            <Pressable
              onPress={handleStartNavigation}
              disabled={isCalculatingRoute || !selectedPoi}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={
                selectedPoi
                  ? `Start navigation to ${selectedPoi.name}`
                  : "Start navigation. Please select a destination first."
              }
              style={[styles.startNavButton, !selectedPoi && styles.startNavButtonDisabled]}
            >
              {isCalculatingRoute ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="navigate" size={22} color="#FFFFFF" />
                  <Text style={styles.startNavButtonText}>
                    {selectedPoi ? `Start Navigation to ${selectedPoi.name}` : "Select a Destination"}
                  </Text>
                </>
              )}
            </Pressable>

            {/* Search Results Candidates Section (If search query is active) */}
            {searchQuery.trim().length >= 2 && (
              <>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.poiSectionTitle}>
                    Destination Matches ({searchResults.length})
                  </Text>
                  {isSearchingDestinations && <ActivityIndicator size="small" color="#38BDF8" />}
                </View>

                {searchResults.map((item) => {
                  const isSelected = selectedPoi?.id === item.id;
                  const distStr = item.distanceMeters
                    ? item.distanceMeters >= 1000
                      ? ` • ${(item.distanceMeters / 1000).toFixed(1)}km away`
                      : ` • ${Math.round(item.distanceMeters)}m away`
                    : "";

                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => handleSelectSearchResult(item, false)}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${item.name}${distStr}`}
                      style={[styles.poiItemCard, isSelected && styles.poiItemCardSelected]}
                    >
                      <View style={styles.poiIconWrap}>
                        <Ionicons
                          name={item.isCampusPoi ? "business" : "location"}
                          size={20}
                          color={isSelected ? "#05DF72" : "#38BDF8"}
                        />
                      </View>
                      <View style={styles.poiItemTextWrap}>
                        <Text style={[styles.poiItemTitle, isSelected && styles.poiItemTitleSelected]}>
                          {item.name}
                        </Text>
                        <Text style={styles.poiItemSubtitle}>
                          {item.displayName}
                          {distStr}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}

            {/* Nearby Places Section (If a category chip was pressed) */}
            {activeNearbyCategory && nearbyPlaces.length > 0 && (
              <>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.poiSectionTitle}>
                    Nearby {activeNearbyCategory.toUpperCase()} ({nearbyPlaces.length})
                  </Text>
                  {isLoadingNearby && <ActivityIndicator size="small" color="#38BDF8" />}
                </View>

                {nearbyPlaces.map((place) => {
                  const isSelected = selectedPoi?.id === place.id;
                  const distStr =
                    place.distanceMeters >= 1000
                      ? `${(place.distanceMeters / 1000).toFixed(1)} km`
                      : `${Math.round(place.distanceMeters)} m`;

                  return (
                    <Pressable
                      key={place.id}
                      onPress={() => handleSelectNearbyPlace(place, false)}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${place.name}, ${distStr} away`}
                      style={[styles.poiItemCard, isSelected && styles.poiItemCardSelected]}
                    >
                      <View style={styles.poiIconWrap}>
                        <Ionicons name="medical" size={20} color={isSelected ? "#05DF72" : "#DC2626"} />
                      </View>
                      <View style={styles.poiItemTextWrap}>
                        <Text style={[styles.poiItemTitle, isSelected && styles.poiItemTitleSelected]}>
                          {place.name}
                        </Text>
                        <Text style={styles.poiItemSubtitle}>
                          {distStr} away • {place.address || place.category}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}

            {/* Verified Campus Survey POIs Default List */}
            {searchQuery.trim().length < 2 && !activeNearbyCategory && (
              <>
                <Text style={styles.poiSectionTitle}>
                  Verified Campus Landmarks ({localCampusPois.length})
                </Text>

                {localCampusPois.slice(0, 10).map((poi) => {
                  const isSelected = selectedPoi?.id === poi.id;
                  return (
                    <Pressable
                      key={poi.id}
                      onPress={() => handleSelectPoi(poi, false)}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${poi.name}, ${poi.category}`}
                      style={[styles.poiItemCard, isSelected && styles.poiItemCardSelected]}
                    >
                      <View style={styles.poiIconWrap}>
                        <Ionicons
                          name={
                            poi.category === "entrance"
                              ? "log-in"
                              : poi.category === "hostel"
                                ? "home"
                                : poi.category === "dining"
                                  ? "restaurant"
                                  : "business"
                          }
                          size={20}
                          color={isSelected ? "#05DF72" : "#94A3B8"}
                        />
                      </View>
                      <View style={styles.poiItemTextWrap}>
                        <Text style={[styles.poiItemTitle, isSelected && styles.poiItemTitleSelected]}>
                          {poi.name}
                        </Text>
                        <Text style={styles.poiItemSubtitle}>
                          {poi.category.toUpperCase()} • {poi.description}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#030712",
  },
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 56,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 56,
    minHeight: 56,
    gap: 6,
  },
  backButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  headerRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerAssistButton: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    borderWidth: 1,
    borderColor: "#38BDF8",
  },
  recenterButton: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  gpsStatusBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
  },
  gpsStatusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  gpsStatusText: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "700",
  },
  modeTogglePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: "rgba(117, 37, 230, 0.2)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(192, 132, 252, 0.3)",
    gap: 5,
  },
  modeToggleText: {
    color: "#C084FC",
    fontSize: 11,
    fontWeight: "700",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  warningBannerText: {
    color: "#FCA5A5",
    fontSize: 12,
    flex: 1,
    fontWeight: "600",
  },
  mapContainer: {
    flex: 1,
    minHeight: 220,
  },
  bottomSheetArea: {
    flex: 1,
    backgroundColor: "#0B1120",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  activeNavCard: {
    padding: 16,
    gap: 10,
  },
  navHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navActivePill: {
    backgroundColor: "rgba(5, 223, 114, 0.2)",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#05DF72",
  },
  navActivePillText: {
    color: "#05DF72",
    fontSize: 12,
    fontWeight: "800",
  },
  navRemainingDistText: {
    color: "#38BDF8",
    fontSize: 14,
    fontWeight: "800",
  },
  navNextInstructionText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
    marginVertical: 4,
  },
  navCautionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    padding: 8,
    borderRadius: 8,
  },
  navCautionText: {
    color: "#FCD34D",
    fontSize: 12,
    flex: 1,
  },
  navControlsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  navActionButtonSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    borderRadius: 14,
    backgroundColor: "rgba(30, 41, 59, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    gap: 8,
  },
  navActionButtonEnd: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    borderRadius: 14,
    backgroundColor: "#DC2626",
    gap: 8,
  },
  navActionButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  arrivedCard: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
  },
  arrivedTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
  },
  arrivedSubtitle: {
    color: "#94A3B8",
    fontSize: 15,
    textAlign: "center",
  },
  finishNavButton: {
    width: "100%",
    height: 56,
    backgroundColor: "#005CE6",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  finishNavButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  setupScrollView: {
    flex: 1,
  },
  setupScrollContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 130,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  clearSearchButton: {
    padding: 6,
  },
  micButton: {
    padding: 6,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
  },
  nearbyChipsRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 4,
  },
  nearbyChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: "rgba(30, 41, 59, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    gap: 6,
    minHeight: 38,
  },
  nearbyChipActive: {
    backgroundColor: "#005CE6",
    borderColor: "#38BDF8",
  },
  nearbyChipText: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "600",
  },
  nearbyChipTextActive: {
    color: "#FFFFFF",
  },
  selectedPoiCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(5, 223, 114, 0.12)",
    borderWidth: 1,
    borderColor: "#05DF72",
    gap: 12,
  },
  selectedPoiInfo: {
    flex: 1,
  },
  selectedPoiTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  selectedPoiDesc: {
    color: "#A7F3D0",
    fontSize: 12,
    marginTop: 2,
  },
  stairsToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  stairsTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  stairsTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  stairsSubtitle: {
    color: "#94A3B8",
    fontSize: 12,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  errorCardText: {
    color: "#FCA5A5",
    fontSize: 13,
    flex: 1,
  },
  startNavButton: {
    flexDirection: "row",
    height: 56,
    backgroundColor: "#005CE6",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    elevation: 4,
  },
  startNavButtonDisabled: {
    backgroundColor: "#1E293B",
  },
  startNavButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  poiSectionTitle: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  poiItemCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    gap: 12,
    minHeight: 56,
  },
  poiItemCardSelected: {
    borderColor: "#05DF72",
    backgroundColor: "rgba(5, 223, 114, 0.08)",
  },
  poiIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  poiItemTextWrap: {
    flex: 1,
  },
  poiItemTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  poiItemTitleSelected: {
    color: "#05DF72",
  },
  poiItemSubtitle: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 2,
  },
  mapVoiceBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(117, 37, 230, 0.15)",
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(192, 132, 252, 0.25)",
  },
  mapVoiceInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mapVoiceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  mapVoiceText: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "700",
  },
  mapVoicePillButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "rgba(30, 41, 59, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  mapVoicePillButtonText: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "700",
  },
  micButtonActive: {
    backgroundColor: "rgba(5, 223, 114, 0.2)",
    borderWidth: 1,
    borderColor: "#05DF72",
  },
  disambiguationCard: {
    backgroundColor: "#1E1B4B",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: "#A855F7",
    gap: 10,
    marginVertical: 4,
  },
  disambiguationHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  disambiguationTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  disambiguationSubtitle: {
    color: "#E2E8F0",
    fontSize: 13,
    lineHeight: 18,
  },
  disambiguationList: {
    gap: 8,
    marginTop: 4,
  },
  disambiguationOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    backgroundColor: "rgba(30, 41, 59, 0.95)",
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(192, 132, 252, 0.4)",
    gap: 12,
  },
  disambiguationOptionRowPressed: {
    backgroundColor: "rgba(117, 37, 230, 0.3)",
    borderColor: "#05DF72",
  },
  disambiguationBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#7525E6",
    alignItems: "center",
    justifyContent: "center",
  },
  disambiguationBadgeText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  disambiguationInfo: {
    flex: 1,
  },
  disambiguationName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  disambiguationDetail: {
    color: "#A7F3D0",
    fontSize: 12,
    marginTop: 2,
  },
  disambiguationCancelButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    marginTop: 4,
  },
  disambiguationCancelText: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "700",
  },
});
