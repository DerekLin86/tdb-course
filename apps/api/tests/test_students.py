"""apps/api/tests/test_students.py
Tests for student CRUD, ticket pack purchase, extension, and expiry calculation.
"""
from datetime import date, timedelta
from fastapi.testclient import TestClient
from database import Session
from models.student import Student, TicketPack


def test_create_student(client: TestClient):
    payload = {
        "name": "王美玲",
        "phone": "0923-456-789",
        "notes": "膝蓋舊傷，動作適度",
    }
    resp = client.post("/api/v1/students", json=payload)
    assert resp.status_code in [200, 201]
    data = resp.json()
    assert data["name"] == "王美玲"
    assert data["phone"] == "0923-456-789"
    assert "id" in data


def test_list_students_with_pack_enrichment(client: TestClient, seed_student: Student, seed_pack: TicketPack):
    resp = client.get("/api/v1/students")
    assert resp.status_code == 200
    students = resp.json()
    assert len(students) >= 1

    target = next((s for s in students if s["id"] == seed_student.id), None)
    assert target is not None
    assert target["activePack"] is not None
    assert target["activePack"]["id"] == seed_pack.id
    assert target["activePack"]["remainingCount"] == 7
    assert isinstance(target["daysUntilExpiry"], int)


def test_get_student_by_id(client: TestClient, seed_student: Student, seed_pack: TicketPack):
    resp = client.get(f"/api/v1/students/{seed_student.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == seed_student.id
    assert data["name"] == seed_student.name
    assert data["activePack"]["id"] == seed_pack.id


def test_purchase_ticket_pack_5_class(client: TestClient, seed_student: Student):
    payload = {
        "studentId": seed_student.id,
        "type": "5_class",
        "totalCount": 5,
        "validityDays": 60,
        "pricePaid": 2500,
    }
    resp = client.post("/api/v1/ticket-packs", json=payload)
    assert resp.status_code in [200, 201]
    data = resp.json()
    assert data["type"] == "5_class"
    assert data["totalCount"] == 5
    assert data["remainingCount"] == 5
    assert data["status"] == "active"


def test_purchase_ticket_pack_10_class(client: TestClient, seed_student: Student):
    payload = {
        "studentId": seed_student.id,
        "type": "10_class",
        "totalCount": 10,
        "validityDays": 100,
        "pricePaid": 5000,
    }
    resp = client.post("/api/v1/ticket-packs", json=payload)
    assert resp.status_code in [200, 201]
    data = resp.json()
    assert data["type"] == "10_class"
    assert data["totalCount"] == 10
    assert data["remainingCount"] == 10
    assert data["status"] == "active"


def test_extend_pack_expiry_reactivates_expired_pack(client: TestClient, db_session: Session, seed_student: Student):
    """E-11: Expired pack with remaining balance reactivates when extended."""
    expired_date = (date.today() - timedelta(days=5)).strftime("%Y-%m-%d")
    pack = TicketPack(
        id="pack-expired-1",
        student_id=seed_student.id,
        type="10_class",
        total_count=10,
        remaining_count=3,
        purchase_date="2026-05-01",
        expiry_date=expired_date,
        status="expired",
        price_paid=5000,
    )
    db_session.add(pack)
    db_session.commit()

    resp = client.patch(f"/api/v1/ticket-packs/{pack.id}/extend", json={"extraDays": 30})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "active"
    assert data["expiryDate"] > expired_date


def test_near_expiry_flag_boundary(client: TestClient, db_session: Session, seed_student: Student):
    # Pack expiring in 10 days (<= 14 -> isNearExpiry: True)
    near_date = (date.today() + timedelta(days=10)).strftime("%Y-%m-%d")
    pack = TicketPack(
        id="pack-near-1",
        student_id=seed_student.id,
        type="5_class",
        total_count=5,
        remaining_count=2,
        purchase_date="2026-08-01",
        expiry_date=near_date,
        status="active",
        price_paid=2500,
    )
    db_session.add(pack)
    db_session.commit()

    resp = client.get("/api/v1/students")
    assert resp.status_code == 200
    target = next((s for s in resp.json() if s["id"] == seed_student.id), None)
    assert target is not None
    assert target["isNearExpiry"] is True
