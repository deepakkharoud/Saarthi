"""
SAARTHI Configuration Module

This module consolidates all configuration constants, environment variables,
and settings for the SAARTHI application. It uses a robust pattern for
environment variable loading and provides typed constants for use throughout
the application.
"""

import os
import logging
from typing import Tuple, Optional
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# =============================================================================
# LOGGING CONFIGURATION
# =============================================================================
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

# =============================================================================
# PATH CONFIGURATION
# =============================================================================
BASE_DIR: Path = Path(__file__).resolve().parent.parent
DEBUG_DIR: Path = Path(os.getenv('DEBUG_DIR', 'debug'))
STATIC_DIR: Path = BASE_DIR / "static"
TEMPLATES_DIR: Path = BASE_DIR / "templates"

# Create debug directory if it doesn't exist
try:
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
except Exception as e:
    logging.warning(f"Could not create debug directory at {DEBUG_DIR}: {e}")

# =============================================================================
# IMAGE PROCESSING SETTINGS
# =============================================================================
# Dimensions for image resizing (width, height)
IMAGE_SIZE: Tuple[int, int] = (224, 160)
MODEL_NAME: str = os.getenv("MODEL_NAME", "gemini-2.5-flash")
MODEL_TIMEOUT: float = float(os.getenv('MODEL_TIMEOUT', '20.0'))

# =============================================================================
# SPEECH TIMING SETTINGS (in seconds)
# =============================================================================
# Minimum interval between repetitions of the same speech
CRITICAL_REPEAT_INTERVAL: float = 1.0
HIGH_REPEAT_INTERVAL: float = 2.0
MEDIUM_REPEAT_INTERVAL: float = 4.0
LOW_REPEAT_INTERVAL: float = 8.0

# =============================================================================
# DISTANCE THRESHOLDS (in meters)
# =============================================================================
CRITICAL_DISTANCE: float = 0.5
DANGER_DISTANCE: float = 1.0
CAUTION_DISTANCE: float = 2.0

# =============================================================================
# ANTI-REPETITION & LOGIC SETTINGS
# =============================================================================
SIMILARITY_THRESHOLD: float = 0.65
RECENT_MESSAGES_COUNT: int = 5

# =============================================================================
# API KEYS & SECURITY
# =============================================================================
GEMINI_KEY: Optional[str] = os.getenv("GEMINI_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

if not GEMINI_KEY:
    logging.warning("GEMINI_KEY is not set in environment variables. Local smart assistance engine will be used.")

def get_gemini_key() -> Optional[str]:
    """Get the active Gemini API key from memory or environment."""
    global GEMINI_KEY
    return GEMINI_KEY or os.getenv("GEMINI_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

def set_gemini_key(new_key: str, persist: bool = True) -> bool:
    """Update the Gemini API key at runtime and optionally persist to .env."""
    global GEMINI_KEY
    GEMINI_KEY = new_key.strip()
    os.environ["GEMINI_KEY"] = GEMINI_KEY
    
    if persist:
        env_path = BASE_DIR / ".env"
        try:
            lines = []
            if env_path.exists():
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.startswith("GEMINI_KEY="):
                            lines.append(f"GEMINI_KEY={GEMINI_KEY}\n")
                        else:
                            lines.append(line)
            else:
                lines = [f"GEMINI_KEY={GEMINI_KEY}\n", "LOG_LEVEL=INFO\n", f"MODEL_NAME={MODEL_NAME}\n"]
            
            # If GEMINI_KEY wasn't in existing lines, append it
            if not any(l.startswith("GEMINI_KEY=") for l in lines):
                lines.insert(0, f"GEMINI_KEY={GEMINI_KEY}\n")

            with open(env_path, "w", encoding="utf-8") as f:
                f.writelines(lines)
            return True
        except Exception as e:
            logging.error(f"Failed to persist GEMINI_KEY to .env: {e}")
            return False
    return True
