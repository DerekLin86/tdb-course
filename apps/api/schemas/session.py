"""apps/api/schemas/session.py
Pydantic schemas for ClassSession and Financials.
"""
from typing import Literal, Optional
from .base import CamelModel

SessionStatus = Literal['scheduled', 'completed', 'cancelled']


class ClassSessionBase(CamelModel):
    date: str          # YYYY-MM-DD
    day_of_week: str   # e.g. '週六'
    start_time: str    # '14:00'
    end_time: str      # '15:30'
    title: str         # e.g. '成人優雅芭蕾美姿體雕班'
    venue_name: str    # e.g. '敦南日光舞蹈排練室 A 廳'
    venue_cost: int = 2000
    fee_per_student: int = 500
    max_capacity: int = 10
    min_threshold: int = 4
    status: SessionStatus = 'scheduled'
    cancellation_reason: Optional[str] = None


class ClassSessionCreate(ClassSessionBase):
    id: Optional[str] = None


class ClassSessionUpdate(CamelModel):
    title: Optional[str] = None
    status: Optional[SessionStatus] = None
    cancellation_reason: Optional[str] = None


class ClassSessionResponse(ClassSessionBase):
    id: str


class SessionFinancialStatsResponse(CamelModel):
    total_capacity: int
    expected_attendees: int
    actual_attended_count: int
    advance_leave_count: int
    late_leave_count: int
    absent_count: int
    min_threshold: int
    is_at_risk: bool
    effective_revenue: int
    venue_cost: int
    estimated_net_profit: int


class CancelThresholdRequest(CamelModel):
    reason: Optional[str] = "人數未達最低開班門檻（場租損益防護退租）"


class CancelThresholdResponse(CamelModel):
    message: str
    refunded_count: int
