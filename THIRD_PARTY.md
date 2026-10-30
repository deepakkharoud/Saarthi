# Third-Party Code & Dependency Audit

This document tracks all external code, libraries, and assets used in the **Saarthi** project in accordance with our standing open-source & originality rules.

## Policy
1. **Dependency First**: Always prefer using libraries as verified dependencies (`npm`, `pip`) over copy-pasting code.
2. **License Vetting**: Before incorporating code or dependencies:
   - Check and record the license.
   - Do **NOT** copy or include AGPL/GPL licensed code without explicit user approval.
3. **Tracking Requirement**: Any copied or adapted code snippet must be logged below with repository URL, author, commit/version, license type, exact files affected, and architectural rationale.

---

## Direct Dependencies Audit

### Backend (Python / FastAPI)
| Package | License | Purpose |
| :--- | :--- | :--- |
| `fastapi` | MIT | High-performance async REST API framework |
| `uvicorn` | BSD-3-Clause | ASGI server implementation |
| `pydantic` | MIT | Strict data validation and schema definitions |
| `pydantic-settings` | MIT | Typed environment configuration management |
| `google-genai` | Apache-2.0 | Official Google GenAI SDK for Gemini / Gemma models |
| `pytest` | MIT | Automated test framework |
| `httpx` | BSD-3-Clause | Async HTTP client for integration test execution |

### Mobile Client (React Native / Expo SDK 58)
| Package | License | Purpose |
| :--- | :--- | :--- |
| `expo` | MIT | Core Expo SDK runtime |
| `react` / `react-native` | MIT | Cross-platform declarative UI runtime |
| `expo-camera` | MIT | Native camera view and frame capture |
| `expo-speech` | MIT | Native Text-to-Speech (TTS) for audible responses |
| `expo-speech-recognition` | MIT | Real-time on-device voice input transcription |
| `react-native-voice-activator` | MIT | iOS native on-device wake-word detection and microphone lifecycle; wraps sherpa-onnx |
| `expo-haptics` | MIT | Tactile feedback patterns for corner navigation and buttons |
| `@react-native-async-storage/async-storage` | MIT | On-device persistent key-value storage |
| `react-native-safe-area-context` | MIT | Dynamic safe area handling for notch/island |
| `@expo/vector-icons` | MIT | Accessible iconography |
| `expo-mlkit-ocr` | MIT | On-device Google ML Kit Text Recognition v2 |
| `expo-location` | MIT | Real-time GPS location tracking and accuracy reporting |
| `@maplibre/maplibre-react-native` | MIT | Interactive vector/raster campus mapping with OpenStreetMap tiles |
| `jest` / `ts-jest` | MIT | Unit testing suite for deterministic application logic |

#### Wake-word runtime assets

`react-native-voice-activator` redistributes sherpa-onnx (Apache-2.0) and downloads the sherpa-onnx GigaSpeech keyword-spotting model on first setup (published as Apache-2.0). The package's own [`THIRD-PARTY-NOTICES.md`](https://github.com/prompt-agency/react-native-voice-activator/blob/main/THIRD-PARTY-NOTICES.md) records that GigaSpeech's training-data terms and the model's redistributability have an unanswered upstream clarification. Saarthi does not copy model files into this repository; the app downloads and checksum-verifies them at runtime. Reassess the model asset before commercial distribution.


---

## Third-Party Code Snippets
| Repository | License | What was adapted | Rationale |
| :--- | :--- | :--- | :--- |
| https://github.com/LevionyxStudio/Saarthi (local source checkout: D:\Hacktober\DeepakJi) | Apache-2.0 | Visual scanning screen, live-assist orchestration, grounded object-search schema/service, and scanner-specific API routes | Integrates the existing scanner into this repo while leaving navigation, wake-word, map, and unrelated voice code in place. |
| https://github.com/GoogleCloudPlatform/generative-ai | Apache-2.0 | Gemini Live session integration pattern referenced by the scanner's live-session adapter | Provides the visual scanner with an optional server-managed live stream; REST scene analysis remains the fallback. |
