"""apps/api/models/course_enrollment.py
CourseEnrollment ORM model for binding students directly to curriculum courses.
"""
from datetime import datetime
from database import Base, Column, String, DateTime, ForeignKey, UniqueConstraint, relationship


class CourseEnrollment(Base):
    __tablename__ = "course_enrollments"

    id = Column(String(), primary_key=True, index=True)
    course_id = Column(
        String(),
        foreign_key=ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    student_id = Column(
        String(),
        foreign_key=ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    enrolled_at = Column(String(), nullable=False)  # YYYY-MM-DD
    status = Column(String(), nullable=False, default="active")  # 'active', 'dropped', 'completed'
    created_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)
    updated_at = Column(DateTime(), default=lambda: datetime.now().isoformat(), nullable=False)

    __table_args__ = (
        UniqueConstraint("course_id", "student_id", name="uq_course_student"),
    )

    course = relationship("Course", back_populates="enrollments")
    student = relationship("Student", back_populates="course_enrollments")
