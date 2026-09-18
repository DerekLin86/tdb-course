"""apps/api/models/session.py
ClassSession ORM model.
"""
from datetime import datetime
from database import Base, Column, String, Integer, Text, DateTime, relationship


class ClassSession(Base):
    __tablename__ = "class_sessions"

    id = Column(String(), primary_key=True, index=True)
    date = Column(String(), nullable=False, index=True)  # YYYY-MM-DD
    day_of_week = Column(String(), nullable=False)       # e.g. '週六'
    start_time = Column(String(), nullable=False)        # '14:00'
    end_time = Column(String(), nullable=False)          # '15:30'
    title = Column(String(), nullable=False)             # '成人優雅芭蕾美姿體雕班'
    venue_name = Column(String(), nullable=False)        # '敦南日光舞蹈排練室 A 廳'
    venue_cost = Column(Integer(), nullable=False, default=2000)
    fee_per_student = Column(Integer(), nullable=False, default=500)
    max_capacity = Column(Integer(), nullable=False, default=10)
    min_threshold = Column(Integer(), nullable=False, default=4)
    status = Column(String(), nullable=False, default="scheduled")  # 'scheduled', 'completed', 'cancelled'
    cancellation_reason = Column(Text(), nullable=True)
    created_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)
    updated_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)

    attendance_records = relationship(
        "AttendanceRecord",
        back_populates="session",
        cascade="all, delete-orphan"
    )
