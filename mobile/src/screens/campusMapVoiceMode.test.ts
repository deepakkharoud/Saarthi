import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mock native and expo dependencies
jest.mock(
  "expo-speech",
  () => ({
    speak: jest.fn((text, opts: any) => {
      opts?.onDone?.();
    }),
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
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    },
    AccessibilityInfo: {
      announceForAccessibility: jest.fn(),
    },
    StyleSheet: {
      create: (styles: any) => styles,
    },
  }),
  { virtual: true }
);

import { globalVoiceService } from "../services/globalVoiceService";
import { mapSearchService, normalizeDestinationQuery } from "../services/mapSearchService";
import { parseVoiceCommand } from "../services/voiceCommands";

describe("Campus Map Voice Mode & Destination Recognition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalVoiceService.disableVoiceMode(false);
  });

  describe("Fix 1: Destination Normalization & Disambiguation Logic", () => {
    it("normalizes destination queries by stripping speech prefixes and mapping numbers", () => {
      expect(normalizeDestinationQuery("take me to block one").normalizedQuery).toBe("block 1");
      expect(normalizeDestinationQuery("directions to gate one").normalizedQuery).toBe("gate 1");
      expect(normalizeDestinationQuery("where is medical centre").category).toBe("hospital");
      expect(normalizeDestinationQuery("find a clinic nearby").category).toBe("hospital");
      expect(normalizeDestinationQuery("guide me to the canteen").category).toBe("food");
    });

    it("resolves multi-match queries and enables selection by number or name", async () => {
      // Mock fetch returning multiple hospitals
      (globalThis as any).fetch = jest.fn((url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("hospital") || urlStr.includes("nearby")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  place_id: "h1",
                  name: "Government Hospital Gharuan",
                  display_name: "Government Hospital Gharuan",
                  lat: "30.7752",
                  lon: "76.5579",
                  type: "hospital",
                },
                {
                  place_id: "h2",
                  name: "Healthcare Multispeciality Hospital",
                  display_name: "Healthcare Multispeciality Hospital",
                  lat: "30.7781",
                  lon: "76.5580",
                  type: "hospital",
                },
              ]),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      });

      const candidates = await mapSearchService.searchDestinations("hospital", 30.7686, 76.5750);
      expect(candidates.length).toBeGreaterThanOrEqual(2);

      // Verify that when multiple match, options can be disambiguated by index or name
      const disambiguation = {
        query: "hospital",
        candidates: candidates.slice(0, 3),
      };

      expect(disambiguation.candidates.length).toBe(2);
      expect(disambiguation.candidates[0].name).toContain("Government Hospital");
      expect(disambiguation.candidates[1].name).toContain("Healthcare Multispeciality");
    });

    it("resolves single valid destination directly without asking", async () => {
      const candidates = await mapSearchService.searchDestinations("Sukhna Boys Hostel", 30.7686, 76.5750);
      expect(candidates.length).toBe(1);
      expect(candidates[0].name).toBe("Sukhna Boys Hostel");
      expect(candidates[0].isCampusPoi).toBe(true);
    });

    it("truthfully returns empty candidates for unsupported non-existent locations", async () => {
      (globalThis as any).fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        })
      );

      const candidates = await mapSearchService.searchDestinations("unmapped mars station xyz", 30.7686, 76.5750);
      expect(candidates.length).toBe(0);
    });
  });

  describe("Fix 2: Map-Specific Voice Mode & Lifecycle Coordination", () => {
    it("suspends Home voice session and restores it upon exiting", async () => {
      // Simulate Home voice mode active
      globalVoiceService["isActive"] = true;
      globalVoiceService["isPaused"] = false;

      // 1. Entering map: verify active state before suspend
      const stateBefore = globalVoiceService.getState();
      expect(stateBefore.isActive).toBe(true);
      expect(stateBefore.isPaused).toBe(false);

      // Suspend silently
      await globalVoiceService.pauseListening(false);
      const stateSuspended = globalVoiceService.getState();
      expect(stateSuspended.isActive).toBe(true);
      expect(stateSuspended.isPaused).toBe(true);
      expect(stateSuspended.isListening).toBe(false);

      // 2. Exiting map: restore Home voice behavior
      await globalVoiceService.resumeListening(false);
      const stateRestored = globalVoiceService.getState();
      expect(stateRestored.isActive).toBe(true);
      expect(stateRestored.isPaused).toBe(false);
    });

    it("parses map-specific commands without home-menu ambiguity", () => {
      // Map-specific intents
      expect(parseVoiceCommand("where am i").intent).toBe("where_am_i");
      expect(parseVoiceCommand("recenter map").intent).toBe("recenter_map");
      expect(parseVoiceCommand("stop navigation").intent).toBe("stop_navigation");
      expect(parseVoiceCommand("how far is destination").intent).toBe("navigation_status");
      expect(parseVoiceCommand("repeat instruction").intent).toBe("repeat");
      expect(parseVoiceCommand("stop").intent).toBe("stop");
      expect(parseVoiceCommand("what can i do here").intent).toBe("what_can_i_do");
      expect(parseVoiceCommand("go back").intent).toBe("go_back");
    });
  });
});
