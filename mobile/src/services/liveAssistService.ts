/**
 * Saarthi Live Camera Assist Service.
 *
 * Implements:
 * 1. Controlled capture and streaming of camera frames to Gemma 4 vision backend.
 * 2. Strict concurrency gate: AT MOST ONE request in flight.
 * 3. Immediate Stop with in-flight AbortController cancellation and TTS cutoff.
 * 4. Duplicate announcement suppression to prevent repeated identical speech.
 * 5. Honest handling of network failure, unreadable images, and unavailable permissions.
 * 6. Safety rules: Never invent room numbers, distances, or state "path is clear".
 */

import { speechService } from "./speech";
import { hapticsService } from "./haptics";
import { analyzeSceneAssist, SceneAnalysisResponse } from "../api/client";

export interface LiveAssistObservation {
  description: string;
  timestamp: number;
  confidence: number;
  quality: string;
}

export interface LiveAssistState {
  isSamplingActive: boolean;
  isAnalyzing: boolean;
  latestDescription: string;
  latestConfidence: number;
  latestImageQuality: string;
  error: string | null;
  suppressedCount: number;
}

export type LiveAssistStateListener = (state: LiveAssistState) => void;

/**
 * Stop words excluded when computing token similarity for duplicate suppression.
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "is",
  "are", "was", "were", "there", "you", "your", "front", "ahead", "with",
]);

/**
 * Compute Jaccard token similarity between two spoken descriptions.
 */
export function computeDescriptionSimilarity(textA: string, textB: string): number {
  if (!textA || !textB) return 0;
  const tokensA = new Set(
    textA
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  );
  const tokensB = new Set(
    textB
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  );

  if (tokensA.size === 0 || tokensB.size === 0) {
    return textA.trim().toLowerCase() === textB.trim().toLowerCase() ? 1.0 : 0;
  }

  let intersectionSize = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      intersectionSize++;
    }
  }

  const unionSize = new Set([...tokensA, ...tokensB]).size;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

export class LiveAssistService {
  private isSamplingActive: boolean = false;
  private isAnalyzing: boolean = false;
  private latestDescription: string = "";
  private latestConfidence: number = 0;
  private latestImageQuality: string = "adequate";
  private error: string | null = null;
  private suppressedCount: number = 0;

  private activeAbortController: AbortController | null = null;
  private sampleTimer: ReturnType<typeof setTimeout> | null = null;
  private recentObservations: LiveAssistObservation[] = [];
  private listeners: Set<LiveAssistStateListener> = new Set();

  private frameCaptureFn: (() => Promise<{ base64?: string; mimeType?: string } | null>) | null = null;

  // Configuration
  private readonly SAMPLING_INTERVAL_MS = 6000; // 6 seconds between automatic samples
  private readonly DUPLICATE_COOLDOWN_MS = 45000; // Suppress duplicate for 45 seconds
  private readonly SIMILARITY_THRESHOLD = 0.70; // 70% token overlap considered duplicate

  public registerFrameCapture(
    captureFn: (() => Promise<{ base64?: string; mimeType?: string } | null>) | null
  ): void {
    this.frameCaptureFn = captureFn;
  }

  public getState(): LiveAssistState {
    return {
      isSamplingActive: this.isSamplingActive,
      isAnalyzing: this.isAnalyzing,
      latestDescription: this.latestDescription,
      latestConfidence: this.latestConfidence,
      latestImageQuality: this.latestImageQuality,
      error: this.error,
      suppressedCount: this.suppressedCount,
    };
  }

  public subscribe(listener: LiveAssistStateListener): () => void {
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
        console.warn("[LiveAssistService] Listener error:", err);
      }
    });
  }

  /**
   * Start live assist continuous sampling.
   */
  public async startLiveAssist(): Promise<void> {
    if (this.isSamplingActive) return;

    this.isSamplingActive = true;
    this.error = null;
    this.notify();

    await hapticsService.triggerButtonPress();
    await speechService.speak(
      "Live Camera Assist started. Point your phone forward while moving. Say 'Stop' or tap the stop button at any time.",
      { force: true }
    );

    // Initial capture immediately
    this.scheduleNextSample(500);
  }

  /**
   * Pause sampling without discarding history.
   */
  public async pauseLiveAssist(): Promise<void> {
    this.isSamplingActive = false;
    this.clearSampleTimer();
    this.abortInFlight();
    this.notify();
    await speechService.speak("Live Camera Assist paused.", { force: true });
  }

  /**
   * Immediate STOP: aborts in-flight request, stops speech, and pauses sampling.
   */
  public async stop(): Promise<void> {
    this.isSamplingActive = false;
    this.clearSampleTimer();
    this.abortInFlight();
    this.isAnalyzing = false;
    this.notify();
    await speechService.stop();
  }

  /**
   * Explicit on-demand scene description triggered by user action or voice command.
   * ("What is ahead?", "Describe surroundings", or tapping 'Describe Now').
   */
  public async describeNow(query?: string): Promise<string> {
    return await this.executeAnalysisCycle(query || "Describe what is visibly in front of me.", true);
  }

  /**
   * Core analysis execution cycle with strict single-request concurrency.
   */
  private async executeAnalysisCycle(query?: string, isUserForced: boolean = false): Promise<string> {
    // Rule 5: At most one image-analysis request in flight
    if (this.isAnalyzing) {
      console.log("[LiveAssistService] Skipped cycle: analysis already in flight.");
      return "An analysis is already in progress. Please wait.";
    }

    if (!this.frameCaptureFn) {
      const msg = "Camera preview is not active.";
      this.error = msg;
      this.notify();
      if (isUserForced) {
        await speechService.speak(msg, { force: true });
      }
      return msg;
    }

    this.isAnalyzing = true;
    this.error = null;
    this.notify();

    const controller = new AbortController();
    this.activeAbortController = controller;

    try {
      // 1. Capture actual camera frame
      const frame = await this.frameCaptureFn();
      if (!frame || !frame.base64) {
        throw new Error("Could not capture camera frame. Camera may be busy or initializing.");
      }

      if (controller.signal.aborted) {
        throw new Error("Analysis aborted by user.");
      }

      // 2. Send actual image to Gemma 4 backend
      const result: SceneAnalysisResponse = await analyzeSceneAssist(
        frame.base64,
        query,
        frame.mimeType || "image/jpeg",
        controller.signal
      );

      if (controller.signal.aborted) {
        throw new Error("Analysis aborted by user.");
      }

      this.latestDescription = result.spoken_description;
      this.latestConfidence = result.confidence;
      this.latestImageQuality = result.image_quality;

      // 3. Handle unreadable or blurry image honestly (Safety Rule 1 & 2)
      if (result.needs_rescan || result.image_quality === "poor" || result.image_quality === "unreadable") {
        const unclearMsg =
          "Image is too blurry or dark to read details. Please hold your phone steady and ensure good lighting.";
        this.latestDescription = unclearMsg;
        this.notify();
        await speechService.speak(unclearMsg, { force: isUserForced });
        return unclearMsg;
      }

      // 4. Duplicate announcement suppression
      const shouldSpeak = isUserForced || !this.isDuplicateAnnouncement(result.spoken_description);

      if (shouldSpeak) {
        this.recordObservation(result.spoken_description, result.confidence, result.image_quality);
        this.notify();
        await speechService.speak(result.spoken_description, { force: isUserForced });
      } else {
        this.suppressedCount++;
        console.log(`[LiveAssistService] Duplicate announcement suppressed (${this.suppressedCount})`);
        this.notify();
      }

      return result.spoken_description;
    } catch (err: any) {
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
        console.log("[LiveAssistService] Analysis cycle safely aborted.");
        return "Analysis stopped.";
      }

      const errMsg =
        err?.message ||
        "Unable to connect to vision service. Please check your network connection.";
      this.error = errMsg;
      this.notify();

      if (isUserForced) {
        await speechService.speak(errMsg, { force: true });
      }
      return errMsg;
    } finally {
      this.isAnalyzing = false;
      this.activeAbortController = null;
      this.notify();

      // Schedule next sample if still active
      if (this.isSamplingActive) {
        this.scheduleNextSample(this.SAMPLING_INTERVAL_MS);
      }
    }
  }

  /**
   * Checks whether the new observation is substantially identical to a recent observation.
   */
  public isDuplicateAnnouncement(newDescription: string): boolean {
    if (!newDescription || newDescription.trim().length === 0) return true;
    const now = Date.now();

    // Check against recent observations within the cooldown window
    for (const obs of this.recentObservations) {
      const ageMs = now - obs.timestamp;
      if (ageMs > this.DUPLICATE_COOLDOWN_MS) continue;

      const similarity = computeDescriptionSimilarity(newDescription, obs.description);
      if (similarity >= this.SIMILARITY_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  private recordObservation(description: string, confidence: number, quality: string): void {
    const now = Date.now();
    this.recentObservations.push({
      description,
      timestamp: now,
      confidence,
      quality,
    });

    // Keep only last 10 observations
    if (this.recentObservations.length > 10) {
      this.recentObservations.shift();
    }
  }

  private scheduleNextSample(delayMs: number): void {
    this.clearSampleTimer();
    this.sampleTimer = setTimeout(async () => {
      if (this.isSamplingActive && !this.isAnalyzing) {
        await this.executeAnalysisCycle(undefined, false);
      }
    }, delayMs);
  }

  private clearSampleTimer(): void {
    if (this.sampleTimer) {
      clearTimeout(this.sampleTimer);
      this.sampleTimer = null;
    }
  }

  private abortInFlight(): void {
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
      } catch {
        // Safe ignore
      }
      this.activeAbortController = null;
    }
  }

  /**
   * Cleanup all resources upon unmount or screen blur.
   */
  public cleanup(): void {
    this.isSamplingActive = false;
    this.clearSampleTimer();
    this.abortInFlight();
    this.isAnalyzing = false;
    this.listeners.clear();
    this.recentObservations = [];
  }
}

export const liveAssistService = new LiveAssistService();
