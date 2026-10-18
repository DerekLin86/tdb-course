"""apps/api/schemas/course_enrollment.py
Pydantic v2 schemas for course enrollments.
"""
from typing import Optional
from .base import CamelModel
from .student import StudentResponse


class CourseEnrollmentCreate(CamelModel):
    student_id: str
    enrolled_at: Optional[str] = None  # YYYY-MM-DD, defaults to today if omitted


class CourseEnrollmentResponse(CamelModel):
    id: str
    course_id: str
    student_id: str
    enrolled_at: str
    status: str
    created_at: Optional[str] = None
    student: Optional[StudentResponse] = None


class CourseEnrollmentDeleteResponse(CamelModel):
    success: bool
    message: str
    removed_scheduled_count: int
    preserved_attended_count: int
