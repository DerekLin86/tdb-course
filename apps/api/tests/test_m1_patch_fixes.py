"""apps/api/tests/test_m1_patch_fixes.py
Comprehensive verification test suite for Milestone 1 patch worker:
1a. Duplicate leave calls idempotency (no double ticket deduction).
1b. Advance leave protected from late overwrite & leave on cancelled session rejected.
1c. Multi-pack refund bounds (remaining <= total, reactivation of depleted pack).
1d. Atomic transactions with commit=False and rollback on failure.
1e. Attendance roster relation enrichment (student and active_pack populated).
1f. Session cancellation status code 409 Conflict for already-cancelled sessions.
1g. Unique constraint handling on student phone registration (HTTP 409 Conflict).
1h. Base64 signature validation (rejects empty canvas URLs).
1i. Database connection thread safety under concurrent requests.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from database import Session, select, reset_db
from models.session import ClassSession
from models.student import Student, TicketPack
from models.attendance import AttendanceRecord
from services.ticket_service import TicketService
from services.attendance_service import AttendanceService
from main import app


# ============================================================================
# Task 1a: Duplicate Leave Idempotency
# ============================================================================

def test_duplicate_leave_idempotency_no_double_deduction(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    db_session: Session,
):
    """Calling leave when already on late leave must NOT deduct a second ticket."""
    initial_remaining = seed_pack.remaining_count  # 7
    payload = {
        "studentId": seed_student.id,
        "leaveReason": "第一回請假：喉嚨痛",
        "simulationHours": 10.0,
    }

    # 1. First late leave request -> deducts 1 ticket
    resp1 = client.post(f"/api/v1/sessions/{seed_session.id}/leave", json=payload)
    assert resp1.status_code == 200
    db_session.refresh(seed_pack)
    assert seed_pack.remaining_count == initial_remaining - 1  # 6

    # 2. Duplicate late leave request (e.g. updating note or double-click)
    payload["leaveReason"] = "第二回請假：改為腸胃炎"
    payload["simulationHours"] = 8.0
    resp2 = client.post(f"/api/v1/sessions/{seed_session.id}/leave", json=payload)
    assert resp2.status_code == 200
    assert "不重複扣堂" in resp2.json()["message"]

    # Ticket count MUST remain 6 (NOT decremented to 5!)
    db_session.refresh(seed_pack)
    assert seed_pack.remaining_count == 6

    # 3. Cancel leave must refund exactly 1 ticket back to 7
    resp_cancel = client.post(
        f"/api/v1/sessions/{seed_session.id}/cancel-leave",
        json={"studentId": seed_student.id},
    )
    assert resp_cancel.status_code == 200
    assert resp_cancel.json()["refunded"] is True
    db_session.refresh(seed_pack)
    assert seed_pack.remaining_count == initial_remaining


# ============================================================================
# Task 1b: Advance Leave Protection & Cancelled Session Leave Guard
# ============================================================================

def test_advance_leave_protected_from_late_overwrite(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    db_session: Session,
):
    """Advance leave filed at 30h must NOT be converted to late leave when updated at 6h."""
    initial_remaining = seed_pack.remaining_count  # 7

    # 1. Advance leave at 30h
    resp1 = client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": 30.0, "leaveReason": "事前出差"},
    )
    assert resp1.status_code == 200
    assert resp1.json()["isAdvance"] is True
    assert resp1.json()["deductedCount"] == 0
    db_session.refresh(seed_pack)
    assert seed_pack.remaining_count == initial_remaining

    # 2. Resubmitted at 6h -> Must remain advance leave with 0 deduction
    resp2 = client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": 6.0, "leaveReason": "出差地點變更補充"},
    )
    assert resp2.status_code == 200
    assert resp2.json()["record"]["status"] == "leave_advance"
    db_session.refresh(seed_pack)
    assert seed_pack.remaining_count == initial_remaining


def test_leave_on_cancelled_session_rejected(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    db_session: Session,
):
    """Leave on a cancelled session must be rejected with HTTP 400."""
    initial_remaining = seed_pack.remaining_count

    # Cancel session
    seed_session.status = "cancelled"
    db_session.commit()

    # Attempt leave
    resp = client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": 12.0},
    )
    assert resp.status_code == 400
    assert "已取消順延" in resp.json()["detail"]
    db_session.refresh(seed_pack)
    assert seed_pack.remaining_count == initial_remaining


# ============================================================================
# Task 1c: Multi-pack Refund Bounds & Depleted Reactivation
# ============================================================================

def test_multi_pack_refund_bounds_and_depleted_reactivation(
    db_session: Session, seed_student: Student
):
    """When active pack is full, refund restores tickets to most recently depleted pack."""
    today = date.today()
    # Pack A: depleted (0 remaining, total 5)
    pack_a = TicketPack(
        id="pack-bnd-a",
        student_id=seed_student.id,
        type="5_class",
        total_count=5,
        remaining_count=0,
        purchase_date=today.strftime("%Y-%m-%d"),
        expiry_date=(today + timedelta(days=20)).strftime("%Y-%m-%d"),
        status="depleted",
        price_paid=2500,
    )
    # Pack B: full active (5 remaining, total 5)
    pack_b = TicketPack(
        id="pack-bnd-b",
        student_id=seed_student.id,
        type="5_class",
        total_count=5,
        remaining_count=5,
        purchase_date=today.strftime("%Y-%m-%d"),
        expiry_date=(today + timedelta(days=60)).strftime("%Y-%m-%d"),
        status="active",
        price_paid=2500,
    )
    db_session.add_all([pack_a, pack_b])
    db_session.commit()

    # Refund 1 ticket: should go into depleted Pack A, NOT into full Pack B!
    refunded_pack = TicketService.refund_ticket(db_session, seed_student.id, count=1)

    assert refunded_pack is not None
    assert refunded_pack.id == "pack-bnd-a"
    assert refunded_pack.remaining_count == 1
    assert refunded_pack.status == "active"
    assert refunded_pack.remaining_count <= refunded_pack.total_count

    # Pack B must stay at 5/5
    db_session.refresh(pack_b)
    assert pack_b.remaining_count == 5


# ============================================================================
# Task 1d: Atomic Transactions & Rollback on Failure
# ============================================================================

def test_atomic_transaction_checkin_rollback_on_failure(
    db_session: Session, seed_session: ClassSession, seed_student: Student, seed_pack: TicketPack
):
    """If an exception occurs during check-in, the deducted ticket is rolled back."""
    initial_remaining = seed_pack.remaining_count
    valid_sig = "data:image/png;base64," + ("A" * 100)

    # Patch db.commit to raise an error
    with patch.object(Session, "commit", side_effect=RuntimeError("Simulated DB Write Failure")):
        with pytest.raises(RuntimeError):
            AttendanceService.check_in(
                db_session, seed_session.id, seed_student.id, valid_sig
            )

    db_session.rollback()
    db_session.refresh(seed_pack)
    assert seed_pack.remaining_count == initial_remaining


def test_atomic_transaction_emergency_cancellation_rollback_on_failure(
    db_session: Session, seed_session: ClassSession
):
    """If refund loop fails halfway through, all refunds are rolled back atomically."""
    s1 = Student(id="stu-rb-1", name="學員1", phone="0911-111-111", registered_at="2026-01-01")
    p1 = TicketPack(
        id="pack-rb-1", student_id="stu-rb-1", type="5_class", total_count=5, remaining_count=2,
        purchase_date="2026-08-01", expiry_date="2026-11-01", status="active", price_paid=2500,
    )
    a1 = AttendanceRecord(
        id=f"att-{seed_session.id}-stu-rb-1", session_id=seed_session.id, student_id="stu-rb-1",
        student_name="學員1", status="attended", deducted_count=1,
    )

    s2 = Student(id="stu-rb-2", name="學員2", phone="0911-222-222", registered_at="2026-01-01")
    p2 = TicketPack(
        id="pack-rb-2", student_id="stu-rb-2", type="5_class", total_count=5, remaining_count=2,
        purchase_date="2026-08-01", expiry_date="2026-11-01", status="active", price_paid=2500,
    )
    a2 = AttendanceRecord(
        id=f"att-{seed_session.id}-stu-rb-2", session_id=seed_session.id, student_id="stu-rb-2",
        student_name="學員2", status="attended", deducted_count=1,
    )

    db_session.add_all([s1, p1, a1, s2, p2, a2])
    db_session.commit()

    call_count = 0
    orig_refund = TicketService.refund_ticket

    def fail_on_second(db, student_id, count=1, commit=True):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("Simulated failure on student 2")
        return orig_refund(db, student_id, count=count, commit=commit)

    with patch.object(TicketService, "refund_ticket", side_effect=fail_on_second):
        with pytest.raises(RuntimeError):
            AttendanceService.cancel_session_due_to_threshold(db_session, seed_session.id)

    db_session.rollback()
    fresh_s = db_session.get(ClassSession, seed_session.id)
    fresh_p1 = db_session.get(TicketPack, p1.id)
    fresh_p2 = db_session.get(TicketPack, p2.id)

    assert fresh_p1.remaining_count == 2, "Student 1 refund was rolled back!"
    assert fresh_p2.remaining_count == 2, "Student 2 was untouched!"
    assert fresh_s.status == "scheduled", "Session status remained scheduled!"


# ============================================================================
# Task 1e: Attendance Roster Relation Enrichment
# ============================================================================

def test_attendance_roster_relation_enrichment(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    sample_signature: str,
):
    """GET /sessions/{id}/attendance must populate student and activePack relations."""
    # Check in student
    resp_checkin = client.post(
        f"/api/v1/sessions/{seed_session.id}/check-in",
        json={"studentId": seed_student.id, "signatureDataUrl": sample_signature},
    )
    assert resp_checkin.status_code == 200

    # Query attendance roster
    resp = client.get(f"/api/v1/sessions/{seed_session.id}/attendance")
    assert resp.status_code == 200
    records = resp.json()
    assert len(records) >= 1

    rec = next((r for r in records if r["studentId"] == seed_student.id), None)
    assert rec is not None
    assert rec["student"] is not None
    assert rec["student"]["name"] == seed_student.name
    assert rec["student"]["phone"] == seed_student.phone
    assert rec["activePack"] is not None
    assert rec["activePack"]["remainingCount"] == 6  # 7 - 1 = 6


# ============================================================================
# Task 1f: Already Cancelled Session Status Code (409 Conflict)
# ============================================================================

def test_already_cancelled_session_returns_409_conflict(
    client: TestClient, seed_session: ClassSession, db_session: Session
):
    """Cancelling an already cancelled session must return HTTP 409 Conflict, not 404."""
    seed_session.status = "cancelled"
    db_session.commit()

    resp = client.post(f"/api/v1/sessions/{seed_session.id}/cancel-threshold")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "該課堂已處於取消狀態"


# ============================================================================
# Task 1g: Unique Constraint Handling on Student Phone (409 Conflict)
# ============================================================================

def test_duplicate_phone_registration_returns_409_conflict(client: TestClient):
    """Registering a student with an already-used phone number returns HTTP 409 Conflict."""
    payload = {"name": "測試學員1", "phone": "0988-123-456"}
    resp1 = client.post("/api/v1/students", json=payload)
    assert resp1.status_code == 201

    # Duplicate phone number
    resp2 = client.post("/api/v1/students", json={"name": "測試學員2", "phone": "0988-123-456"})
    assert resp2.status_code == 409
    assert "已被註冊" in resp2.json()["detail"] or "衝突" in resp2.json()["detail"]


# ============================================================================
# Task 1h: Base64 Signature Validation
# ============================================================================

def test_empty_canvas_signature_rejected(
    client: TestClient, seed_session: ClassSession, seed_student: Student
):
    """Signatures with empty or insufficient Base64 payload must be rejected with HTTP 400."""
    # 1. Empty base64 payload
    resp1 = client.post(
        f"/api/v1/sessions/{seed_session.id}/check-in",
        json={"studentId": seed_student.id, "signatureDataUrl": "data:image/png;base64,"},
    )
    assert resp1.status_code == 400
    assert "筆跡" in resp1.json()["detail"] or "無效" in resp1.json()["detail"]

    # 2. Too short base64 payload
    resp2 = client.post(
        f"/api/v1/sessions/{seed_session.id}/check-in",
        json={"studentId": seed_student.id, "signatureDataUrl": "data:image/png;base64,AAAA"},
    )
    assert resp2.status_code == 400
    assert "筆跡" in resp2.json()["detail"] or "無效" in resp2.json()["detail"]


# ============================================================================
# Task 1i: Database Thread Safety Under Concurrent Requests
# ============================================================================

def test_database_thread_safety_concurrency():
    """Concurrent requests through ThreadPoolExecutor must execute without sqlite3.InterfaceError."""
    reset_db()
    c = TestClient(app)

    def req(idx: int):
        return c.post(
            "/api/v1/ticket-packs",
            json={
                "studentId": "stu-1",
                "type": "5_class",
                "totalCount": 5,
                "validityDays": 60,
                "pricePaid": 2500,
            },
        )

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(req, i) for i in range(10)]
        responses = [f.result() for f in futures]

    assert all(r.status_code == 201 for r in responses), f"Unexpected status codes: {[r.status_code for r in responses]}"
