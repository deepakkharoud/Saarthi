/**
 * Saarthi Camera Assist Screen — Live Camera Assist with Gemma 4 Vision.
 *
 * Implements:
 * 1. An explicit Live Assist mode with real camera preview.
 * 2. Controlled capture of actual images using installed expo-camera.
 * 3. Actual images sent to existing Gemma 4 backend via LiveAssistService.
 * 4. Concise spoken descriptions of new, relevant observations.
 * 5. Strict single request-in-flight concurrency gate.
 * 6. Immediate Stop, proper cancellation, duplicate-announcement suppression, and lifecycle cleanup.
 * 7. Honest handling of network failure, unreadable images, and unavailable permissions.
 *
 * Accessibility:
 * - Minimum 56dp touch targets.
 * - WCAG AAA high contrast with clear status badges.
 * - Spoken feedback on all state changes.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  AccessibilityInfo,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions, PermissionResponse } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "../theme/colors";
import { speechService } from "../services/speech";
import { hapticsService } from "../services/haptics";
import { liveAssistService, LiveAssistState } from "../services/liveAssistService";
import { resolveCameraPermissionState } from "../utils/cameraPermissions";

export interface CameraAssistScreenProps {
  onNavigateBack: () => void;
  permissionResponse?: PermissionResponse | null;
  onRequestPermission?: () => Promise<PermissionResponse>;
  initialAutoStart?: boolean;
}

export const CameraAssistScreen: React.FC<CameraAssistScreenProps> = ({
  onNavigateBack,
  permissionResponse: propPermission,
  onRequestPermission: propRequestPermission,
  initialAutoStart = true,
}) => {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);

  const [hookPermission, hookRequestPermission] = useCameraPermissions();
  const permission = propPermission !== undefined ? propPermission : hookPermission;
  const requestPermission = propRequestPermission || hookRequestPermission;

  const [isCameraReady, setIsCameraReady] = useState<boolean>(false);
  const [assistState, setAssistState] = useState<LiveAssistState>(
    liveAssistService.getState()
  );

  // Subscribe to live assist service state
  useEffect(() => {
    const unsubscribe = liveAssistService.subscribe((state) => {
      setAssistState(state);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Frame capture implementation using real installed camera
  const captureFrame = useCallback(async () => {
    if (!cameraRef.current) {
      console.warn("[CameraAssistScreen] Camera ref not available for capture.");
      return null;
    }

    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.65,
        skipProcessing: false,
      });

      if (!photo || !photo.base64) {
        return null;
      }

      return {
        base64: photo.base64,
        mimeType: "image/jpeg",
      };
    } catch (err) {
      console.warn("[CameraAssistScreen] takePictureAsync failed:", err);
      return null;
    }
  }, []);

  // Register frame capture with service
  useEffect(() => {
    liveAssistService.registerFrameCapture(captureFrame);
    return () => {
      liveAssistService.registerFrameCapture(null);
    };
  }, [captureFrame]);

  // Initial welcome and auto-start
  const hasStartedRef = useRef<boolean>(false);
  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    (async () => {
      const permState = resolveCameraPermissionState(permission);
      if (permState === "granted" && initialAutoStart) {
        await liveAssistService.startLiveAssist();
      } else if (permState !== "granted") {
        await speechService.speak(
          "Camera permission is required for Live Camera Assist. Tap the center button to request permission.",
          { force: true }
        );
      }
    })();

    return () => {
      // Safe lifecycle cleanup on unmount
      liveAssistService.cleanup();
    };
  }, [permission, initialAutoStart]);

  // Permission handling
  const handleRequestPermission = async () => {
    await hapticsService.triggerButtonPress();
    try {
      const resp = await requestPermission();
      if (resp && resp.granted) {
        await speechService.speak("Camera permission granted. Starting Live Assist.", { force: true });
        await liveAssistService.startLiveAssist();
      } else {
        await speechService.speak(
          "Camera permission denied. Please enable camera access in phone Settings to use Live Assist.",
          { force: true }
        );
      }
    } catch {
      await speechService.speak("Failed to request camera permission. Please check Settings.", {
        force: true,
      });
    }
  };

  // User Actions
  const handleToggleSampling = async () => {
    await hapticsService.triggerButtonPress();
    if (assistState.isSamplingActive) {
      await liveAssistService.pauseLiveAssist();
    } else {
      await liveAssistService.startLiveAssist();
    }
  };

  const handleDescribeNow = async () => {
    await hapticsService.triggerCapture();
    await liveAssistService.describeNow("Describe what is visibly in front of me on this university campus.");
  };

  const handleImmediateStop = async () => {
    await hapticsService.triggerButtonPress();
    await liveAssistService.stop();
  };

  const handleBack = async () => {
    await hapticsService.triggerBottomLeft();
    await liveAssistService.stop();
    onNavigateBack();
  };

  const permState = resolveCameraPermissionState(permission);

  // If permission is confirmed denied
  if (permState === "denied") {
    return (
      <View style={[styles.permissionContainer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Ionicons name="camera-reverse-outline" size={64} color="#EF4444" style={styles.permissionIcon} />
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionBody}>
          Live Camera Assist needs permission to stream camera images to Gemma 4 for scene understanding and obstacle awareness.
        </Text>
        <Pressable
          onPress={handleRequestPermission}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Grant Camera Permission"
          accessibilityHint="Double-tap to request camera access"
          style={styles.permissionButton}
        >
          <Text style={styles.permissionButtonText}>Grant Camera Access</Text>
        </Pressable>
        <Pressable
          onPress={handleBack}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Return to Previous Screen"
          style={styles.permissionBackButton}
        >
          <Text style={styles.permissionBackButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 1. Real Camera Preview Layer */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="picture"
        onCameraReady={() => setIsCameraReady(true)}
      />

      {/* 2. Accessible Visual Frame & Crosshair Reticle for Low-Vision Targeting */}
      <View style={styles.viewfinderContainer} pointerEvents="none">
        <View style={styles.reticleCornerTopLeft} />
        <View style={styles.reticleCornerTopRight} />
        <View style={styles.reticleCornerBottomLeft} />
        <View style={styles.reticleCornerBottomRight} />
        <View style={styles.centerCrosshairHorizontal} />
        <View style={styles.centerCrosshairVertical} />
      </View>

      {/* 3. Translucent Accessible HUD Overlay */}
      <View
        style={[
          styles.hudOverlay,
          {
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        {/* Top Header Bar */}
        <View style={styles.topHeaderBar}>
          <Pressable
            onPress={handleBack}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Back. Double-tap to exit Live Assist."
            style={styles.headerIconButton}
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
          </Pressable>

          <View style={styles.titleBadgeContainer}>
            <View
              style={[
                styles.statusIndicatorDot,
                assistState.isAnalyzing
                  ? styles.statusDotAnalyzing
                  : assistState.isSamplingActive
                  ? styles.statusDotActive
                  : styles.statusDotPaused,
              ]}
            />
            <Text style={styles.headerTitleText}>LIVE ASSIST</Text>
            <Text style={styles.headerSubtitleText}>Gemma 4 Vision</Text>
          </View>

          <Pressable
            onPress={handleImmediateStop}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Stop. Double-tap to immediately cut off speech and cancel analysis."
            accessibilityHint="Stops speech output and cancels in-flight vision request"
            style={styles.stopHeaderButton}
            hitSlop={8}
          >
            <Ionicons name="stop-circle" size={26} color="#EF4444" />
          </Pressable>
        </View>

        {/* In-Flight Analysis Spinner Pill */}
        {assistState.isAnalyzing && (
          <View
            style={styles.analyzingBanner}
            accessible={true}
            accessibilityRole="progressbar"
            accessibilityLabel="Gemma 4 is analyzing the camera view"
          >
            <ActivityIndicator size="small" color="#38BDF8" style={{ marginRight: 8 }} />
            <Text style={styles.analyzingText}>Analyzing view with Gemma 4...</Text>
          </View>
        )}

        {/* Error Notice Pill */}
        {assistState.error && !assistState.isAnalyzing && (
          <View
            style={styles.errorBanner}
            accessible={true}
            accessibilityRole="alert"
            accessibilityLabel={`Notice: ${assistState.error}`}
          >
            <Ionicons name="alert-circle" size={18} color="#EF4444" style={{ marginRight: 6 }} />
            <Text style={styles.errorBannerText} numberOfLines={2}>
              {assistState.error}
            </Text>
          </View>
        )}

        {/* Center Spacer to preserve clear camera view */}
        <View style={styles.middleSightArea} />

        {/* Latest Spoken Description Card */}
        <View
          style={styles.descriptionCard}
          accessible={true}
          accessibilityRole="text"
          accessibilityLabel={`Observation: ${
            assistState.latestDescription ||
            "Point camera steady at doors, signs, or obstacles ahead."
          }`}
        >
          <View style={styles.descriptionHeaderRow}>
            <Ionicons name="eye" size={18} color="#38BDF8" />
            <Text style={styles.descriptionLabel}>LATEST OBSERVATION</Text>
            {assistState.suppressedCount > 0 && (
              <Text style={styles.suppressedBadge}>
                {assistState.suppressedCount} duplicate{assistState.suppressedCount > 1 ? "s" : ""} suppressed
              </Text>
            )}
          </View>
          <Text style={styles.descriptionText} numberOfLines={4}>
            {assistState.latestDescription ||
              "Point your camera steady forward. Live Assist will describe signs, doors, and landmarks as you move."}
          </Text>
          <Text style={styles.safetyDisclaimerText}>
            Note: Drop-offs and low ground obstacles below camera frame are not checked.
          </Text>
        </View>

        {/* Bottom Primary Controls (>= 56dp Touch Targets) */}
        <View style={styles.bottomControlsRow}>
          {/* Pause / Resume Sampling Button */}
          <Pressable
            onPress={handleToggleSampling}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={
              assistState.isSamplingActive
                ? "Pause Live Assist continuous streaming"
                : "Resume Live Assist continuous streaming"
            }
            accessibilityHint="Toggles automatic periodic scene description"
            style={[
              styles.controlButton,
              styles.secondaryControlButton,
              assistState.isSamplingActive && styles.activeSamplingButton,
            ]}
          >
            <Ionicons
              name={assistState.isSamplingActive ? "pause" : "play"}
              size={26}
              color="#FFFFFF"
            />
            <Text style={styles.controlButtonLabel}>
              {assistState.isSamplingActive ? "Pause" : "Live Stream"}
            </Text>
          </Pressable>

          {/* Primary Action: Describe Now Button */}
          <Pressable
            onPress={handleDescribeNow}
            disabled={assistState.isAnalyzing}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Describe Now. Double-tap to immediately inspect what is ahead."
            accessibilityHint="Captures photo and reads scene description immediately"
            style={({ pressed }) => [
              styles.controlButton,
              styles.primaryDescribeButton,
              pressed && styles.buttonPressed,
              assistState.isAnalyzing && styles.buttonDisabled,
            ]}
          >
            <Ionicons name="sparkles" size={32} color="#FFFFFF" />
            <Text style={styles.primaryButtonLabel}>Describe Now</Text>
          </Pressable>

          {/* Immediate Stop Button */}
          <Pressable
            onPress={handleImmediateStop}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Stop Speaking"
            accessibilityHint="Stops speech audio immediately"
            style={[styles.controlButton, styles.stopControlButton]}
          >
            <Ionicons name="stop" size={26} color="#FFFFFF" />
            <Text style={styles.controlButtonLabel}>Stop</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  hudOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  topHeaderBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(3, 7, 18, 0.85)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#1E293B",
  },
  headerIconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#111827",
    justifyContent: "center",
    alignItems: "center",
  },
  titleBadgeContainer: {
    alignItems: "center",
  },
  statusIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 2,
  },
  statusDotActive: {
    backgroundColor: "#22C55E",
  },
  statusDotAnalyzing: {
    backgroundColor: "#38BDF8",
  },
  statusDotPaused: {
    backgroundColor: "#F59E0B",
  },
  headerTitleText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 1.2,
  },
  headerSubtitleText: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "600",
  },
  stopHeaderButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1.5,
    borderColor: "#EF4444",
    justifyContent: "center",
    alignItems: "center",
  },
  analyzingBanner: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(15, 23, 42, 0.92)",
    borderColor: "#38BDF8",
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 8,
  },
  analyzingText: {
    color: "#38BDF8",
    fontSize: 13,
    fontWeight: "700",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(127, 29, 29, 0.9)",
    borderColor: "#EF4444",
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    marginTop: 8,
    maxWidth: "90%",
  },
  errorBannerText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  middleSightArea: {
    flex: 1,
  },
  viewfinderContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
  },
  reticleCornerTopLeft: {
    position: "absolute",
    top: "22%",
    left: "14%",
    width: 32,
    height: 32,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: "#38BDF8",
  },
  reticleCornerTopRight: {
    position: "absolute",
    top: "22%",
    right: "14%",
    width: 32,
    height: 32,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: "#38BDF8",
  },
  reticleCornerBottomLeft: {
    position: "absolute",
    bottom: "32%",
    left: "14%",
    width: 32,
    height: 32,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: "#38BDF8",
  },
  reticleCornerBottomRight: {
    position: "absolute",
    bottom: "32%",
    right: "14%",
    width: 32,
    height: 32,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: "#38BDF8",
  },
  centerCrosshairHorizontal: {
    position: "absolute",
    width: 24,
    height: 2,
    backgroundColor: "rgba(56, 189, 248, 0.4)",
  },
  centerCrosshairVertical: {
    position: "absolute",
    height: 24,
    width: 2,
    backgroundColor: "rgba(56, 189, 248, 0.4)",
  },
  descriptionCard: {
    backgroundColor: "rgba(3, 7, 18, 0.92)",
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#1E293B",
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  descriptionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  descriptionLabel: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    marginLeft: 6,
    flex: 1,
  },
  suppressedBadge: {
    color: "#94A3B8",
    fontSize: 10,
    fontStyle: "italic",
  },
  descriptionText: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
  safetyDisclaimerText: {
    color: "#64748B",
    fontSize: 11,
    marginTop: 8,
    fontStyle: "italic",
  },
  bottomControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  controlButton: {
    minHeight: 58,
    minWidth: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  secondaryControlButton: {
    flex: 1,
    backgroundColor: "#1F2937",
    borderWidth: 1.5,
    borderColor: "#374151",
  },
  activeSamplingButton: {
    backgroundColor: "#065F46",
    borderColor: "#10B981",
  },
  primaryDescribeButton: {
    flex: 1.5,
    backgroundColor: "#005CE6",
    borderWidth: 2,
    borderColor: "#38BDF8",
    minHeight: 68,
    shadowColor: "#0066FF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  stopControlButton: {
    flex: 1,
    backgroundColor: "#7F1D1D",
    borderWidth: 1.5,
    borderColor: "#EF4444",
  },
  controlButtonLabel: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  primaryButtonLabel: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: "#030712",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  permissionIcon: {
    marginBottom: 20,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#FFFFFF",
    marginBottom: 12,
    textAlign: "center",
  },
  permissionBody: {
    fontSize: 15,
    color: "#94A3B8",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  permissionButton: {
    width: "100%",
    backgroundColor: "#005CE6",
    minHeight: 56,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  permissionButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  permissionBackButton: {
    width: "100%",
    backgroundColor: "#1F2937",
    minHeight: 56,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  permissionBackButtonText: {
    color: "#94A3B8",
    fontSize: 15,
    fontWeight: "700",
  },
});
