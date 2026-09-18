"""apps/api/tests/test_leave_rules.py
Tests for 24-hour leave policy boundary conditions, cancellation refunds, and admin overrides.
"""
from fastapi.testclient import TestClient
from models.session import ClassSession
from models.student import Student, TicketPack


def test_leave_exactly_24_hours_no_deduction(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
):
    """E-01: Exactly 24.0 hours before class -> advance leave, 0 tickets deducted."""
    initial_remaining = seed_pack.remaining_count
    payload = {
        "studentId": seed_student.id,
        "leaveReason": "家族聚餐提前請假",
        "simulationHours": 24.0,
    }
    resp = client.post(f"/api/v1/sessions/{seed_session.id}/leave", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["isAdvance"] is True
    assert data["deductedCount"] == 0
    assert data["record"]["status"] == "leave_advance"

    # Ticket count must be untouched
    resp_student = client.get("/api/v1/students")
    stu_data = next((s for s in resp_student.json() if s["id"] == seed_student.id), None)
    assert stu_data["activePack"]["remainingCount"] == initial_remaining


def test_leave_under_24_hours_deducts_one_class(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
):
    """E-02: Under 24.0 hours (e.g. 23.99h or 12h) -> late leave, 1 ticket deducted."""
    initial_remaining = seed_pack.remaining_count
    payload = {
        "studentId": seed_student.id,
        "leaveReason": "臨時加班請假",
        "simulationHours": 23.99,
    }
    resp = client.post(f"/api/v1/sessions/{seed_session.id}/leave", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["isAdvance"] is False
    assert data["deductedCount"] == 1
    assert data["record"]["status"] == "leave_late"

    # Ticket count must be decremented by 1
    resp_student = client.get("/api/v1/students")
    stu_data = next((s for s in resp_student.json() if s["id"] == seed_student.id), None)
    assert stu_data["activePack"]["remainingCount"] == initial_remaining - 1


def test_cancel_late_leave_refunds_ticket(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
):
    """E-09: Cancelling late leave refunds the 1 deducted ticket."""
    initial_remaining = seed_pack.remaining_count

    # 1. Submit late leave (deducts 1)
    client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": 12.0},
    )

    # 2. Cancel leave
    resp_cancel = client.post(
        f"/api/v1/sessions/{seed_session.id}/cancel-leave",
        json={"studentId": seed_student.id},
    )
    assert resp_cancel.status_code == 200
    data = resp_cancel.json()
    assert data["success"] is True
    assert data["refunded"] is True

    # 3. Verify ticket count is restored
    resp_student = client.get("/api/v1/students")
    stu_data = next((s for s in resp_student.json() if s["id"] == seed_student.id), None)
    assert stu_data["activePack"]["remainingCount"] == initial_remaining


def test_cancel_advance_leave_no_double_refund(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
):
    initial_remaining = seed_pack.remaining_count

    # 1. Submit advance leave (deducts 0)
    client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": 36.0},
    )

    # 2. Cancel leave
    resp_cancel = client.post(
        f"/api/v1/sessions/{seed_session.id}/cancel-leave",
        json={"studentId": seed_student.id},
    )
    assert resp_cancel.status_code == 200
    assert resp_cancel.json()["refunded"] is False

    # 3. Ticket count must remain identical
    resp_student = client.get("/api/v1/students")
    stu_data = next((s for s in resp_student.json() if s["id"] == seed_student.id), None)
    assert stu_data["activePack"]["remainingCount"] == initial_remaining


def test_manual_status_override(client: TestClient, seed_session: ClassSession, seed_student: Student):
    payload = {"status": "absent", "remark": "無故缺席"}
    resp = client.put(
        f"/api/v1/sessions/{seed_session.id}/attendance/{seed_student.id}", json=payload
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "absent"
    assert data["deductedCount"] == 1
    assert data["remark"] == "無故缺席"


def test_cannot_leave_after_checkin(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    sample_signature: str,
):
    # Check in first
    client.post(
        f"/api/v1/sessions/{seed_session.id}/check-in",
        json={"studentId": seed_student.id, "signatureDataUrl": sample_signature},
    )
    # Attempt leave
    resp = client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": 12.0},
    )
    assert resp.status_code == 400
    assert "已完成現場簽到" in resp.json()["detail"]
