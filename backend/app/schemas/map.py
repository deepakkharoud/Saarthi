from typing import List, Optional, Any
from pydantic import BaseModel, Field


class ReverseGeocodeResponse(BaseModel):
    display_name: str = Field(..., description="Full formatted address string")
    road: Optional[str] = Field(None, description="Primary road or street name")
    suburb: Optional[str] = Field(None, description="Neighborhood, sector, or campus block")
    city: Optional[str] = Field(None, description="City, town, or district")
    state: Optional[str] = Field(None, description="State or province")
    country: Optional[str] = Field(None, description="Country name")
    landmark: Optional[str] = Field(None, description="Prominent nearby landmark if detected")
    spoken_description: str = Field(..., description="Conversational text-to-speech description for blind user")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)


class GeocodeResult(BaseModel):
    id: str = Field(..., description="Unique identifier or OSM place ID")
    name: str = Field(..., description="Short place or building name")
    display_name: str = Field(..., description="Full descriptive address")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    category: Optional[str] = Field(None, description="Category such as hospital, amenity, campus, shop")
    place_type: Optional[str] = Field(None, description="OSM type e.g. building, road, node")


class GeocodeResponse(BaseModel):
    query: str
    results: List[GeocodeResult] = Field(default_factory=list)


class NearbyPlace(BaseModel):
    id: str
    name: str
    category: str
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    distance_meters: float = Field(..., ge=0.0)
    address: Optional[str] = None


class NearbyResponse(BaseModel):
    category: str
    count: int
    results: List[NearbyPlace] = Field(default_factory=list)
