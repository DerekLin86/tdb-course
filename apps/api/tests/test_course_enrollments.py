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
from services.ticket_service import TicketService


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


def test_batch_enroll_students_in_course():
    """Test batch enrollment of existing students, ensuring all sessions are populated with attendance records."""
    with SessionLocal() as db:
        course = Course(id="course-test-batch", title="Batch Test Course")
        db.merge(course)
        session = ClassSession(
            id="session-test-batch-1",
            course_id="course-test-batch",
            date="2026-10-25",
            day_of_week="週日",
            start_time="10:00",
            end_time="11:30",
            title="Batch Class 1",
            venue_name="敦南 A",
            venue_cost=2000,
            fee_per_student=500,
        )
        db.merge(session)
        db.commit()

    client = TestClient(app)
    payload = {
        "studentIds": ["stu-2", "stu-3"],
        "enrolledAt": "2026-10-20",
    }
    resp = client.post("/api/v1/courses/course-test-batch/students/batch", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["courseId"] == "course-test-batch"
    assert data["enrolledCount"] == 2
    assert data["existingCount"] == 0
    assert len(data["enrollments"]) == 2

    # Calling batch again tests idempotency: existing_count == 2, enrolled_count == 0
    resp2 = client.post("/api/v1/courses/course-test-batch/students/batch", json=payload)
    assert resp2.status_code == 201
    data2 = resp2.json()
    assert data2["enrolledCount"] == 0
    assert data2["existingCount"] == 2

    with SessionLocal() as db:
        sessions = db.query(ClassSession).filter(ClassSession.course_id == "course-test-batch").all()
        assert len(sessions) > 0
        for sid in ["stu-2", "stu-3"]:
            enr = db.query(CourseEnrollment).filter(
                CourseEnrollment.course_id == "course-test-batch",
                CourseEnrollment.student_id == sid,
            ).first()
            assert enr is not None
            assert enr.status == "active"
            for s in sessions:
                att = db.query(AttendanceRecord).filter(
                    AttendanceRecord.session_id == s.id,
                    AttendanceRecord.student_id == sid,
                ).first()
                assert att is not None
                assert att.status == "registered"
                assert att.deducted_count == 0


def test_batch_import_students_into_course():
    """Test batch importing new and existing students by phone, verifying ticket pack creation and course enrollment."""
    with SessionLocal() as db:
        session = ClassSession(
            id="session-course-2-test",
            course_id="course-2",
            date="2026-10-28",
            day_of_week="週三",
            start_time="19:00",
            end_time="20:30",
            title="足尖技巧第 1 堂",
            venue_name="敦南日光舞蹈排練室 A 廳",
            venue_cost=2000,
            fee_per_student=550,
        )
        db.merge(session)
        db.commit()

    client = TestClient(app)
    new_phone = "0988-999-000"
    existing_phone = "0912-345-678"  # stu-1

    payload = {
        "students": [
            {
                "name": "陳秀琴",
                "phone": existing_phone,
                "notes": "舊生加入新期班",
                "initialPackType": "10_class",
            },
            {
                "name": "新同學李雅婷",
                "phone": new_phone,
                "notes": "初次報名芭蕾美姿",
                "initialPackType": "10_class",
            },
        ],
        "enrolledAt": "2026-10-20",
    }
    resp = client.post("/api/v1/courses/course-2/students/batch-import", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["courseId"] == "course-2"
    assert data["totalProcessed"] == 2
    assert data["existingStudentsCount"] == 1
    assert data["createdStudentsCount"] == 1
    assert data["enrolledCount"] == 2
    assert len(data["enrollments"]) == 2

    with SessionLocal() as db:
        # Verify new student exists and has ticket pack
        new_stu = db.query(Student).filter(Student.phone == new_phone).first()
        assert new_stu is not None
        assert new_stu.name == "新同學李雅婷"

        pack = TicketService.get_active_pack(db, new_stu.id)
        assert pack is not None
        assert pack.type == "10_class"
        assert pack.total_count == 10
        assert pack.remaining_count == 10

        # Verify enrollments and sessions
        sessions = db.query(ClassSession).filter(ClassSession.course_id == "course-2").all()
        assert len(sessions) > 0
        for stu_id in [new_stu.id, "stu-1"]:
            enr = db.query(CourseEnrollment).filter(
                CourseEnrollment.course_id == "course-2",
                CourseEnrollment.student_id == stu_id,
            ).first()
            assert enr is not None
            assert enr.status == "active"
            for s in sessions:
                att = db.query(AttendanceRecord).filter(
                    AttendanceRecord.session_id == s.id,
                    AttendanceRecord.student_id == stu_id,
                ).first()
                assert att is not None
                assert att.status == "registered"
                assert att.deducted_count == 0
