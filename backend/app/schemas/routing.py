from typing import List, Optional
from pydantic import BaseModel, Field


class Coordinates(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0, description="WGS84 Latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="WGS84 Longitude")


class WalkingManeuver(BaseModel):
    instruction: str = Field(..., description="Spoken turn-by-turn guidance")
    distance_meters: float = Field(..., ge=0.0)
    time_seconds: float = Field(..., ge=0.0)
    bearing_degrees: Optional[float] = None
    maneuver_type: Optional[str] = None
    location: Coordinates
    has_stairs: bool = Field(default=False, description="True if this specific maneuver involves steps or stairs")


class WalkingRouteRequest(BaseModel):
    start: Coordinates
    destination: Coordinates
    destination_name: Optional[str] = Field(default=None, description="Accessible label of target landmark")
    avoid_stairs: bool = Field(default=False, description="Prefer stair-free pedestrian paths")


class WalkingRouteResponse(BaseModel):
    status: str = Field(..., description="'success', 'no_route_found', or 'error'")
    total_distance_meters: float = Field(default=0.0)
    total_time_seconds: float = Field(default=0.0)
    polyline: str = Field(default="", description="Encoded polyline precision 6")
    coordinates: List[List[float]] = Field(default_factory=list, description="[[lat, lon], ...] coordinates along route")
    maneuvers: List[WalkingManeuver] = Field(default_factory=list)
    spoken_summary: str = Field(default="")
    has_stairs: bool = Field(default=False, description="True if any segment contains steps or stairs")
    accessibility_status: str = Field(
        default="unknown",
        description="'verified_stair_free', 'contains_stairs', or 'unknown'"
    )
    stairs_warning: Optional[str] = Field(
        default=None,
        description="Clear spoken warning if stairs could not be avoided"
    )
    error_message: Optional[str] = None
