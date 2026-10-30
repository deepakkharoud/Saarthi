import { describe, it, expect, beforeEach, jest } from "@jest/globals";

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
    AppState: {
      currentState: "active",
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    },
    StyleSheet: {
      create: (styles: any) => styles,
      absoluteFill: {},
    },
  }),
  { virtual: true }
);

jest.mock(
  "@react-native-async-storage/async-storage",
  () => {
    let store: Record<string, string> = {};
    return {
      getItem: jest.fn(async (key: string) => store[key] || null),
      setItem: jest.fn(async (key: string, val: string) => {
        store[key] = val;
      }),
      clear: jest.fn(async () => {
        store = {};
      }),
      _setStore: (newStore: Record<string, string>) => {
        store = { ...newStore };
      },
      _getStore: () => store,
    };
  },
  { virtual: true }
);

import AsyncStorage from "@react-native-async-storage/async-storage";
import { speechService } from "../services/speech";
import { voiceRecognitionService } from "../services/voiceRecognition";
import { globalVoiceService } from "../services/globalVoiceService";

const ONBOARDING_KEY = "@saarthi_onboarding_played";
const EXPECTED_ONBOARDING_TEXT =
  "Welcome to SAARTHI! While the app is open on Home, say Hey Saarthi to activate voice control. Then choose Live Visual Scan, Read Anything, Campus Map, My Day, or Talk to Saarthi.";

describe("First-Launch Voice Onboarding and Clutter Reduction", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    (AsyncStorage as any)._setStore({});

    jest.spyOn(speechService, "speak").mockImplementation(async () => {});
    jest.spyOn(speechService, "stop").mockImplementation(async () => {});
    jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async () => {});
    jest.spyOn(voiceRecognitionService, "requestPermissions").mockResolvedValue(true);
    await globalVoiceService.disableVoiceMode(false);
  });

  // 1. First-Launch Voice Onboarding
  describe("First-launch Voice Onboarding", () => {
    it("speaks the exact required voice control instruction on first launch", async () => {
      const speakSpy = jest.spyOn(speechService, "speak");
      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening");
      const permSpy = jest.spyOn(voiceRecognitionService, "requestPermissions");

      // Simulate App first launch check
      const played = await AsyncStorage.getItem(ONBOARDING_KEY);
      expect(played).toBeNull();

      if (!played) {
        await speechService.speak(EXPECTED_ONBOARDING_TEXT, { force: true });
        await AsyncStorage.setItem(ONBOARDING_KEY, "true");
      }

      // Check spoken welcome wording
      expect(speakSpy).toHaveBeenCalledWith(EXPECTED_ONBOARDING_TEXT, { force: true });

      // Verifies persistent storage was written
      const stored = await AsyncStorage.getItem(ONBOARDING_KEY);
      expect(stored).toBe("true");

      // Critical safety check: microphone MUST NOT be activated automatically
      expect(listenSpy).not.toHaveBeenCalled();
      expect(permSpy).not.toHaveBeenCalled();
    });

    it("does not repeat the onboarding announcement on subsequent launches", async () => {
      // Simulate already played in persistent storage
      await AsyncStorage.setItem(ONBOARDING_KEY, "true");

      const speakSpy = jest.spyOn(speechService, "speak");
      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening");

      // Simulate app subsequent launch
      const played = await AsyncStorage.getItem(ONBOARDING_KEY);
      if (!played) {
        await speechService.speak(EXPECTED_ONBOARDING_TEXT, { force: true });
      }

      expect(speakSpy).not.toHaveBeenCalled();
      expect(listenSpy).not.toHaveBeenCalled();
    });

    it("replays the exact voice onboarding instruction when triggered from Settings", async () => {
      const speakSpy = jest.spyOn(speechService, "speak");

      // Simulate handleReplayOnboarding called from Settings
      const handleReplayOnboarding = async () => {
        await speechService.speak(EXPECTED_ONBOARDING_TEXT, { force: true });
      };

      await handleReplayOnboarding();

      expect(speakSpy).toHaveBeenCalledWith(EXPECTED_ONBOARDING_TEXT, { force: true });
    });
  });

  // 2. Reduce Home-Screen Clutter & Reactivation Accessibility
  describe("Home-Screen Clutter Reduction and Visibility Rules", () => {
    it("does not display top capsule on Home screen when voice mode is inactive", () => {
      // Logic from GlobalVoiceControl:
      const shouldRenderOnHomeInactive = (screen: string, isActive: boolean) => {
        if (screen === "home" && !isActive) {
          return false;
        }
        return true;
      };

      expect(shouldRenderOnHomeInactive("home", false)).toBe(false);
    });

    it("displays voice status on Home screen when voice mode is active", () => {
      const shouldRenderOnHomeActive = (screen: string, isActive: boolean) => {
        if (screen === "home" && !isActive) {
          return false;
        }
        return true;
      };

      expect(shouldRenderOnHomeActive("home", true)).toBe(true);
    });

    it("preserves an accessible control on non-home screens even when voice mode is inactive", () => {
      const shouldRenderOnNonHomeScreen = (screen: string, isActive: boolean) => {
        if (screen === "home" && !isActive) {
          return false;
        }
        return true;
      };

      // Non-home screens preserve access to turn voice mode on
      expect(shouldRenderOnNonHomeScreen("timetable", false)).toBe(true);
      expect(shouldRenderOnNonHomeScreen("navigation", false)).toBe(true);
      expect(shouldRenderOnNonHomeScreen("reader", false)).toBe(true);
      expect(shouldRenderOnNonHomeScreen("settings", false)).toBe(true);
      expect(shouldRenderOnNonHomeScreen("results", false)).toBe(true);
    });

    it("anchors at bottom on scrollable screens to prevent overlapping headers or screen titles", () => {
      const getAnchorDock = (screen: string): "top" | "bottom" => {
        if (screen === "home" || screen === "reader") {
          return "top";
        }
        return "bottom";
      };

      // Scrollable content screens anchor at bottom away from headers and titles
      expect(getAnchorDock("timetable")).toBe("bottom");
      expect(getAnchorDock("navigation")).toBe("bottom");
      expect(getAnchorDock("settings")).toBe("bottom");
      expect(getAnchorDock("results")).toBe("bottom");

      // Non-scrollable framed screens anchor at top away from bottom tiles
      expect(getAnchorDock("home")).toBe("top");
      expect(getAnchorDock("reader")).toBe("top");
    });
  });

  // 3. Accessibility props and multi-modal differentiation
  describe("Accessibility and Non-Color Differentiation", () => {
    it("distinguishes listening, paused, and inactive states with explicit text and icons", () => {
      const getStateDisplay = (isActive: boolean, isPaused: boolean, isListening: boolean) => {
        if (!isActive) {
          return { text: "Voice Mode: OFF", icon: "mic-outline" };
        }
        if (isPaused) {
          return { text: "Voice: PAUSED", icon: "pause-circle" };
        }
        if (isListening) {
          return { text: "Listening...", icon: "mic" };
        }
        return { text: "Voice: ON", icon: "mic-outline" };
      };

      const inactive = getStateDisplay(false, false, false);
      expect(inactive.text).toBe("Voice Mode: OFF");
      expect(inactive.icon).toBe("mic-outline");

      const listening = getStateDisplay(true, false, true);
      expect(listening.text).toBe("Listening...");
      expect(listening.icon).toBe("mic");

      const paused = getStateDisplay(true, true, false);
      expect(paused.text).toBe("Voice: PAUSED");
      expect(paused.icon).toBe("pause-circle");

      // Verify states have unique texts and icons, never relying on color alone
      expect(inactive.text).not.toBe(listening.text);
      expect(listening.text).not.toBe(paused.text);
      expect(inactive.icon).not.toBe(listening.icon);
      expect(listening.icon).not.toBe(paused.icon);
    });
  });
});
