import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mock native ESM modules for Jest Node environment
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
  () => {
    let appStateListener: ((state: string) => void) | null = null;
    return {
      Platform: { OS: "android" },
      AppState: {
        currentState: "active",
        addEventListener: jest.fn((event: string, handler: (state: string) => void) => {
          appStateListener = handler;
          return {
            remove: jest.fn(() => {
              appStateListener = null;
            }),
          };
        }),
        _simulateStateChange: (newState: string) => {
          if (appStateListener) {
            appStateListener(newState);
          }
        },
      },
    };
  },
  { virtual: true }
);

import { globalVoiceService } from "./globalVoiceService";
import { speechService } from "./speech";
import { voiceRecognitionService } from "./voiceRecognition";
import { AppState } from "react-native";

describe("globalVoiceService — Global Voice Navigation System", () => {
  const advanceAndFlush = async (ms: number) => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.useFakeTimers();

    // Default mocks: onDone called synchronously so speech completion triggers scheduled restart
    jest.spyOn(speechService, "speak").mockImplementation(async (text, opts) => {
      opts?.onDone?.();
    });
    jest.spyOn(speechService, "stop").mockImplementation(async () => {});
    jest.spyOn(speechService, "isSpeaking").mockReturnValue(false);
    jest.spyOn(speechService, "isSpeakingAsync").mockResolvedValue(false);

    jest.spyOn(voiceRecognitionService, "checkAvailability").mockReturnValue({ available: true });
    jest.spyOn(voiceRecognitionService, "requestPermissions").mockResolvedValue(true);
    jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async () => {});
    jest.spyOn(voiceRecognitionService, "stopListening").mockImplementation(() => {});
    jest.spyOn(voiceRecognitionService, "cancelListening").mockImplementation(() => {});

    await globalVoiceService.disableVoiceMode(false);
  });

  afterEach(async () => {
    jest.clearAllTimers();
    jest.useRealTimers();
    await globalVoiceService.disableVoiceMode(false);
  });

  // 1. Activation and Deactivation
  describe("Activation and Deactivation", () => {
    it("activates voice mode, speaks greeting, and starts listening only after greeting finishes", async () => {
      const speakSpy = jest.spyOn(speechService, "speak");
      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening");

      // Before speech completes, listenSpy shouldn't have been called
      const successPromise = globalVoiceService.enableVoiceMode();
      expect(listenSpy).not.toHaveBeenCalled();

      const success = await successPromise;
      expect(success).toBe(true);

      const state = globalVoiceService.getState();
      expect(state.isActive).toBe(true);
      expect(state.isPaused).toBe(false);
      expect(state.statusMessage).toContain("Voice mode is on");

      // Verify spoken confirmation was triggered
      expect(speakSpy).toHaveBeenCalledWith(
        expect.stringContaining("Voice mode is on"),
        expect.objectContaining({ force: true })
      );

      // Fast-forward through TTS cooldown delay (300ms)
      await advanceAndFlush(400);

      expect(listenSpy).toHaveBeenCalledTimes(1);
    });

    it("disables voice mode, stops microphone, and speaks confirmation", async () => {
      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);

      const cancelListenSpy = jest.spyOn(voiceRecognitionService, "cancelListening");
      const speakSpy = jest.spyOn(speechService, "speak");

      await globalVoiceService.disableVoiceMode(true);

      const state = globalVoiceService.getState();
      expect(state.isActive).toBe(false);
      expect(state.isListening).toBe(false);
      expect(state.statusMessage).toBe("Voice mode is off.");

      expect(cancelListenSpy).toHaveBeenCalled();
      expect(speakSpy).toHaveBeenCalledWith("Voice mode is off.", expect.objectContaining({ force: true }));
    });

    it("toggles voice mode between active and inactive", async () => {
      expect(globalVoiceService.getState().isActive).toBe(false);

      await globalVoiceService.toggleVoiceMode();
      expect(globalVoiceService.getState().isActive).toBe(true);

      await globalVoiceService.toggleVoiceMode();
      expect(globalVoiceService.getState().isActive).toBe(false);
    });
  });

  // 2. Permission Handling
  describe("Permission Handling", () => {
    it("handles permission denial accessibly without starting microphone", async () => {
      jest.spyOn(voiceRecognitionService, "requestPermissions").mockResolvedValue(false);
      const speakSpy = jest.spyOn(speechService, "speak");
      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening");

      const success = await globalVoiceService.enableVoiceMode();
      expect(success).toBe(false);

      const state = globalVoiceService.getState();
      expect(state.isActive).toBe(false);
      expect(state.error).toContain("permission was denied");
      expect(speakSpy).toHaveBeenCalledWith(expect.stringContaining("permission was denied"), {
        force: true,
      });
      expect(listenSpy).not.toHaveBeenCalled();
    });

    it("handles native module unavailability gracefully (Expo Go fallback)", async () => {
      jest.spyOn(voiceRecognitionService, "checkAvailability").mockReturnValue({
        available: false,
        reason: "Speech recognition requires a native Android build.",
      });
      const speakSpy = jest.spyOn(speechService, "speak");
      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening");

      const success = await globalVoiceService.enableVoiceMode();
      expect(success).toBe(false);

      expect(globalVoiceService.getState().isActive).toBe(false);
      expect(speakSpy).toHaveBeenCalledWith(
        expect.stringContaining("requires a native Android build"),
        { force: true }
      );
      expect(listenSpy).not.toHaveBeenCalled();
    });
  });

  // 3. Pause and Resume Listening
  // 3. Pause and Resume Listening
  describe("Pause and Resume Listening", () => {
    it("pauses listening, stops mic, and notifies user without exiting voice mode", async () => {
      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);

      const cancelListenSpy = jest.spyOn(voiceRecognitionService, "cancelListening");
      const speakSpy = jest.spyOn(speechService, "speak");

      await globalVoiceService.pauseListening(true);

      const state = globalVoiceService.getState();
      expect(state.isActive).toBe(true);
      expect(state.isPaused).toBe(true);
      expect(state.isListening).toBe(false);
      expect(cancelListenSpy).toHaveBeenCalled();
      expect(speakSpy).toHaveBeenCalledWith(
        expect.stringContaining("Listening paused"),
        expect.objectContaining({ force: true })
      );
    });

    it("resumes listening from paused state after speech confirmation finishes (Active -> pause -> resume -> listening again)", async () => {
      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        cbs?.onStart?.();
      });

      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);
      expect(listenSpy).toHaveBeenCalledTimes(1);
      expect(globalVoiceService.getState().isListening).toBe(true);

      await globalVoiceService.pauseListening(false);
      expect(globalVoiceService.getState().isPaused).toBe(true);
      expect(globalVoiceService.getState().isListening).toBe(false);

      await globalVoiceService.resumeListening(true);
      const state = globalVoiceService.getState();
      expect(state.isPaused).toBe(false);

      await advanceAndFlush(400);
      expect(listenSpy).toHaveBeenCalledTimes(2);
      expect(globalVoiceService.getState().isListening).toBe(true);
    });

    it("handles Active -> pause -> tap control -> listening again", async () => {
      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        cbs?.onStart?.();
      });

      // 1. Start active
      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);
      expect(listenSpy).toHaveBeenCalledTimes(1);

      // 2. Pause
      await globalVoiceService.pauseListening(true);
      expect(globalVoiceService.getState().isPaused).toBe(true);
      expect(globalVoiceService.getState().isListening).toBe(false);

      // 3. Simulate tapping the global voice control while paused
      const currentState = globalVoiceService.getState();
      if (currentState.isPaused || !currentState.isListening) {
        await globalVoiceService.resumeListening(true);
      }
      await advanceAndFlush(400);

      expect(globalVoiceService.getState().isPaused).toBe(false);
      expect(globalVoiceService.getState().isListening).toBe(true);
      expect(listenSpy).toHaveBeenCalledTimes(2);
    });

    it("does not create duplicate recognition sessions during repeated pause and resume", async () => {
      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        cbs?.onStart?.();
      });

      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);
      expect(listenSpy).toHaveBeenCalledTimes(1);

      // Repeated pause and resume cycles
      for (let i = 0; i < 5; i++) {
        await globalVoiceService.pauseListening(false);
        expect(globalVoiceService.getState().isPaused).toBe(true);
        expect(globalVoiceService.getState().isListening).toBe(false);

        await globalVoiceService.resumeListening(false);
        await advanceAndFlush(200);
        expect(globalVoiceService.getState().isPaused).toBe(false);
        expect(globalVoiceService.getState().isListening).toBe(true);
      }

      // Exactly 1 initial + 5 resumes = 6 clean sessions
      expect(listenSpy).toHaveBeenCalledTimes(6);
    });

    it("is safe to call resume while already listening without creating duplicate sessions", async () => {
      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        cbs?.onStart?.();
      });

      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);
      expect(listenSpy).toHaveBeenCalledTimes(1);
      expect(globalVoiceService.getState().isListening).toBe(true);

      // Call resume while already active and listening
      await globalVoiceService.resumeListening(true);
      await advanceAndFlush(400);

      // Should be a safe no-op and NOT start duplicate sessions
      expect(listenSpy).toHaveBeenCalledTimes(1);
      expect(globalVoiceService.getState().isActive).toBe(true);
      expect(globalVoiceService.getState().isListening).toBe(true);
    });

    it("leaves a recoverable state if recognition restart fails and allows retry by tapping control", async () => {
      // Mock startListening to reject on first attempt
      const startSpy = jest
        .spyOn(voiceRecognitionService, "startListening")
        .mockRejectedValueOnce(new Error("Audio hardware busy"));

      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);

      // Failed start leaves isPaused = true with informative error message
      const failedState = globalVoiceService.getState();
      expect(failedState.isPaused).toBe(true);
      expect(failedState.isListening).toBe(false);
      expect(failedState.error).toContain("Audio hardware busy");
      expect(failedState.statusMessage).toContain("Tap to retry");

      // User retries by tapping the control (resumeListening)
      // Now startListening succeeds
      startSpy.mockImplementation(async (cbs) => {
        cbs?.onStart?.();
      });

      await globalVoiceService.resumeListening(true);
      await advanceAndFlush(400);

      // Successfully recovered!
      const recoveredState = globalVoiceService.getState();
      expect(recoveredState.isPaused).toBe(false);
      expect(recoveredState.isListening).toBe(true);
      expect(recoveredState.error).toBeNull();
    });
  });

  // 4. Command Dispatch and Global Navigation
  describe("Command Dispatch and Global Navigation", () => {
    it("dispatches recognized command across screens and restarts listening after result speech", async () => {
      const onNavigateScreen = jest.fn();
      globalVoiceService.setDispatchContextProvider(() => ({
        currentScreen: "home",
        onNavigateToScreen: onNavigateScreen,
      }));

      let capturedCallbacks: any = null;
      jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        capturedCallbacks = cbs;
      });

      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);

      expect(capturedCallbacks).toBeTruthy();

      // Simulate spoken command: "open timetable"
      capturedCallbacks.onResult({
        transcript: "open time table",
        isFinal: true,
      });

      await advanceAndFlush(100);

      // Verification: Navigation occurred to timetable
      expect(onNavigateScreen).toHaveBeenCalledWith("timetable");
    });
  });

  // 5. App Backgrounding and Error Threshold
  describe("Lifecycle and Resilience", () => {
    it("stops listening when app goes to background and resumes when returning to foreground", async () => {
      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);

      const stopListenSpy = jest.spyOn(voiceRecognitionService, "stopListening");
      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening");

      // Simulate AppState going to background
      (AppState as any)._simulateStateChange("background");

      expect(stopListenSpy).toHaveBeenCalled();

      // Simulate AppState returning to active
      (AppState as any)._simulateStateChange("active");
      await advanceAndFlush(600);

      expect(listenSpy).toHaveBeenCalled();
    });

    it("pauses listening after 3 consecutive recognition errors to prevent infinite loops", async () => {
      let capturedCallbacks: any = null;
      jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        capturedCallbacks = cbs;
      });

      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);

      expect(capturedCallbacks).toBeTruthy();

      // Trigger error 1
      capturedCallbacks.onError("Network timeout");
      await advanceAndFlush(700);

      // Trigger error 2
      capturedCallbacks.onError("No speech match");
      await advanceAndFlush(700);

      // Trigger error 3
      capturedCallbacks.onError("Audio buffer error");
      await advanceAndFlush(100);

      const state = globalVoiceService.getState();
      expect(state.isPaused).toBe(true);
      expect(state.statusMessage).toBe("Voice recognition paused.");
    });

    it("prevents duplicate listeners through subscription cleanup", () => {
      const listener = jest.fn();
      const unsubscribe = globalVoiceService.subscribe(listener);

      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      globalVoiceService.pauseListening(false);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // 6. State Consistency Regression Suite
  describe("State Consistency Regression Suite", () => {
    it("Activation -> TTS completion -> listening: maintains isPaused=false throughout and enters listening only after speech", async () => {
      let completeSpeech: (() => void) | null = null;
      jest.spyOn(speechService, "speak").mockImplementation(async (text, opts) => {
        completeSpeech = () => opts?.onDone?.();
      });

      const recordedStates: Array<{ isActive: boolean; isPaused: boolean; isListening: boolean }> = [];
      const unsubscribe = globalVoiceService.subscribe((state) => {
        recordedStates.push({
          isActive: state.isActive,
          isPaused: state.isPaused,
          isListening: state.isListening,
        });
      });

      let capturedCallbacks: any = null;
      jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        capturedCallbacks = cbs;
        cbs?.onStart?.();
      });

      // 1. Activate Global Voice Mode
      const enablePromise = globalVoiceService.enableVoiceMode();
      await advanceAndFlush(50);

      // Verify state during welcome speech: active, NOT paused, NOT listening yet
      const midSpeechState = globalVoiceService.getState();
      expect(midSpeechState.isActive).toBe(true);
      expect(midSpeechState.isPaused).toBe(false);
      expect(midSpeechState.isListening).toBe(false);

      // At no point during initial speech should isPaused be true!
      expect(recordedStates.some((s) => s.isPaused === true)).toBe(false);

      // 2. Complete welcome speech
      expect(completeSpeech).toBeTruthy();
      completeSpeech!();
      await enablePromise;

      // Fast-forward cooldown (300ms)
      await advanceAndFlush(400);

      // Verify state after speech: active, NOT paused, AND listening
      const listeningState = globalVoiceService.getState();
      expect(listeningState.isActive).toBe(true);
      expect(listeningState.isPaused).toBe(false);
      expect(listeningState.isListening).toBe(true);

      unsubscribe();
    });

    it("Command -> navigation -> listening again: resets listening during dispatch and restarts after feedback speech", async () => {
      const onNavigateScreen = jest.fn();
      globalVoiceService.setDispatchContextProvider(() => ({
        currentScreen: "home",
        onNavigateToScreen: onNavigateScreen,
      }));

      let capturedCallbacks: any = null;
      let startListeningCallCount = 0;
      jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        capturedCallbacks = cbs;
        startListeningCallCount++;
        cbs?.onStart?.();
      });

      // Activate and reach listening state
      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);
      expect(globalVoiceService.getState().isListening).toBe(true);
      expect(startListeningCallCount).toBe(1);

      // Setup speech simulation for command response
      let isTtsSpeaking = false;
      jest.spyOn(speechService, "isSpeaking").mockImplementation(() => isTtsSpeaking);
      jest.spyOn(speechService, "isSpeakingAsync").mockImplementation(async () => isTtsSpeaking);
      jest.spyOn(speechService, "speak").mockImplementation(async (text, opts) => {
        isTtsSpeaking = true;
        // Delay speech finish slightly
        setTimeout(() => {
          isTtsSpeaking = false;
          opts?.onDone?.();
        }, 100);
      });

      // Simulate spoken command "open reader"
      capturedCallbacks.onResult({
        transcript: "open reader",
        isFinal: true,
      });

      // Immediately after final result, listening should be false (preventing dual mic/TTS)
      expect(globalVoiceService.getState().isListening).toBe(false);

      // Fast forward past dispatch and TTS duration
      await advanceAndFlush(150);
      expect(onNavigateScreen).toHaveBeenCalledWith("reader");

      // Advance through TTS poll cycles and the 350ms restart cooldown
      await advanceAndFlush(500);
      await advanceAndFlush(500);

      // Listening must be restarted automatically!
      expect(startListeningCallCount).toBe(2);
      expect(globalVoiceService.getState().isActive).toBe(true);
      expect(globalVoiceService.getState().isPaused).toBe(false);
      expect(globalVoiceService.getState().isListening).toBe(true);
    });

    it("State subscriptions: broadcast accurate state on every transition without false paused events", async () => {
      const history: Array<{ isActive: boolean; isPaused: boolean; isListening: boolean }> = [];
      const unsubscribe = globalVoiceService.subscribe((s) => {
        history.push({ isActive: s.isActive, isPaused: s.isPaused, isListening: s.isListening });
      });

      jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        cbs?.onStart?.();
      });

      // 1. Enable
      await globalVoiceService.enableVoiceMode();
      await advanceAndFlush(400);

      // 2. Pause explicitly
      await globalVoiceService.pauseListening(false);

      // 3. Resume
      await globalVoiceService.resumeListening(false);
      await advanceAndFlush(400);

      // 4. Disable
      await globalVoiceService.disableVoiceMode(false);

      unsubscribe();

      // Check the pause state transitions
      const pausedEntries = history.filter((h) => h.isPaused);
      expect(pausedEntries.length).toBeGreaterThan(0);
      // Verify that every paused entry has isActive = true
      pausedEntries.forEach((entry) => {
        expect(entry.isActive).toBe(true);
      });

      // Prior to the explicit pause, no entry should have isPaused = true
      const firstPauseIndex = history.findIndex((h) => h.isPaused);
      for (let i = 0; i < firstPauseIndex; i++) {
        expect(history[i].isPaused).toBe(false);
      }
    });

    it("Pause -> confirmation speech completes -> remains paused (never triggers automatic resume)", async () => {
      let completePauseSpeech: (() => void) | null = null;
      jest.spyOn(speechService, "speak").mockImplementation(async (text, opts) => {
        completePauseSpeech = () => opts?.onDone?.();
      });

      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening");

      // 1. Enable and reach listening
      await globalVoiceService.enableVoiceMode();
      if (completePauseSpeech) (completePauseSpeech as any)();
      await advanceAndFlush(400);
      expect(listenSpy).toHaveBeenCalledTimes(1);

      // 2. Pause with confirmation speech
      await globalVoiceService.pauseListening(true);
      expect(globalVoiceService.getState().isPaused).toBe(true);
      expect(globalVoiceService.getState().isSpeaking).toBe(true);
      expect(globalVoiceService.getState().isListening).toBe(false);

      // 3. Complete pause confirmation speech
      expect(completePauseSpeech).toBeTruthy();
      (completePauseSpeech as any)();
      await advanceAndFlush(50);
      expect(globalVoiceService.getState().isSpeaking).toBe(false);
      expect(globalVoiceService.getState().isPaused).toBe(true);

      // 4. Advance several seconds into the future
      await advanceAndFlush(5000);

      // Must strictly remain paused and NOT restart listening!
      expect(listenSpy).toHaveBeenCalledTimes(1);
      expect(globalVoiceService.getState().isPaused).toBe(true);
      expect(globalVoiceService.getState().isListening).toBe(false);
    });

    it("Paused -> tap Resume -> confirmation speech -> native start -> listening", async () => {
      let completeResumeSpeech: (() => void) | null = null;
      jest.spyOn(speechService, "speak").mockImplementation(async (text, opts) => {
        completeResumeSpeech = () => opts?.onDone?.();
      });

      let capturedCallbacks: any = null;
      const listenSpy = jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        capturedCallbacks = cbs;
      });

      // 1. Reach paused state
      await globalVoiceService.enableVoiceMode();
      if (completeResumeSpeech) (completeResumeSpeech as any)();
      await advanceAndFlush(400);

      await globalVoiceService.pauseListening(false);
      expect(globalVoiceService.getState().isPaused).toBe(true);

      // 2. Tap Resume
      const resumePromise = globalVoiceService.resumeListening(true);
      await advanceAndFlush(50);

      // During resume confirmation: unpaused, speaking, NOT listening yet
      expect(globalVoiceService.getState().isPaused).toBe(false);
      expect(globalVoiceService.getState().isSpeaking).toBe(true);
      expect(globalVoiceService.getState().isListening).toBe(false);

      // 3. Complete speech
      expect(completeResumeSpeech).toBeTruthy();
      (completeResumeSpeech as any)();
      await resumePromise;

      // 4. Advance past schedule delay (150ms)
      await advanceAndFlush(200);
      expect(listenSpy).toHaveBeenCalled();

      // UI state before native onStart is still isListening=false
      expect(globalVoiceService.getState().isListening).toBe(false);

      // 5. Native onStart confirms
      expect(capturedCallbacks).toBeTruthy();
      capturedCallbacks.onStart();

      // UI state confirms listening
      expect(globalVoiceService.getState().isListening).toBe(true);
      expect(globalVoiceService.getState().isSpeaking).toBe(false);
      expect(globalVoiceService.getState().statusMessage).toBe("Listening resumed.");
    });

    it("TTS finishing while paused does not restart recognition", async () => {
      let speechDoneCallback: (() => void) | null = null;
      jest.spyOn(speechService, "speak").mockImplementation(async (text, opts) => {
        speechDoneCallback = () => opts?.onDone?.();
      });

      let startCount = 0;
      jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        startCount++;
        cbs?.onStart?.();
      });

      // 1. Start active and listening
      await globalVoiceService.enableVoiceMode();
      if (speechDoneCallback) (speechDoneCallback as any)();
      await advanceAndFlush(400);
      expect(startCount).toBe(1);

      // 2. User pauses while background speech might be queued
      await globalVoiceService.pauseListening(false);
      expect(globalVoiceService.getState().isPaused).toBe(true);

      // 3. Speech completes while paused
      if (speechDoneCallback) (speechDoneCallback as any)();
      await advanceAndFlush(2000);

      // Recognition must NOT restart
      expect(startCount).toBe(1);
      expect(globalVoiceService.getState().isPaused).toBe(true);
      expect(globalVoiceService.getState().isListening).toBe(false);
    });

    it("Exit while speaking never restarts recognition", async () => {
      let speechDoneCallback: (() => void) | null = null;
      jest.spyOn(speechService, "speak").mockImplementation(async (text, opts) => {
        speechDoneCallback = () => opts?.onDone?.();
      });

      let startCount = 0;
      jest.spyOn(voiceRecognitionService, "startListening").mockImplementation(async (cbs) => {
        startCount++;
        cbs?.onStart?.();
      });

      // 1. Start active
      await globalVoiceService.enableVoiceMode();
      if (speechDoneCallback) (speechDoneCallback as any)();
      await advanceAndFlush(400);
      expect(startCount).toBe(1);

      // 2. User exits voice mode while speech confirmation is speaking
      await globalVoiceService.disableVoiceMode(true);
      expect(globalVoiceService.getState().isActive).toBe(false);

      // 3. Speech completes
      if (speechDoneCallback) (speechDoneCallback as any)();
      await advanceAndFlush(3000);

      // Recognition must remain completely off
      expect(startCount).toBe(1);
      expect(globalVoiceService.getState().isActive).toBe(false);
      expect(globalVoiceService.getState().isListening).toBe(false);
    });
  });
});
