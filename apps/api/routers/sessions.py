"""apps/api/routers/sessions.py
REST router for class sessions, break-even financials, and emergency cancellation.
"""
from datetime import datetime
import re
from typing import List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from database import Session, get_db, desc, asc
from models.session import ClassSession
from models.student import Student
from models.attendance import AttendanceRecord
from models.course_enrollment import CourseEnrollment
from schemas.session import (
    ClassSessionCreate,
    ClassSessionBatchCreate,
    ClassSessionResponse,
    SessionFinancialStatsResponse,
    CancelThresholdRequest,
    CancelThresholdResponse,
)
from services.financial_service import FinancialService
from services.attendance_service import AttendanceService

router = APIRouter(prefix="/sessions", tags=["Class Sessions & Financials"])


def _generate_session_id(
    db: Session,
    date: str,
    start_time: str,
    course_id: Optional[str] = None,
    explicit_id: Optional[str] = None,
    used_ids: Optional[set] = None,
) -> str:
    """Generates a collision-resistant unique ID for a class session while respecting explicit IDs."""
    if explicit_id:
        if used_ids is not None:
            used_ids.add(explicit_id)
        return explicit_id

    base_id = f"session-{date}"
    candidate = base_id
    occupied = (used_ids is not None and candidate in used_ids) or db.get(ClassSession, candidate) is not None
    if occupied:
        candidate = f"{base_id}-{start_time.replace(':', '')}"
        occupied = (used_ids is not None and candidate in used_ids) or db.get(ClassSession, candidate) is not None
        if occupied:
            candidate = f"{candidate}-{uuid.uuid4().hex[:6]}"

    if used_ids is not None:
        used_ids.add(candidate)
    return candidate


def _populate_session_roster(db: Session, session: ClassSession) -> None:
    """Automatically populates attendance records (status='registered', deducted_count=0,
    remark='期班建立課堂自動帶入名冊') for all active enrolled students in the course.
    """
    if not session.course_id:
        return

    enrollments = db.query(CourseEnrollment).filter(
        CourseEnrollment.course_id == session.course_id,
        CourseEnrollment.status == "active"
    ).all()

    now_iso = datetime.now().isoformat()
    for enr in enrollments:
        student = db.get(Student, enr.student_id)
        if not student:
            continue

        existing_att = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session.id,
            AttendanceRecord.student_id == student.id
        ).first()

        if not existing_att:
            new_att = AttendanceRecord(
                id=f"att-{session.id}-{student.id}",
                session_id=session.id,
                student_id=student.id,
                student_name=student.name,
                status="registered",
                deducted_count=0,
                remark="期班建立課堂自動帶入名冊",
                created_at=now_iso,
                updated_at=now_iso,
            )
            db.add(new_att)


def _reindex_course_sessions(
    db: Session,
    course_id: str,
    pending_sessions: Optional[List[ClassSession]] = None
) -> None:
    """Re-indexes session_index chronologically (1, 2, 3...) for all sessions belonging to the course
    based on asc(date), asc(start_time), and updates auto-generated titles if appropriate.
    """
    existing_sessions = db.query(ClassSession).filter(
        ClassSession.course_id == course_id
    ).all()

    sessions_map = {s.id: s for s in existing_sessions}
    if pending_sessions:
        for s in pending_sessions:
            if s.course_id == course_id:
                sessions_map[s.id] = s

    all_sessions = list(sessions_map.values())
    all_sessions.sort(key=lambda s: (s.date, s.start_time))

    for idx, s in enumerate(all_sessions, start=1):
        s.session_index = idx
        if s.title and re.search(r'第\s*\d+\s*堂', s.title):
            s.title = re.sub(r'第\s*\d+\s*堂', f'第 {idx} 堂', s.title)


@router.get("", response_model=List[ClassSessionResponse])
def get_sessions(db: Session = Depends(get_db)):
    """Get all scheduled, completed, and cancelled class sessions ordered by asc(date), asc(start_time)."""
    sessions = db.query(ClassSession).order_by(asc(ClassSession.date), asc(ClassSession.start_time)).all()
    sessions.sort(key=lambda s: (s.date, s.start_time))
    return [ClassSessionResponse.model_validate(s) for s in sessions]


@router.post("", response_model=ClassSessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(payload: ClassSessionCreate, db: Session = Depends(get_db)):
    """Create a new class session schedule."""
    sess_id = _generate_session_id(
        db=db,
        date=payload.date,
        start_time=payload.start_time,
        course_id=payload.course_id,
        explicit_id=payload.id,
    )
    session = ClassSession(
        id=sess_id,
        date=payload.date,
        day_of_week=payload.day_of_week,
        start_time=payload.start_time,
        end_time=payload.end_time,
        title=payload.title,
        venue_name=payload.venue_name,
        venue_cost=payload.venue_cost,
        fee_per_student=payload.fee_per_student,
        max_capacity=payload.max_capacity,
        min_threshold=payload.min_threshold,
        status=payload.status,
        cancellation_reason=payload.cancellation_reason,
        course_id=payload.course_id,
        session_index=payload.session_index,
        teacher_fee=payload.teacher_fee,
        other_cost=payload.other_cost,
    )
    db.add(session)

    if session.course_id:
        _populate_session_roster(db, session)
        _reindex_course_sessions(db, session.course_id, [session])

    db.commit()
    db.refresh(session)
    return ClassSessionResponse.model_validate(session)


@router.post("/batch", response_model=List[ClassSessionResponse], status_code=status.HTTP_201_CREATED)
def create_sessions_batch(payload: ClassSessionBatchCreate, db: Session = Depends(get_db)):
    """Atomically create multiple class sessions in batch.
    - Populates attendance records for enrolled students for each session.
    - Re-indexes session_index chronologically for affected courses.
    - Returns the list of created ClassSessionResponse ordered by asc(date), asc(start_time).
    """
    if not payload.sessions:
        return []

    created_sessions: List[ClassSession] = []
    used_ids: set = set()

    for item in payload.sessions:
        sess_id = _generate_session_id(
            db=db,
            date=item.date,
            start_time=item.start_time,
            course_id=item.course_id,
            explicit_id=item.id,
            used_ids=used_ids,
        )
        session = ClassSession(
            id=sess_id,
            date=item.date,
            day_of_week=item.day_of_week,
            start_time=item.start_time,
            end_time=item.end_time,
            title=item.title,
            venue_name=item.venue_name,
            venue_cost=item.venue_cost,
            fee_per_student=item.fee_per_student,
            max_capacity=item.max_capacity,
            min_threshold=item.min_threshold,
            status=item.status,
            cancellation_reason=item.cancellation_reason,
            course_id=item.course_id,
            session_index=item.session_index,
            teacher_fee=item.teacher_fee,
            other_cost=item.other_cost,
        )
        db.add(session)
        created_sessions.append(session)

    # 1. Populate attendance records for enrolled students for each session
    for session in created_sessions:
        if session.course_id:
            _populate_session_roster(db, session)

    # 2. Re-index session_index chronologically for affected courses
    affected_courses = {s.course_id for s in created_sessions if s.course_id}
    for course_id in affected_courses:
        _reindex_course_sessions(db, course_id, created_sessions)

    # 3. Commit all additions and reindexings atomically
    db.commit()

    # 4. Refresh all created sessions to reflect final persisted state
    for session in created_sessions:
        db.refresh(session)

    # 5. Order created sessions by asc(date), asc(start_time)
    created_sessions.sort(key=lambda s: (s.date, s.start_time))
    return [ClassSessionResponse.model_validate(s) for s in created_sessions]


@router.get("/{session_id}", response_model=ClassSessionResponse)
def get_session(session_id: str, db: Session = Depends(get_db)):
    """Get details of a specific class session."""
    session = db.get(ClassSession, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="查無該課堂")
    return ClassSessionResponse.model_validate(session)


@router.get("/{session_id}/financials", response_model=SessionFinancialStatsResponse)
def get_session_financials(session_id: str, db: Session = Depends(get_db)):
    """Calculate real-time break-even financials and 4-person risk alert for a session."""
    try:
        stats = FinancialService.get_session_financials(db, session_id)
        return SessionFinancialStatsResponse.model_validate(stats)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))


@router.post("/{session_id}/cancel-threshold", response_model=CancelThresholdResponse)
def cancel_session_due_to_threshold(
    session_id: str,
    payload: Optional[CancelThresholdRequest] = None,
    db: Session = Depends(get_db)
):
    """Emergency session cancellation due to break-even threshold failure.
    Atomically refunds all deducted tickets back to enrolled students.
    """
    reason = payload.reason if payload and payload.reason else "人數未達最低開班門檻（場租損益防護退租）"
    try:
        res = AttendanceService.cancel_session_due_to_threshold(db, session_id=session_id, reason=reason)
        return CancelThresholdResponse.model_validate(res)
    except ValueError as ve:
        err_msg = str(ve)
        if "查無" in err_msg:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=err_msg)
        elif "已處於取消" in err_msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=err_msg)
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err_msg)
