"""
SAARTHI Page & API Routes
=========================
Serves HTML dashboard and provides REST endpoints for configuration,
status, and Memory Palace inspection.
"""

import os
import json
import logging
from typing import Dict, Any, Optional
from fastapi import APIRouter, Request, Body, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from ..config import TEMPLATES_DIR, MODEL_NAME, get_gemini_key, set_gemini_key
from ..services.memory import memory_store

router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Serve the main application visual navigation interface."""
    return templates.TemplateResponse(request=request, name="index.html")


@router.get("/api/status")
async def get_system_status():
    """Return backend status, AI engine mode, and memory stats."""
    key = get_gemini_key()
    has_key = bool(key and len(key.strip()) > 5)
    locations = memory_store.get_locations()
    history = memory_store.data.get("history", [])
    
    return {
        "status": "online",
        "system": "SAARTHI Visual Navigation Assistant",
        "version": "1.0.0",
        "has_gemini_key": has_key,
        "active_model": MODEL_NAME,
        "engine": "Google Gemini 2.5/3 Flash" if has_key else "Intelligent Autonomous Vision Engine",
        "memory_locations_count": len(locations),
        "history_count": len(history)
    }


@router.post("/api/settings/key")
async def update_api_key(payload: Dict[str, Any] = Body(...)):
    """Update Gemini API Key dynamically and persist to .env."""
    key = payload.get("key", "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="Key cannot be empty")
    
    # Check if user passed model name too
    model_name = payload.get("model")
    if model_name:
        import os
        from .. import config
        config.MODEL_NAME = model_name
        os.environ["MODEL_NAME"] = model_name

    success = set_gemini_key(key, persist=True)
    if success:
        from ..services.processor import reset_gemini_client
        reset_gemini_client()
        return {"success": True, "message": "Gemini API key updated successfully."}
    else:
        return {"success": False, "message": "Failed to persist key to .env, but applied in memory."}


@router.get("/api/memory")
async def get_memory_data():
    """Retrieve full Memory Palace tagged locations and recent object history."""
    locations = memory_store.get_locations()
    history = memory_store.data.get("history", [])[-50:]
    return {
        "locations": locations,
        "history": history
    }


@router.post("/api/memory/tag")
async def add_memory_tag(payload: Dict[str, Any] = Body(...)):
    """Explicitly tag a location in the Memory Palace."""
    name = payload.get("name", "").strip()
    description = payload.get("description", "").strip()
    if not name or not description:
        raise HTTPException(status_code=400, detail="Name and description are required.")
    
    memory_store.add_location(name, description)
    return {"success": True, "name": name, "description": description}


@router.delete("/api/memory")
async def clear_memory():
    """Clear memory palace records."""
    memory_store.data = {"locations": {}, "history": []}
    memory_store.save()
    return {"success": True, "message": "Memory cleared."}
