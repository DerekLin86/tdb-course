"""apps/api/models/attendance.py
AttendanceRecord ORM model.
"""
from datetime import datetime
from database import Base, Column, String, Integer, Text, DateTime, ForeignKey, UniqueConstraint, relationship


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"

    id = Column(String(), primary_key=True, index=True)
    session_id = Column(String(), foreign_key=ForeignKey("class_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(String(), foreign_key=ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    student_name = Column(String(), nullable=False)
    status = Column(String(), nullable=False, default="registered")  # 'registered', 'attended', 'leave_advance', 'leave_late', 'absent'

    # Full Base64 PNG Data URL stored as SQLite TEXT
    signature_data_url = Column(Text(), nullable=True)
    signed_at = Column(String(), nullable=True)           # HH:mm:ss, e.g. '13:55:20'
    deducted_count = Column(Integer(), nullable=False, default=0)
    leave_requested_at = Column(String(), nullable=True)  # ISO string
    leave_reason = Column(String(), nullable=True)
    remark = Column(Text(), nullable=True)
    created_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)
    updated_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)

    __table_args__ = (
        UniqueConstraint("session_id", "student_id", name="uq_session_student"),
    )

    session = relationship("ClassSession", back_populates="attendance_records")
    student = relationship("Student", back_populates="attendance_records")
