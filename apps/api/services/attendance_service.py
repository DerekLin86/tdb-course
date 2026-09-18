"""apps/api/services/attendance_service.py
Attendance, Mode A Base64 check-in, 24-hour leave policy, and threshold cancellation refunds.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from database import Session, select
from models.session import ClassSession
from models.student import Student
from models.attendance import AttendanceRecord
from services.ticket_service import TicketService


class AttendanceService:
    """Encapsulates check-in, leave rules, and attendance operations."""

    @staticmethod
    def check_in(
        db: Session, session_id: str, student_id: str, signature_data_url: str
    ) -> Dict[str, Any]:
        """Mode A iPad Kiosk check-in with Base64 signature and 1-ticket deduction."""
        session = db.get(ClassSession, session_id)
        if not session:
            raise ValueError("查無當前課程")
        if session.status == "cancelled":
            raise ValueError("該課堂已取消順延，無法簽到")

        student = db.get(Student, student_id)
        if not student:
            raise ValueError("查無該學員")

        if not signature_data_url or not signature_data_url.startswith("data:image/"):
            raise ValueError("手寫簽名資料無效或為空")

        if ";base64," not in signature_data_url:
            raise ValueError("手寫簽名資料格式錯誤，缺少 Base64 編碼")

        b64_part = signature_data_url.split(";base64,", 1)[1].strip()
        if len(b64_part) < 50:
            raise ValueError("手寫簽名資料無效或簽名筆跡過短")

        # 1. Idempotency check: if already attended, do not deduct again
        stmt = select(AttendanceRecord).where(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.student_id == student_id,
        )
        record = db.scalars(stmt).first()
        if record and record.status == "attended":
            return {
                "success": True,
                "message": f"{student.name} 先前已完成簽到！",
                "record": record,
            }

        try:
            # 2. Ticket deduction (throws ValueError if depleted, commit=False for atomicity)
            pack = TicketService.deduct_ticket(db, student_id, count=1, commit=False)

            # 3. Create or update attendance record
            now_time = datetime.now().strftime("%H:%M:%S")
            if record:
                record.status = "attended"
                record.signature_data_url = signature_data_url
                record.signed_at = now_time
                record.deducted_count = 1
                record.remark = "教室 iPad 現場手寫簽到"
            else:
                record_id = f"att-{session_id}-{student_id}"
                record = AttendanceRecord(
                    id=record_id,
                    session_id=session_id,
                    student_id=student_id,
                    student_name=student.name,
                    status="attended",
                    signature_data_url=signature_data_url,
                    signed_at=now_time,
                    deducted_count=1,
                    remark="教室 iPad 現場手寫簽到",
                )
                db.add(record)

            db.commit()
            db.refresh(record)
            db.refresh(pack)
            return {
                "success": True,
                "message": f"✅ {student.name} 簽到成功！剩餘 {pack.remaining_count} 堂。",
                "record": record,
            }
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def request_leave(
        db: Session,
        session_id: str,
        student_id: str,
        reason: Optional[str] = None,
        simulation_hours: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Submits leave request applying the 24-hour break-even policy."""
        session = db.get(ClassSession, session_id)
        if not session:
            raise ValueError("查無當前課程")
        if session.status == "cancelled":
            raise ValueError("該課堂已取消順延，無法提出請假")

        student = db.get(Student, student_id)
        if not student:
            raise ValueError("查無該學員")

        # Check existing record
        stmt = select(AttendanceRecord).where(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.student_id == student_id,
        )
        record = db.scalars(stmt).first()
        if record:
            if record.status == "attended":
                raise ValueError("學員已完成現場簽到，無法提出請假！")
            if record.status in ["leave_advance", "leave_late"]:
                # Idempotent: return existing record without deducting additional tickets
                if reason and record.leave_reason != reason:
                    record.leave_reason = reason
                    db.commit()
                    db.refresh(record)
                return {
                    "success": True,
                    "is_advance": record.status == "leave_advance",
                    "deducted_count": record.deducted_count,
                    "message": f"{student.name} 先前已完成請假（{record.status}），不重複扣堂。",
                    "record": record,
                }

        # Determine hours until class
        if simulation_hours is not None:
            hours_left = float(simulation_hours)
        else:
            try:
                class_dt_str = f"{session.date} {session.start_time}"
                class_dt = datetime.strptime(class_dt_str, "%Y-%m-%d %H:%M")
                hours_left = (class_dt - datetime.now()).total_seconds() / 3600.0
            except ValueError:
                hours_left = 30.0

        is_advance = hours_left >= 24.0
        now_iso = datetime.now().isoformat()

        try:
            if is_advance:
                deducted_count = 0
                status = "leave_advance"
                leave_reason = reason or "提前請假 (保有堂數)"
                remark = f"開課前 {round(hours_left, 1)} 小時線上請假，完整保留堂數"
                msg = f"您已成功請假！距開課還有 {round(hours_left, 1)} 小時，堂數完整保留不扣除。"
            else:
                deducted_count = 1
                status = "leave_late"
                # Deduct 1 ticket for venue cost sharing with commit=False for atomicity
                TicketService.deduct_ticket(db, student_id, count=1, commit=False)
                leave_reason = reason or "逾時請假 (分攤場租扣堂)"
                remark = f"開課前 {round(hours_left, 1)} 小時請假（未達24小時前），依規則扣抵 1 堂場租"
                msg = f"距開課僅剩 {round(hours_left, 1)} 小時（不足24小時），已為您完成請假，並依規定扣抵 1 堂場租。"

            if record:
                record.status = status
                record.deducted_count = deducted_count
                record.leave_requested_at = now_iso
                record.leave_reason = leave_reason
                record.remark = remark
            else:
                record_id = f"att-{session_id}-{student_id}"
                record = AttendanceRecord(
                    id=record_id,
                    session_id=session_id,
                    student_id=student_id,
                    student_name=student.name,
                    status=status,
                    deducted_count=deducted_count,
                    leave_requested_at=now_iso,
                    leave_reason=leave_reason,
                    remark=remark,
                )
                db.add(record)

            db.commit()
            db.refresh(record)
            return {
                "success": True,
                "is_advance": is_advance,
                "deducted_count": deducted_count,
                "message": msg,
                "record": record,
            }
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def cancel_leave(db: Session, session_id: str, student_id: str) -> Dict[str, Any]:
        """Cancels leave request. Refunds 1 ticket if previously deducted for late leave."""
        stmt = select(AttendanceRecord).where(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.student_id == student_id,
        )
        record = db.scalars(stmt).first()
        if not record or record.status not in ["leave_advance", "leave_late"]:
            raise ValueError("查無該學員之請假紀錄")

        try:
            was_refunded = False
            if record.status == "leave_late" and record.deducted_count > 0:
                TicketService.refund_ticket(db, student_id, count=record.deducted_count, commit=False)
                was_refunded = True

            record.status = "registered"
            record.deducted_count = 0
            record.leave_requested_at = None
            record.leave_reason = None
            record.remark = "取消請假，恢復預約出席"
            db.commit()
            db.refresh(record)

            return {
                "success": True,
                "refunded": was_refunded,
                "message": "已取消請假，恢復預約出席" + ("，並已退還扣除之 1 堂票卡！" if was_refunded else "。"),
            }
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def cancel_session_due_to_threshold(
        db: Session, session_id: str, reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """Cancels session due to under-threshold risk, atomically refunding all deducted tickets."""
        session = db.get(ClassSession, session_id)
        if not session:
            raise ValueError("查無該課堂")
        if session.status == "cancelled":
            raise ValueError("該課堂已處於取消狀態")

        try:
            session.status = "cancelled"
            session.cancellation_reason = reason or "人數未達最低開班門檻（場租損益防護退租）"

            stmt = select(AttendanceRecord).where(
                AttendanceRecord.session_id == session_id,
                AttendanceRecord.deducted_count > 0,
            )
            deducted_records = db.scalars(stmt).all()
            total_refunded = 0

            for r in deducted_records:
                TicketService.refund_ticket(db, r.student_id, count=r.deducted_count, commit=False)
                total_refunded += r.deducted_count
                r.deducted_count = 0
                r.remark = (r.remark or "") + " [課堂取消，已全數退還堂數]"

            db.commit()
            return {
                "message": "課堂已取消順延，所有已扣堂數已全數退還學員！",
                "refunded_count": total_refunded,
            }
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def override_status(
        db: Session, session_id: str, student_id: str, status: str, remark: Optional[str] = None
    ) -> AttendanceRecord:
        """Manual admin override of attendance status."""
        session = db.get(ClassSession, session_id)
        if not session:
            raise ValueError("查無該課堂")
        student = db.get(Student, student_id)
        if not student:
            raise ValueError("查無該學員")

        stmt = select(AttendanceRecord).where(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.student_id == student_id,
        )
        record = db.scalars(stmt).first()
        deducted_count = 1 if status in ["attended", "leave_late", "absent"] else 0

        if record:
            record.status = status
            record.deducted_count = deducted_count
            record.remark = remark or "老師後台手動變更"
        else:
            record_id = f"att-{session_id}-{student_id}"
            record = AttendanceRecord(
                id=record_id,
                session_id=session_id,
                student_id=student_id,
                student_name=student.name,
                status=status,
                deducted_count=deducted_count,
                remark=remark or "老師後台手動變更",
            )
            db.add(record)

        db.commit()
        db.refresh(record)
        return record
