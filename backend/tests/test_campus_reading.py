import json
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from app.core.config import get_settings
from app.main import app
from app.services.gemini import GeminiServiceException

TESTDATA_DIR = Path(__file__).resolve().parent.parent.parent / "testdata"
if not TESTDATA_DIR.exists():
    TESTDATA_DIR = Path(__file__).resolve().parent.parent / "testdata"

DUMMY_JPEG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_campus_read_missing_payload(client: TestClient) -> None:
    """Returns 400 if neither ocr_text nor image_base64 is provided."""
    response = client.post("/api/v1/campus/read", json={})
    assert response.status_code == 400
    assert "either ocr_text or image_base64" in response.json()["detail"].lower()


def test_campus_read_unreadable_noisy_text_fails_audible(client: TestClient) -> None:
    """Short or noisy OCR (<4 chars) produces audible retry message (Rule 4)."""
    response = client.post(
        "/api/v1/campus/read",
        json={"ocr_text": "xyz", "reading_mode": "auto"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["needs_rescan"] is True
    assert data["confidence"] <= 0.5
    assert "couldn't read that clearly" in data["spoken_summary"].lower()


def test_campus_read_timetable_mock_mode(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    """Mock mode correctly generates structured timetable items."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("ENABLE_AI_MOCK", "True")
    get_settings.cache_clear()

    response = client.post(
        "/api/v1/campus/read",
        json={"ocr_text": "Weekly Class Timetable Schedule", "reading_mode": "timetable"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "mock_success"
    assert data["reading_mode"] == "timetable"
    assert len(data["timetable_items"]) >= 1
    assert data["timetable_items"][0]["course_code"] == "CS201"
    assert data["timetable_items"][0]["room"] == "Room 204"
    assert data["needs_rescan"] is False
    assert "CS201" in data["spoken_summary"]


def test_campus_read_door_sign_mock_mode(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    """Mock mode correctly structures classroom door sign plaque."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("ENABLE_AI_MOCK", "True")
    get_settings.cache_clear()

    response = client.post(
        "/api/v1/campus/read",
        json={"ocr_text": "Room 204 Computer Science Department", "reading_mode": "sign"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["reading_mode"] == "sign"
    assert data["door_sign"] is not None
    assert "204" in data["door_sign"]["room_number"]
    assert "Computer Science" in data["door_sign"]["department"]


def test_campus_read_notice_mock_mode(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    """Mock mode correctly extracts notice with raw date text."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("ENABLE_AI_MOCK", "True")
    get_settings.cache_clear()

    response = client.post(
        "/api/v1/campus/read",
        json={"ocr_text": "Assignment 2 deadline announcement", "reading_mode": "notice"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["reading_mode"] == "notice"
    assert len(data["notices"]) >= 1
    assert "October 28" in data["notices"][0]["raw_date_text"]


@patch("app.api.routes.campus.generate_text")
@patch("app.api.routes.campus.generate_campus_structured_content")
def test_campus_read_mock_mode_takes_precedence_over_configured_key(
    mock_structured: MagicMock,
    mock_text: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """Mock mode must return deterministic mock data without calling real Gemini API even when key is set."""
    import time
    monkeypatch.setenv("GEMINI_API_KEY", "configured-api-key-in-env")
    monkeypatch.setenv("ENABLE_AI_MOCK", "True")
    get_settings.cache_clear()

    start_time = time.time()
    response = client.post(
        "/api/v1/campus/read",
        json={"ocr_text": "Room 204 - Computer Science Department", "reading_mode": "auto"},
    )
    duration = time.time() - start_time

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "mock_success"
    assert "Room 204" in data["spoken_summary"]
    assert duration < 1.0
    # Crucial check: external Gemini API methods must NOT have been called
    mock_text.assert_not_called()
    mock_structured.assert_not_called()


@patch("app.api.routes.campus.generate_text")
def test_campus_read_gemma_json_parsing(
    mock_generate: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """Tests successful structured JSON parsing from Gemma 4 output."""
    monkeypatch.setenv("GEMINI_API_KEY", "real-key")
    monkeypatch.setenv("ENABLE_AI_MOCK", "False")
    get_settings.cache_clear()

    mock_llm_json = {
        "reading_mode": "timetable",
        "spoken_summary": "You have Physics at 11 AM in Hall C.",
        "confidence": 0.95,
        "needs_rescan": False,
        "source_text": "PHY101 Mon 11:00 Hall C",
        "timetable_items": [
            {
                "course_code": "PHY101",
                "course_name": "General Physics",
                "day_of_week": "Monday",
                "start_time": "11:00",
                "end_time": "12:30",
                "room": "Hall C",
                "confidence": 0.95,
            }
        ],
        "uncertainties": [],
        "unchecked_areas": ["Ground obstacles"],
    }
    mock_generate.return_value = f"```json\n{json.dumps(mock_llm_json)}\n```"

    response = client.post(
        "/api/v1/campus/read",
        json={"ocr_text": "PHY101 Mon 11:00 Hall C", "reading_mode": "timetable"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["confidence"] == 0.95
    assert data["timetable_items"][0]["course_code"] == "PHY101"
    assert "Physics" in data["spoken_summary"]


@patch("app.api.routes.campus.generate_text")
def test_campus_read_malformed_llm_output_fails_safely(
    mock_generate: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """When Gemma 4 returns malformed non-JSON, falls back safely to audible retry."""
    monkeypatch.setenv("GEMINI_API_KEY", "real-key")
    monkeypatch.setenv("ENABLE_AI_MOCK", "False")
    get_settings.cache_clear()

    mock_generate.return_value = "Sorry, I am not able to parse this as JSON."

    response = client.post(
        "/api/v1/campus/read",
        json={"ocr_text": "Some text", "reading_mode": "auto"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["needs_rescan"] is True
    assert "couldn't read that clearly" in data["spoken_summary"].lower()


@patch("app.api.routes.campus.generate_campus_structured_content")
def test_campus_read_with_image_calls_multimodal(
    mock_multimodal: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """Tests that sending image_base64 invokes generate_campus_structured_content."""
    import base64
    monkeypatch.setenv("GEMINI_API_KEY", "real-key")
    monkeypatch.setenv("ENABLE_AI_MOCK", "False")
    get_settings.cache_clear()

    # Valid 1x1 JPEG bytes
    dummy_jpeg_b64 = base64.b64encode(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb").decode("ascii")

    mock_llm_json = {
        "reading_mode": "sign",
        "spoken_summary": "Door sign for Room 101.",
        "confidence": 0.90,
        "needs_rescan": False,
        "source_text": "Room 101",
        "door_sign": {
            "room_number": "Room 101",
            "department": "Engineering",
            "occupants": [],
            "status": "Available",
        },
        "uncertainties": [],
        "unchecked_areas": ["Ground level"],
    }
    mock_multimodal.return_value = json.dumps(mock_llm_json)

    response = client.post(
        "/api/v1/campus/read",
        json={"image_base64": dummy_jpeg_b64, "reading_mode": "sign"},
    )
    assert response.status_code == 200
    assert mock_multimodal.called
    data = response.json()
    assert data["door_sign"]["room_number"] == "Room 101"


@patch("app.api.routes.campus.generate_text")
def test_campus_read_gurmukhi_detected_adds_uncertainty(
    mock_generate: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """Verifies that Punjabi Gurmukhi text appends an explicit experimental uncertainty disclaimer."""
    monkeypatch.setenv("GEMINI_API_KEY", "real-key")
    monkeypatch.setenv("ENABLE_AI_MOCK", "False")
    get_settings.cache_clear()

    mock_llm_json = {
        "reading_mode": "notice",
        "spoken_summary": "Notice about Punjabi university events.",
        "confidence": 0.88,
        "needs_rescan": False,
        "source_text": "ਯੂਨੀਵਰਸਿਟੀ ਨੋਟਿਸ",
        "uncertainties": [],
        "unchecked_areas": ["Surroundings"],
    }
    mock_generate.return_value = json.dumps(mock_llm_json)

    # Contains Gurmukhi chars: ਯੂਨੀਵਰਸਿਟੀ (University in Punjabi)
    response = client.post(
        "/api/v1/campus/read",
        json={"ocr_text": "ਯੂਨੀਵਰਸਿਟੀ ਨੋਟਿਸ 2026", "reading_mode": "notice"},
    )
    assert response.status_code == 200
    data = response.json()
    assert any("Gurmukhi" in u for u in data["uncertainties"])


@patch("app.api.routes.campus.generate_campus_structured_content")
def test_campus_read_non_text_mouse_image_with_mock_disabled_does_not_return_room_204(
    mock_vision: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """With mock mode disabled, a mouse image processed by Gemma 4 must not return Room 204 or Turing data."""
    monkeypatch.setenv("GEMINI_API_KEY", "real-configured-key")
    monkeypatch.setenv("ENABLE_AI_MOCK", "False")
    get_settings.cache_clear()

    # Vision model correctly identifies computer mouse in surroundings without text
    mock_vision.return_value = json.dumps({
        "reading_mode": "surroundings",
        "spoken_summary": "A computer mouse is resting on a desk. No campus signs or text detected.",
        "confidence": 0.90,
        "needs_rescan": False,
        "source_text": "",
        "door_sign": None,
        "timetable_items": [],
        "notices": [],
        "uncertainties": [],
        "unchecked_areas": ["Drop-offs outside frame"],
    })

    response = client.post(
        "/api/v1/campus/read",
        json={"image_base64": DUMMY_JPEG_B64, "reading_mode": "auto"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["reading_mode"] == "surroundings"
    assert data["door_sign"] is None
    assert data["timetable_items"] == []
    assert data["notices"] == []
    assert "computer mouse" in data["spoken_summary"].lower()
    # Must NOT contain hardcoded fixture information
    assert "Room 204" not in response.text
    assert "Turing" not in response.text
    assert "Lovelace" not in response.text


@patch("app.api.routes.campus.generate_campus_structured_content")
def test_campus_read_non_text_llm_hallucination_stripped_by_deterministic_guards(
    mock_vision: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """If the LLM attempts to output a door sign when reading_mode is surroundings or text is empty, code strips it."""
    monkeypatch.setenv("GEMINI_API_KEY", "real-configured-key")
    monkeypatch.setenv("ENABLE_AI_MOCK", "False")
    get_settings.cache_clear()

    # Simulates an errant LLM hallucinating a door sign for a non-text image
    mock_vision.return_value = json.dumps({
        "reading_mode": "surroundings",
        "spoken_summary": "I see a black mouse.",
        "confidence": 0.85,
        "needs_rescan": False,
        "source_text": "",
        "door_sign": {
            "room_number": "Room 204",
            "department": "Computer Science",
            "occupants": ["Dr. Alan Turing"],
            "status": "Available",
        },
        "timetable_items": [],
        "notices": [],
        "uncertainties": [],
        "unchecked_areas": [],
    })

    response = client.post(
        "/api/v1/campus/read",
        json={"image_base64": DUMMY_JPEG_B64, "reading_mode": "auto"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["reading_mode"] == "surroundings"
    # Deterministic safety rule enforces door_sign=None when surroundings or empty source_text
    assert data["door_sign"] is None


@patch("app.api.routes.campus.generate_campus_structured_content")
def test_campus_read_inference_failure_never_falls_back_to_fixtures(
    mock_vision: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """When real inference fails with an exception, it must fail safely without returning mock campus info."""
    monkeypatch.setenv("GEMINI_API_KEY", "real-configured-key")
    monkeypatch.setenv("ENABLE_AI_MOCK", "False")
    get_settings.cache_clear()

    mock_vision.side_effect = GeminiServiceException("Upstream server timeout", status_code=504)

    response = client.post(
        "/api/v1/campus/read",
        json={"image_base64": DUMMY_JPEG_B64, "reading_mode": "auto"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "service_error"
    assert data["needs_rescan"] is True
    assert data["door_sign"] is None
    assert data["timetable_items"] == []
    assert data["notices"] == []
    assert "temporarily unavailable" in data["spoken_summary"]
    # Verify no mock fixtures leaked
    assert "Room 204" not in response.text
    assert "Turing" not in response.text


def test_campus_read_mock_mode_mouse_returns_surroundings_not_room_204(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """In mock mode, Auto Read with mouse text returns surroundings, never Room 204."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("ENABLE_AI_MOCK", "True")
    get_settings.cache_clear()

    response = client.post(
        "/api/v1/campus/read",
        json={"ocr_text": "wireless optical mouse", "reading_mode": "auto"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["reading_mode"] == "surroundings"
    assert data["door_sign"] is None
    assert "computer mouse" in data["spoken_summary"].lower()
    assert "Room 204" not in response.text


def test_campus_read_mock_mode_explicitly_enabled_returns_door_sign_fixture(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """In mock mode, explicit sign request returns Room 204 fixture as expected for testing."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("ENABLE_AI_MOCK", "True")
    get_settings.cache_clear()

    response = client.post(
        "/api/v1/campus/read",
        json={"ocr_text": "Room 204 Department of Computer Science", "reading_mode": "sign"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "mock_success"
    assert data["reading_mode"] == "sign"
    assert data["door_sign"] is not None
    assert data["door_sign"]["room_number"] == "Room 204"
    assert "Dr. Alan Turing" in data["door_sign"]["occupants"]


@patch("app.api.routes.campus.generate_text")
def test_campus_read_valid_sign_text_parsed_into_schema(
    mock_generate: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """Valid door sign text is parsed into the expected DoorSignInfo schema."""
    monkeypatch.setenv("GEMINI_API_KEY", "real-key")
    monkeypatch.setenv("ENABLE_AI_MOCK", "False")
    get_settings.cache_clear()

    mock_llm_json = {
        "reading_mode": "sign",
        "spoken_summary": "Door sign for Room 305, Department of Electrical Engineering. Prof. Nikola Tesla.",
        "confidence": 0.96,
        "needs_rescan": False,
        "source_text": "Room 305 | Department of Electrical Engineering | Prof. Nikola Tesla",
        "door_sign": {
            "room_number": "Room 305",
            "department": "Department of Electrical Engineering",
            "occupants": ["Prof. Nikola Tesla"],
            "status": "In Lab",
            "confidence": 0.96,
        },
        "timetable_items": [],
        "notices": [],
        "uncertainties": [],
        "unchecked_areas": ["Surrounding stairs"],
    }
    mock_generate.return_value = json.dumps(mock_llm_json)

    response = client.post(
        "/api/v1/campus/read",
        json={"ocr_text": "Room 305 Department of Electrical Engineering Prof. Nikola Tesla", "reading_mode": "sign"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["reading_mode"] == "sign"
    assert data["door_sign"] is not None
    assert data["door_sign"]["room_number"] == "Room 305"
    assert data["door_sign"]["department"] == "Department of Electrical Engineering"
    assert "Prof. Nikola Tesla" in data["door_sign"]["occupants"]


def test_campus_read_invalid_image_base64_fails_audibly_without_fixture(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """Corrupt image payload produces safe low-confidence response and does not leak fixtures."""
    monkeypatch.setenv("GEMINI_API_KEY", "real-key")
    monkeypatch.setenv("ENABLE_AI_MOCK", "False")
    get_settings.cache_clear()

    response = client.post(
        "/api/v1/campus/read",
        json={"image_base64": "!!!not_valid_base64!!!", "reading_mode": "auto"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["needs_rescan"] is True
    assert data["door_sign"] is None
    assert "couldn't read" in data["spoken_summary"].lower()
    assert "Room 204" not in response.text


@patch("app.api.routes.campus.generate_campus_structured_content")
def test_campus_read_with_real_door_sign_image_file(
    mock_structured: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """End-to-end payload test using a real door sign image file."""
    import base64
    monkeypatch.setenv("GEMINI_API_KEY", "real-configured-key")
    monkeypatch.setenv("ENABLE_AI_MOCK", "False")
    get_settings.cache_clear()

    with open(TESTDATA_DIR / "sample_door_sign.jpg", "rb") as f:
        door_sign_b64 = base64.b64encode(f.read()).decode("utf-8")

    mock_structured.return_value = json.dumps({
        "reading_mode": "sign",
        "spoken_summary": "Office door sign for Room 204, Computer Science, Dr. Alan Turing.",
        "confidence": 1.0,
        "needs_rescan": False,
        "source_text": "Room 204\nComputer Science\nDr. Alan Turing",
        "door_sign": {
            "room_number": "204",
            "department": "Computer Science",
            "occupants": ["Dr. Alan Turing"],
            "status": None,
            "confidence": 0.95,
        },
        "timetable_items": [],
        "notices": [],
        "uncertainties": [],
        "unchecked_areas": ["Drop-offs and ground obstacles outside camera frame"],
    })

    response = client.post(
        "/api/v1/campus/read",
        json={"image_base64": door_sign_b64, "reading_mode": "auto"},
    )
    assert response.status_code == 200
    assert mock_structured.called
    # Check that image_bytes passed to the multimodal function are valid JPEG bytes
    called_args = mock_structured.call_args[1]
    assert called_args["mime_type"] == "image/jpeg"
    assert len(called_args["image_bytes"]) > 1000
    data = response.json()
    assert data["status"] == "success"
    assert data["reading_mode"] == "sign"
    assert data["door_sign"]["room_number"] == "204"
    assert data["door_sign"]["department"] == "Computer Science"
    assert "Dr. Alan Turing" in data["door_sign"]["occupants"]


@patch("app.api.routes.campus.generate_campus_structured_content")
def test_campus_read_with_real_mouse_image_file(
    mock_structured: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    """End-to-end payload test using a real non-text mouse image file."""
    import base64
    monkeypatch.setenv("GEMINI_API_KEY", "real-configured-key")
    monkeypatch.setenv("ENABLE_AI_MOCK", "False")
    get_settings.cache_clear()

    with open(TESTDATA_DIR / "sample_mouse.jpg", "rb") as f:
        mouse_b64 = base64.b64encode(f.read()).decode("utf-8")

    mock_structured.return_value = json.dumps({
        "reading_mode": "surroundings",
        "spoken_summary": "A computer mouse is resting on a surface. No campus signs or text detected.",
        "confidence": 0.95,
        "needs_rescan": False,
        "source_text": "",
        "door_sign": None,
        "timetable_items": [],
        "notices": [],
        "uncertainties": [],
        "unchecked_areas": ["Drop-offs outside camera frame"],
    })

    response = client.post(
        "/api/v1/campus/read",
        json={"image_base64": mouse_b64, "reading_mode": "auto"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["reading_mode"] == "surroundings"
    assert data["door_sign"] is None
    assert data["timetable_items"] == []
    assert data["notices"] == []
    assert "Room 204" not in response.text



