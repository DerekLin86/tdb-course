"""apps/api/tests/test_course_enrollments.py
Pytest integration tests for course-level student enrollment, idempotent backfill,
and session attendance inheritance.
"""
import pytest
from fastapi.testclient import TestClient
from main import app
from database import SessionLocal, init_db, backfill_course_enrollments, engine
from models.course import Course
from models.course_enrollment import CourseEnrollment
from models.session import ClassSession
from models.student import Student
from models.attendance import AttendanceRecord


@pytest.fixture(autouse=True)
def setup_db():
    init_db(seed=True, force_seed=True)
    yield


def test_backfill_course_enrollments_idempotency():
    """Verify safe idempotent backfill does not lose data or duplicate."""
    with SessionLocal() as db:
        course = Course(id="course-test-backfill", title="Backfill Course")
        db.merge(course)
        session = ClassSession(
            id="session-test-backfill",
            course_id="course-test-backfill",
            date="2026-10-20",
            day_of_week="週二",
            start_time="14:00",
            end_time="15:30",
            title="Backfill Session",
            venue_name="敦南 A",
            venue_cost=2000,
            fee_per_student=500,
        )
        db.merge(session)
        att = AttendanceRecord(
            id="att-test-backfill-stu-1",
            session_id="session-test-backfill",
            student_id="stu-1",
            student_name="陳秀琴",
            status="attended",
            signature_data_url="data:image/svg+xml;base64,mock",
            deducted_count=1,
        )
        db.merge(att)
        db.commit()

        inserted = backfill_course_enrollments(engine)
        assert inserted >= 1

        enr = db.query(CourseEnrollment).filter(
            CourseEnrollment.course_id == "course-test-backfill",
            CourseEnrollment.student_id == "stu-1"
        ).first()
        assert enr is not None
        assert enr.status == "active"

        inserted_again = backfill_course_enrollments(engine)
        assert inserted_again == 0


def test_enroll_student_in_course_syncs_existing_sessions():
    """Enrolling a student in a course should automatically register them in all existing sessions."""
    client = TestClient(app)
    resp = client.post("/api/v1/courses/course-1/students", json={"studentId": "stu-10"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["studentId"] == "stu-10"
    assert data["courseId"] == "course-1"

    with SessionLocal() as db:
        sessions = db.query(ClassSession).filter(ClassSession.course_id == "course-1").all()
        assert len(sessions) > 0
        for s in sessions:
            att = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == s.id,
                AttendanceRecord.student_id == "stu-10"
            ).first()
            assert att is not None
            assert att.status == "registered"


def test_enroll_student_in_course_idempotent():
    """Multiple enroll calls for the same student return the existing enrollment."""
    client = TestClient(app)
    resp1 = client.post("/api/v1/courses/course-1/students", json={"studentId": "stu-5"})
    assert resp1.status_code == 201
    resp2 = client.post("/api/v1/courses/course-1/students", json={"studentId": "stu-5"})
    assert resp2.status_code == 201
    assert resp1.json()["id"] == resp2.json()["id"]


def test_remove_student_from_course_preserves_attended_records():
    """Removing student from course deletes scheduled reservations but preserves historical attendances."""
    client = TestClient(app)
    resp = client.delete("/api/v1/courses/course-1/students/stu-1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["preservedAttendedCount"] >= 1

    with SessionLocal() as db:
        enr = db.query(CourseEnrollment).filter(
            CourseEnrollment.course_id == "course-1",
            CourseEnrollment.student_id == "stu-1"
        ).first()
        assert enr is None

        att_prev = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == "session-upcoming",
            AttendanceRecord.student_id == "stu-1"
        ).first()
        assert att_prev is not None
        assert att_prev.status == "attended"
        assert att_prev.deducted_count == 1
