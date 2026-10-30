import { NativeModules, Platform } from "react-native";

export interface SpeechRecognitionResult {
  transcript: string;
  isFinal: boolean;
}

export interface SpeechRecognitionCallbacks {
  onStart?: () => void;
  onResult?: (result: SpeechRecognitionResult) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export interface SpeechRecognitionStartOptions {
  contextualStrings?: string[];
  /** Keep continuous sessions open after delivering a complete transcript. */
  keepListeningAfterFinal?: boolean;
  requiresOnDeviceRecognition?: boolean;
  androidRecognitionServicePackage?: string;
  languageTag?: string;
}

function hasNativeModule(name: string): boolean {
  try {
    const g = globalThis as any;
    if (g?.expo?.modules?.[name]) return true;
    if (g?.nativeModuleProxy?.[name]) return true;
    if (g?.__turboModuleProxy && g.__turboModuleProxy(name)) return true;
    if (NativeModules && NativeModules[name]) return true;
  } catch {
    // Safe ignore
  }
  return false;
}

function getSpeechRecognitionModule(): any {
  // 1. Try requireOptionalNativeModule from expo (standard Expo SDK 50+)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireOptionalNativeModule } = require("expo");
    if (typeof requireOptionalNativeModule === "function") {
      const nativeMod = requireOptionalNativeModule("ExpoSpeechRecognition");
      if (!nativeMod) {
        return null;
      }
    }
  } catch {
    // Continue
  }

  // 2. Safe check against global / TurboModule / NativeModules
  if (!hasNativeModule("ExpoSpeechRecognition")) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const speechModule = require("expo-speech-recognition");
      if (speechModule?.ExpoSpeechRecognitionModule) {
        return speechModule.ExpoSpeechRecognitionModule;
      }
    } catch {
      return null;
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const speechModule = require("expo-speech-recognition");
    return speechModule?.ExpoSpeechRecognitionModule || null;
  } catch {
    return null;
  }
}

/**
 * Service managing native speech recognition via expo-speech-recognition.
 *
 * NOTE ON EXPO GO COMPATIBILITY:
 * Expo Go does not bundle third-party native modules. In Expo Go, native modules
 * are not present in the runtime. This service safely detects that condition, prevents crashes,
 * and returns clear diagnostic information explaining that an Expo development build is required for voice input.
 */
class VoiceRecognitionService {
  private isAvailable: boolean = false;
  private availabilityChecked: boolean = false;
  private unavailableReason: string = "";
  private module: any = null;
  private activeSubscription: (() => void) | null = null;
  private isListening: boolean = false;
  private currentSessionId: number = 0;
  private finalTranscriptTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFinalTranscript: string = "";

  constructor() {
    this.init();
  }

  private init(): void {
    if (this.availabilityChecked) return;

    try {
      const nativeModule = getSpeechRecognitionModule();
      if (!nativeModule) {
        this.isAvailable = false;
        this.unavailableReason =
          "Speech recognition requires an Expo development build. In standard Expo Go, native voice input is not available.";
        this.availabilityChecked = true;
        return;
      }

      this.module = nativeModule;
      if (typeof this.module.isRecognitionAvailable === "function") {
        const available = Boolean(this.module.isRecognitionAvailable());
        this.isAvailable = available;
        if (!available) {
          this.unavailableReason =
            "Speech recognition is not available or not enabled on this device.";
        }
      } else {
        this.isAvailable = true;
      }
    } catch (err: any) {
      console.log(
        "[SAARTHI Voice] Native speech recognition module unavailable in current environment:",
        err?.message || err
      );
      this.isAvailable = false;
      this.unavailableReason =
        "Speech recognition requires an Expo development build. In standard Expo Go, native voice input is not available.";
    }

    this.availabilityChecked = true;
  }

  /**
   * Check whether speech recognition is available on the current device and build.
   */
  public checkAvailability(): { available: boolean; reason?: string } {
    if (!this.availabilityChecked) {
      this.init();
    }
    return {
      available: this.isAvailable,
      reason: this.isAvailable ? undefined : this.unavailableReason,
    };
  }

  /**
   * Check whether microphone and speech recognition permissions have already been granted.
   */
  public async getPermissions(): Promise<boolean> {
    if (!this.isAvailable || !this.module) {
      return false;
    }
    try {
      if (typeof this.module.getPermissionsAsync === "function") {
        const res = await this.module.getPermissionsAsync();
        return res?.granted === true || res?.status === "granted";
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Request microphone and speech recognition permissions.
   */
  public async requestPermissions(): Promise<boolean> {
    if (!this.isAvailable || !this.module) {
      return false;
    }
    try {
      if (typeof this.module.requestPermissionsAsync === "function") {
        const res = await this.module.requestPermissionsAsync();
        return res?.granted === true || res?.status === "granted";
      }
      return true;
    } catch (err) {
      console.warn("[SAARTHI Voice] Permission request error:", err);
      return false;
    }
  }

  /** Check whether Android has an installed offline model for the requested language. */
  public async getInstalledOnDeviceLocale(languageTag: string): Promise<string | null> {
    if (Platform.OS !== "android" || typeof this.module?.getSupportedLocales !== "function") {
      return null;
    }
    try {
      const result = await this.module.getSupportedLocales({
        androidRecognitionServicePackage: "com.google.android.as",
      });
      const installedLocales: string[] = result?.installedLocales || [];
      const normalizeLocale = (locale: string) => locale.replace(/_/g, "-").toLocaleLowerCase();
      const normalizedRequest = normalizeLocale(languageTag);
      const exactMatch = installedLocales.find(
        (locale) => normalizeLocale(locale) === normalizedRequest
      );
      if (exactMatch) return exactMatch;

      // Prefer the installed English variant (for example en-IN) over requesting
      // en-US when only a regional English model is present on the device.
      const requestedLanguage = normalizedRequest.split("-")[0];
      return (
        installedLocales.find(
          (locale) => normalizeLocale(locale).split("-")[0] === requestedLanguage
        ) || null
      );
    } catch (error) {
      console.warn("[SAARTHI Voice] Could not inspect offline speech models:", error);
      return null;
    }
  }

  /**
   * Start listening for the user's spoken question.
   * Uses monotonic session IDs to filter stale 'end' or 'error' events from previous sessions.
   */
  public async startListening(
    callbacks: SpeechRecognitionCallbacks,
    options: SpeechRecognitionStartOptions = {}
  ): Promise<void> {
    const status = this.checkAvailability();
    if (!status.available || !this.module) {
      const reason =
        status.reason ||
        "Speech recognition is unavailable. An Expo development build is required.";
      callbacks.onError?.(reason);
      return;
    }

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      callbacks.onError?.(
        "Microphone or speech recognition permission was denied. Please allow access in Settings."
      );
      return;
    }

    try {
      // Clean up previous listeners and assign a new session ID to invalidate pending async events
      this.cancelListening();
      const sessionId = ++this.currentSessionId;
      let hasStarted = false;
      this.pendingFinalTranscript = "";
      this.isListening = true;
      console.log(`[SAARTHI Voice Recognition] Starting session #${sessionId}...`);

      const unsubResult = this.module.addListener?.("result", (event: any) => {
        if (this.currentSessionId !== sessionId) return;
        if (event?.results && event.results.length > 0) {
          const best = event.results[0];
          console.log(
            `[SAARTHI Voice Recognition] Session #${sessionId} native 'result' (isFinal=${event.isFinal}, chars=${best?.transcript?.length || 0})`
          );
          const transcript = (best?.transcript || "").trim();
          if (event.isFinal === true && transcript) {
            const previous = this.pendingFinalTranscript.trim();
            const normalizedPrevious = previous.toLocaleLowerCase();
            const normalizedIncoming = transcript.toLocaleLowerCase();
            if (!previous || normalizedIncoming.startsWith(normalizedPrevious)) {
              this.pendingFinalTranscript = transcript;
            } else if (!normalizedPrevious.endsWith(normalizedIncoming)) {
              this.pendingFinalTranscript = `${previous} ${transcript}`.trim();
            }

            // Let a slower speaker continue after a brief pause. Continuous
            // recognition can emit a final segment before the full command is done.
            callbacks.onResult?.({ transcript: this.pendingFinalTranscript, isFinal: false });
            if (this.finalTranscriptTimer) clearTimeout(this.finalTranscriptTimer);
            this.finalTranscriptTimer = setTimeout(() => {
              if (this.currentSessionId !== sessionId) return;
              const completedTranscript = this.pendingFinalTranscript.trim();
              this.finalTranscriptTimer = null;
              this.pendingFinalTranscript = "";
              if (!completedTranscript) return;
              if (!options.keepListeningAfterFinal) this.stopListening();
              callbacks.onResult?.({ transcript: completedTranscript, isFinal: true });
            }, 2200);
          } else {
            callbacks.onResult?.({ transcript, isFinal: false });
          }
        }
      });

      const unsubError = this.module.addListener?.("error", (event: any) => {
        if (this.currentSessionId !== sessionId) return;
        // Ignore "aborted" error fired when intentionally aborting/cancelling
        if (event?.error === "aborted") return;
        console.warn(`[SAARTHI Voice Recognition] Session #${sessionId} native 'error':`, event);
        if (this.pendingFinalTranscript.trim()) {
          if (this.finalTranscriptTimer) clearTimeout(this.finalTranscriptTimer);
          this.finalTranscriptTimer = null;
          const completedTranscript = this.pendingFinalTranscript.trim();
          this.pendingFinalTranscript = "";
          this.stopListening();
          callbacks.onResult?.({ transcript: completedTranscript, isFinal: true });
          if (options.keepListeningAfterFinal) callbacks.onEnd?.();
          return;
        }
        this.isListening = false;
        const errorDetails = [event?.error, event?.message]
          .filter((detail): detail is string => typeof detail === "string" && detail.length > 0)
          .join(": ");
        callbacks.onError?.(errorDetails || "Speech recognition encountered an error.");
      });

      const unsubEnd = this.module.addListener?.("end", () => {
        if (this.currentSessionId !== sessionId) return;
        // Some Android recognizers emit an end notification during startup,
        // before their matching start event. Treating that as a real timeout
        // causes the destination prompt to replay before the mic is ready.
        if (!hasStarted) {
          console.log(`[SAARTHI Voice Recognition] Ignoring premature end for session #${sessionId}.`);
          return;
        }
        console.log(`[SAARTHI Voice Recognition] Session #${sessionId} native 'end' received.`);
        this.isListening = false;
        // If speech was recognized, let its short final-result grace period
        // finish before notifying consumers that the session ended.
        if (!this.pendingFinalTranscript.trim()) callbacks.onEnd?.();
      });

      const unsubStart = this.module.addListener?.("start", () => {
        if (this.currentSessionId !== sessionId) return;
        hasStarted = true;
        console.log(`[SAARTHI Voice Recognition] Session #${sessionId} native 'start' confirmed. Listening active.`);
        callbacks.onStart?.();
      });

      this.activeSubscription = () => {
        unsubResult?.remove?.();
        unsubError?.remove?.();
        unsubEnd?.remove?.();
        unsubStart?.remove?.();
      };

      this.module.start({
        lang: options.languageTag || "en-US",
        interimResults: true,
        // Continuous mode is supported on Android 13+ and allows natural
        // pauses without finalizing the whole command immediately.
        continuous: Platform.OS !== "android" || Number(Platform.Version) >= 33,
        requiresOnDeviceRecognition: options.requiresOnDeviceRecognition,
        androidRecognitionServicePackage: options.androidRecognitionServicePackage,
        contextualStrings: options.contextualStrings,
        androidIntentOptions: {
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 20000,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 12000,
          EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 10000,
        },
      });
    } catch (err: any) {
      console.warn(`[SAARTHI Voice Recognition] Session start error:`, err);
      this.isListening = false;
      callbacks.onError?.(
        err?.message || "Failed to start speech recognition. Please try again."
      );
    }
  }

  /**
   * Stop speech recognition and finalize results.
   */
  public stopListening(): void {
    const prev = this.currentSessionId++;
    console.log(`[SAARTHI Voice Recognition] stopListening() - terminating session #${prev}`);
    this.cleanup();
    if (this.module) {
      try {
        this.module.stop?.();
      } catch {
        // Safe ignore
      }
    }
    this.isListening = false;
  }

  /**
   * Abort and cancel speech recognition without returning results.
   */
  public cancelListening(): void {
    const prev = this.currentSessionId++;
    console.log(`[SAARTHI Voice Recognition] cancelListening() - aborting session #${prev}`);
    this.cleanup();
    if (this.module) {
      try {
        this.module.abort?.();
      } catch {
        // Safe ignore
      }
    }
    this.isListening = false;
  }

  public getIsListening(): boolean {
    return this.isListening;
  }

  private cleanup(): void {
    if (this.finalTranscriptTimer) {
      clearTimeout(this.finalTranscriptTimer);
      this.finalTranscriptTimer = null;
    }
    this.pendingFinalTranscript = "";
    if (this.activeSubscription) {
      try {
        this.activeSubscription();
      } catch {
        // Safe ignore
      }
      this.activeSubscription = null;
    }
  }
}

export const voiceRecognitionService = new VoiceRecognitionService();
