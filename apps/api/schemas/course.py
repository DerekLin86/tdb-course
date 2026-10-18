"""apps/api/schemas/course.py
Pydantic v2 schemas for Course management.
"""
from typing import Optional
from .base import CamelModel


class CourseBase(CamelModel):
    title: str
    description: Optional[str] = ""
    total_sessions: int = 8
    default_venue_cost: int = 2000
    default_teacher_fee: int = 1200
    default_fee_per_student: int = 500
    min_threshold: int = 4
    status: str = "active"
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class CourseCreate(CourseBase):
    id: Optional[str] = None


class CourseUpdate(CamelModel):
    title: Optional[str] = None
    description: Optional[str] = None
    total_sessions: Optional[int] = None
    default_venue_cost: Optional[int] = None
    default_teacher_fee: Optional[int] = None
    default_fee_per_student: Optional[int] = None
    min_threshold: Optional[int] = None
    status: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class CourseResponse(CourseBase):
    id: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
