"""apps/api/models/course.py
Course ORM model for multi-week curriculum and financial management.
"""
from datetime import datetime
from database import Base, Column, String, Integer, Text, DateTime, relationship


class Course(Base):
    __tablename__ = "courses"

    id = Column(String(), primary_key=True, index=True)
    title = Column(String(), nullable=False)
    description = Column(Text(), nullable=True, default="")
    total_sessions = Column(Integer(), nullable=False, default=8)
    default_venue_cost = Column(Integer(), nullable=False, default=2000)
    default_teacher_fee = Column(Integer(), nullable=False, default=1200)
    default_fee_per_student = Column(Integer(), nullable=False, default=500)
    min_threshold = Column(Integer(), nullable=False, default=4)
    status = Column(String(), nullable=False, default="active")
    start_date = Column(String(), nullable=True)
    end_date = Column(String(), nullable=True)
    created_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)
    updated_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)

    sessions = relationship(
        "ClassSession",
        back_populates="course",
        cascade="all, delete-orphan",
    )
