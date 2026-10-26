/**
 * Saarthi OCR Service.
 *
 * Implements a clean, decoupled OCR interface:
 * 1. Checks if a native on-device ML Kit OCR module is active in development build.
 * 2. If running in Expo Go or without native binaries, gracefully falls back to the backend
 *    Gemma 4 reading pipeline, preserving 100% app stability.
 */

export interface OCRResult {
  text: string;
  confidence: number;
  blocks: string[];
  isLocal: boolean;
}

function hasNativeModule(name: string): boolean {
  try {
    const g = globalThis as any;
    if (g?.expo?.modules?.[name]) return true;
    if (g?.nativeModuleProxy?.[name]) return true;
    if (g?.__turboModuleProxy && g.__turboModuleProxy(name)) return true;
  } catch {
    // Safe ignore
  }
  return false;
}

export class OCRService {
  private isNativeModuleAvailable: boolean | null = null;

  /**
   * Evaluates if on-device ML Kit OCR is present in the native runtime.
   * Returns false without throwing in standard Expo Go or Node test runners.
   */
  async checkNativeSupport(): Promise<boolean> {
    if (this.isNativeModuleAvailable !== null) {
      return this.isNativeModuleAvailable;
    }

    try {
      // First safely check if the native module exists in the current binary
      if (!hasNativeModule("ExpoMlkitOcr")) {
        this.isNativeModuleAvailable = false;
        return false;
      }

      // Dynamic import to load JS bindings
      const mlkit: any = await import("expo-mlkit-ocr");
      if (
        mlkit &&
        (typeof mlkit.recognizeText === "function" ||
          typeof mlkit.detectText === "function" ||
          typeof mlkit.isSupported === "function")
      ) {
        this.isNativeModuleAvailable = true;
        return true;
      }
    } catch (err: any) {
      console.log(
        "[SAARTHI OCR] Native ML Kit OCR module unavailable in current environment (e.g. Expo Go):",
        err?.message || err
      );
    }

    this.isNativeModuleAvailable = false;
    return false;
  }

  /**
   * Recognize text from a local image file URI.
   * If running in Expo Go or without native binaries, gracefully returns isLocal=false
   * so the reading pipeline seamlessly routes to the backend Gemma 4 model.
   */
  async recognizeTextFromUri(imageUri: string): Promise<OCRResult> {
    const isSupported = await this.checkNativeSupport();

    if (isSupported) {
      try {
        const mlkit: any = await import("expo-mlkit-ocr");
        // expo-mlkit-ocr v0.2.7 uses recognizeText(uri)
        const results =
          typeof mlkit.recognizeText === "function"
            ? await mlkit.recognizeText(imageUri)
            : typeof mlkit.detectText === "function"
            ? await mlkit.detectText(imageUri)
            : null;

        if (results && results.text) {
          const rawBlocks = Array.isArray(results.blocks) ? results.blocks : [];
          const blocks = rawBlocks
            .map((b: any) => (typeof b === "string" ? b : b.text || ""))
            .filter(Boolean);

          return {
            text: results.text,
            confidence: 0.92,
            blocks: blocks.length > 0 ? blocks : [results.text],
            isLocal: true,
          };
        }
      } catch (err) {
        console.warn("[SAARTHI OCR] Local OCR execution error, falling back to backend:", err);
      }
    }

    // Return empty with isLocal=false indicating cloud or mock pipeline should process image
    return {
      text: "",
      confidence: 0.0,
      blocks: [],
      isLocal: false,
    };
  }
}

export const ocrService = new OCRService();
