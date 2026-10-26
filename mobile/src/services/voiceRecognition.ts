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

  /**
   * Start listening for the user's spoken question.
   * Uses monotonic session IDs to filter stale 'end' or 'error' events from previous sessions.
   */
  public async startListening(callbacks: SpeechRecognitionCallbacks): Promise<void> {
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
      this.isListening = true;
      console.log(`[SAARTHI Voice Recognition] Starting session #${sessionId}...`);

      const unsubResult = this.module.addListener?.("result", (event: any) => {
        if (this.currentSessionId !== sessionId) return;
        if (event?.results && event.results.length > 0) {
          const best = event.results[0];
          console.log(
            `[SAARTHI Voice Recognition] Session #${sessionId} native 'result' (isFinal=${event.isFinal}, chars=${best?.transcript?.length || 0})`
          );
          callbacks.onResult?.({
            transcript: best?.transcript || "",
            isFinal: event.isFinal === true,
          });
        }
      });

      const unsubError = this.module.addListener?.("error", (event: any) => {
        if (this.currentSessionId !== sessionId) return;
        // Ignore "aborted" error fired when intentionally aborting/cancelling
        if (event?.error === "aborted") return;
        console.warn(`[SAARTHI Voice Recognition] Session #${sessionId} native 'error':`, event);
        this.isListening = false;
        callbacks.onError?.(
          event?.message || event?.error || "Speech recognition encountered an error."
        );
      });

      const unsubEnd = this.module.addListener?.("end", () => {
        if (this.currentSessionId !== sessionId) return;
        console.log(`[SAARTHI Voice Recognition] Session #${sessionId} native 'end' received.`);
        this.isListening = false;
        callbacks.onEnd?.();
      });

      const unsubStart = this.module.addListener?.("start", () => {
        if (this.currentSessionId !== sessionId) return;
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
        lang: "en-US",
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
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
