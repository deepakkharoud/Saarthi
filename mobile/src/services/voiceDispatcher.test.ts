import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// Mock native ESM modules so ts-jest (node environment) runs cleanly without requiring native Android/iOS ESM
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

import { dispatchVoiceCommand } from "./voiceDispatcher";
import { speechService } from "./speech";

describe("voiceDispatcher — Dynamic Screen-Aware & Navigation Command Execution", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(speechService, "speak").mockImplementation(async () => {});
    jest.spyOn(speechService, "stop").mockImplementation(async () => {});
    jest.spyOn(speechService, "repeatLast").mockImplementation(async () => true);
  });

  // 1. Phase 1 Screen Awareness tests
  describe("Phase 1 Screen Awareness", () => {
    it("dynamically returns screen description for 'Where am I?' based on active currentScreen", async () => {
      const speakSpy = jest.spyOn(speechService, "speak");

      const readerRes = await dispatchVoiceCommand("Where am I?", {
        currentScreen: "reader",
      });
      expect(readerRes).toContain("Campus Reader");
      expect(speakSpy).toHaveBeenCalledWith(expect.stringContaining("Campus Reader"), {
        force: true,
      });

      const navRes = await dispatchVoiceCommand("Where am I?", {
        currentScreen: "navigation",
      });
      expect(navRes).toContain("Campus Navigation");
      expect(readerRes).not.toEqual(navRes);

      const homeRes = await dispatchVoiceCommand("Where am I?", {
        currentScreen: "home",
      });
      expect(homeRes).toContain("Home");
      expect(homeRes).not.toEqual(readerRes);
    });

    it("dynamically returns screen actions for 'What can I do here?' and 'Help' based on active currentScreen", async () => {
      const readerActions = await dispatchVoiceCommand("What can I do here?", {
        currentScreen: "reader",
      });
      expect(readerActions.toLowerCase()).toContain("scan");

      const timetableActions = await dispatchVoiceCommand("Help", {
        currentScreen: "timetable",
      });
      expect(timetableActions.toLowerCase()).toContain("class");

      const settingsActions = await dispatchVoiceCommand("What can I do?", {
        currentScreen: "settings",
      });
      expect(settingsActions.toLowerCase()).toContain("server");

      expect(readerActions).not.toEqual(timetableActions);
      expect(readerActions).not.toEqual(settingsActions);
    });

    it("calls speechService.stop() when receiving 'Stop' command", async () => {
      const stopSpy = jest.spyOn(speechService, "stop");
      const result = await dispatchVoiceCommand("Stop speaking", {
        currentScreen: "reader",
      });
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe("Stopped speaking.");
    });

    it("calls speechService.repeatLast() when receiving 'Repeat that' command", async () => {
      const repeatSpy = jest.spyOn(speechService, "repeatLast");
      const result = await dispatchVoiceCommand("Repeat that", {
        currentScreen: "home",
      });
      expect(repeatSpy).toHaveBeenCalledTimes(1);
      expect(result).toBe("Replaying last message.");
    });
  });

  // 2. Phase 2 Global Voice Navigation tests
  describe("Phase 2 Global Voice Navigation", () => {
    it("navigates to Campus Reader on 'Open Reader' and 'Open Campus Reader' and confirms by speech", async () => {
      const onNavScreen = jest.fn();
      const speakSpy = jest.spyOn(speechService, "speak");

      const res = await dispatchVoiceCommand("Open Campus Reader", {
        currentScreen: "home",
        onNavigateToScreen: onNavScreen,
      });

      expect(res).toBe("Opening Campus Reader.");
      expect(onNavScreen).toHaveBeenCalledWith("reader");
      expect(speakSpy).toHaveBeenCalledWith("Opening Campus Reader.", { force: true });

      // Regression: "open reader"
      const res2 = await dispatchVoiceCommand("open reader", {
        currentScreen: "home",
        onNavigateToScreen: onNavScreen,
      });
      expect(res2).toBe("Opening Campus Reader.");
      expect(onNavScreen).toHaveBeenCalledWith("reader");
    });

    it("navigates to My Timetable on 'open time table', 'open timetable', and all equivalent timetable phrases", async () => {
      const phrases = [
        "open time table",
        "open timetable",
        "open my timetable",
        "show timetable",
        "show my timetable",
        "open class timetable",
        "My Schedule",
      ];

      for (const phrase of phrases) {
        const onNavScreen = jest.fn();
        const speakSpy = jest.spyOn(speechService, "speak");

        const res = await dispatchVoiceCommand(phrase, {
          currentScreen: "home",
          onNavigateToScreen: onNavScreen,
        });

        expect(res).toBe("Opening My Timetable.");
        expect(onNavScreen).toHaveBeenCalledWith("timetable");
        expect(speakSpy).toHaveBeenCalledWith("Opening My Timetable.", { force: true });
      }
    });

    it("navigates to Campus Navigation on 'open navigation' or 'Find a Room'", async () => {
      const onNavScreen = jest.fn();

      const res1 = await dispatchVoiceCommand("open navigation", {
        currentScreen: "home",
        onNavigateToScreen: onNavScreen,
      });
      expect(res1).toBe("Opening Campus Navigation.");
      expect(onNavScreen).toHaveBeenCalledWith("navigation");

      const res2 = await dispatchVoiceCommand("Find a Room", {
        currentScreen: "home",
        onNavigateToScreen: onNavScreen,
      });
      expect(res2).toBe("Opening Campus Navigation.");
      expect(onNavScreen).toHaveBeenCalledWith("navigation");
    });

    it("navigates to Home on 'go home' or 'Return Home'", async () => {
      const onNavScreen = jest.fn();

      const res1 = await dispatchVoiceCommand("go home", {
        currentScreen: "reader",
        onNavigateToScreen: onNavScreen,
      });
      expect(res1).toBe("Opening Home.");
      expect(onNavScreen).toHaveBeenCalledWith("home");

      const res2 = await dispatchVoiceCommand("Return Home", {
        currentScreen: "reader",
        onNavigateToScreen: onNavScreen,
      });
      expect(res2).toBe("Opening Home.");
      expect(onNavScreen).toHaveBeenCalledWith("home");
    });

    it("navigates to Settings on 'Open Settings'", async () => {
      const onNavScreen = jest.fn();

      const res = await dispatchVoiceCommand("Open Settings", {
        currentScreen: "home",
        onNavigateToScreen: onNavScreen,
      });
      expect(res).toBe("Opening Settings.");
      expect(onNavScreen).toHaveBeenCalledWith("settings");
    });

    it("navigates to Voice Assistant on 'Open Voice Assistant'", async () => {
      const onNavScreen = jest.fn();

      const res = await dispatchVoiceCommand("Open Voice Assistant", {
        currentScreen: "home",
        onNavigateToScreen: onNavScreen,
      });
      expect(res).toBe("Opening Voice Assistant.");
      expect(onNavScreen).toHaveBeenCalledWith("voice");
    });

    it("handles 'Open Results' with scan results available", async () => {
      const onNavScreen = jest.fn();

      const res = await dispatchVoiceCommand("Open Results", {
        currentScreen: "home",
        hasReadingResult: true,
        onNavigateToScreen: onNavScreen,
      });
      expect(res).toBe("Opening Reading Results.");
      expect(onNavScreen).toHaveBeenCalledWith("results");
    });

    it("blocks 'Open Results' and speaks guidance when no scan results exist", async () => {
      const onNavScreen = jest.fn();

      const res = await dispatchVoiceCommand("Open Results", {
        currentScreen: "home",
        hasReadingResult: false,
        onNavigateToScreen: onNavScreen,
      });
      expect(res).toContain("No reading results available yet");
      expect(onNavScreen).not.toHaveBeenCalled();
    });

    it("informs user when already on the requested screen without navigating", async () => {
      const onNavScreen = jest.fn();

      const res = await dispatchVoiceCommand("Go Home", {
        currentScreen: "home",
        onNavigateToScreen: onNavScreen,
      });
      expect(res).toBe("You are already on the Home screen.");
      expect(onNavScreen).not.toHaveBeenCalled();
    });
  });

  // 3. Back Navigation tests
  describe("Back Navigation (Go Back)", () => {
    it("navigates back to previous screen when history exists", async () => {
      const onNavBack = jest.fn(() => "home" as const);
      const speakSpy = jest.spyOn(speechService, "speak");

      const res = await dispatchVoiceCommand("Go Back", {
        currentScreen: "reader",
        screenHistory: ["home"],
        onNavigateBack: onNavBack,
      });

      expect(onNavBack).toHaveBeenCalled();
      expect(res).toBe("Returning to Home.");
      expect(speakSpy).toHaveBeenCalledWith("Returning to Home.", { force: true });
    });

    it("navigates back through deeper history stack correctly", async () => {
      const onNavBack = jest.fn(() => "reader" as const);

      const res = await dispatchVoiceCommand("Previous Screen", {
        currentScreen: "voice",
        screenHistory: ["home", "reader"],
        onNavigateBack: onNavBack,
      });

      expect(onNavBack).toHaveBeenCalled();
      expect(res).toBe("Returning to Campus Reader.");
    });

    it("safely explains when history is empty and user is already on Home", async () => {
      const onNavBack = jest.fn(() => null);
      const speakSpy = jest.spyOn(speechService, "speak");

      const res = await dispatchVoiceCommand("Go Back", {
        currentScreen: "home",
        screenHistory: [],
        onNavigateBack: onNavBack,
      });

      expect(res).toBe("You are already on the Home screen. There is nowhere to go back.");
      expect(speakSpy).toHaveBeenCalledWith(
        "You are already on the Home screen. There is nowhere to go back.",
        { force: true }
      );
    });

    it("safely explains when onNavigateBack returns false", async () => {
      const onNavBack = jest.fn(() => false);

      const res = await dispatchVoiceCommand("Back", {
        currentScreen: "home",
        onNavigateBack: onNavBack,
      });

      expect(res).toBe("You are already on the Home screen. There is nowhere to go back.");
    });
  });

  // 4. Unknown Commands Cause No Navigation
  describe("Unknown Commands", () => {
    it("causes no navigation on unknown commands and provides guidance", async () => {
      const onNavScreen = jest.fn<(screen: any) => void>();
      const onNavBack = jest.fn<() => void>();
      const speakSpy = jest.spyOn(speechService, "speak");

      const result = await dispatchVoiceCommand("Play heavy metal music", {
        currentScreen: "home",
        onNavigateToScreen: onNavScreen,
        onNavigateBack: onNavBack,
      });

      expect(onNavScreen).not.toHaveBeenCalled();
      expect(onNavBack).not.toHaveBeenCalled();
      expect(result).toContain("I did not recognize the command");
      expect(speakSpy).toHaveBeenCalledWith(expect.stringContaining("I did not recognize"), {
        force: true,
      });
    });
  });

  // 5. Existing destination navigation & OCR commands
  describe("Existing destination navigation and OCR commands", () => {
    it("dispatches reader navigation for 'read this sign'", async () => {
      const onNavReader = jest.fn();
      const result = await dispatchVoiceCommand("Read this room number", {
        currentScreen: "home",
        onNavigateToReader: onNavReader,
      });
      expect(onNavReader).toHaveBeenCalledWith("sign");
      expect(result).toContain("room sign");
    });

    it("dispatches campus navigation for 'take me to science center'", async () => {
      const onNavNavigation = jest.fn();
      const result = await dispatchVoiceCommand("take me to science center", {
        currentScreen: "home",
        onNavigateToNavigation: onNavNavigation,
      });
      expect(onNavNavigation).toHaveBeenCalledWith("science center");
      expect(result).toContain("science center");
    });
  });

  // 6. Voice Mode Management Commands
  describe("Global Voice Mode Commands", () => {
    it("dispatches 'stop listening' to pause recognition", async () => {
      const onStopListening = jest.fn();
      const speakSpy = jest.spyOn(speechService, "speak");

      const res = await dispatchVoiceCommand("stop listening", {
        currentScreen: "home",
        onStopListening,
      });

      expect(onStopListening).toHaveBeenCalledTimes(1);
      expect(res).toContain("Listening paused");
      expect(speakSpy).toHaveBeenCalledWith(expect.stringContaining("Listening paused"), {
        force: true,
      });
    });

    it("dispatches 'resume listening' to continue recognition", async () => {
      const onResumeListening = jest.fn();
      const speakSpy = jest.spyOn(speechService, "speak");

      const res = await dispatchVoiceCommand("resume listening", {
        currentScreen: "home",
        onResumeListening,
      });

      expect(onResumeListening).toHaveBeenCalledTimes(1);
      expect(res).toBe("Listening resumed.");
      expect(speakSpy).toHaveBeenCalledWith("Listening resumed.", { force: true });
    });

    it("dispatches 'exit voice mode' to turn off voice mode", async () => {
      const onExitVoiceMode = jest.fn();
      const speakSpy = jest.spyOn(speechService, "speak");

      const res = await dispatchVoiceCommand("exit voice mode", {
        currentScreen: "reader",
        onExitVoiceMode,
      });

      expect(onExitVoiceMode).toHaveBeenCalledTimes(1);
      expect(res).toBe("Voice mode is off.");
      expect(speakSpy).toHaveBeenCalledWith("Voice mode is off.", { force: true });
    });
  });

  // 7. Voice-First Auto Read & Results Execution
  describe("Voice-First Auto Read & Results Actions", () => {
    it("triggers scan via onTriggerScan when saying 'scan now' on the reader screen", async () => {
      const onTriggerScan = jest.fn(async () => {});

      const res = await dispatchVoiceCommand("scan now", {
        currentScreen: "reader",
        onTriggerScan,
      });

      expect(onTriggerScan).toHaveBeenCalledTimes(1);
      expect(res).toBe("Scan initiated.");
    });

    it("prevents duplicate scan execution when isCapturing is true", async () => {
      const onTriggerScan = jest.fn(async () => {});
      const speakSpy = jest.spyOn(speechService, "speak");

      const res = await dispatchVoiceCommand("scan now", {
        currentScreen: "reader",
        isCapturing: true,
        onTriggerScan,
      });

      expect(onTriggerScan).not.toHaveBeenCalled();
      expect(res).toContain("already in progress");
      expect(speakSpy).toHaveBeenCalledWith(
        expect.stringContaining("already in progress"),
        { force: true }
      );
    });

    it("navigates to reader when saying 'scan now' from another screen", async () => {
      const onNavigateToScreen = jest.fn();
      const speakSpy = jest.spyOn(speechService, "speak");

      const res = await dispatchVoiceCommand("scan now", {
        currentScreen: "home",
        onNavigateToScreen,
      });

      expect(onNavigateToScreen).toHaveBeenCalledWith("reader");
      expect(res).toContain("Opening camera in Auto Read mode");
      expect(speakSpy).toHaveBeenCalledWith(
        expect.stringContaining("Opening camera in Auto Read mode"),
        { force: true }
      );
    });

    it("speaks verbatim source text when user says 'read the full text'", async () => {
      const speakSpy = jest.spyOn(speechService, "speak");
      const mockResult: any = {
        spokenText: "Summary of sign",
        response: {
          source_text: "Department of Computer Science Room 204",
          spoken_summary: "Room 204 Computer Science",
          confidence: 0.95,
        },
      };

      const res = await dispatchVoiceCommand("read the full text", {
        currentScreen: "results",
        currentReadingResult: mockResult,
      });

      expect(res).toContain("Department of Computer Science Room 204");
      expect(speakSpy).toHaveBeenCalledWith(
        "Full text: Department of Computer Science Room 204",
        { force: true }
      );
    });

    it("calls onReadFullText callback if provided", async () => {
      const onReadFullText = jest.fn(async () => {});

      const res = await dispatchVoiceCommand("read the full text", {
        currentScreen: "results",
        onReadFullText,
      });

      expect(onReadFullText).toHaveBeenCalledTimes(1);
      expect(res).toBe("Reading full text.");
    });

    it("speaks concise summary when user says 'summarize this'", async () => {
      const speakSpy = jest.spyOn(speechService, "speak");
      const mockResult: any = {
        spokenText: "Room 204 Computer Science plaque",
        response: {
          source_text: "Department of Computer Science Room 204 Office Hours Mon 2pm",
          spoken_summary: "Room 204 Computer Science plaque",
          confidence: 0.95,
        },
      };

      const res = await dispatchVoiceCommand("summarize this", {
        currentScreen: "results",
        currentReadingResult: mockResult,
      });

      expect(res).toContain("Room 204 Computer Science plaque");
      expect(speakSpy).toHaveBeenCalledWith(
        "Summary: Room 204 Computer Science plaque",
        { force: true }
      );
    });

    it("navigates back to camera when saying 'scan again'", async () => {
      const onScanAgain = jest.fn();
      const speakSpy = jest.spyOn(speechService, "speak");

      const res = await dispatchVoiceCommand("scan again", {
        currentScreen: "results",
        onScanAgain,
      });

      expect(onScanAgain).toHaveBeenCalledTimes(1);
      expect(res).toContain("Returning to camera");
      expect(speakSpy).toHaveBeenCalledWith(
        "Returning to camera. Say 'scan now' when ready.",
        { force: true }
      );
    });

    it("describes voice-first Auto Read actions for 'what can I do here?' on reader screen", async () => {
      const res = await dispatchVoiceCommand("what can I do here?", {
        currentScreen: "reader",
      });
      expect(res.toLowerCase()).toContain("scan now");
    });

    it("describes voice-controlled actions for 'what can I do here?' on results screen", async () => {
      const res = await dispatchVoiceCommand("what can I do here?", {
        currentScreen: "results",
      });
      expect(res.toLowerCase()).toContain("read the full text");
      expect(res.toLowerCase()).toContain("summarize this");
      expect(res.toLowerCase()).toContain("scan again");
    });
  });
});

