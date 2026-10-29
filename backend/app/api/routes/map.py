import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.map import (
    ReverseGeocodeResponse,
    GeocodeResponse,
    NearbyResponse,
)
from app.services.map_service import MapService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get(
    "/reverse-geocode",
    response_model=ReverseGeocodeResponse,
    summary="Reverse geocode coordinates into grounded human-readable surroundings",
    description="Resolves latitude and longitude into street name, neighborhood, and spoken introduction for blind users.",
)
async def reverse_geocode(
    lat: float = Query(..., ge=-90.0, le=90.0, description="Latitude in degrees"),
    lon: float = Query(..., ge=-180.0, le=180.0, description="Longitude in degrees"),
) -> ReverseGeocodeResponse:
    try:
        return await MapService.reverse_geocode(lat=lat, lon=lon)
    except Exception as exc:
        logger.exception("Reverse geocoding error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reverse-geocode location: {str(exc)}",
        )


@router.get(
    "/geocode",
    response_model=GeocodeResponse,
    summary="Search destinations and landmarks by name",
    description="Resolves a spoken or typed destination query to real map coordinates and address.",
)
async def geocode_destination(
    q: str = Query(..., min_length=1, description="Destination search query"),
    lat: Optional[float] = Query(None, ge=-90.0, le=90.0, description="User current latitude for proximity biasing"),
    lon: Optional[float] = Query(None, ge=-180.0, le=180.0, description="User current longitude for proximity biasing"),
) -> GeocodeResponse:
    try:
        return await MapService.geocode_search(query=q, lat=lat, lon=lon)
    except Exception as exc:
        logger.exception("Destination geocoding error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to search destination: {str(exc)}",
        )


@router.get(
    "/nearby",
    response_model=NearbyResponse,
    summary="Search nearby verified amenities and landmarks",
    description="Finds verified nearby places such as hospitals, restaurants, ATMs, bus stops, colleges, and petrol pumps.",
)
async def get_nearby_places(
    lat: float = Query(..., ge=-90.0, le=90.0, description="User current latitude"),
    lon: float = Query(..., ge=-180.0, le=180.0, description="User current longitude"),
    category: str = Query("hospital", description="Category: hospital, food, atm, transit, college, fuel, pharmacy"),
    radius: float = Query(3000.0, ge=100.0, le=25000.0, description="Search radius in meters"),
) -> NearbyResponse:
    try:
        return await MapService.search_nearby(lat=lat, lon=lon, category=category, radius_meters=radius)
    except Exception as exc:
        logger.exception("Nearby search error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to search nearby places: {str(exc)}",
        )
