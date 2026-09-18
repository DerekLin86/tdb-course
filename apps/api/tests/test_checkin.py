"""apps/api/tests/test_checkin.py
Tests for Mode A iPad Kiosk check-in, signature persistence, and deduction rules.
"""
from fastapi.testclient import TestClient
from database import Session
from models.session import ClassSession
from models.student import Student, TicketPack
from models.attendance import AttendanceRecord


def test_successful_mode_a_kiosk_checkin(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    sample_signature: str,
):
    initial_remaining = seed_pack.remaining_count
    payload = {
        "studentId": seed_student.id,
        "signatureDataUrl": sample_signature,
    }
    resp = client.post(f"/api/v1/sessions/{seed_session.id}/check-in", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "簽到成功" in data["message"]
    assert data["record"]["status"] == "attended"
    assert data["record"]["deductedCount"] == 1
    assert data["record"]["signatureDataUrl"] == sample_signature

    # Verify student pack was decremented
    resp_student = client.get("/api/v1/students")
    stu_data = next((s for s in resp_student.json() if s["id"] == seed_student.id), None)
    assert stu_data["activePack"]["remainingCount"] == initial_remaining - 1


def test_checkin_depletes_ticket_pack(
    client: TestClient,
    db_session: Session,
    seed_session: ClassSession,
    seed_student: Student,
    sample_signature: str,
):
    """E-03: Pack with exactly 1 ticket left transitions to 'depleted' upon check-in."""
    pack = TicketPack(
        id="pack-last-1",
        student_id=seed_student.id,
        type="5_class",
        total_count=5,
        remaining_count=1,
        purchase_date="2026-08-01",
        expiry_date="2026-11-01",
        status="active",
        price_paid=2500,
    )
    db_session.add(pack)
    db_session.commit()

    payload = {"studentId": seed_student.id, "signatureDataUrl": sample_signature}
    resp = client.post(f"/api/v1/sessions/{seed_session.id}/check-in", json=payload)
    assert resp.status_code == 200

    db_session.refresh(pack)
    assert pack.remaining_count == 0
    assert pack.status == "depleted"


def test_checkin_with_zero_remaining_tickets_fails(
    client: TestClient,
    db_session: Session,
    seed_session: ClassSession,
    seed_student: Student,
    sample_signature: str,
):
    """E-04: Student with 0 remaining tickets is rejected with HTTP 400."""
    pack = TicketPack(
        id="pack-depleted-0",
        student_id=seed_student.id,
        type="5_class",
        total_count=5,
        remaining_count=0,
        purchase_date="2026-08-01",
        expiry_date="2026-11-01",
        status="depleted",
        price_paid=2500,
    )
    db_session.add(pack)
    db_session.commit()

    payload = {"studentId": seed_student.id, "signatureDataUrl": sample_signature}
    resp = client.post(f"/api/v1/sessions/{seed_session.id}/check-in", json=payload)
    assert resp.status_code == 400
    assert "用罄" in resp.json()["detail"]


def test_checkin_idempotency_prevents_double_deduction(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    sample_signature: str,
):
    """E-05: Duplicate check-ins do not deduct additional tickets."""
    payload = {"studentId": seed_student.id, "signatureDataUrl": sample_signature}
    # First check-in
    resp1 = client.post(f"/api/v1/sessions/{seed_session.id}/check-in", json=payload)
    assert resp1.status_code == 200

    # Second check-in
    resp2 = client.post(f"/api/v1/sessions/{seed_session.id}/check-in", json=payload)
    assert resp2.status_code == 200
    assert "已完成簽到" in resp2.json()["message"]

    # Balance was decremented only once (7 - 1 = 6)
    resp_student = client.get("/api/v1/students")
    stu_data = next((s for s in resp_student.json() if s["id"] == seed_student.id), None)
    assert stu_data["activePack"]["remainingCount"] == 6


def test_store_and_retrieve_large_base64_signature(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
):
    """E-10: 100KB+ Base64 PNG signature stored and retrieved without truncation."""
    large_signature = "data:image/png;base64," + ("A" * 100000)
    payload = {"studentId": seed_student.id, "signatureDataUrl": large_signature}
    resp = client.post(f"/api/v1/sessions/{seed_session.id}/check-in", json=payload)
    assert resp.status_code == 200

    resp_att = client.get(f"/api/v1/sessions/{seed_session.id}/attendance")
    assert resp_att.status_code == 200
    records = resp_att.json()
    record = next((r for r in records if r["studentId"] == seed_student.id), None)
    assert record is not None
    assert record["signatureDataUrl"] == large_signature


def test_invalid_signature_rejected(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
):
    payload = {"studentId": seed_student.id, "signatureDataUrl": "invalid_format"}
    resp = client.post(f"/api/v1/sessions/{seed_session.id}/check-in", json=payload)
    assert resp.status_code == 400


def test_checkin_on_cancelled_session_fails(
    client: TestClient,
    db_session: Session,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    sample_signature: str,
):
    seed_session.status = "cancelled"
    db_session.commit()

    payload = {"studentId": seed_student.id, "signatureDataUrl": sample_signature}
    resp = client.post(f"/api/v1/sessions/{seed_session.id}/check-in", json=payload)
    assert resp.status_code == 400
    assert "已取消" in resp.json()["detail"] or "已停課" in resp.json()["detail"]
