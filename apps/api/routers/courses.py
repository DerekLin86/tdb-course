"""apps/api/routers/courses.py
REST router for curriculum courses and cohorts.
"""
from datetime import datetime
import random
import time
from typing import List, Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException, status
from database import Session, get_db, desc
from models.course import Course
from models.course_enrollment import CourseEnrollment
from models.student import Student
from models.session import ClassSession
from models.attendance import AttendanceRecord
from schemas.course import CourseCreate, CourseResponse
from schemas.course_enrollment import (
    CourseEnrollmentCreate,
    CourseEnrollmentResponse,
    CourseEnrollmentDeleteResponse,
    CourseEnrollmentBatchCreate,
    CourseEnrollmentBatchResponse,
    StudentBatchImportItem,
    CourseEnrollmentBatchImportCreate,
    CourseEnrollmentBatchImportResponse,
)
from schemas.student import StudentResponse, TicketPackResponse
from services.ticket_service import TicketService

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


@router.delete("/{course_id}", status_code=status.HTTP_200_OK)
def delete_course(course_id: str, db: Session = Depends(get_db)):
    """Delete a curriculum course and cascade-remove associated sessions and attendance records."""
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"查無此課程 (Course ID: {course_id})",
        )
    course_title = course.title
    sessions = db.query(ClassSession).filter(ClassSession.course_id == course_id).all()
    for s in sessions:
        attendance_records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == s.id).all()
        for a in attendance_records:
            db.delete(a)
        db.delete(s)
    db.delete(course)
    db.commit()
    return {
        "success": True,
        "message": f"課程【{course_title}】及所屬課堂與出勤紀錄已安全刪除",
    }


def _enrich_student_response(db: Session, student: Student) -> StudentResponse:
    """Enrich a student model into a StudentResponse with active pack and expiry calculations."""
    enriched = TicketService.enrich_student_data(db, student)
    pack_resp = (
        TicketPackResponse.model_validate(enriched["active_pack"])
        if enriched["active_pack"]
        else None
    )
    return StudentResponse(
        id=student.id,
        name=student.name,
        phone=student.phone,
        line_user_id=student.line_user_id,
        avatar_url=student.avatar_url,
        notes=student.notes,
        registered_at=student.registered_at,
        active_pack=pack_resp,
        days_until_expiry=enriched["days_until_expiry"],
        is_near_expiry=enriched["is_near_expiry"],
    )


def _build_enrollment_response(
    db: Session, enr: CourseEnrollment, student: Optional[Student]
) -> CourseEnrollmentResponse:
    """Build a CourseEnrollmentResponse object populated with enriched student info."""
    student_resp = _enrich_student_response(db, student) if student else None
    return CourseEnrollmentResponse(
        id=enr.id,
        course_id=enr.course_id,
        student_id=enr.student_id,
        enrolled_at=enr.enrolled_at,
        status=enr.status,
        created_at=str(enr.created_at) if enr.created_at else None,
        student=student_resp,
    )


def _sync_course_sessions_attendance(
    db: Session, course_id: str, student: Student, now_iso: str
) -> None:
    """Synchronize course sessions with a student, creating registered attendance records if missing."""
    sessions = db.query(ClassSession).filter(ClassSession.course_id == course_id).all()
    for s in sessions:
        existing_att = (
            db.query(AttendanceRecord)
            .filter(
                AttendanceRecord.session_id == s.id,
                AttendanceRecord.student_id == student.id,
            )
            .first()
        )
        if not existing_att:
            new_att = AttendanceRecord(
                id=f"att-{s.id}-{student.id}",
                session_id=s.id,
                student_id=student.id,
                student_name=student.name,
                status="registered",
                deducted_count=0,
                remark="期班報名自動登錄課堂名冊",
                created_at=now_iso,
                updated_at=now_iso,
            )
            db.add(new_att)


def _enroll_single_student(
    db: Session,
    course_id: str,
    student: Student,
    enrolled_date: str,
    now_iso: str,
) -> Tuple[CourseEnrollment, bool]:
    """Enroll a student into a course and sync sessions.
    Returns (CourseEnrollment, is_new_or_reactivated: bool).
    """
    existing_enr = (
        db.query(CourseEnrollment)
        .filter(
            CourseEnrollment.course_id == course_id,
            CourseEnrollment.student_id == student.id,
        )
        .first()
    )

    is_new = False
    if existing_enr:
        if existing_enr.status != "active":
            existing_enr.status = "active"
            existing_enr.enrolled_at = enrolled_date
            existing_enr.updated_at = now_iso
            db.commit()
            db.refresh(existing_enr)
            is_new = True
        enr_record = existing_enr
    else:
        is_new = True
        enr_id = f"enr-{course_id}-{student.id}"
        enr_record = CourseEnrollment(
            id=enr_id,
            course_id=course_id,
            student_id=student.id,
            enrolled_at=enrolled_date,
            status="active",
            created_at=now_iso,
            updated_at=now_iso,
        )
        db.add(enr_record)
        db.commit()
        db.refresh(enr_record)

    _sync_course_sessions_attendance(db, course_id, student, now_iso)
    db.commit()
    return enr_record, is_new


@router.get("/{course_id}/students", response_model=List[CourseEnrollmentResponse])
def get_course_students(course_id: str, db: Session = Depends(get_db)):
    """Get all enrolled students for a specific course."""
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"查無此課程 (Course ID: {course_id})",
        )
    enrollments = (
        db.query(CourseEnrollment)
        .filter(
            CourseEnrollment.course_id == course_id,
            CourseEnrollment.status == "active",
        )
        .all()
    )

    result = []
    for enr in enrollments:
        student = db.get(Student, enr.student_id)
        result.append(_build_enrollment_response(db, enr, student))
    return result


@router.post(
    "/{course_id}/students",
    response_model=CourseEnrollmentResponse,
    status_code=status.HTTP_201_CREATED,
)
def enroll_student_in_course(
    course_id: str,
    payload: CourseEnrollmentCreate,
    db: Session = Depends(get_db),
):
    """Enroll a student into a course and synchronize existing course sessions' attendance rosters."""
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"查無此課程 (Course ID: {course_id})",
        )
    student = db.get(Student, payload.student_id)
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"查無此學員 (Student ID: {payload.student_id})",
        )

    enrolled_date = payload.enrolled_at or datetime.now().strftime("%Y-%m-%d")
    now_iso = datetime.now().isoformat()

    enr_record, _ = _enroll_single_student(
        db, course_id, student, enrolled_date, now_iso
    )

    return _build_enrollment_response(db, enr_record, student)


@router.post(
    "/{course_id}/students/batch",
    response_model=CourseEnrollmentBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
def enroll_students_batch(
    course_id: str,
    payload: CourseEnrollmentBatchCreate,
    db: Session = Depends(get_db),
):
    """Batch enroll multiple existing students into a course."""
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"查無此課程 (Course ID: {course_id})",
        )

    enrolled_date = payload.enrolled_at or datetime.now().strftime("%Y-%m-%d")
    now_iso = datetime.now().isoformat()

    enrolled_count = 0
    existing_count = 0
    enrollments = []

    for student_id in payload.student_ids:
        student = db.get(Student, student_id)
        if not student:
            continue
        enr_record, is_new = _enroll_single_student(
            db, course_id, student, enrolled_date, now_iso
        )
        if is_new:
            enrolled_count += 1
        else:
            existing_count += 1
        enrollments.append(_build_enrollment_response(db, enr_record, student))

    return CourseEnrollmentBatchResponse(
        course_id=course_id,
        enrolled_count=enrolled_count,
        existing_count=existing_count,
        enrollments=enrollments,
    )


@router.post(
    "/{course_id}/students/batch-import",
    response_model=CourseEnrollmentBatchImportResponse,
    status_code=status.HTTP_201_CREATED,
)
def batch_import_students_into_course(
    course_id: str,
    payload: CourseEnrollmentBatchImportCreate,
    db: Session = Depends(get_db),
):
    """Batch import students (create or match by phone), provision initial ticket pack if new,
    and enroll into the course with session attendance synchronization.
    """
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"查無此課程 (Course ID: {course_id})",
        )

    enrolled_date = payload.enrolled_at or datetime.now().strftime("%Y-%m-%d")
    now_iso = datetime.now().isoformat()

    total_processed = 0
    created_students_count = 0
    existing_students_count = 0
    enrolled_count = 0
    enrollments = []

    for idx, item in enumerate(payload.students):
        clean_name = item.name.strip()
        clean_phone = item.phone.strip()
        if not clean_name or not clean_phone:
            continue

        total_processed += 1
        existing_student = (
            db.query(Student).filter(Student.phone == clean_phone).first()
        )

        if existing_student:
            student = existing_student
            existing_students_count += 1
        else:
            created_students_count += 1
            stu_id = f"stu-{int(time.time() * 1000)}-{idx}-{random.randint(100, 999)}"
            student = Student(
                id=stu_id,
                name=clean_name,
                phone=clean_phone,
                notes=item.notes,
                registered_at=enrolled_date,
            )
            db.add(student)
            db.commit()
            db.refresh(student)

            # Provision initial tickets if specified and valid
            if item.initial_pack_type:
                pack_key = item.initial_pack_type.strip().lower()
                if pack_key not in ["none", ""]:
                    valid_type = "10_class"
                    if pack_key in TicketService.PACK_CONFIGS:
                        valid_type = pack_key
                    elif "5" in pack_key:
                        valid_type = "5_class"
                    elif "single" in pack_key or "1" in pack_key or "單堂" in pack_key:
                        valid_type = "single"
                    elif "trial" in pack_key or "體驗" in pack_key:
                        valid_type = "trial"

                    try:
                        TicketService.purchase_pack(db, student.id, valid_type)
                    except Exception:
                        pass

        enr_record, is_new = _enroll_single_student(
            db, course_id, student, enrolled_date, now_iso
        )
        if is_new:
            enrolled_count += 1

        enrollments.append(_build_enrollment_response(db, enr_record, student))

    return CourseEnrollmentBatchImportResponse(
        course_id=course_id,
        total_processed=total_processed,
        created_students_count=created_students_count,
        existing_students_count=existing_students_count,
        enrolled_count=enrolled_count,
        enrollments=enrollments,
    )


@router.delete("/{course_id}/students/{student_id}", response_model=CourseEnrollmentDeleteResponse)
def remove_student_from_course(course_id: str, student_id: str, db: Session = Depends(get_db)):
    """Remove student from course: removes pending unfulfilled 'registered' session attendances,
    while safely preserving all historical attended and leave records!
    """
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"查無此課程 (Course ID: {course_id})",
        )
    enr = db.query(CourseEnrollment).filter(
        CourseEnrollment.course_id == course_id,
        CourseEnrollment.student_id == student_id
    ).first()
    if not enr:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="該學員尚未註冊加入此期班",
        )

    sessions = db.query(ClassSession).filter(ClassSession.course_id == course_id).all()
    session_ids = [s.id for s in sessions]

    removed_count = 0
    preserved_count = 0

    if session_ids:
        records = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id.in_(session_ids),
            AttendanceRecord.student_id == student_id
        ).all()

        for rec in records:
            if rec.status == "registered":
                db.delete(rec)
                removed_count += 1
            else:
                preserved_count += 1

    db.delete(enr)
    db.commit()

    return CourseEnrollmentDeleteResponse(
        success=True,
        message=f"學員已自期班【{course.title}】名冊中安全移除",
        removed_scheduled_count=removed_count,
        preserved_attended_count=preserved_count,
    )
