"""apps/api/routers/courses.py
REST router for curriculum courses and cohorts.
"""
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from database import Session, get_db, desc
from models.course import Course
from schemas.course import CourseCreate, CourseResponse

router = APIRouter(prefix="/courses", tags=["Courses"])


@router.get("", response_model=List[CourseResponse])
def get_courses(db: Session = Depends(get_db)):
    """Get all courses ordered by created_at descending."""
    courses = db.query(Course).order_by(desc(Course.created_at)).all()
    return [CourseResponse.model_validate(c) for c in courses]


@router.post("", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
def create_course(payload: CourseCreate, db: Session = Depends(get_db)):
    """Create a new curriculum course."""
    course_id = payload.id or f"course-{int(datetime.now().timestamp() * 1000)}"
    now_iso = datetime.now().isoformat()
    course = Course(
        id=course_id,
        title=payload.title,
        description=payload.description or "",
        total_sessions=payload.total_sessions,
        default_venue_cost=payload.default_venue_cost,
        default_teacher_fee=payload.default_teacher_fee,
        default_fee_per_student=payload.default_fee_per_student,
        min_threshold=payload.min_threshold,
        status=payload.status,
        start_date=payload.start_date,
        end_date=payload.end_date,
        created_at=now_iso,
        updated_at=now_iso,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return CourseResponse.model_validate(course)


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(course_id: str, db: Session = Depends(get_db)):
    """Get details of a specific course by id."""
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"查無此課程 (Course ID: {course_id})",
        )
    return CourseResponse.model_validate(course)
