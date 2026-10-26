import logging
from fastapi import APIRouter, HTTPException, status
from app.schemas.routing import WalkingRouteRequest, WalkingRouteResponse
from app.services.valhalla import calculate_walking_route

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post(
    "/walk",
    response_model=WalkingRouteResponse,
    summary="Calculate real outdoor pedestrian walking route using Valhalla",
    description=(
        "Queries the open-source Valhalla routing engine with OpenStreetMap data. "
        "Returns actual route coordinates, distance, and turn-by-turn spoken maneuvers. "
        "Never invents fake geometry if a pedestrian path is disconnected or unmapped."
    ),
)
async def get_walking_route(request: WalkingRouteRequest) -> WalkingRouteResponse:
    try:
        response = await calculate_walking_route(request)
        return response
    except Exception as exc:
        logger.exception("Failed to calculate walking route: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pedestrian routing failure: {str(exc)}",
        )
