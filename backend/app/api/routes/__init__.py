from fastapi import APIRouter
from app.api.routes import health, ai, campus, routing

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(ai.router, prefix="/ai", tags=["AI"])
api_router.include_router(campus.router, prefix="/campus", tags=["Campus"])
api_router.include_router(routing.router, prefix="/routing", tags=["Routing"])

__all__ = ["api_router"]

