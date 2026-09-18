"""apps/api/tests/test_system.py
Tests for system health check and system data reset endpoint.
"""
from fastapi.testclient import TestClient
from database import Session, engine
from models.student import Student, TicketPack
from models.session import ClassSession
from models.attendance import AttendanceRecord


def test_health_check(client: TestClient):
    """Verify root health check endpoint."""
    resp = client.get("/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "Triple Dream Ballet API" in data["service"]
    assert data["docs"] == "/docs"


def test_system_reset_endpoint(client: TestClient, db_session: Session):
    """Verify POST /api/v1/system/reset drops mutated data and restores seed state."""
    # Add an extraneous student and session
    extra_student = Student(
        id="stu-extra-test",
        name="測試額外學員",
        phone="0999-999-999",
        registered_at="2026-09-01",
    )
    db_session.add(extra_student)
    db_session.commit()

    # Call reset
    resp = client.post("/api/v1/system/reset")
    assert resp.status_code == 200
    data = resp.json()
    assert "重置" in data["message"]
    assert data["studentsCount"] == 10
    assert data["ticketPacksCount"] == 10
    assert data["sessionsCount"] == 2
    assert data["attendanceCount"] == 2

    # Query DB to verify extra student is gone and seed data is intact
    with Session(engine) as db:
        assert db.query(Student).count() == 10
        assert db.get(Student, "stu-extra-test") is None
        assert db.get(Student, "stu-1") is not None
        assert db.query(TicketPack).count() == 10
        assert db.query(ClassSession).count() == 2
        assert db.query(AttendanceRecord).count() == 2
