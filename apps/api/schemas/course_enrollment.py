"""apps/api/schemas/course_enrollment.py
Pydantic v2 schemas for course enrollments.
"""
from typing import List, Optional
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


class CourseEnrollmentBatchCreate(CamelModel):
    student_ids: List[str]
    enrolled_at: Optional[str] = None


class CourseEnrollmentBatchResponse(CamelModel):
    course_id: str
    enrolled_count: int
    existing_count: int
    enrollments: List[CourseEnrollmentResponse]


class StudentBatchImportItem(CamelModel):
    name: str
    phone: str
    initial_pack_type: Optional[str] = "10_class"
    notes: Optional[str] = None


class CourseEnrollmentBatchImportCreate(CamelModel):
    students: List[StudentBatchImportItem]
    enrolled_at: Optional[str] = None


class CourseEnrollmentBatchImportResponse(CamelModel):
    course_id: str
    total_processed: int
    created_students_count: int
    existing_students_count: int
    enrolled_count: int
    enrollments: List[CourseEnrollmentResponse]
