import math
import logging
from typing import List, Optional, Dict, Any
import httpx

from app.schemas.map import (
    ReverseGeocodeResponse,
    GeocodeResult,
    GeocodeResponse,
    NearbyPlace,
    NearbyResponse,
)

logger = logging.getLogger(__name__)

NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org"
USER_AGENT = "SaarthiAssistant-Navigation/1.0 (accessibility-app; contact: support@saarthi.edu)"
REQUEST_TIMEOUT_SECONDS = 7.0


def calculate_haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate geodesic distance in meters between two coordinates using Haversine formula."""
    r = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(r * c, 1)


class MapService:
    @staticmethod
    async def reverse_geocode(lat: float, lon: float) -> ReverseGeocodeResponse:
        """Resolve coordinates to human-readable street and surroundings using OpenStreetMap Nominatim."""
        headers = {"User-Agent": USER_AGENT}
        params = {
            "format": "jsonv2",
            "lat": str(lat),
            "lon": str(lon),
            "zoom": "18",
            "addressdetails": "1",
        }

        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                resp = await client.get(f"{NOMINATIM_BASE_URL}/reverse", params=params, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    addr = data.get("address", {})

                    road = addr.get("road") or addr.get("pedestrian") or addr.get("path") or addr.get("cycleway")
                    suburb = addr.get("suburb") or addr.get("neighbourhood") or addr.get("college") or addr.get("university") or addr.get("residential")
                    city = addr.get("city") or addr.get("town") or addr.get("county") or addr.get("state_district")
                    state = addr.get("state")
                    country = addr.get("country")
                    landmark = addr.get("amenity") or addr.get("building") or addr.get("tourism")

                    display_name = data.get("display_name", f"Location at {lat:.5f}, {lon:.5f}")

                    # Grounded conversational description for blind student
                    spoken_parts = []
                    if road and suburb:
                        spoken_parts.append(f"You are currently near {road} in {suburb}.")
                    elif road:
                        spoken_parts.append(f"You are currently on or near {road}.")
                    elif suburb:
                        spoken_parts.append(f"You are currently in {suburb}.")
                    elif city:
                        spoken_parts.append(f"You are currently in {city}.")
                    else:
                        spoken_parts.append("Your GPS position has been located on the campus map.")

                    if landmark:
                        spoken_parts.append(f"There is {landmark} nearby.")

                    spoken_parts.append("Where would you like to go?")
                    spoken_description = " ".join(spoken_parts)

                    return ReverseGeocodeResponse(
                        display_name=display_name,
                        road=road,
                        suburb=suburb,
                        city=city,
                        state=state,
                        country=country,
                        landmark=landmark,
                        spoken_description=spoken_description,
                        latitude=lat,
                        longitude=lon,
                    )
        except Exception as exc:
            logger.warning("Reverse geocode external request failed: %s", exc)

        # Fallback truthful response without hallucinations
        fallback_spoken = f"Your current GPS coordinates are active at latitude {lat:.4f}, longitude {lon:.4f}. Where would you like to go?"
        return ReverseGeocodeResponse(
            display_name=f"Coordinates: {lat:.5f}, {lon:.5f}",
            road=None,
            suburb=None,
            city=None,
            state=None,
            country=None,
            landmark=None,
            spoken_description=fallback_spoken,
            latitude=lat,
            longitude=lon,
        )

    @staticmethod
    async def geocode_search(query: str, lat: Optional[float] = None, lon: Optional[float] = None) -> GeocodeResponse:
        """Search for a destination or place by name using Nominatim."""
        cleaned_query = query.strip()
        if not cleaned_query:
            return GeocodeResponse(query=query, results=[])

        headers = {"User-Agent": USER_AGENT}
        params: Dict[str, Any] = {
            "format": "jsonv2",
            "q": cleaned_query,
            "limit": "8",
            "addressdetails": "1",
        }

        # If user coordinates are provided, bias the search viewbox around user's location (~50km radius)
        if lat is not None and lon is not None:
            delta = 0.5
            params["viewbox"] = f"{lon - delta},{lat + delta},{lon + delta},{lat - delta}"
            params["bounded"] = "0"  # Prefer nearby, but don't strictly reject if slightly outside

        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                resp = await client.get(f"{NOMINATIM_BASE_URL}/search", params=params, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    results: List[GeocodeResult] = []
                    for item in data:
                        try:
                            item_lat = float(item["lat"])
                            item_lon = float(item["lon"])
                            results.append(
                                GeocodeResult(
                                    id=str(item.get("place_id", f"{item_lat}_{item_lon}")),
                                    name=item.get("name") or item.get("display_name", "").split(",")[0],
                                    display_name=item.get("display_name", ""),
                                    latitude=item_lat,
                                    longitude=item_lon,
                                    category=item.get("category") or item.get("type"),
                                    place_type=item.get("type"),
                                )
                            )
                        except (ValueError, KeyError):
                            continue

                    return GeocodeResponse(query=cleaned_query, results=results)
        except Exception as exc:
            logger.warning("Geocode search failed: %s", exc)

        return GeocodeResponse(query=cleaned_query, results=[])

    @staticmethod
    async def search_nearby(
        lat: float,
        lon: float,
        category: str,
        radius_meters: float = 3000.0,
    ) -> NearbyResponse:
        """Find nearby verified amenities (hospitals, cafes, ATMs, bus stops, colleges) near user GPS."""
        headers = {"User-Agent": USER_AGENT}
        cat_lower = category.lower().strip()

        # Map common category queries to search terms
        amenity_query = cat_lower
        if "hospital" in cat_lower or "clinic" in cat_lower:
            amenity_query = "hospital"
        elif "food" in cat_lower or "restaurant" in cat_lower or "cafe" in cat_lower:
            amenity_query = "restaurant"
        elif "atm" in cat_lower or "bank" in cat_lower:
            amenity_query = "atm"
        elif "bus" in cat_lower or "transit" in cat_lower or "station" in cat_lower:
            amenity_query = "bus stop"
        elif "college" in cat_lower or "university" in cat_lower or "school" in cat_lower:
            amenity_query = "college"
        elif "petrol" in cat_lower or "fuel" in cat_lower or "gas" in cat_lower:
            amenity_query = "fuel"
        elif "pharmacy" in cat_lower or "chemist" in cat_lower:
            amenity_query = "pharmacy"

        delta = radius_meters / 111000.0  # Approx degree conversion
        params = {
            "format": "jsonv2",
            "q": amenity_query,
            "viewbox": f"{lon - delta},{lat + delta},{lon + delta},{lat - delta}",
            "bounded": "1",
            "limit": "10",
            "addressdetails": "1",
        }

        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                resp = await client.get(f"{NOMINATIM_BASE_URL}/search", params=params, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    places: List[NearbyPlace] = []
                    for item in data:
                        try:
                            item_lat = float(item["lat"])
                            item_lon = float(item["lon"])
                            dist = calculate_haversine_distance(lat, lon, item_lat, item_lon)
                            if dist <= radius_meters:
                                places.append(
                                    NearbyPlace(
                                        id=str(item.get("place_id", f"{item_lat}_{item_lon}")),
                                        name=item.get("name") or item.get("display_name", "").split(",")[0],
                                        category=item.get("type") or cat_lower,
                                        latitude=item_lat,
                                        longitude=item_lon,
                                        distance_meters=dist,
                                        address=item.get("display_name"),
                                    )
                                )
                        except (ValueError, KeyError):
                            continue

                    places.sort(key=lambda p: p.distance_meters)
                    return NearbyResponse(category=cat_lower, count=len(places), results=places)
        except Exception as exc:
            logger.warning("Nearby search failed: %s", exc)

        return NearbyResponse(category=cat_lower, count=0, results=[])
