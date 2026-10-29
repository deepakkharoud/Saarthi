import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
import httpx

from app.main import app
from app.services.valhalla import decode_valhalla_polyline

client = TestClient(app)


def test_decode_valhalla_polyline():
    # Known test polyline (precision 6)
    # Encodes (30.770726, 76.576329) to (30.769660, 76.575543)
    coords = decode_valhalla_polyline("kabuy@qcz`qCbA?~DT", precision=6)
    assert len(coords) >= 1
    assert isinstance(coords[0][0], float)
    assert isinstance(coords[0][1], float)


@pytest.mark.anyio
async def test_routing_endpoint_success():
    mock_valhalla_payload = {
        "trip": {
            "summary": {
                "length": 0.154,
                "time": 109.6,
            },
            "legs": [
                {
                    "shape": "kabuy@qcz`qCbA?~DT",
                    "maneuvers": [
                        {
                            "instruction": "Walk south on campus path.",
                            "length": 0.080,
                            "time": 55.0,
                            "type": 1,
                            "begin_shape_index": 0,
                        },
                        {
                            "instruction": "Turn right toward Block 1 entrance.",
                            "length": 0.074,
                            "time": 54.6,
                            "type": 2,
                            "begin_shape_index": 1,
                        },
                    ],
                }
            ],
        }
    }

    mock_resp = httpx.Response(200, json=mock_valhalla_payload, request=httpx.Request("POST", "http://test"))

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp

        payload = {
            "start": {"latitude": 30.770726, "longitude": 76.576329},
            "destination": {"latitude": 30.769660, "longitude": 76.575543},
            "destination_name": "Block 1",
            "avoid_stairs": True,
        }

        response = client.post("/api/v1/routing/walk", json=payload)
        assert response.status_code == 200
        route_request = mock_post.call_args.kwargs["json"]
        pedestrian_options = route_request["costing_options"]["pedestrian"]
        assert pedestrian_options["type"] == "blind"
        assert "use_stairs" not in pedestrian_options
        assert pedestrian_options["step_penalty"] == 300.0
        data = response.json()
        assert data["status"] == "success"
        assert data["total_distance_meters"] == 154.0
        assert len(data["maneuvers"]) == 2
        assert "Block 1" in data["spoken_summary"]
        assert len(data["coordinates"]) >= 1
        assert data["has_stairs"] is False
        assert data["accessibility_status"] == "unknown"
        assert "cannot confirm" in data["stairs_warning"].lower()
        assert "cannot confirm" in data["spoken_summary"].lower()


@pytest.mark.anyio
async def test_routing_endpoint_no_route():
    mock_resp = httpx.Response(400, text="No path could be found", request=httpx.Request("POST", "http://test"))

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp

        payload = {
            "start": {"latitude": 30.770726, "longitude": 76.576329},
            "destination": {"latitude": 0.0, "longitude": 0.0},
            "destination_name": "Middle of Ocean",
        }

        response = client.post("/api/v1/routing/walk", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "no_route_found"
        assert "No continuous walking route" in data["spoken_summary"]


@pytest.mark.anyio
async def test_routing_endpoint_timeout():
    with patch("httpx.AsyncClient.post", side_effect=httpx.TimeoutException("Connection timed out")):
        payload = {
            "start": {"latitude": 30.770726, "longitude": 76.576329},
            "destination": {"latitude": 30.769660, "longitude": 76.575543},
        }

        response = client.post("/api/v1/routing/walk", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "error"
        assert "timed out" in data["error_message"].lower()


@pytest.mark.anyio
async def test_routing_endpoint_stairs_detected():
    mock_valhalla_payload = {
        "trip": {
            "summary": {"length": 0.200, "time": 150.0},
            "legs": [
                {
                    "shape": "kabuy@qcz`qCbA?~DT",
                    "maneuvers": [
                        {
                            "instruction": "Walk south for 50 meters.",
                            "length": 0.050,
                            "time": 35.0,
                            "type": 1,
                            "begin_shape_index": 0,
                        },
                        {
                            "instruction": "Walk down steps toward footbridge.",
                            "length": 0.030,
                            "time": 30.0,
                            "type": 27,
                            "begin_shape_index": 1,
                        },
                    ],
                }
            ],
        }
    }

    mock_resp = httpx.Response(200, json=mock_valhalla_payload, request=httpx.Request("POST", "http://test"))

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp

        payload = {
            "start": {"latitude": 30.770726, "longitude": 76.576329},
            "destination": {"latitude": 30.769660, "longitude": 76.575543},
            "destination_name": "Footbridge",
            "avoid_stairs": True,
        }

        response = client.post("/api/v1/routing/walk", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["has_stairs"] is True
        assert data["accessibility_status"] == "contains_stairs"
        assert data["stairs_warning"] is not None
        assert "map data marks stairs" in data["stairs_warning"]
        assert "map data marks stairs" in data["spoken_summary"]
