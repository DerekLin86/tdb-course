"""apps/api/models/student.py
Student and TicketPack ORM models.
"""
from datetime import datetime
from database import Base, Column, String, Integer, Text, DateTime, ForeignKey, relationship


class Student(Base):
    __tablename__ = "students"

    id = Column(String(), primary_key=True, index=True)
    name = Column(String(), nullable=False, index=True)
    phone = Column(String(), nullable=False, unique=True, index=True)
    line_user_id = Column(String(), nullable=True)
    avatar_url = Column(String(), nullable=True)
    notes = Column(Text(), nullable=True)
    registered_at = Column(String(), nullable=False)
    created_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)
    updated_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)

    ticket_packs = relationship(
        "TicketPack",
        back_populates="student",
        cascade="all, delete-orphan",
        order_by="desc(TicketPack.purchase_date)"
    )
    attendance_records = relationship(
        "AttendanceRecord",
        back_populates="student",
        cascade="all, delete-orphan"
    )


class TicketPack(Base):
    __tablename__ = "ticket_packs"

    id = Column(String(), primary_key=True, index=True)
    student_id = Column(String(), foreign_key=ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(), nullable=False)  # '5_class', '10_class', 'single'
    total_count = Column(Integer(), nullable=False)
    remaining_count = Column(Integer(), nullable=False, default=0)
    purchase_date = Column(String(), nullable=False)  # YYYY-MM-DD
    expiry_date = Column(String(), nullable=False)    # YYYY-MM-DD
    status = Column(String(), nullable=False, default="active")  # 'active', 'expired', 'depleted'
    price_paid = Column(Integer(), nullable=True)     # 2500, 5000
    created_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)
    updated_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)

    student = relationship("Student", back_populates="ticket_packs")
