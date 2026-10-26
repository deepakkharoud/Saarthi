import { AppState, AppStateStatus, AccessibilityInfo } from "react-native";
import { speechService } from "./speech";
import { voiceRecognitionService } from "./voiceRecognition";
import {
  parseVoiceCommand,
  ParsedVoiceCommand,
} from "./voiceCommands";
import {
  dispatchVoiceCommand,
  VoiceCommandDispatchContext,
} from "./voiceDispatcher";

export interface GlobalVoiceState {
  isActive: boolean;
  isPaused: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  statusMessage: string;
  lastTranscript: string;
  lastCommand: ParsedVoiceCommand | null;
  error: string | null;
}

export type GlobalVoiceListener = (state: GlobalVoiceState) => void;

/**
 * Service managing Global Voice Mode across SAARTHI Campus Mode.
 *
 * Implements:
 * 1. Global activation/deactivation across all screens.
 * 2. Strict TTS/speech-recognition coordination to prevent echo loops.
 * 3. Graceful handling of permissions, errors, silence, and backgrounding.
 * 4. "stop listening", "resume listening", and "exit voice mode" commands.
 * 5. Safe restart without infinite loops or duplicate listeners.
 */
export class GlobalVoiceService {
  private isActive: boolean = false;
  private isPaused: boolean = false;
  private isListening: boolean = false;
  private isSpeaking: boolean = false;
  private statusMessage: string = "Voice mode is off.";
  private lastTranscript: string = "";
  private lastCommand: ParsedVoiceCommand | null = null;
  private error: string | null = null;

  private listeners: Set<GlobalVoiceListener> = new Set();
  private dispatchContextProvider: (() => VoiceCommandDispatchContext) | null = null;

  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private ttsPollInterval: ReturnType<typeof setInterval> | null = null;
  private consecutiveErrors: number = 0;
  private ttsCheckAttempts: number = 0;
  private isHandlingCommand: boolean = false;
  private appStateSubscription: any = null;

  constructor() {
    this.initAppState();
  }

  private initAppState(): void {
    try {
      if (AppState && typeof AppState.addEventListener === "function") {
        this.appStateSubscription = AppState.addEventListener(
          "change",
          this.handleAppStateChange.bind(this)
        );
      }
    } catch {
      // Safe fallback
    }
  }

  public setDispatchContextProvider(provider: () => VoiceCommandDispatchContext): void {
    this.dispatchContextProvider = provider;
  }

  public getState(): GlobalVoiceState {
    return {
      isActive: this.isActive,
      isPaused: this.isPaused,
      isListening: this.isListening,
      isSpeaking: this.isSpeaking || speechService.isSpeaking(),
      statusMessage: this.statusMessage,
      lastTranscript: this.lastTranscript,
      lastCommand: this.lastCommand,
      error: this.error,
    };
  }

  public subscribe(listener: GlobalVoiceListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (err) {
        console.warn("[GlobalVoiceService] Listener error:", err);
      }
    });
  }

  /**
   * Activates global voice mode with spoken greeting and microphone listening.
   */
  public async enableVoiceMode(customWelcome?: string): Promise<boolean> {
    if (this.isActive && !this.isPaused) {
      return true;
    }

    if (this.isActive && this.isPaused) {
      await this.resumeListening(true);
      return true;
    }

    // 1. Check availability
    const avail = voiceRecognitionService.checkAvailability();
    if (!avail.available) {
      const msg =
        avail.reason ||
        "Speech recognition requires a native Android build. In Expo Go, use the on-screen buttons.";
      this.error = msg;
      this.statusMessage = msg;
      this.notify();
      await speechService.speak(msg, { force: true });
      return false;
    }

    // 2. Request permissions
    const granted = await voiceRecognitionService.requestPermissions();
    if (!granted) {
      const msg =
        "Microphone or speech recognition permission was denied. Please allow microphone access in Settings to use voice navigation.";
      this.error = msg;
      this.statusMessage = msg;
      this.isActive = false;
      this.isListening = false;
      this.notify();
      await speechService.speak(msg, { force: true });
      return false;
    }

    // 3. Set active state
    this.isActive = true;
    this.isPaused = false;
    this.isListening = false;
    this.isSpeaking = true;
    this.consecutiveErrors = 0;
    this.error = null;
    const welcome =
      customWelcome ||
      "Voice mode is on. You can say open reader, open timetable, open navigation, or ask for help.";
    this.statusMessage = welcome;
    this.notify();
    console.log("[SAARTHI Voice State] Activated: isActive=true, isPaused=false, isListening=false. Speaking welcome...");

    // 4. Speak confirmation and begin recognition AFTER confirmation finishes
    let started = false;
    const triggerStart = () => {
      if (!started) {
        started = true;
        this.isSpeaking = false;
        this.notify();
        console.log("[SAARTHI Voice State] Welcome speech completed or timed out, scheduling listening start");
        this.scheduleStartListening(300);
      }
    };

    // Safety fallback timer: welcome utterance is ~92 chars (~5.5s). At 7s, start listening anyway if onDone didn't fire
    const fallbackTimer = setTimeout(triggerStart, 7000);

    await speechService.speak(welcome, {
      force: true,
      onDone: () => {
        clearTimeout(fallbackTimer);
        triggerStart();
      },
      onError: () => {
        clearTimeout(fallbackTimer);
        triggerStart();
      },
    });

    return true;
  }

  /**
   * Disables voice mode completely and stops the microphone.
   */
  public async disableVoiceMode(speakConfirmation: boolean = true): Promise<void> {
    console.log("[SAARTHI Voice State] disableVoiceMode() - turning off voice mode");
    this.clearTimers();
    this.isActive = false;
    this.isPaused = false;
    this.isListening = false;
    this.isSpeaking = speakConfirmation;
    this.statusMessage = "Voice mode is off.";
    this.error = null;
    this.consecutiveErrors = 0;
    this.ttsCheckAttempts = 0;

    voiceRecognitionService.cancelListening();
    this.notify();

    if (speakConfirmation) {
      try {
        await speechService.speak("Voice mode is off.", {
          force: true,
          onDone: () => {
            this.isSpeaking = false;
            this.notify();
          },
          onError: () => {
            this.isSpeaking = false;
            this.notify();
          },
        });
      } catch {
        this.isSpeaking = false;
        this.notify();
      }
    }
  }

  /**
   * Toggles voice mode on or off.
   */
  public async toggleVoiceMode(): Promise<boolean> {
    if (this.isActive) {
      await this.disableVoiceMode(true);
      return false;
    } else {
      return await this.enableVoiceMode();
    }
  }

  /**
   * Pauses microphone listening while keeping voice mode active.
   * Crucially, after confirmation finishes, remains paused and never auto-restarts listening.
   */
  public async pauseListening(speakConfirmation: boolean = true): Promise<void> {
    if (!this.isActive) return;

    console.log("[SAARTHI Voice State] pauseListening() - isActive=true, isPaused=true, isListening=false");
    this.clearTimers();
    this.isPaused = true;
    this.isListening = false;
    this.isSpeaking = speakConfirmation;
    this.statusMessage = "Listening paused.";
    this.ttsCheckAttempts = 0;
    this.notify();

    voiceRecognitionService.cancelListening();

    if (speakConfirmation) {
      try {
        await speechService.speak(
          "Listening paused. Tap the voice button to resume.",
          {
            force: true,
            onDone: () => {
              this.isSpeaking = false;
              this.notify();
            },
            onError: () => {
              this.isSpeaking = false;
              this.notify();
            },
          }
        );
      } catch {
        this.isSpeaking = false;
        this.notify();
      }
    }
  }

  /**
   * Resumes microphone listening from paused state.
   * Safe when already listening (no-op).
   * Speaks short confirmation, then starts recognition and announces listening once native onStart is confirmed.
   */
  public async resumeListening(speakConfirmation: boolean = true): Promise<void> {
    if (!this.isActive) {
      await this.enableVoiceMode();
      return;
    }

    // Safe resume when already active and listening
    if (!this.isPaused && this.isListening) {
      console.log("[SAARTHI Voice State] Already listening, resume is safe no-op.");
      return;
    }

    console.log("[SAARTHI Voice State] resumeListening() - starting resume sequence");
    this.clearTimers();
    this.isPaused = false;
    this.isListening = false;
    this.consecutiveErrors = 0;
    this.error = null;

    if (speakConfirmation) {
      this.isSpeaking = true;
      this.statusMessage = "Resuming voice control...";
      this.notify();

      let started = false;
      const triggerStart = () => {
        if (!started) {
          started = true;
          this.isSpeaking = false;
          this.notify();
          if (this.isActive && !this.isPaused) {
            this.scheduleStartListening(150);
          }
        }
      };

      const fallbackTimer = setTimeout(triggerStart, 2500);

      try {
        await speechService.speak("Resuming voice control.", {
          force: true,
          onDone: () => {
            clearTimeout(fallbackTimer);
            triggerStart();
          },
          onError: () => {
            clearTimeout(fallbackTimer);
            triggerStart();
          },
        });
      } catch {
        clearTimeout(fallbackTimer);
        triggerStart();
      }
    } else {
      this.isSpeaking = false;
      this.statusMessage = "Resuming voice control...";
      this.notify();
      this.scheduleStartListening(150);
    }
  }

  /**
   * Safely schedules starting speech recognition with a delay and TTS guard.
   * Bounds TTS checks to prevent infinite deferral if TTS state is stuck.
   */
  public scheduleStartListening(delayMs: number = 250): void {
    this.clearTimers();

    if (!this.isActive || this.isPaused) {
      return;
    }

    console.log(`[SAARTHI Voice State] scheduleStartListening(delayMs=${delayMs})`);
    this.startTimer = setTimeout(async () => {
      if (!this.isActive || this.isPaused) {
        return;
      }

      // Check if text-to-speech is actively talking
      let isSpeaking = false;
      try {
        isSpeaking = await speechService.isSpeakingAsync();
      } catch {
        isSpeaking = speechService.isSpeaking();
      }

      if (isSpeaking) {
        this.ttsCheckAttempts++;
        if (this.ttsCheckAttempts <= 4) {
          console.log("[SAARTHI Voice State] TTS is actively speaking, delaying listening restart...");
          this.scheduleStartListening(250);
          return;
        } else {
          console.warn("[SAARTHI Voice State] TTS check limit reached, proceeding to start listening.");
        }
      }

      this.ttsCheckAttempts = 0;
      await this.startRecognitionSession();
    }, delayMs);
  }

  private async startRecognitionSession(): Promise<void> {
    if (!this.isActive || this.isPaused || this.isListening) {
      console.log(
        `[SAARTHI Voice State] startRecognitionSession skipped: isActive=${this.isActive}, isPaused=${this.isPaused}, isListening=${this.isListening}`
      );
      return;
    }

    try {
      console.log("[SAARTHI Voice State] startRecognitionSession() - initiating startListening");
      this.error = null;

      await voiceRecognitionService.startListening({
        onStart: () => {
          console.log("[SAARTHI Voice State] onStart received, isListening=true confirmed");
          this.isListening = true;
          this.isSpeaking = false;
          this.error = null;
          this.statusMessage = "Listening resumed.";
          this.notify();
          try {
            AccessibilityInfo.announceForAccessibility("Listening resumed.");
          } catch {
            // Safe fallback
          }
        },
        onResult: (res) => {
          this.lastTranscript = res.transcript;
          this.notify();

          if (res.isFinal && res.transcript.trim()) {
            console.log(
              `[SAARTHI Voice State] Final transcript received: "${res.transcript}". Stopping recognition before dispatch.`
            );
            this.isListening = false;
            voiceRecognitionService.stopListening();
            this.notify();
            this.handleFinalTranscript(res.transcript);
          }
        },
        onError: (err) => {
          console.warn("[SAARTHI Voice State] Recognition error:", err);
          this.isListening = false;
          this.consecutiveErrors += 1;

          const isFatal =
            this.consecutiveErrors >= 3 ||
            (typeof err === "string" &&
              (err.includes("permission") || err.includes("unavailable")));

          if (isFatal) {
            this.isPaused = true;
            this.error = err || "Voice recognition error";
            this.statusMessage = "Voice recognition paused.";
            this.notify();
            speechService.speak(
              "Voice recognition paused. Tap the voice button when you are ready to speak.",
              { force: true }
            );
          } else if (this.isActive && !this.isPaused) {
            this.scheduleStartListening(600);
          }
        },
        onEnd: () => {
          console.log("[SAARTHI Voice State] onEnd received, isListening=false");
          this.isListening = false;
          this.notify();

          // If session ended cleanly without a final transcript and still active, restart safely
          if (
            this.isActive &&
            !this.isPaused &&
            !this.isHandlingCommand &&
            !speechService.isSpeaking()
          ) {
            this.scheduleStartListening(400);
          }
        },
      });
    } catch (err: any) {
      console.warn("[SAARTHI Voice State] Failed to start recognition:", err);
      this.isListening = false;
      this.isPaused = true; // Recoverable state allowing user to retry by tapping the control!
      this.error = err?.message || "Failed to start speech recognition";
      this.statusMessage = "Voice recognition error. Tap to retry.";
      this.notify();
    }
  }

  private async handleFinalTranscript(rawTranscript: string): Promise<void> {
    const transcript = rawTranscript.trim();
    if (!transcript) return;

    this.isHandlingCommand = true;
    this.isListening = false;
    this.isSpeaking = true;
    this.consecutiveErrors = 0;
    const parsed = parseVoiceCommand(transcript);
    this.lastCommand = parsed;
    console.log(`[SAARTHI Voice State] Handling command: "${transcript}" -> intent: "${parsed.intent}"`);

    // Handle voice mode meta-commands immediately
    if (parsed.intent === "exit_voice_mode") {
      this.isHandlingCommand = false;
      this.isSpeaking = false;
      await this.disableVoiceMode(true);
      return;
    }

    if (parsed.intent === "stop_listening") {
      this.isHandlingCommand = false;
      this.isSpeaking = false;
      await this.pauseListening(true);
      return;
    }

    if (parsed.intent === "resume_listening") {
      this.isHandlingCommand = false;
      this.isSpeaking = false;
      await this.resumeListening(true);
      return;
    }

    // Stop recognition during command execution and speech
    voiceRecognitionService.stopListening();
    this.statusMessage = "Processing command...";
    this.notify();

    const context: VoiceCommandDispatchContext = this.dispatchContextProvider
      ? this.dispatchContextProvider()
      : { currentScreen: "home" };

    try {
      console.log(`[SAARTHI Voice State] Dispatching command on screen "${context.currentScreen}"...`);
      const resultMsg = await dispatchVoiceCommand(parsed, context);
      console.log(`[SAARTHI Voice State] Dispatch succeeded, result: "${resultMsg}"`);
      this.statusMessage = resultMsg;
      this.notify();

      // Wait for TTS audio to complete before resuming listening
      await speechService.waitForPlaybackCompletion(5000);
    } catch (err: any) {
      console.warn("[SAARTHI Voice State] Dispatch error:", err);
      this.statusMessage = "Command execution error.";
      this.notify();
    } finally {
      this.isHandlingCommand = false;
      this.isSpeaking = false;
      this.notify();

      // Automatically restart recognition ONLY if still active, not paused, and app is active
      if (this.isActive && !this.isPaused && AppState.currentState === "active") {
        console.log("[SAARTHI Voice State] TTS complete, resuming listening");
        this.scheduleStartListening(200);
      } else {
        console.log(
          `[SAARTHI Voice State] Skipping listening restart: isActive=${this.isActive}, isPaused=${this.isPaused}, appState=${AppState.currentState}`
        );
      }
    }
  }

  private handleAppStateChange(nextAppState: AppStateStatus): void {
    if (nextAppState === "background" || nextAppState === "inactive") {
      this.clearTimers();
      voiceRecognitionService.stopListening();
      this.isListening = false;
      this.notify();
    } else if (nextAppState === "active") {
      if (this.isActive && !this.isPaused) {
        this.scheduleStartListening(500);
      }
    }
  }

  private clearTimers(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.ttsPollInterval) {
      clearInterval(this.ttsPollInterval);
      this.ttsPollInterval = null;
    }
  }

  public destroy(): void {
    this.clearTimers();
    if (this.appStateSubscription?.remove) {
      this.appStateSubscription.remove();
    }
    voiceRecognitionService.stopListening();
    this.listeners.clear();
  }
}

export const globalVoiceService = new GlobalVoiceService();
