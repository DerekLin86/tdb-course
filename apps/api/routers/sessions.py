"""apps/api/routers/sessions.py
REST router for class sessions, break-even financials, and emergency cancellation.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from database import Session, get_db, desc
from models.session import ClassSession
from schemas.session import (
    ClassSessionCreate,
    ClassSessionResponse,
    SessionFinancialStatsResponse,
    CancelThresholdRequest,
    CancelThresholdResponse,
)
from services.financial_service import FinancialService
from services.attendance_service import AttendanceService

router = APIRouter(prefix="/sessions", tags=["Class Sessions & Financials"])


@router.get("", response_model=List[ClassSessionResponse])
def get_sessions(db: Session = Depends(get_db)):
    """Get all scheduled, completed, and cancelled class sessions."""
    sessions = db.query(ClassSession).order_by(desc(ClassSession.date)).all()
    return [ClassSessionResponse.model_validate(s) for s in sessions]


@router.post("", response_model=ClassSessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(payload: ClassSessionCreate, db: Session = Depends(get_db)):
    """Create a new class session schedule."""
    sess_id = payload.id or f"session-{payload.date}"
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
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return ClassSessionResponse.model_validate(session)


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
