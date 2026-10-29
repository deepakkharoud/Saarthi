import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
import httpx

from app.main import app
from app.services.map_service import calculate_haversine_distance, MapService

client = TestClient(app)


def test_haversine_distance_calculation():
    # Distance between two nearby points in Chandigarh University (~145m)
    dist = calculate_haversine_distance(30.770726, 76.576329, 30.769660, 76.575543)
    assert 120.0 < dist < 170.0


@pytest.mark.anyio
async def test_reverse_geocode_endpoint_mock():
    mock_payload = {
        "place_id": 12345,
        "display_name": "Ludhiana Road, Gharuan, Mohali, Punjab, India",
        "address": {
            "road": "Ludhiana Road",
            "suburb": "Gharuan",
            "city": "Mohali",
            "state": "Punjab",
            "country": "India",
            "amenity": "Chandigarh University",
        },
    }

    mock_resp = httpx.Response(200, json=mock_payload, request=httpx.Request("GET", "http://test"))

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_resp

        res = client.get("/api/v1/map/reverse-geocode?lat=30.7686&lon=76.5750")
        assert res.status_code == 200
        data = res.json()
        assert "Ludhiana Road" in data["road"]
        assert "Gharuan" in data["suburb"]
        assert "Ludhiana Road" in data["spoken_description"]
        assert "Chandigarh University" in data["spoken_description"]


@pytest.mark.anyio
async def test_geocode_search_endpoint():
    mock_payload = [
        {
            "place_id": 999,
            "name": "Civil Hospital",
            "display_name": "Civil Hospital, Kharar, Punjab, India",
            "lat": "30.7420",
            "lon": "76.6450",
            "type": "hospital",
            "category": "amenity",
        }
    ]

    mock_resp = httpx.Response(200, json=mock_payload, request=httpx.Request("GET", "http://test"))

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_resp

        res = client.get("/api/v1/map/geocode?q=hospital&lat=30.768&lon=76.575")
        assert res.status_code == 200
        data = res.json()
        assert len(data["results"]) == 1
        assert data["results"][0]["name"] == "Civil Hospital"
        assert data["results"][0]["latitude"] == 30.7420


@pytest.mark.anyio
async def test_nearby_endpoint():
    mock_payload = [
        {
            "place_id": 555,
            "name": "Apollo Pharmacy",
            "display_name": "Apollo Pharmacy, Main Market, Kharar",
            "lat": "30.7450",
            "lon": "76.6480",
            "type": "pharmacy",
        }
    ]

    mock_resp = httpx.Response(200, json=mock_payload, request=httpx.Request("GET", "http://test"))

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_resp

        res = client.get("/api/v1/map/nearby?lat=30.7455&lon=76.6482&category=pharmacy&radius=2000")
        assert res.status_code == 200
        data = res.json()
        assert data["count"] == 1
        assert data["results"][0]["name"] == "Apollo Pharmacy"
        assert data["results"][0]["distance_meters"] >= 0.0
