# SAARTHI — Backend Feature and API Audit

**Audit Date:** 2026-10-25  
**Auditor:** Senior Backend Systems Review  
**Target Audience:** Mobile Frontend Engineers, AI Assistants, System Architects  
**Scope:** `backend/` directory, route definitions, schemas, service clients, error paths, test suites, and mock engines.

---

## 1. Backend Architecture

### 1.1 Application Entrypoint & Startup
- **Entry File:** `backend/app/main.py`
- **Application Factory:** `create_application() -> FastAPI`
- **Instance:** Module-level `app = create_application()` executed by ASGI servers (`uvicorn app.main:app`).
- **OpenAPI Configuration:**
  - Interactive Swagger UI: `/docs`
  - ReDoc Documentation: `/redoc`
  - OpenAPI JSON Specification: `/api/v1/openapi.json`
- **Prefix Mounting:** All operational routes are mounted through `api_router` under the `/api/v1` prefix (`settings.API_V1_STR`).

### 1.2 Router Structure
The routing table is organized into three distinct sub-routers under `backend/app/api/routes/`:
1. `health.py`: Root health monitoring (`/api/v1/health`), tag `Health`.
2. `ai.py`: Vision and model connectivity (`/api/v1/ai/...`), tag `AI`.
3. `campus.py`: Structured document and signage extraction (`/api/v1/campus/...`), tag `Campus`.

### 1.3 Middleware & CORS Architecture
- **Middleware:** `CORSMiddleware` configured in `backend/app/main.py`.
- **Allowed Origins:** Sourced dynamically from `settings.CORS_ORIGINS`.
- **Validation Constraint (`backend/app/core/config.py`):**
  - Wildcard origin (`*`) is strictly disallowed if `CORS_ALLOW_CREDENTIALS` is set to `True`.
  - Origins can be specified as a JSON array (`["http://localhost:3000"]`) or comma-separated strings.
- **Allowed Methods & Headers:** Set to `["*"]` to allow flexible client integration.

### 1.4 State & Persistence Model
- **Completely Stateless:** The backend does **not** connect to any SQL, NoSQL, Redis, or embedded database.
- **Zero In-Memory Sessions:** Requests are self-contained and execute independently.
- **Design Rationale:**
  - User schedule data, saved locations, and onboarding states reside solely on the user's mobile device (`AsyncStorage`) to preserve privacy and prevent student tracking.
  - Campus routing graphs are processed deterministically on-device rather than requiring backend server roundtrips.

### 1.5 Error Handling, Timeouts & Retries
- **Custom Exceptions (`backend/app/services/gemini.py`):**
  - `GeminiServiceException(message: str, status_code: int = 502)`
  - `GeminiCredentialsMissingException(message: str, status_code: 503)`
- **Upstream Error Mapping:**
  - HTTP 401 / 403 (Invalid API Key) $\rightarrow$ Returns HTTP 502 (Bad Gateway). Credentials are never leaked in responses.
  - HTTP 429 (Rate Limit / Quota Exceeded) $\rightarrow$ Returns HTTP 429.
  - HTTP 404 (Model Not Found) $\rightarrow$ Returns HTTP 502.
  - HTTP 5xx (Google Server Error) $\rightarrow$ Triggers retry loop, then returns HTTP 502.
- **Transient Retry Strategy:**
  - `analyze_image()` in `gemini.py` includes a 2-attempt loop (`max_attempts = 2`) with a 1.0-second delay upon receiving `errors.ServerError`.

---

## 2. Complete API Inventory

The backend exposes exactly **5 registered endpoints**. Below is the verified specification for each.

```
/api/v1
├── /health               GET    (System Health)
└── /ai
    ├── /status           GET    (AI Status & Mock Check)
    ├── /test             POST   (Text Generation Check)
    └── /vision           POST   (Multimodal Scene Description)
└── /campus
    └── /read             POST   (Structured Campus Reading)
```

---

### Endpoint 1: Health Check
- **Route:** `GET /api/v1/health`
- **Handler:** `get_health()` in `backend/app/api/routes/health.py`
- **Purpose:** Verifies that the FastAPI gateway is alive and responding. Contains zero external dependencies.
- **Headers:** None required.
- **Query / Path Parameters:** None.
- **Request Body:** None.
- **Response Schema (`HealthResponse`):**
  ```json
  {
    "status": "ok",
    "service": "saarthi-backend",
    "version": "0.1.0"
  }
  ```
- **Error Codes:** None under normal operation.
- **Execution Mode:** Real deterministic plain Python.

---

### Endpoint 2: AI Configuration Status
- **Route:** `GET /api/v1/ai/status`
- **Handler:** `get_ai_status()` in `backend/app/api/routes/ai.py`
- **Purpose:** Informs the mobile client whether cloud AI features are available or operating in local mock mode without exposing raw credentials.
- **Headers:** None required.
- **Request Body:** None.
- **Response Schema (`AIStatusResponse`):**
  - `configured` (bool): `True` if `GEMINI_API_KEY` is set OR `ENABLE_AI_MOCK` is `True`.
  - `model` (str): Configured model identifier (e.g., `"gemma-4-26b-a4b-it"`).
  - `mock_mode` (bool): `True` if `ENABLE_AI_MOCK` is active.
  ```json
  {
    "configured": true,
    "model": "gemma-4-26b-a4b-it",
    "mock_mode": true
  }
  ```
- **Error Codes:** None.
- **Execution Mode:** Real deterministic settings query.

---

### Endpoint 3: Text Generation Connectivity Test
- **Route:** `POST /api/v1/ai/test`
- **Handler:** `test_ai_connectivity()` in `backend/app/api/routes/ai.py`
- **Purpose:** Tests basic text generation against Google Gemma 4 or verifies mock execution.
- **Request Body (`AITestRequest`):**
  | Field | Type | Required | Default | Constraints | Description |
  | :--- | :--- | :--- | :--- | :--- | :--- |
  | `prompt` | `str` | Optional | `"Say hello in 5 words or less."` | Max 500 chars | Test prompt |
- **Successful Response (`AITestResponse`):**
  ```json
  {
    "status": "success",
    "model": "gemma-4-26b-a4b-it",
    "prompt": "Say hello in 5 words or less.",
    "response": "Hello! Welcome to campus today."
  }
  ```
  *(In mock mode, returns `status: "mock_success"` and `model: "mock-gemma-4-26b-a4b-it"`).*
- **Error Responses:**
  - `422 Unprocessable Entity`: Prompt exceeds 500 characters.
  - `503 Service Unavailable`: `GEMINI_API_KEY` missing and `ENABLE_AI_MOCK=False`.
  - `502 Bad Gateway`: Upstream Google GenAI connectivity failure.

---

### Endpoint 4: Multimodal Scene Description
- **Route:** `POST /api/v1/ai/vision`
- **Handler:** `analyze_scene_image()` in `backend/app/api/routes/ai.py`
- **Purpose:** Analyzes a photo taken by the student for navigation assistance, obstacle identification, and spatial orientation.
- **Request Body (`AIVisionRequest`):**
  | Field | Type | Required | Default | Validation / Constraints |
  | :--- | :--- | :--- | :--- | :--- |
  | `image_base64` | `str` | **Yes** | None | Base64 string. Strips optional `data:image/...;base64,` prefix. |
  | `prompt` | `str` | Optional | `None` | Max 2000 chars. If omitted, uses default accessible prompt. |
  | `mime_type` | `str` | Optional | `"image/jpeg"` | Must resolve to `image/jpeg` or `image/png`. |
- **Payload Validation Enforced by Code:**
  1. Base64 string must decode cleanly (`binascii.Error` $\rightarrow$ HTTP 400).
  2. Decoded size cannot exceed **8 MB** (`MAX_DECODED_IMAGE_SIZE_BYTES` $\rightarrow$ HTTP 413).
  3. Binary magic bytes must match JPEG (`\xff\xd8\xff`) or PNG (`\x89PNG\r\n\x1a\n`) $\rightarrow$ HTTP 400 if invalid.
- **Successful Response (`AIVisionResponse`):**
  ```json
  {
    "status": "success",
    "model": "gemma-4-26b-a4b-it",
    "prompt": "Describe what is visibly in front of the camera...",
    "description": "In front of you is a wide corridor with double glass doors leading outside. A student bulletin board is mounted on the wall to your left.",
    "confidence": 0.90,
    "uncertainties": [],
    "unchecked_areas": [
      "Drop-offs and ground obstacles below camera field of view"
    ],
    "needs_rescan": false,
    "extracted_text": null
  }
  ```
- **Error Codes:**
  - `400 Bad Request`: Empty image data, malformed base64, unsupported MIME type, or invalid JPEG/PNG magic bytes.
  - `413 Content Too Large`: Decoded image exceeds 8 MB.
  - `422 Unprocessable Entity`: Request body violates Pydantic schema.
  - `503 Service Unavailable`: API key unconfigured when mock mode is off.
  - `502 Bad Gateway`: Google GenAI API error or rate limit.

---

### Endpoint 5: Structured Campus Document & Sign Reading
- **Route:** `POST /api/v1/campus/read`
- **Handler:** `read_campus_text()` in `backend/app/api/routes/campus.py`
- **Purpose:** Extracts, categorizes, and structures text from room door signs, printed class timetables, campus noticeboards, and surrounding placards.
- **Request Body (`CampusReadingRequest`):**
  | Field | Type | Required | Default | Description |
  | :--- | :--- | :--- | :--- | :--- |
  | `image_base64` | `str` | Conditional | `None` | Base64-encoded image for multimodal extraction. |
  | `ocr_text` | `str` | Conditional | `None` | Pre-extracted on-device OCR string. |
  | `reading_mode`| `str` | Optional | `"auto"` | `"auto"`, `"timetable"`, `"sign"`, `"notice"`, or `"surroundings"`. |
- **Input Validation:**
  - Either `ocr_text` OR `image_base64` must be provided. If both are missing $\rightarrow$ HTTP 400.
  - **Fail-Audible Rule:** If only `ocr_text` is supplied and it contains fewer than 4 characters $\rightarrow$ Returns immediate 200 OK with `confidence: 0.3`, `needs_rescan: true`, and spoken message: *"I couldn't read that clearly, please try again."*
- **Successful Response (`CampusReadingResponse`):**
  ```json
  {
    "status": "success",
    "reading_mode": "sign",
    "spoken_summary": "Door sign reads Room 204, Department of Computer Science. Dr. Alan Turing and Prof. Ada Lovelace. Office hours 2 to 4 PM.",
    "confidence": 0.96,
    "needs_rescan": false,
    "source_text": "ROOM 204 | DEPARTMENT OF COMPUTER SCIENCE | Dr. Alan Turing, Prof. Ada Lovelace | Office Hours: 2-4 PM",
    "door_sign": {
      "room_number": "Room 204",
      "department": "Department of Computer Science",
      "occupants": ["Dr. Alan Turing", "Prof. Ada Lovelace"],
      "status": "Faculty Office Hours 2 PM - 4 PM",
      "confidence": 0.96
    },
    "timetable_items": [],
    "notices": [],
    "uncertainties": [],
    "unchecked_areas": ["Drop-offs and obstacles below camera height"]
  }
  ```
- **Error Codes:**
  - `400 Bad Request`: Neither `ocr_text` nor `image_base64` provided.
  - `503 Service Unavailable`: API key missing when mock mode is off.
  - `502 Bad Gateway`: Model generation failure.

---

## 3. Feature-by-Feature Analysis

### 3.1 Visual Scene Guidance (`/api/v1/ai/vision`)
- **Pipeline:** Mobile captures photo $\rightarrow$ Encodes to Base64 $\rightarrow$ Sends to `/api/v1/ai/vision`.
- **Backend Flow:** Strips data URI $\rightarrow$ Validates binary magic bytes $\rightarrow$ Calls `analyze_image()` in `gemini.py` using `types.Part.from_bytes` $\rightarrow$ Injects system instructions enforcing 1–3 spoken sentences, zero markdown headers/asterisks, and explicit uncertainty reporting.
- **Safety Assertion:** Appends `unchecked_areas: ["Drop-offs and ground obstacles below camera field of view"]` to prevent students from assuming the path is clear of floor hazards.

### 3.2 Door Sign Recognition (`/api/v1/campus/read`)
- **Extraction Schema:** `DoorSignInfo` (`room_number`, `department`, `occupants`, `status`, `confidence`).
- **Frontend Action:** The mobile app parses `door_sign.room_number` and triggers `mobile/src/navigation/localization.ts` to snap the student's current navigation origin to that room's graph node (e.g., `"node_cs_lab_204"`).

### 3.3 Timetable Structuring (`/api/v1/campus/read`)
- **Extraction Schema:** List of `TimetableItem` (`course_code`, `course_name`, `day_of_week`, `start_time`, `end_time`, `room`, `building`, `confidence`).
- **Crucial Separation:** The backend extracts verbatim text only. **No date arithmetic is performed by the LLM.**
- **Frontend Action:** The mobile client takes the extracted timetable items and passes them to `mobile/src/utils/dateTimeReasoning.ts`, which runs pure client-side deterministic JavaScript `Date` math to calculate real-time class countdowns.

### 3.4 Campus Notice & Deadline Extraction (`/api/v1/campus/read`)
- **Extraction Schema:** List of `NoticeItem` (`title`, `raw_date_text`, `summary`, `urgency`, `confidence`).
- **Safety Rule:** `raw_date_text` captures the literal text written on the poster (e.g. *"Wednesday, October 28 at 5:00 PM"*). The LLM is explicitly instructed not to calculate calendar offsets.

### 3.5 Multilingual Gurmukhi / Punjabi Handling
- **Implementation:** In `backend/app/api/routes/campus.py`, the backend checks for Unicode range `\u0A00` to `\u0A7F`.
- **Behavior:** If Gurmukhi characters are detected, the backend appends an uncertainty warning: *"Punjabi Gurmukhi text recognition is experimental on this version. Verify with campus staff."*

### 3.6 Offline Mock Engine
- **Activation Condition:** Activated when `settings.is_gemini_configured` is `False` AND `settings.ENABLE_AI_MOCK` is `True`.
- **Characteristics:**
  - Fast, local, and zero-cost.
  - Emits realistic, schema-valid JSON for door signs, timetables, and notices.
  - Explicitly flags responses with `status: "mock_success"` and `model: "mock-gemma-4-26b-a4b-it"`.

---

## 4. AI & Mock Behavior Specifications

### 4.1 Model & SDK Specifications
- **Model Name:** `gemma-4-26b-a4b-it` (Google Gemma 4 26B instruction-tuned multimodal model).
- **SDK Library:** `google-genai` (`Client`, `types.Part.from_bytes`, `types.GenerateContentConfig`).
- **Generation Parameters:**
  - `temperature`: `0.2` (Low temperature for deterministic, factual extraction).
  - `max_output_tokens`: `800`.
  - `thinking_budget`: `0` (Disables hidden thinking tokens to maximize speed).

### 4.2 System Prompt Enforcements
The system prompts in `gemini.py` and `campus.py` strictly mandate:
1. Speak in plain conversational sentences suitable for TTS.
2. Never output Markdown symbols (`*`, `#`, `-`, `**`).
3. Never invent room numbers or lecture times.
4. If image clarity is low, set `confidence: 0.4` and `needs_rescan: true`.

### 4.3 Output Post-Processing & Parsing
In `campus.py`, model responses are cleaned of markdown fences:
```python
cleaned_json = raw_response.strip()
if cleaned_json.startswith("```json"):
    cleaned_json = cleaned_json[7:]
if cleaned_json.startswith("```"):
    cleaned_json = cleaned_json[3:]
if cleaned_json.endswith("```"):
    cleaned_json = cleaned_json[:-3]
```
If JSON decoding fails, the endpoint does not crash; it catches `json.JSONDecodeError` and returns `status: "low_confidence"` with `needs_rescan: true`.

---

## 5. Schemas & Contract Reference

### Schema Summary Table

| Schema Name | File | Role | Fields |
| :--- | :--- | :--- | :--- |
| `HealthResponse` | `schemas/health.py` | Response | `status` (str), `service` (str), `version` (str) |
| `AIStatusResponse` | `schemas/ai.py` | Response | `configured` (bool), `model` (str), `mock_mode` (bool) |
| `AITestRequest` | `schemas/ai.py` | Request | `prompt` (str, default provided, max 500) |
| `AITestResponse` | `schemas/ai.py` | Response | `status` (str), `model` (str), `prompt` (str), `response` (str) |
| `AIVisionRequest` | `schemas/ai.py` | Request | `image_base64` (str), `prompt` (Optional[str]), `mime_type` (Optional[str]) |
| `AIVisionResponse` | `schemas/ai.py` | Response | `status` (str), `model` (str), `prompt` (str), `description` (str), `confidence` (float), `uncertainties` (list[str]), `unchecked_areas` (list[str]), `needs_rescan` (bool), `extracted_text` (Optional[str]) |
| `CampusReadingRequest` | `schemas/campus.py` | Request | `image_base64` (Optional[str]), `ocr_text` (Optional[str]), `reading_mode` (str) |
| `CampusReadingResponse` | `schemas/campus.py`| Response | `status` (str), `reading_mode` (str), `spoken_summary` (str), `confidence` (float), `needs_rescan` (bool), `source_text` (str), `door_sign` (Optional[DoorSignInfo]), `timetable_items` (list[TimetableItem]), `notices` (list[NoticeItem]), `uncertainties` (list[str]), `unchecked_areas` (list[str]) |
| `DoorSignInfo` | `schemas/campus.py` | Nested Model | `room_number` (str), `department` (Optional[str]), `occupants` (list[str]), `status` (Optional[str]), `confidence` (float) |
| `TimetableItem` | `schemas/campus.py` | Nested Model | `course_code` (str), `course_name` (str), `day_of_week` (str), `start_time` (str), `end_time` (str), `room` (str), `building` (Optional[str]), `confidence` (float) |
| `NoticeItem` | `schemas/campus.py` | Nested Model | `title` (str), `raw_date_text` (Optional[str]), `summary` (str), `urgency` (str), `confidence` (float) |

---

## 6. Mobile Integration Contract

### 6.1 Base URL & Connection Rules
- **Base URL Construction:** `http://<HOST_IP>:8000/api/v1`
- **Device Networking:**
  - Physical devices (iOS/Android Expo Go) cannot use `http://localhost:8000`.
  - The mobile app must connect via the PC's Wi-Fi LAN IP (e.g. `http://192.168.29.201:8000`).
  - Mobile client helper is in `mobile/src/config/env.ts`.

### 6.2 HTTP Client Best Practices
```typescript
// Standard POST request template for Mobile Frontend
export async function sendCampusReading(payload: {
  image_base64?: string;
  ocr_text?: string;
  reading_mode?: string;
}): Promise<CampusReadingResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second safety timeout

  try {
    const response = await fetch(`${getBackendBaseUrl()}/api/v1/campus/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      throw new Error(errorJson.detail || `Server returned ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
```

### 6.3 Handling Low Confidence and Unchecked Areas
The mobile frontend must inspect the response:
1. If `needs_rescan === true` or `confidence < 0.65`:
   - Speak `spoken_summary` via TTS (`"I couldn't read that clearly, please try again."`).
   - Trigger a distinct warning haptic (`hapticService.warning()`).
   - Do not commit changes to timetable storage or campus routing.
2. If `door_sign` is present:
   - Present button: *"Navigate from this room"*.
3. If `timetable_items` has items:
   - Present button: *"Save schedule to My Timetable"*.

---

## 7. Testing & Verification

### 7.1 Test Suites Overview
The backend includes **43 automated test cases** located in `backend/tests/`:

1. `test_health.py` (5 tests):
   - Verifies HTTP 200 and schema from `/api/v1/health`.
   - Verifies health endpoint operates independently of Gemini credentials.
   - Verifies `/docs` is accessible.
   - Verifies CORS disallows wildcard `*` when credentials are enabled.
2. `test_ai.py` (22 tests):
   - Verifies status endpoint when unconfigured vs configured.
   - Verifies text generation error handling (401, 403, 429, 502, 503).
   - Verifies vision endpoint image validation: empty payload, malformed Base64, unsupported MIME types, magic byte tampering, oversized images (> 8MB), and data URI stripping.
   - Verifies mock mode fallback behavior.
3. `test_campus_reading.py` (9 tests):
   - Verifies missing payload handling (HTTP 400).
   - Verifies noisy text rejection (< 4 chars) fails audible.
   - Verifies mock mode extraction for timetables, door signs, and notices.
   - Verifies Gemma JSON parsing, markdown codefence stripping, and safe failure on malformed LLM outputs.
   - Verifies Punjabi Gurmukhi unicode detection and warning injection.
4. `test_csv_to_campus_graph.py` (3 tests):
   - Validates CSV parser on `campus_survey_template.csv`.
   - Tests rejection of duplicate node IDs and invalid edge references.
5. `test_demo_flow.py` (4 tests):
   - Tests end-to-end user journeys using visual test fixtures from `testdata/`.

### 7.2 Verified Test Execution Results
- **Execution Command:**
  ```powershell
  $env:ENABLE_AI_MOCK="False"; .\.venv\Scripts\pytest
  ```
- **Observed Result:**
  ```text
  ======================== 43 passed, 1 warning in 2.08s ========================
  ```
- **Important Environment Finding:**
  - When `ENABLE_AI_MOCK=True` is set in `.env`, 40 tests pass and 3 tests fail because the tests explicitly expect missing credentials to trigger HTTP 503 errors, whereas mock mode intercepts and successfully returns HTTP 200 `mock_success`.

---

## 8. Final Capability Matrix

| Feature | HTTP Endpoint | Implementation Status | Real AI / Deterministic / Mock | Frontend Input Requirements | Known Limitations / Edge Cases |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Gateway Health** | `GET /api/v1/health` | Implemented | Deterministic Plain Code | None | None. Completely isolated. |
| **AI Status & Mode** | `GET /api/v1/ai/status` | Implemented | Deterministic Settings Check | None | Never leaks API key. |
| **Text Generation Check** | `POST /api/v1/ai/test` | Implemented | Real Gemma 4 / Mock Fallback | `{ prompt?: string }` (max 500 chars) | Requires active API key unless mock mode enabled. |
| **Multimodal Scene Vision**| `POST /api/v1/ai/vision` | Implemented | Real Gemma 4 / Mock Fallback | `{ image_base64: string, prompt?: string, mime_type?: string }` | Enforces 8MB limit and JPEG/PNG magic bytes. Always reports unchecked ground hazards. |
| **Door Sign Extraction** | `POST /api/v1/campus/read` | Implemented | Real Gemma 4 / Mock Fallback | `{ image_base64?: string, ocr_text?: string, reading_mode: "sign" }` | Dependent on image legibility. Snaps to graph node on frontend. |
| **Timetable Extraction** | `POST /api/v1/campus/read` | Implemented | Real Gemma 4 / Mock Fallback | `{ image_base64?: string, ocr_text?: string, reading_mode: "timetable" }` | Extracts schedule only; frontend must execute Date countdown math. |
| **Noticeboard Reading** | `POST /api/v1/campus/read` | Implemented | Real Gemma 4 / Mock Fallback | `{ image_base64?: string, ocr_text?: string, reading_mode: "notice" }` | Raw date text extracted verbatim without LLM date math. |
| **Gurmukhi Detection** | `POST /api/v1/campus/read` | Implemented | Deterministic Regex Check | Text containing `\u0A00`–`\u0A7F` | Experimental; injects uncertainty advisory. |
| **Fail-Audible Recovery** | `POST /api/v1/campus/read` | Implemented | Deterministic Rule Check | OCR text < 4 chars | Returns 200 OK with `confidence: 0.3` and spoken recovery prompt. |
| **Accessible Dijkstra Router** | *Client-Side Only* | Client Implemented | Deterministic Dijkstra | Campus graph JSON | Intentionally not an endpoint; executes locally on mobile for offline safety. |
| **Schedule Date Engine** | *Client-Side Only* | Client Implemented | Deterministic Date Engine | Local `AsyncStorage` | Intentionally not an endpoint; executes locally on mobile to prevent hallucinations. |

---

## 9. Recommended Frontend Integration Order

Based on the verified backend capabilities, the mobile frontend should integrate endpoints in this sequence:

1. **Step 1: Health & Connectivity Ping**
   - Call `GET /api/v1/health` and `GET /api/v1/ai/status` on app startup.
   - Use this to display the live green/red connection badge in the UI and know whether mock mode is running.
2. **Step 2: Campus Reader (`POST /api/v1/campus/read`)**
   - Wire the 84dp camera shutter button to capture a frame and send to `/api/v1/campus/read`.
   - Handle the returned `CampusReadingResponse`:
     - If `door_sign` present $\rightarrow$ Offer route navigation starting from that room.
     - If `timetable_items` present $\rightarrow$ Display confirmation card and save to `AsyncStorage`.
     - If `needs_rescan` is true $\rightarrow$ Trigger native TTS with `spoken_summary`.
3. **Step 3: Multimodal Scene Description (`POST /api/v1/ai/vision`)**
   - Connect the *"📸 Describe Scene"* feature in `CampusReaderScreen.tsx`.
   - Pass user questions or default prompts (e.g., *"Identify obstacles"*).
   - Read `description` aloud using `expo-speech`. Always speak `unchecked_areas` when prompted.
4. **Step 4: AI Connectivity Test (`POST /api/v1/ai/test`)**
   - Provide a button in `SettingsScreen.tsx` allowing developers and users to verify API keys with a single tap.

---

## 10. Audit Summary & Checklists

### 1. Files Inspected
- `backend/app/main.py`
- `backend/app/core/config.py`
- `backend/app/api/routes/__init__.py`
- `backend/app/api/routes/health.py`
- `backend/app/api/routes/ai.py`
- `backend/app/api/routes/campus.py`
- `backend/app/schemas/health.py`
- `backend/app/schemas/ai.py`
- `backend/app/schemas/campus.py`
- `backend/app/services/gemini.py`
- `backend/tests/test_health.py`
- `backend/tests/test_ai.py`
- `backend/tests/test_campus_reading.py`
- `backend/tests/test_csv_to_campus_graph.py`
- `backend/tests/test_demo_flow.py`

### 2. Endpoints Discovered
1. `GET /api/v1/health`
2. `GET /api/v1/ai/status`
3. `POST /api/v1/ai/test`
4. `POST /api/v1/ai/vision`
5. `POST /api/v1/campus/read`

### 3. Confirmed Features
- Real Google GenAI multimodal integration (`gemma-4-26b-a4b-it`).
- Strict Base64 validation with binary magic-byte enforcement (JPEG & PNG).
- Comprehensive campus document extraction (Door signs, Timetables, Noticeboards).
- Fail-audible noisy text rejection (< 4 chars).
- Multilingual Gurmukhi Unicode character detection.
- Offline mock engine with realistic fixtures.
- Conservative hazard disclosures (`unchecked_areas`).

### 4. Mock-Only or Conditional Features
- `ENABLE_AI_MOCK=True` provides mock responses when no `GEMINI_API_KEY` is set.
- All campus reading modes have mock implementations for offline development.

### 5. Missing / Non-Backend Features Clarification
- **Campus Dijkstra Routing:** Not an endpoint. Implemented strictly on the mobile client (`mobile/src/navigation/campusRouter.ts`).
- **Date Arithmetic / Countdown:** Not an endpoint. Implemented strictly on the mobile client (`mobile/src/utils/dateTimeReasoning.ts`).
- **Database / User Auth:** Intentionally omitted. System is stateless to protect student privacy.

### 6. Tests Executed & Results
- Command: `.\.venv\Scripts\pytest` (with `ENABLE_AI_MOCK=False`)
- **Result:** **43 passed, 1 warning in 2.08s**.
