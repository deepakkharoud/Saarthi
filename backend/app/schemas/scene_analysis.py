"""Structured scene analysis schemas for Gemma 4 vision.

Returns validated structured information including:
- A concise spoken description.
- Visible objects with relative positions.
- Detected text and signs.
- Spatial descriptions only when supported by the image.
- Explicit uncertainty and limitations.
- Image quality assessment.

All distances, collision risks, and depth claims are excluded per safety rules.
"""
from typing import List, Optional
from pydantic import BaseModel, Field


class DetectedObject(BaseModel):
    """A single visually identifiable object in the scene."""

    label: str = Field(
        ...,
        description="Short name of the detected object (e.g. 'door', 'staircase', 'bench').",
        max_length=100,
    )
    relative_position: Optional[str] = Field(
        default=None,
        description="Qualitative position from camera perspective: 'left', 'center', 'right', 'above', 'below'. Null if indeterminate.",
        max_length=50,
    )
    confidence: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Object identification confidence.",
    )


class DetectedText(BaseModel):
    """A text fragment extracted from the scene."""

    text: str = Field(
        ...,
        description="Verbatim text as read from the image.",
        max_length=2000,
    )
    context: Optional[str] = Field(
        default=None,
        description="What surface the text appears on: 'sign', 'door', 'notice_board', 'screen', 'paper', 'other'.",
        max_length=50,
    )
    confidence: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
    )


class SceneAnalysisRequest(BaseModel):
    """Request for structured scene analysis."""

    image_base64: str = Field(
        ...,
        description="Base64-encoded JPEG or PNG image data.",
    )
    query: Optional[str] = Field(
        default=None,
        description="Optional user question about the scene (e.g. 'What sign is this?', 'Describe my surroundings').",
        max_length=2000,
    )
    mime_type: str = Field(
        default="image/jpeg",
        description="MIME type. Must be image/jpeg or image/png.",
    )
    include_objects: bool = Field(
        default=True,
        description="Whether to attempt object identification.",
    )
    include_text: bool = Field(
        default=True,
        description="Whether to attempt text extraction.",
    )


class SceneAnalysisResponse(BaseModel):
    """Structured scene analysis response from Gemma 4."""

    status: str = Field(
        default="success",
        description="'success', 'low_quality', 'error'.",
    )
    model: str = Field(
        default="",
        description="Model identifier used for inference.",
    )
    spoken_description: str = Field(
        ...,
        description="Concise 1-3 sentence description optimized for text-to-speech.",
    )
    objects: List[DetectedObject] = Field(
        default_factory=list,
        description="Visually identifiable objects in the scene.",
    )
    detected_texts: List[DetectedText] = Field(
        default_factory=list,
        description="Text fragments extracted from signs, notices, screens.",
    )
    spatial_description: Optional[str] = Field(
        default=None,
        description="Brief spatial layout description only when clearly supported by the image. Null if uncertain.",
        max_length=500,
    )
    uncertainties: List[str] = Field(
        default_factory=list,
        description="Aspects that could not be determined (e.g. 'sign text partially obscured').",
    )
    unchecked_areas: List[str] = Field(
        default_factory=lambda: [
            "Ground-level obstacles and drop-offs below the camera field of view",
            "Areas behind the camera or outside the visible frame",
        ],
        description="Regions not verified (never claim path is clear).",
    )
    image_quality: str = Field(
        default="adequate",
        description="'good', 'adequate', 'poor', 'unreadable'.",
    )
    needs_rescan: bool = Field(
        default=False,
        description="True if image quality prevents safe analysis.",
    )
    confidence: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Overall analysis confidence.",
    )
