"""apps/api/services/financial_service.py
Class session break-even financials, revenue calculation, and 4-person risk alert.
"""
from typing import Any, Dict, List
from database import Session, select
from models.session import ClassSession
from models.student import Student
from models.attendance import AttendanceRecord


class FinancialService:
    """Calculates class session financials, effective revenue, and break-even status."""

    @staticmethod
    def get_session_financials(db: Session, session_id: str) -> Dict[str, Any]:
        """Computes real-time financial stats and risk indicators for a class session."""
        session = db.get(ClassSession, session_id)
        if not session:
            raise ValueError("查無該課堂")

        all_students = db.scalars(select(Student)).all()
        stmt = select(AttendanceRecord).where(AttendanceRecord.session_id == session_id)
        records = db.scalars(stmt).all()
        record_map = {r.student_id: r for r in records}

        attended = 0
        registered = 0
        advance_leave = 0
        late_leave = 0
        absent = 0

        for stu in all_students:
            rec = record_map.get(stu.id)
            status = rec.status if rec else "registered"

            if status == "attended":
                attended += 1
            elif status == "registered":
                registered += 1
            elif status == "leave_advance":
                advance_leave += 1
            elif status == "leave_late":
                late_leave += 1
            elif status == "absent":
                absent += 1

        expected_attendees = registered + attended
        billable_count = attended + late_leave + absent + registered
        effective_revenue = billable_count * session.fee_per_student
        estimated_net_profit = effective_revenue - session.venue_cost
        is_at_risk = expected_attendees < session.min_threshold

        return {
            "total_capacity": session.max_capacity,
            "expected_attendees": expected_attendees,
            "actual_attended_count": attended,
            "advance_leave_count": advance_leave,
            "late_leave_count": late_leave,
            "absent_count": absent,
            "min_threshold": session.min_threshold,
            "is_at_risk": is_at_risk,
            "effective_revenue": effective_revenue,
            "venue_cost": session.venue_cost,
            "estimated_net_profit": estimated_net_profit,
        }
