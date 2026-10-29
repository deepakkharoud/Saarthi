import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  AccessibilityInfo,
  AppState,
  AppStateStatus,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Colors } from "./src/theme/colors";
import { speechService } from "./src/services/speech";
import { NavigationRoute, CampusGraph } from "./src/navigation/campusRouter";
import { CampusLocalizer, LocalizationResult } from "./src/navigation/localization";
import { ReadingPipelineResult } from "./src/services/readingPipeline";
import sampleCampusData from "./src/data/sample_campus_graph.json";

// Shared deterministic localizer initialized with verified campus graph
const campusLocalizer = new CampusLocalizer(sampleCampusData as unknown as CampusGraph);

// Modular Screens
import { useCameraPermissions } from "expo-camera";
import { HomeScreen } from "./src/screens/HomeScreen";
import { CampusReaderScreen, ReadingMode } from "./src/screens/CampusReaderScreen";
import { ReadingResultsScreen } from "./src/screens/ReadingResultsScreen";
import { TimetableScreen } from "./src/screens/TimetableScreen";
import {
  CampusNavigationScreen,
  CampusNavigationVoiceActions,
} from "./src/screens/CampusNavigationScreen";


import { VoiceAssistantScreen } from "./src/screens/VoiceAssistantScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { CameraAssistScreen } from "./src/screens/CameraAssistScreen";
import { globalVoiceService } from "./src/services/globalVoiceService";
import { GlobalVoiceControl } from "./src/components/GlobalVoiceControl";
import { voiceRecognitionService } from "./src/services/voiceRecognition";
import {
  isSaarthiWakeTranscript,
  SAARTHI_WAKE_PHRASES,
  WAKE_WORD_GREETING,
} from "./src/services/wakeWord";
import {
  addWakeWordListener,
  dispose as disposeWakeWordDetector,
  getModelStatus,
  getStatus as getWakeWordDetectorStatus,
  initialize as initializeWakeWordDetector,
  prepareModels,
  startDetection as startWakeWordDetection,
  stopDetection as stopWakeWordDetection,
} from "react-native-voice-activator";

export type AppScreen =
  | "home"
  | "reader"
  | "results"
  | "timetable"
  | "navigation"
  | "voice"
  | "settings"
  | "assist";

const ONBOARDING_KEY = "@saarthi_onboarding_played";
const HOME_VOICE_GUIDANCE =
  "Welcome to SAARTHI! While the app is open on Home, say Hey Saarthi to activate voice control. Then choose Read Anything, Campus Map, My Day, or Talk to Saarthi. You can also tap the purple Talk to Saarthi tile.";

export function SaarthiApp() {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>("home");
  const [screenHistory, setScreenHistory] = useState<AppScreen[]>([]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [readerMode, setReaderMode] = useState<ReadingMode>("auto");
  const [currentReadingResult, setCurrentReadingResult] = useState<ReadingPipelineResult | null>(null);
  const [currentImageUri, setCurrentImageUri] = useState<string | undefined>(undefined);
  const [activeRoute, setActiveRoute] = useState<NavigationRoute | null>(null);
  const [currentStartNodeId, setCurrentStartNodeId] = useState<string>("entrance_main");
  const [navDestinationQuery, setNavDestinationQuery] = useState<string>("");

  const [isVoiceModeActive, setIsVoiceModeActive] = useState<boolean>(
    globalVoiceService.getState().isActive
  );
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [isOnboardingResolved, setIsOnboardingResolved] = useState<boolean>(false);
  const [appState, setAppState] = useState<AppStateStatus>("active");
  const [wakeWordStatus, setWakeWordStatus] = useState<string>("Wake phrase is starting.");
  const wakeWordGenerationRef = useRef<number>(0);
  const wakePermissionRequestedRef = useRef<boolean>(false);
  const startWakeWordRef = useRef<() => Promise<void>>(async () => undefined);
  const stopWakeWordRef = useRef<() => Promise<void>>(async () => undefined);
  const wakeBackgroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        if (wakeBackgroundTimerRef.current) {
          clearTimeout(wakeBackgroundTimerRef.current);
          wakeBackgroundTimerRef.current = null;
        }
        setAppState("active");
        return;
      }

      if (nextState === "background" && !wakeBackgroundTimerRef.current) {
        // Some Android speech services briefly report background while opening
        // their recognizer. Only release the mic if the app stays backgrounded.
        wakeBackgroundTimerRef.current = setTimeout(() => {
          wakeBackgroundTimerRef.current = null;
          setAppState("background");
        }, 2000);
      }
    });
    return () => {
      subscription.remove();
      if (wakeBackgroundTimerRef.current) {
        clearTimeout(wakeBackgroundTimerRef.current);
        wakeBackgroundTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return globalVoiceService.subscribe((state) => {
      setIsVoiceModeActive(state.isActive);
    });
  }, []);

  // Home uses Android's installed on-device en-IN speech recognizer for the
  // wake phrase. This is much more reliable for Saarthi's Indian-accented name
  // than an untuned open-vocabulary keyword spotter. iOS retains the native KWS.
  useEffect(() => {
    const generation = ++wakeWordGenerationRef.current;
    let cancelled = false;
    let wakeWordTriggered = false;
    let detectorInitialized = false;
    let detectorStarted = false;
    let detectorMode: "android-asr" | "sherpa" =
      Platform.OS === "android" ? "android-asr" : "sherpa";
    let offlineSpeechLocale: string | null = null;
    let speechRestartTimer: ReturnType<typeof setTimeout> | null = null;
    let wakeTranscriptTimer: ReturnType<typeof setTimeout> | null = null;
    let wakeTranscriptBuffer = "";
    let speechRestartAttempts = 0;
    let startPromise: Promise<void> | null = null;
    let stopPromise: Promise<void> | null = null;
    let modelPreparationPromise: Promise<void> | null = null;
    const isCurrent = () => !cancelled && wakeWordGenerationRef.current === generation;

    let detectionSubscription: { remove: () => void } | undefined;
    let stateSubscription: { remove: () => void } | undefined;
    let errorSubscription: { remove: () => void } | undefined;
    const cleanupListeners = (): void => {
      detectionSubscription?.remove();
      stateSubscription?.remove();
      errorSubscription?.remove();
    };

    const handleWakePhraseDetected = (): void => {
      if (!isCurrent() || wakeWordTriggered) return;
      wakeWordTriggered = true;
      setWakeWordStatus("Hey Saarthi heard. Opening voice controls.");
      console.log("[WakeWord] On-device recognition heard the wake phrase.");
      void (async () => {
        try {
          await stopDetector();
          if (!isCurrent()) return;
          const enabled = await globalVoiceService.enableVoiceMode(WAKE_WORD_GREETING);
          if (!enabled && isCurrent()) {
            wakeWordTriggered = false;
            await speechService.waitForPlaybackCompletion(7000);
            await startWakeWordRef.current();
          }
        } catch (error) {
          console.warn("[WakeWord] Could not hand off microphone to voice mode:", error);
          if (isCurrent()) {
            wakeWordTriggered = false;
            await startWakeWordRef.current();
          }
        }
      })();
    };

    const scheduleSpeechRestart = (delayMs: number): void => {
      if (speechRestartTimer || !isCurrent() || wakeWordTriggered) return;
      speechRestartTimer = setTimeout(() => {
        speechRestartTimer = null;
        if (isCurrent() && !wakeWordTriggered) void startWakeWordRef.current();
      }, delayMs);
    };

    const stopDetector = async (): Promise<void> => {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        if (speechRestartTimer) {
          clearTimeout(speechRestartTimer);
          speechRestartTimer = null;
        }
      if (wakeTranscriptTimer) {
        clearTimeout(wakeTranscriptTimer);
        wakeTranscriptTimer = null;
      }
        if (detectorMode === "android-asr" && detectorStarted) {
          detectorStarted = false;
          voiceRecognitionService.cancelListening();
        } else if (detectorMode === "sherpa" && detectorStarted) {
          detectorStarted = false;
          try {
            await stopWakeWordDetection();
          } catch (error) {
            console.warn("[WakeWord] Could not stop native detector cleanly:", error);
          }
        }
      })();
      try {
        await stopPromise;
      } finally {
        stopPromise = null;
      }
    };

    const startDetector = async (): Promise<void> => {
      if (!isCurrent() || wakeWordTriggered || detectorStarted || startPromise) return;
      startPromise = (async () => {
        try {
          if (detectorMode === "android-asr") {
            if (!offlineSpeechLocale) {
              setWakeWordStatus("Download English (India) offline speech to enable Hey Saarthi.");
              return;
            }
            setWakeWordStatus("Starting offline Hey Saarthi listener.");
            let startFailed = false;
            await voiceRecognitionService.startListening(
              {
                onStart: () => {
                  if (!isCurrent() || wakeWordTriggered) return;
                  detectorStarted = true;
                  speechRestartAttempts = 0;
                  setWakeWordStatus("Hey Saarthi is listening. Say Hey Saarthi.");
                },
                onResult: ({ transcript }) => {
                  if (!isCurrent() || wakeWordTriggered || !transcript.trim()) return;
                  const normalized = transcript
                    .toLocaleLowerCase()
                    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
                    .trim();
                  const previous = wakeTranscriptBuffer.trim();
                  if (!previous || normalized.startsWith(previous)) {
                    wakeTranscriptBuffer = normalized;
                  } else if (!previous.startsWith(normalized) && !previous.endsWith(normalized)) {
                    wakeTranscriptBuffer = `${previous} ${normalized}`.trim();
                  }

                  if (wakeTranscriptTimer) clearTimeout(wakeTranscriptTimer);
                  wakeTranscriptTimer = setTimeout(() => {
                    wakeTranscriptTimer = null;
                    wakeTranscriptBuffer = "";
                  }, 3500);

                  if (isSaarthiWakeTranscript(wakeTranscriptBuffer)) {
                    handleWakePhraseDetected();
                  } else {
                    setWakeWordStatus(`Heard: ${wakeTranscriptBuffer}. Say Hey Saarthi to start.`);
                  }
                },
                onError: (error) => {
                  if (!isCurrent() || wakeWordTriggered) return;
                  startFailed = true;
                  detectorStarted = false;
                  speechRestartAttempts += 1;
                  console.warn("[WakeWord] Offline speech recognizer ended:", error);
                  if (speechRestartAttempts <= 5) {
                    setWakeWordStatus("Restarting offline Hey Saarthi listener.");
                    scheduleSpeechRestart(Math.min(700 * speechRestartAttempts, 3500));
                  } else {
                    setWakeWordStatus("Offline wake listening stopped. Tap Talk to Saarthi.");
                  }
                },
                onEnd: () => {
                  if (!isCurrent() || wakeWordTriggered) return;
                  detectorStarted = false;
                  setWakeWordStatus("Restarting offline Hey Saarthi listener.");
                  scheduleSpeechRestart(350);
                },
              },
              {
                languageTag: offlineSpeechLocale,
                contextualStrings: [
                  ...SAARTHI_WAKE_PHRASES,
                  "hey saathi",
                  "hai saarthi",
                  "हे सारथी",
                  "हे सारथि",
                  "हे साथी",
                ],
                keepListeningAfterFinal: true,
                requiresOnDeviceRecognition: true,
                androidRecognitionServicePackage: "com.google.android.as",
              },
            );
            if (isCurrent() && !wakeWordTriggered && !startFailed) detectorStarted = true;
            if (!isCurrent() || wakeWordTriggered) await stopDetector();
            return;
          }

          if (!detectorInitialized) {
            if (modelPreparationPromise) await modelPreparationPromise;
            if (!isCurrent()) return;
            await initializeWakeWordDetector({
              wakePhrase: SAARTHI_WAKE_PHRASES,
              engineConfig: { sensitivity: 0.85 },
            });
            detectorInitialized = true;
          }
          if (!isCurrent() || wakeWordTriggered) return;
          await startWakeWordDetection();
          detectorStarted = true;
          if (!isCurrent() || wakeWordTriggered) {
            await stopDetector();
            return;
          }
          setWakeWordStatus("Hey Saarthi is listening. Say Hey Saarthi.");
        } catch (error) {
          if (!isCurrent() || wakeWordTriggered) return;
          setWakeWordStatus("Wake word could not start. Tap Talk to Saarthi to use voice.");
          AccessibilityInfo.announceForAccessibility(
            "Hey Saarthi could not start. Tap Talk to Saarthi to use voice commands."
          );
          console.warn("[WakeWord] Native detector failed to start:", error);
        }
      })();
      try {
        await startPromise;
      } finally {
        startPromise = null;
      }
    };

    if (!isOnboardingResolved) {
      setWakeWordStatus("Preparing Hey Saarthi.");
      return () => {
        cancelled = true;
        void stopDetector().finally(() => {
          if (detectorInitialized) void disposeWakeWordDetector();
        });
      };
    }

    startWakeWordRef.current = startDetector;
    stopWakeWordRef.current = stopDetector;

    if (currentScreen !== "home") {
      setWakeWordStatus("Wake phrase is available on Home.");
      return () => {
        cancelled = true;
        void stopDetector().finally(() => {
          if (detectorInitialized) void disposeWakeWordDetector();
        });
      };
    }
    if (isVoiceModeActive) {
      setWakeWordStatus("Voice assistant is active.");
      return () => {
        cancelled = true;
        void stopDetector().finally(() => {
          if (detectorInitialized) void disposeWakeWordDetector();
        });
      };
    }
    if (appState !== "active") {
      setWakeWordStatus("Wake phrase pauses while Saarthi is in the background.");
      return () => {
        cancelled = true;
        void stopDetector().finally(() => {
          if (detectorInitialized) void disposeWakeWordDetector();
        });
      };
    }

    const initializeWakeWord = async (): Promise<(() => void) | undefined> => {
      try {
        setWakeWordStatus("Checking microphone permission for Hey Saarthi.");
        let permissionGranted =
          Platform.OS === "android"
            ? await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
            : await voiceRecognitionService.getPermissions();
        if (!permissionGranted && !wakePermissionRequestedRef.current) {
          wakePermissionRequestedRef.current = true;
          permissionGranted =
            Platform.OS === "android"
              ? (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
                  title: "Microphone permission",
                  message: "SAARTHI needs the microphone to listen for Hey Saarthi on Home.",
                  buttonPositive: "Allow",
                  buttonNegative: "Not now",
                })) === PermissionsAndroid.RESULTS.GRANTED
              : await voiceRecognitionService.requestPermissions();
        }
        if (!isCurrent()) {
          cleanupListeners();
          return undefined;
        }
        if (!permissionGranted) {
          setWakeWordStatus("Wake phrase off. Tap Talk to Saarthi to enable voice access.");
          AccessibilityInfo.announceForAccessibility(
            "Microphone permission is needed for Hey Saarthi. You can tap Talk to Saarthi to continue."
          );
          cleanupListeners();
          return undefined;
        }

        if (Platform.OS === "android") {
          const hindiSpeechLocale = await voiceRecognitionService.getInstalledOnDeviceLocale("hi-IN");
          offlineSpeechLocale =
            hindiSpeechLocale ??
            (await voiceRecognitionService.getInstalledOnDeviceLocale("en-IN"));
          console.log(
            `[WakeWord] Using offline wake locale: ${offlineSpeechLocale ?? "not installed"}`,
          );
          if (!offlineSpeechLocale) {
            setWakeWordStatus("Download English (India) offline speech to enable Hey Saarthi.");
            cleanupListeners();
            return undefined;
          }
          detectorMode = "android-asr";
        } else {
          detectorMode = "sherpa";
          const availability = getWakeWordDetectorStatus();
          if (!availability.isAvailable || availability.state === "unsupported") {
            setWakeWordStatus("Wake phrase unavailable. Tap Talk to Saarthi to use voice.");
            cleanupListeners();
            return undefined;
          }

          detectionSubscription = addWakeWordListener("wakeWordDetected", handleWakePhraseDetected);
          stateSubscription = addWakeWordListener("stateChanged", ({ state }) => {
            if (!isCurrent() || wakeWordTriggered) return;
            if (state === "running") {
              setWakeWordStatus("Hey Saarthi is listening. Say Hey Saarthi.");
            } else if (state === "initializing" || state === "starting") {
              setWakeWordStatus("Preparing the offline Hey Saarthi detector.");
            }
          });
          errorSubscription = addWakeWordListener("error", (error) => {
            if (!isCurrent() || wakeWordTriggered) return;
            const spokenMessage =
              error.category === "permission"
                ? "Microphone access is needed for Hey Saarthi. Allow microphone access or tap Talk to Saarthi."
                : "Hey Saarthi is unavailable. Tap Talk to Saarthi to use voice commands.";
            setWakeWordStatus(spokenMessage);
            AccessibilityInfo.announceForAccessibility(spokenMessage);
            void speechService.speak(spokenMessage, { force: true });
            console.warn("[WakeWord] Native detector reported an error:", error);
            void stopDetector();
          });

          const modelStatus = await getModelStatus();
          if (!modelStatus.ready) {
            setWakeWordStatus("Downloading the offline wake-word model. Internet is needed once.");
            AccessibilityInfo.announceForAccessibility(
              "Downloading the offline wake word model. This needs internet once. Voice buttons remain available."
            );
            modelPreparationPromise = prepareModels({
              onProgress: ({ percent }) => {
                if (isCurrent()) {
                  setWakeWordStatus(`Preparing offline wake-word model: ${percent} percent.`);
                }
              },
            }).then(() => undefined);
            await modelPreparationPromise;
            modelPreparationPromise = null;
          }
        }
        if (!isCurrent()) {
          cleanupListeners();
          return undefined;
        }

        // Wait for any startup/onboarding speech so the recognizer cannot mistake
        // Saarthi's own voice for the wake phrase. SpeechRecognizer is no longer
        // used for standby wake detection.
        setWakeWordStatus(
          detectorMode === "android-asr"
            ? "Preparing offline speech recognition for Hey Saarthi."
            : "Preparing Hey Saarthi detector.",
        );
        await speechService.waitForPlaybackCompletion(12000);
        if (!isCurrent()) {
          cleanupListeners();
          return undefined;
        }
        await startDetector();
      } catch (error) {
        cleanupListeners();
        if (!isCurrent()) return undefined;
        setWakeWordStatus("Offline wake setup failed. Tap Talk to Saarthi to use voice.");
        AccessibilityInfo.announceForAccessibility(
          "Offline wake setup failed. Tap Talk to Saarthi to use voice."
        );
        void speechService.speak(
          "Hey Saarthi setup failed. Tap Talk to Saarthi to use voice commands.",
          { force: true }
        );
        console.warn("[WakeWord] Setup failed:", error);
      } finally {
        modelPreparationPromise = null;
      }

      return cleanupListeners;
    };

    let removeNativeListeners: (() => void) | undefined;
    void initializeWakeWord().then((cleanup) => {
      if (cancelled) cleanup?.();
      else removeNativeListeners = cleanup;
    });
    return () => {
      cancelled = true;
      if (startWakeWordRef.current === startDetector) {
        startWakeWordRef.current = async () => undefined;
        stopWakeWordRef.current = async () => undefined;
      }
      removeNativeListeners?.();
      void stopDetector().finally(() => {
        if (detectorInitialized) void disposeWakeWordDetector();
      });
    };
  }, [appState, currentScreen, isOnboardingResolved, isVoiceModeActive]);

  // Play spoken welcome and show dismissible banner on first launch
  useEffect(() => {
    (async () => {
      try {
        const played = await AsyncStorage.getItem(ONBOARDING_KEY);
        if (!played) {
          setShowOnboarding(true);
          await speechService.speak(HOME_VOICE_GUIDANCE, { force: true });
          await AsyncStorage.setItem(ONBOARDING_KEY, "true");
        }
      } catch {
        // Safe ignore
      } finally {
        setIsOnboardingResolved(true);
      }
    })();
  }, []);

  const handleDismissOnboarding = useCallback(async () => {
    setShowOnboarding(false);
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, "true");
    } catch {
      // Safe ignore
    }
  }, []);

  const handleNavigate = useCallback(
    (screen: AppScreen, params?: any) => {
      if (params?.mode) {
        setReaderMode(params.mode);
      }
      if (params?.destinationQuery) {
        setNavDestinationQuery(params.destinationQuery);
      }
      if (screen !== currentScreen) {
        setScreenHistory((prev) => {
          if (prev.length > 0 && prev[prev.length - 1] === currentScreen) {
            return prev;
          }
          return [...prev, currentScreen];
        });
        setCurrentScreen(screen);
      }
    },
    [currentScreen]
  );

  const handleGoBack = useCallback((): AppScreen | null => {
    if (screenHistory.length > 0) {
      const prevScreen = screenHistory[screenHistory.length - 1];
      setScreenHistory((prev) => prev.slice(0, -1));
      setCurrentScreen(prevScreen);
      return prevScreen;
    } else {
      if (currentScreen !== "home") {
        setCurrentScreen("home");
        return "home";
      }
      return null;
    }
  }, [screenHistory, currentScreen]);

  const handleReadingComplete = (
    result: ReadingPipelineResult,
    mode: ReadingMode,
    imageUri?: string
  ) => {
    setCurrentReadingResult(result);
    setReaderMode(mode);
    setCurrentImageUri(imageUri);
    setScreenHistory((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === currentScreen) {
        return prev;
      }
      return [...prev, currentScreen];
    });
    setCurrentScreen("results");
  };

  const handleSetLocationFromSign = (locationName: string): LocalizationResult => {
    const result = campusLocalizer.localizeFromOcr(locationName);
    if (result.isLocalized && result.node) {
      setCurrentStartNodeId(result.node.id);
    }
    // Return result so caller can announce status or handle unmapped room safely
    return result;
  };

  const handleReplayOnboarding = async () => {
    setShowOnboarding(true);
    await speechService.speak(HOME_VOICE_GUIDANCE, { force: true });
  };

  const handleCancelRoute = () => {
    setActiveRoute(null);
  };

  const handleRepeatRouteStep = async () => {
    if (activeRoute) {
      const stepIndex = activeRoute.currentStepIndex || 0;
      const step = activeRoute.steps[stepIndex];
      if (step) {
        await speechService.speak(step.spokenInstruction, { force: true });
      }
    }
  };

  const handleToggleVoiceMode = useCallback(async () => {
    if (currentScreen === "home" && !isVoiceModeActive) {
      // The native keyword spotter must release the mic before ASR requests it.
      await stopWakeWordRef.current();
      voiceRecognitionService.cancelListening();
      const enabled = await globalVoiceService.enableVoiceMode();
      if (!enabled) await startWakeWordRef.current();
      return;
    }
    await globalVoiceService.toggleVoiceMode();
  }, [currentScreen, isVoiceModeActive]);

  // Connect globalVoiceService with current navigation context
  const scanTriggerRef = useRef<(() => Promise<void>) | null>(null);
  const resultsVoiceActionsRef = useRef<{
    onReadFullText: () => Promise<void>;
    onSummarize: () => Promise<void>;
    onScanAgain: () => void;
  } | null>(null);
  const navigationVoiceActionsRef = useRef<CampusNavigationVoiceActions | null>(null);

  useEffect(() => {
    globalVoiceService.setDispatchContextProvider(() => ({
      currentScreen,
      screenHistory,
      hasReadingResult: Boolean(currentReadingResult),
      currentReadingResult,
      onNavigateToScreen: (screen: AppScreen) => handleNavigate(screen),
      onNavigateBack: () => handleGoBack(),
      onNavigateToReader: (mode) => {
        setReaderMode(mode || "auto");
        handleNavigate("reader");
      },
      onNavigateToAssist: () => {
        handleNavigate("assist");
      },
      onNavigateToNavigation: (dest) => {
        setNavDestinationQuery(dest || "");
        handleNavigate("navigation");
      },
      onNavigateToTimetable: () => handleNavigate("timetable"),
      onTriggerScan: async () => {
        if (scanTriggerRef.current) {
          await scanTriggerRef.current();
        }
      },
      onReadFullText: async () => {
        if (resultsVoiceActionsRef.current) {
          await resultsVoiceActionsRef.current.onReadFullText();
        }
      },
      onSummarizeResult: async () => {
        if (resultsVoiceActionsRef.current) {
          await resultsVoiceActionsRef.current.onSummarize();
        }
      },
      onScanAgain: () => {
        if (resultsVoiceActionsRef.current) {
          resultsVoiceActionsRef.current.onScanAgain();
        } else {
          handleNavigate("reader");
        }
      },
      onStopListening: () => {
        globalVoiceService.pauseListening(false);
      },
      onResumeListening: () => {
        globalVoiceService.resumeListening(false);
      },
      onExitVoiceMode: () => {
        globalVoiceService.disableVoiceMode(false);
      },
      // In-Map Voice Navigation Actions
      onMapSearchDestination: async (dest: string) => {
        if (navigationVoiceActionsRef.current) {
          await navigationVoiceActionsRef.current.onSearchDestination(dest);
        }
      },
      onMapSearchNearby: async (category: string) => {
        if (navigationVoiceActionsRef.current) {
          await navigationVoiceActionsRef.current.onSearchNearby(category);
        }
      },
      onMapStopNavigation: async () => {
        if (navigationVoiceActionsRef.current) {
          await navigationVoiceActionsRef.current.onStopNavigation();
        }
      },
      onMapRepeatInstruction: async () => {
        if (navigationVoiceActionsRef.current) {
          await navigationVoiceActionsRef.current.onRepeatInstruction();
        }
      },
      onMapRecenter: async () => {
        if (navigationVoiceActionsRef.current) {
          await navigationVoiceActionsRef.current.onRecenter();
        }
      },
      onMapWhereAmI: async () => {
        if (navigationVoiceActionsRef.current) {
          await navigationVoiceActionsRef.current.onWhereAmI();
        }
      },
      onMapGetStatus: async () => {
        if (navigationVoiceActionsRef.current) {
          await navigationVoiceActionsRef.current.onGetStatus();
        }
      },
    }));
  }, [
    currentScreen,
    screenHistory,
    currentReadingResult,
    handleNavigate,
    handleGoBack,
  ]);


  return (
    <View style={styles.appContainer}>
      <StatusBar style="dark" />

      {currentScreen === "home" && (
        <HomeScreen
          onNavigate={handleNavigate}
          activeRoute={activeRoute}
          onCancelRoute={handleCancelRoute}
          onRepeatRouteStep={handleRepeatRouteStep}
          isVoiceModeActive={isVoiceModeActive}
          wakeWordStatus={wakeWordStatus}
          onToggleVoiceMode={handleToggleVoiceMode}
          showOnboarding={showOnboarding}
          onDismissOnboarding={handleDismissOnboarding}
        />
      )}

      {currentScreen === "reader" && (
        <CampusReaderScreen
          initialMode={readerMode}
          onNavigateBack={handleGoBack}
          onReadingComplete={handleReadingComplete}
          permissionResponse={cameraPermission}
          onRequestPermission={requestCameraPermission}
          onRegisterScanTrigger={(trigger) => {
            scanTriggerRef.current = trigger;
          }}
          onOpenLiveAssist={() => handleNavigate("assist")}
        />
      )}

      {currentScreen === "results" && currentReadingResult && (
        <ReadingResultsScreen
          result={currentReadingResult}
          mode={readerMode}
          imageUri={currentImageUri}
          onNavigateHome={() => handleNavigate("home")}
          onScanAnother={() => handleNavigate("reader")}
          onSetLocation={handleSetLocationFromSign}
          onViewTimetable={() => handleNavigate("timetable")}
          onRegisterResultsActions={(actions) => {
            resultsVoiceActionsRef.current = actions;
          }}
        />
      )}

      {currentScreen === "timetable" && (
        <TimetableScreen
          onNavigateBack={handleGoBack}
          onScanTimetable={() => {
            setReaderMode("timetable");
            handleNavigate("reader");
          }}
        />
      )}

      {currentScreen === "navigation" && (
        <CampusNavigationScreen
          initialStartNodeId={currentStartNodeId}
          initialDestinationQuery={navDestinationQuery}
          onNavigateBack={handleGoBack}
          onActiveRouteChanged={setActiveRoute}
          onOpenLiveAssist={() => handleNavigate("assist")}
          onRegisterNavigationActions={(actions) => {
            navigationVoiceActionsRef.current = actions;
          }}
        />
      )}


      {currentScreen === "assist" && (
        <CameraAssistScreen
          onNavigateBack={handleGoBack}
          permissionResponse={cameraPermission}
          onRequestPermission={requestCameraPermission}
        />
      )}

      {currentScreen === "voice" && (
        <VoiceAssistantScreen
          currentScreen={currentScreen}
          screenHistory={screenHistory}
          hasReadingResult={!!currentReadingResult}
          onNavigateToScreen={(screen) => handleNavigate(screen)}
          onNavigateBack={handleGoBack}
          onNavigateToReader={(mode) => {
            setReaderMode(mode || "auto");
            handleNavigate("reader");
          }}
          onNavigateToNavigation={(dest) => {
            setNavDestinationQuery(dest || "");
            handleNavigate("navigation");
          }}
          onNavigateToTimetable={() => handleNavigate("timetable")}
        />
      )}

      {currentScreen === "settings" && (
        <SettingsScreen
          onNavigateBack={handleGoBack}
          onReplayOnboarding={handleReplayOnboarding}
        />
      )}

      {/* Global Voice Mode Accessible Floating Capsule across all screens */}
      <GlobalVoiceControl currentScreen={currentScreen} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider style={styles.rootProvider}>
      <SaarthiApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  rootProvider: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  appContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
