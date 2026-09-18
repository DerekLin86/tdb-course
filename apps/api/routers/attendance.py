"""apps/api/routers/attendance.py
REST router for attendance, Mode A check-in, and 24h leave management.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from database import Session, get_db
from models.session import ClassSession
from models.student import Student
from models.attendance import AttendanceRecord
from schemas.student import StudentResponse, TicketPackResponse
from schemas.attendance import (
    AttendanceRecordResponse,
    CheckInRequest,
    CheckInResponse,
    LeaveRequest,
    LeaveResponse,
    CancelLeaveRequest,
    CancelLeaveResponse,
    AttendanceUpdateRequest,
)
from services.attendance_service import AttendanceService
from services.ticket_service import TicketService

router = APIRouter(prefix="/sessions", tags=["Attendance & Check-in"])


def _enrich_attendance_response(db: Session, record: AttendanceRecord) -> AttendanceRecordResponse:
    """Enriches an attendance record with student profile and active pack."""
    student = db.get(Student, record.student_id)
    student_resp: Optional[StudentResponse] = None
    pack_resp: Optional[TicketPackResponse] = None

    if student:
        enriched = TicketService.enrich_student_data(db, student)
        active_pack = enriched["active_pack"]
        if active_pack:
            pack_resp = TicketPackResponse.model_validate(active_pack)
        student_resp = StudentResponse.model_validate({
            "id": student.id,
            "name": student.name,
            "phone": student.phone,
            "line_user_id": student.line_user_id,
            "avatar_url": student.avatar_url,
            "notes": student.notes,
            "registered_at": student.registered_at,
            "active_pack": pack_resp,
            "days_until_expiry": enriched["days_until_expiry"],
            "is_near_expiry": enriched["is_near_expiry"],
        })

    r_dict = {
        "id": record.id,
        "session_id": record.session_id,
        "student_id": record.student_id,
        "student_name": record.student_name,
        "status": record.status,
        "signature_data_url": record.signature_data_url,
        "signed_at": record.signed_at,
        "deducted_count": record.deducted_count,
        "leave_requested_at": record.leave_requested_at,
        "leave_reason": record.leave_reason,
        "remark": record.remark,
        "student": student_resp,
        "active_pack": pack_resp,
    }
    return AttendanceRecordResponse.model_validate(r_dict)


@router.get("/{session_id}/attendance", response_model=List[AttendanceRecordResponse])
def get_session_attendance(session_id: str, db: Session = Depends(get_db)):
    """Fetch attendance roster for a specific session with enriched student and pack data."""
    session = db.get(ClassSession, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="查無該課堂")

    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
    return [_enrich_attendance_response(db, r) for r in records]


@router.post("/{session_id}/check-in", response_model=CheckInResponse)
def check_in_with_signature(session_id: str, payload: CheckInRequest, db: Session = Depends(get_db)):
    """Mode A iPad Kiosk sign-in with Canvas Base64 PNG signature.
    Deducts 1 class from student's active ticket pack. Idempotent.
    """
    try:
        res = AttendanceService.check_in(
            db,
            session_id=session_id,
            student_id=payload.student_id,
            signature_data_url=payload.signature_data_url,
        )
        return CheckInResponse(
            success=res["success"],
            message=res["message"],
            record=_enrich_attendance_response(db, res["record"]),
        )
    except ValueError as ve:
        err_msg = str(ve)
        status_code = status.HTTP_404_NOT_FOUND if "查無" in err_msg else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=err_msg)


@router.post("/{session_id}/leave", response_model=LeaveResponse)
def request_leave(session_id: str, payload: LeaveRequest, db: Session = Depends(get_db)):
    """24-hour leave policy rule:
    - Hours until class >= 24.0h: leave_advance, deductedCount = 0.
    - Hours until class < 24.0h: leave_late, deductedCount = 1 (covers fixed venue cost).
    """
    try:
        res = AttendanceService.request_leave(
            db,
            session_id=session_id,
            student_id=payload.student_id,
            reason=payload.leave_reason,
            simulation_hours=payload.simulation_hours,
        )
        return LeaveResponse(
            success=res["success"],
            message=res["message"],
            is_advance=res["is_advance"],
            deducted_count=res["deducted_count"],
            record=_enrich_attendance_response(db, res["record"]),
        )
    except ValueError as ve:
        err_msg = str(ve)
        status_code = status.HTTP_404_NOT_FOUND if "查無" in err_msg else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=err_msg)


@router.post("/{session_id}/cancel-leave", response_model=CancelLeaveResponse)
def cancel_leave(session_id: str, payload: CancelLeaveRequest, db: Session = Depends(get_db)):
    """Cancel leave request, restoring reservation. Refunds 1 ticket if previously late leave."""
    try:
        res = AttendanceService.cancel_leave(db, session_id=session_id, student_id=payload.student_id)
        return CancelLeaveResponse(
            success=res["success"],
            message=res["message"],
            refunded=res["refunded"],
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))


@router.put("/{session_id}/attendance/{student_id}", response_model=AttendanceRecordResponse)
def update_attendance_status(
    session_id: str,
    student_id: str,
    payload: AttendanceUpdateRequest,
    db: Session = Depends(get_db)
):
    """Admin manual override of student attendance status."""
    try:
        record = AttendanceService.override_status(
            db,
            session_id=session_id,
            student_id=student_id,
            status=payload.status,
            remark=payload.remark,
        )
        return _enrich_attendance_response(db, record)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
