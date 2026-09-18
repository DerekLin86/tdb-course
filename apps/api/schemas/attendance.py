"""apps/api/schemas/attendance.py
Pydantic schemas for Attendance, Check-in, and Leave operations.
"""
from typing import Literal, Optional
from .base import CamelModel
from .student import StudentResponse, TicketPackResponse

AttendanceStatus = Literal['registered', 'attended', 'leave_advance', 'leave_late', 'absent']


class AttendanceRecordBase(CamelModel):
    session_id: str
    student_id: str
    student_name: str
    status: AttendanceStatus = 'registered'
    signature_data_url: Optional[str] = None
    signed_at: Optional[str] = None
    deducted_count: int = 0
    leave_requested_at: Optional[str] = None
    leave_reason: Optional[str] = None
    remark: Optional[str] = None


class AttendanceRecordResponse(AttendanceRecordBase):
    id: str
    student: Optional[StudentResponse] = None
    active_pack: Optional[TicketPackResponse] = None


class CheckInRequest(CamelModel):
    student_id: str
    signature_data_url: str


class CheckInResponse(CamelModel):
    success: bool
    message: str
    record: AttendanceRecordResponse


class LeaveRequest(CamelModel):
    student_id: str
    leave_reason: Optional[str] = None
    simulation_hours: Optional[float] = None


class LeaveResponse(CamelModel):
    success: bool
    message: str
    is_advance: bool
    deducted_count: int
    record: AttendanceRecordResponse


class CancelLeaveRequest(CamelModel):
    student_id: str


class CancelLeaveResponse(CamelModel):
    success: bool
    message: str
    refunded: bool


class AttendanceUpdateRequest(CamelModel):
    status: AttendanceStatus
    remark: Optional[str] = None
