import logging
import re
from typing import List, Optional, Tuple
import httpx
from app.core.config import get_settings
from app.schemas.routing import (
    Coordinates,
    WalkingManeuver,
    WalkingRouteRequest,
    WalkingRouteResponse,
)

logger = logging.getLogger(__name__)

# Valhalla maneuver types related to stairs/steps
# Type 27 in Valhalla indicates steps (kSteps)
STAIRS_MANEUVER_TYPE = "27"
STAIRS_REGEX = re.compile(r"\b(stairs|steps|stairway|staircase)\b", re.IGNORECASE)


def decode_valhalla_polyline(encoded: str, precision: int = 6) -> List[List[float]]:
    """Decode a Valhalla encoded polyline string (default precision 6) into [[lat, lon], ...] coordinates."""
    coordinates: List[List[float]] = []
    index = 0
    lat = 0
    lng = 0
    factor = 10**precision

    while index < len(encoded):
        byte = 0
        shift = 0
        result = 0

        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break

        dlat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += dlat

        shift = 0
        result = 0

        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break

        dlng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng += dlng

        coordinates.append([round(lat / factor, 6), round(lng / factor, 6)])

    return coordinates


async def calculate_walking_route(request: WalkingRouteRequest) -> WalkingRouteResponse:
    """Query Valhalla routing engine for real general-purpose pedestrian route with accessibility support."""
    settings = get_settings()
    dest_label = request.destination_name or "your destination"

    # Supported Valhalla pedestrian costing options for stair avoidance
    valhalla_body = {
        "locations": [
            {
                "lat": request.start.latitude,
                "lon": request.start.longitude,
                "type": "break",
            },
            {
                "lat": request.destination.latitude,
                "lon": request.destination.longitude,
                "type": "break",
            },
        ],
        "costing": "pedestrian",
        "costing_options": {
            "pedestrian": {
                "walking_speed": 4.2,  # Comfortable, safe pedestrian walking pace (4.2 km/h)
                # Valhalla has no use_stairs costing option. step_penalty biases routes away from stairs,
                # but is not a guarantee that a returned route is stair-free.
                "step_penalty": 300.0 if request.avoid_stairs else 0.0,
                "use_hills": 0.2 if request.avoid_stairs else 0.5,
                "use_lit": 0.0,
                # Request enhanced street, stairs, gate, and crossing instructions for blind pedestrians.
                "type": "blind",
            }
        },
        "directions_options": {
            "units": "kilometers",
            "language": "en-US",
        },
    }

    try:
        async with httpx.AsyncClient(timeout=settings.VALHALLA_TIMEOUT_SECONDS) as client:
            resp = await client.post(settings.VALHALLA_API_URL, json=valhalla_body)

            if resp.status_code != 200:
                logger.warning("Valhalla routing API error %d: %s", resp.status_code, resp.text)
                return WalkingRouteResponse(
                    status="no_route_found",
                    error_message="No continuous pedestrian path found between start and destination in OpenStreetMap data.",
                    spoken_summary=f"No continuous walking route found to {dest_label}. Pedestrian path may be unmapped or disconnected.",
                )

            data = resp.json()
            trip = data.get("trip", {})
            summary = trip.get("summary", {})
            legs = trip.get("legs", [])

            if not legs:
                return WalkingRouteResponse(
                    status="no_route_found",
                    error_message="Valhalla returned an empty route.",
                    spoken_summary=f"No walking path could be calculated to {dest_label}.",
                )

            primary_leg = legs[0]
            encoded_shape = primary_leg.get("shape", "")
            coordinates = decode_valhalla_polyline(encoded_shape, precision=6) if encoded_shape else []

            total_dist_meters = round(summary.get("length", 0.0) * 1000.0, 1)
            total_time_seconds = round(summary.get("time", 0.0), 1)

            maneuvers: List[WalkingManeuver] = []
            route_has_stairs = False

            for m in primary_leg.get("maneuvers", []):
                instruction = m.get("instruction", "")
                dist_m = round(m.get("length", 0.0) * 1000.0, 1)
                time_s = round(m.get("time", 0.0), 1)
                m_type = str(m["type"]) if "type" in m and m["type"] is not None else None

                # Detect if this specific maneuver involves steps or stairs
                is_stair_step = (m_type == STAIRS_MANEUVER_TYPE) or bool(STAIRS_REGEX.search(instruction))
                if is_stair_step:
                    route_has_stairs = True

                # Maneuver point
                pt_idx = m.get("begin_shape_index", 0)
                pt = coordinates[pt_idx] if pt_idx < len(coordinates) else [request.start.latitude, request.start.longitude]

                maneuvers.append(
                    WalkingManeuver(
                        instruction=instruction,
                        distance_meters=dist_m,
                        time_seconds=time_s,
                        bearing_degrees=float(m["bearing"]) if "bearing" in m and m["bearing"] is not None else None,
                        maneuver_type=m_type,
                        location=Coordinates(latitude=pt[0], longitude=pt[1]),
                        has_stairs=is_stair_step,
                    )
                )

            # Determine genuine accessibility status
            stairs_warning: Optional[str] = None
            if route_has_stairs:
                accessibility_status = "contains_stairs"
                stairs_warning = (
                    "Warning: Valhalla map data marks stairs on this route."
                    if not request.avoid_stairs
                    else "Warning: Valhalla map data marks stairs on this route; no stair-free alternative was found."
                )
            else:
                # Missing stair instructions do not prove that the underlying map is complete.
                accessibility_status = "unknown"
                stairs_warning = (
                    "Stair avoidance was requested, but map data cannot confirm that this route is stair-free."
                    if request.avoid_stairs
                    else "Stair details may be incomplete in map data; this route may include stairs."
                )

            # Formulate clear spoken summary
            dist_str = (
                f"{total_dist_meters / 1000.0:.1f} kilometers"
                if total_dist_meters >= 1000.0
                else f"{MathRound(total_dist_meters)} meters"
            )
            time_str = f"{max(1, MathRound(total_time_seconds / 60.0))} minutes walk"

            summary_parts = [
                f"Walking route to {dest_label} found.",
                f"Total distance: {dist_str}, approximately {time_str}.",
            ]
            if stairs_warning:
                summary_parts.append(stairs_warning)

            if maneuvers:
                summary_parts.append(f"First step: {maneuvers[0].instruction}")
            else:
                summary_parts.append("Head towards destination.")

            spoken_summary = " ".join(summary_parts)

            return WalkingRouteResponse(
                status="success",
                total_distance_meters=total_dist_meters,
                total_time_seconds=total_time_seconds,
                polyline=encoded_shape,
                coordinates=coordinates,
                maneuvers=maneuvers,
                spoken_summary=spoken_summary,
                has_stairs=route_has_stairs,
                accessibility_status=accessibility_status,
                stairs_warning=stairs_warning,
            )

    except httpx.TimeoutException:
        logger.error("Valhalla routing timed out after %s seconds", settings.VALHALLA_TIMEOUT_SECONDS)
        return WalkingRouteResponse(
            status="error",
            error_message="Routing service request timed out.",
            spoken_summary="Routing service timed out. Please check network connection.",
        )
    except Exception as exc:
        logger.exception("Unexpected routing error: %s", exc)
        return WalkingRouteResponse(
            status="error",
            error_message=str(exc),
            spoken_summary="An error occurred while calculating the walking route.",
        )


def MathRound(val: float) -> int:
    return int(round(val))
