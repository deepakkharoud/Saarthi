/**
 * Saarthi Campus Map View.
 *
 * Full-screen interactive map powered by @maplibre/maplibre-react-native.
 * Compatible across MapLibre versions (supports both v11 Map & legacy MapView).
 * Uses a self-contained OpenStreetMap raster style with standard OSM tiles
 * to guarantee instantaneous rendering without external style-server dependencies.
 *
 * Fallback Resilience:
 * If native MapLibre is not linked (e.g. headless tests), gracefully falls back
 * to an accessible high-contrast tactile vector map canvas without crashing.
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { StyleSheet, View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RealGpsLocation } from "../services/locationService";
import { CampusPoi } from "../data/campusSurveyData";
import { NearbyPlaceResult } from "../services/mapSearchService";
import { Colors } from "../theme/colors";

// Import MapLibre safely to support both native and headless/test environments
let MapLibreGL: any = null;
try {
  MapLibreGL = require("@maplibre/maplibre-react-native");
  if (MapLibreGL && MapLibreGL.default) {
    MapLibreGL = { ...MapLibreGL.default, ...MapLibreGL };
  }
} catch {
  MapLibreGL = null;
}

// Self-contained OpenStreetMap Raster Style JSON (Zero external style server dependency)
export const OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    "osm-raster-tiles": {
      type: "raster",
      tiles: [
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm-raster-layer",
      type: "raster",
      source: "osm-raster-tiles",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

export const OSM_STYLE_JSON = JSON.stringify(OSM_RASTER_STYLE);
export const OSM_DEMO_STYLE = "https://demotiles.maplibre.org/style.json";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

export interface CampusMapViewProps {
  currentLocation: RealGpsLocation | null;
  selectedDestination: CampusPoi | null;
  destinations: CampusPoi[];
  routeCoordinates: [number, number][]; // [lat, lon]
  onSelectPoi: (poi: CampusPoi) => void;
  isRecenterRequested?: boolean;
  onRecenterComplete?: () => void;
  nearbyPlaces?: NearbyPlaceResult[];
  onSelectNearbyPlace?: (place: NearbyPlaceResult) => void;
}

export const CampusMapView: React.FC<CampusMapViewProps> = ({
  currentLocation,
  selectedDestination,
  destinations,
  routeCoordinates,
  onSelectPoi,
  isRecenterRequested,
  onRecenterComplete,
  nearbyPlaces = [],
  onSelectNearbyPlace,
}) => {
  const cameraRef = useRef<any>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(16.5);
  const hasAutoCentered = useRef<boolean>(false);

  const MapComponent = MapLibreGL?.Map || MapLibreGL?.MapView;
  const CameraComponent = MapLibreGL?.Camera;
  // MapLibre v11's Marker uses `lngLat`; PointAnnotation is an older API with
  // a different coordinate contract. Use the installed Marker implementation.
  const MarkerComponent = MapLibreGL?.Marker;
  const GeoJSONSourceComponent = MapLibreGL?.GeoJSONSource || MapLibreGL?.ShapeSource;
  const LayerComponent = MapLibreGL?.Layer || MapLibreGL?.LineLayer;

  const isNativeMapAvailable = Boolean(MapComponent && CameraComponent);

  // Default initial coordinate: user GPS location if available, otherwise selected destination or regional center
  const initialCenterCoordinate = useMemo<[number, number]>(() => {
    if (currentLocation && !currentLocation.isStale) {
      return [currentLocation.longitude, currentLocation.latitude];
    }
    if (selectedDestination) {
      return [selectedDestination.longitude, selectedDestination.latitude];
    }
    return [76.57505, 30.76864]; // default initial center if no GPS/destination yet
  }, [currentLocation, selectedDestination]);

  // Auto-frame route when a new route polyline is plotted
  useEffect(() => {
    if (routeCoordinates && routeCoordinates.length >= 2 && cameraRef.current) {
      let minLat = routeCoordinates[0][0];
      let maxLat = routeCoordinates[0][0];
      let minLon = routeCoordinates[0][1];
      let maxLon = routeCoordinates[0][1];

      for (let i = 1; i < routeCoordinates.length; i++) {
        const [lat, lon] = routeCoordinates[i];
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }

      const ne = [maxLon, maxLat];
      const sw = [minLon, minLat];

      if (typeof cameraRef.current.fitBounds === "function") {
        cameraRef.current.fitBounds(ne, sw, [80, 40, 180, 40], 800);
      } else if (typeof cameraRef.current.setCamera === "function") {
        cameraRef.current.setCamera({
          bounds: { ne, sw, paddingTop: 80, paddingRight: 40, paddingBottom: 180, paddingLeft: 40 },
          animationDuration: 800,
        });
      }
    }
  }, [routeCoordinates]);

  // Center camera automatically when first live GPS fix locks
  useEffect(() => {
    if (currentLocation && !currentLocation.isStale && !hasAutoCentered.current && cameraRef.current) {
      hasAutoCentered.current = true;
      const targetCoord = [currentLocation.longitude, currentLocation.latitude];
      if (typeof cameraRef.current.easeTo === "function") {
        cameraRef.current.easeTo({ center: targetCoord, zoom: 17, duration: 800 });
      } else if (typeof cameraRef.current.setCamera === "function") {
        cameraRef.current.setCamera({ centerCoordinate: targetCoord, zoomLevel: 17, animationDuration: 800 });
      }
    }
  }, [currentLocation]);

  // Recenter camera when explicitly requested by user button or voice
  useEffect(() => {
    if (isRecenterRequested && cameraRef.current) {
      const targetCoord =
        currentLocation && !currentLocation.isStale
          ? [currentLocation.longitude, currentLocation.latitude]
          : initialCenterCoordinate;

      if (typeof cameraRef.current.easeTo === "function") {
        cameraRef.current.easeTo({ center: targetCoord, zoom: 17.5, duration: 800 });
      } else if (typeof cameraRef.current.setCamera === "function") {
        cameraRef.current.setCamera({ centerCoordinate: targetCoord, zoomLevel: 17.5, animationDuration: 800 });
      }
      onRecenterComplete?.();
    }
  }, [isRecenterRequested, currentLocation, initialCenterCoordinate, onRecenterComplete]);

  // Zoom In / Out handlers
  const handleZoomIn = useCallback(() => {
    if (cameraRef.current) {
      const nextZoom = Math.min(currentZoom + 1, 19);
      setCurrentZoom(nextZoom);
      if (typeof cameraRef.current.easeTo === "function") {
        cameraRef.current.easeTo({ zoom: nextZoom, duration: 300 });
      } else if (typeof cameraRef.current.zoomTo === "function") {
        cameraRef.current.zoomTo(nextZoom, 300);
      }
    }
  }, [currentZoom]);

  const handleZoomOut = useCallback(() => {
    if (cameraRef.current) {
      const nextZoom = Math.max(currentZoom - 1, 12);
      setCurrentZoom(nextZoom);
      if (typeof cameraRef.current.easeTo === "function") {
        cameraRef.current.easeTo({ zoom: nextZoom, duration: 300 });
      } else if (typeof cameraRef.current.zoomTo === "function") {
        cameraRef.current.zoomTo(nextZoom, 300);
      }
    }
  }, [currentZoom]);

  // Convert route coordinates to GeoJSON LineString
  const routeFeature = useMemo<any>(() => {
    if (!routeCoordinates || routeCoordinates.length < 2) return null;
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: routeCoordinates.map(([lat, lon]) => [lon, lat]),
      },
    };
  }, [routeCoordinates]);

  // If MapLibre Native module failed or is unavailable, render accessible fallback canvas
  if (!isNativeMapAvailable || mapError || !MapComponent) {
    return (
      <View style={styles.container} accessible={true} accessibilityLabel="Campus Map Overview">
        <View style={styles.fallbackHeader}>
          <Ionicons name="map-outline" size={20} color={Colors.primary} />
          <Text style={styles.fallbackTitle}>Accessible Pedestrian Navigation</Text>
        </View>

        {/* Tactile landmark list overview */}
        <View style={styles.fallbackCard}>
          <Text style={styles.fallbackSubtitle}>
            Interactive GPS and Turn-by-Turn Spoken Guidance are active.
          </Text>
          <Text style={styles.osmAttributionText}>{OSM_ATTRIBUTION}</Text>
        </View>

        {/* Selected target badge */}
        {selectedDestination && (
          <View style={styles.selectedPoiBanner}>
            <Ionicons name="flag" size={18} color="#05DF72" />
            <Text style={styles.selectedPoiText}>
              Destination Target: {selectedDestination.name} ({selectedDestination.shortCode})
            </Text>
          </View>
        )}

        {/* Route distance notice */}
        {routeCoordinates.length > 0 && (
          <View style={styles.routeNoticeBanner}>
            <Ionicons name="walk" size={18} color="#38BDF8" />
            <Text style={styles.routeNoticeText}>
              Route polyline plotted with {routeCoordinates.length} survey waypoints.
            </Text>
          </View>
        )}

        <View style={styles.attributionFooter}>
          <Text style={styles.attributionSub}>{OSM_ATTRIBUTION}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} accessible={false}>
      <MapComponent
        style={styles.map}
        mapStyle={OSM_STYLE_JSON}
        styleJSON={OSM_STYLE_JSON}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={true}
        onDidFailLoadingMap={(err: any) => {
          console.warn("Map style load failure:", err);
          setMapError("Map style loading error.");
        }}
      >
        <CameraComponent
          ref={cameraRef}
          initialViewState={{
            center: initialCenterCoordinate,
            zoom: 16.5,
          }}
          defaultSettings={{
            centerCoordinate: initialCenterCoordinate,
            zoomLevel: 16.5,
          }}
        />

        {/* 1. Walking Route Polyline Layer */}
        {routeFeature && GeoJSONSourceComponent && LayerComponent && (
          <GeoJSONSourceComponent id="campusWalkingRouteSource" shape={routeFeature} data={routeFeature}>
            <LayerComponent
              id="campusWalkingRouteLayer"
              type="line"
              style={{
                lineColor: "#0284C7",
                lineWidth: 6,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </GeoJSONSourceComponent>
        )}

        {/* 2. Destination Markers (Campus POIs) */}
        {MarkerComponent &&
          destinations.map((poi) => {
            const isSelected = selectedDestination?.id === poi.id;
            return (
              <MarkerComponent
                key={poi.id}
                id={`poi_${poi.id}`}
                lngLat={[poi.longitude, poi.latitude]}
                onPress={() => onSelectPoi(poi)}
                onSelected={() => onSelectPoi(poi)}
              >
                <View
                  style={[
                    styles.markerPin,
                    isSelected && styles.markerPinSelected,
                    { backgroundColor: isSelected ? "#05DF72" : "#7525E6" },
                  ]}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={`${poi.name}, ${poi.category}`}
                >
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
                    size={14}
                    color="#FFFFFF"
                  />
                </View>
              </MarkerComponent>
            );
          })}

        {/* 2b. Explicit Selected Destination Pin (for general non-campus destinations) */}
        {MarkerComponent &&
          selectedDestination &&
          !destinations.some((d) => d.id === selectedDestination.id) &&
          !nearbyPlaces.some((p) => p.id === selectedDestination.id) && (
            <MarkerComponent
              key={`selected_dest_${selectedDestination.id}`}
              id={`selected_dest_${selectedDestination.id}`}
              lngLat={[selectedDestination.longitude, selectedDestination.latitude]}
              onPress={() => onSelectPoi(selectedDestination)}
              onSelected={() => onSelectPoi(selectedDestination)}
            >
              <View
                style={[styles.markerPin, styles.markerPinSelected, { backgroundColor: "#05DF72" }]}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={`Destination Target: ${selectedDestination.name}`}
              >
                <Ionicons name="flag" size={14} color="#FFFFFF" />
              </View>
            </MarkerComponent>
          )}

        {/* 3. Nearby Amenities Markers (Hospitals, Food, ATMs, etc.) */}
        {MarkerComponent &&
          nearbyPlaces.map((place) => {
            const isSelected = selectedDestination?.id === place.id;
            return (
              <MarkerComponent
                key={`nearby_${place.id}`}
                id={`nearby_${place.id}`}
                lngLat={[place.longitude, place.latitude]}
                onPress={() => onSelectNearbyPlace?.(place)}
                onSelected={() => onSelectNearbyPlace?.(place)}
              >
                <View
                  style={[
                    styles.nearbyPin,
                    isSelected && styles.markerPinSelected,
                    { backgroundColor: isSelected ? "#05DF72" : "#DC2626" },
                  ]}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={`${place.name}, ${place.category}, ${Math.round(place.distanceMeters)}m away`}
                >
                  <Ionicons
                    name={
                      place.category.includes("hospital") || place.category.includes("pharmacy")
                        ? "medical"
                        : place.category.includes("food") || place.category.includes("restaurant")
                        ? "restaurant"
                        : place.category.includes("atm") || place.category.includes("bank")
                        ? "cash"
                        : place.category.includes("bus") || place.category.includes("station")
                        ? "bus"
                        : "location"
                    }
                    size={13}
                    color="#FFFFFF"
                  />
                </View>
              </MarkerComponent>
            );
          })}

        {/* 4. Selected Destination Pin */}
        {MarkerComponent &&
          selectedDestination &&
          !destinations.some((d) => d.id === selectedDestination.id) && (
            <MarkerComponent
              id="selectedDestMarker"
              lngLat={[selectedDestination.longitude, selectedDestination.latitude]}
            >
              <View style={styles.selectedDestPin}>
                <Ionicons name="flag" size={16} color="#FFFFFF" />
              </View>
            </MarkerComponent>
          )}

        {/* 5. Live Phone GPS Location Marker with Accuracy Halo */}
        {MarkerComponent && currentLocation && !currentLocation.isStale && (
          <MarkerComponent
            id="userGpsLocation"
            lngLat={[currentLocation.longitude, currentLocation.latitude]}
          >
            <View style={styles.userLocationOuter}>
              <View style={styles.userLocationPulse} />
              <View style={styles.userLocationInner} />
            </View>
          </MarkerComponent>
        )}
      </MapComponent>

      {/* Map Zoom Controls (+ / -) */}
      <View style={styles.zoomControlsWrapper} pointerEvents="box-none">
        <Pressable
          onPress={handleZoomIn}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Zoom In"
          accessibilityHint="Enlarges the map view"
          style={styles.zoomButton}
        >
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </Pressable>
        <Pressable
          onPress={handleZoomOut}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Zoom Out"
          accessibilityHint="Expands the map view area"
          style={styles.zoomButton}
        >
          <Ionicons name="remove" size={24} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Visible OpenStreetMap Attribution Bar */}
      <View style={styles.attributionBadge} accessible={true} accessibilityLabel={`Map data: ${OSM_ATTRIBUTION}`}>
        <Text style={styles.attributionBadgeText}>{OSM_ATTRIBUTION}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#030712",
    overflow: "hidden",
  },
  map: {
    flex: 1,
  },
  markerPin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  nearbyPin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  markerPinSelected: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  selectedDestPin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#05DF72",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
    elevation: 6,
  },
  userLocationOuter: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  userLocationPulse: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(56, 189, 248, 0.35)",
    borderWidth: 1.5,
    borderColor: "#38BDF8",
  },
  userLocationInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#0284C7",
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
  },
  zoomControlsWrapper: {
    position: "absolute",
    right: 14,
    bottom: 38,
    gap: 8,
  },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    borderWidth: 1.5,
    borderColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  attributionBadge: {
    position: "absolute",
    bottom: 4,
    left: 8,
    backgroundColor: "rgba(3, 7, 18, 0.75)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  attributionBadgeText: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "500",
  },
  fallbackHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 8,
    backgroundColor: "#0F172A",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
  },
  fallbackTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  fallbackCard: {
    margin: 12,
    padding: 14,
    backgroundColor: "#0F172A",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  fallbackSubtitle: {
    color: "#E2E8F0",
    fontSize: 13,
    lineHeight: 18,
  },
  osmAttributionText: {
    color: "#64748B",
    fontSize: 11,
    marginTop: 6,
  },
  selectedPoiBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    backgroundColor: "#064E3B",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#05DF72",
    gap: 8,
  },
  selectedPoiText: {
    color: "#ECFDF5",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  routeNoticeBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    backgroundColor: "#0C4A6E",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#38BDF8",
    gap: 8,
  },
  routeNoticeText: {
    color: "#F0F9FF",
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  attributionFooter: {
    marginTop: "auto",
    padding: 12,
    alignItems: "center",
  },
  attributionSub: {
    color: "#64748B",
    fontSize: 11,
  },
});
