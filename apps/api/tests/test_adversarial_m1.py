"""apps/api/tests/test_adversarial_m1.py
Adversarial challenge test suite for Milestone 1:
1. 24-hour leave policy rule boundaries (Delta t = 24.0 vs 23.999, float precision).
2. Time travel simulation & negative hours (past classes).
3. Duplicate leave requests & ticket drain vulnerability analysis.
4. Leave requests against cancelled sessions vulnerability analysis.
5. Base64 signature ingestion with massive payloads (500KB, 1MB, 2MB) & byte-for-byte SHA-256 fidelity.
"""
import base64
import hashlib
import os
from datetime import datetime, timedelta
import pytest
from fastapi.testclient import TestClient
from database import Session, select
from models.session import ClassSession
from models.student import Student, TicketPack
from models.attendance import AttendanceRecord


# ============================================================================
# 1. BOUNDARY PRECISION TESTS (Delta t = 24.0 vs 23.999, Microsecond precision)
# ============================================================================

def test_leave_boundary_exact_24_hours(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
):
    """Boundary test: Delta t = 24.0 hours exactly -> advance leave, 0 ticket deduction."""
    initial_remaining = seed_pack.remaining_count
    payload = {
        "studentId": seed_student.id,
        "leaveReason": "正好開課前 24.0 小時請假",
        "simulationHours": 24.0,
    }
    resp = client.post(f"/api/v1/sessions/{seed_session.id}/leave", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["isAdvance"] is True
    assert data["deductedCount"] == 0
    assert data["record"]["status"] == "leave_advance"

    # Check student active pack count
    resp_student = client.get("/api/v1/students")
    stu_data = next((s for s in resp_student.json() if s["id"] == seed_student.id), None)
    assert stu_data["activePack"]["remainingCount"] == initial_remaining


def test_leave_boundary_23_999_hours(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
):
    """Boundary test: Delta t = 23.999 hours -> late leave, exactly 1 ticket deducted."""
    initial_remaining = seed_pack.remaining_count
    payload = {
        "studentId": seed_student.id,
        "leaveReason": "距開課 23.999 小時請假（差 3.6 秒滿 24 小時）",
        "simulationHours": 23.999,
    }
    resp = client.post(f"/api/v1/sessions/{seed_session.id}/leave", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["isAdvance"] is False
    assert data["deductedCount"] == 1
    assert data["record"]["status"] == "leave_late"

    # Check student active pack count decremented by 1
    resp_student = client.get("/api/v1/students")
    stu_data = next((s for s in resp_student.json() if s["id"] == seed_student.id), None)
    assert stu_data["activePack"]["remainingCount"] == initial_remaining - 1


def test_leave_boundary_microsecond_precision(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
):
    """Boundary test: 24.0000001 (advance) vs 23.9999999 (late)."""
    initial_remaining = seed_pack.remaining_count

    # 1. 24.0000001 -> advance
    payload1 = {
        "studentId": seed_student.id,
        "simulationHours": 24.0000001,
    }
    resp1 = client.post(f"/api/v1/sessions/{seed_session.id}/leave", json=payload1)
    assert resp1.status_code == 200
    assert resp1.json()["isAdvance"] is True
    assert resp1.json()["deductedCount"] == 0

    # Cancel to reset state
    client.post(f"/api/v1/sessions/{seed_session.id}/cancel-leave", json={"studentId": seed_student.id})

    # 2. 23.9999999 -> late
    payload2 = {
        "studentId": seed_student.id,
        "simulationHours": 23.9999999,
    }
    resp2 = client.post(f"/api/v1/sessions/{seed_session.id}/leave", json=payload2)
    assert resp2.status_code == 200
    assert resp2.json()["isAdvance"] is False
    assert resp2.json()["deductedCount"] == 1

    # Verify balance
    resp_student = client.get("/api/v1/students")
    stu_data = next((s for s in resp_student.json() if s["id"] == seed_student.id), None)
    assert stu_data["activePack"]["remainingCount"] == initial_remaining - 1


def test_leave_simulation_datetime_calculation(
    client: TestClient,
    db_session: Session,
    seed_student: Student,
    seed_pack: TicketPack,
):
    """Test natural datetime calculation when simulationHours is omitted."""
    initial_remaining = seed_pack.remaining_count

    # Session in 25 hours from now
    future_time = datetime.now() + timedelta(hours=25)
    session_future = ClassSession(
        id="sess-future-25h",
        date=future_time.strftime("%Y-%m-%d"),
        day_of_week="週六",
        start_time=future_time.strftime("%H:%M"),
        end_time=(future_time + timedelta(hours=1, minutes=30)).strftime("%H:%M"),
        title="未來 25h 課堂",
        venue_name="敦南日光舞蹈排練室 A 廳",
    )
    db_session.add(session_future)
    db_session.commit()

    resp = client.post(
        f"/api/v1/sessions/{session_future.id}/leave",
        json={"studentId": seed_student.id},
    )
    assert resp.status_code == 200
    assert resp.json()["isAdvance"] is True
    assert resp.json()["deductedCount"] == 0

    # Session in 12 hours from now
    near_time = datetime.now() + timedelta(hours=12)
    session_near = ClassSession(
        id="sess-near-12h",
        date=near_time.strftime("%Y-%m-%d"),
        day_of_week="週六",
        start_time=near_time.strftime("%H:%M"),
        end_time=(near_time + timedelta(hours=1, minutes=30)).strftime("%H:%M"),
        title="未來 12h 課堂",
        venue_name="敦南日光舞蹈排練室 A 廳",
    )
    db_session.add(session_near)
    db_session.commit()

    resp_near = client.post(
        f"/api/v1/sessions/{session_near.id}/leave",
        json={"studentId": seed_student.id},
    )
    assert resp_near.status_code == 200
    assert resp_near.json()["isAdvance"] is False
    assert resp_near.json()["deductedCount"] == 1


# ============================================================================
# 2. ADVERSARIAL CHALLENGE: DUPLICATE LEAVE & TICKET DRAIN
# ============================================================================

def test_adversarial_duplicate_late_leave_ticket_drain(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    db_session: Session,
):
    """ADVERSARIAL ATTACK:
    A student submits multiple late leave requests (e.g. rapid double-tap or updating reason).
    Does the system deduct multiple tickets for the SAME session?
    And if cancel_leave is called, does it fail to refund all drained tickets?
    """
    initial_remaining = seed_pack.remaining_count  # 7
    payload = {
        "studentId": seed_student.id,
        "leaveReason": "第一回請假：頭痛",
        "simulationHours": 12.0,
    }

    # First leave request
    resp1 = client.post(f"/api/v1/sessions/{seed_session.id}/leave", json=payload)
    assert resp1.status_code == 200
    db_session.refresh(seed_pack)
    first_remaining = seed_pack.remaining_count
    assert first_remaining == initial_remaining - 1  # 6

    # Second leave request with different reason (e.g. updating reason or double tap)
    payload["leaveReason"] = "第二回請假：改為發燒"
    payload["simulationHours"] = 10.0
    resp2 = client.post(f"/api/v1/sessions/{seed_session.id}/leave", json=payload)
    assert resp2.status_code == 200

    db_session.refresh(seed_pack)
    second_remaining = seed_pack.remaining_count

    # EMPIRICAL OBSERVATION:
    # If the system lacks idempotency for leave, second_remaining will be 5 (deducted twice!).
    print(f"\n[EMPIRICAL TEST] Duplicate Late Leave: Initial={initial_remaining}, after 1st={first_remaining}, after 2nd={second_remaining}")

    # Check database record state
    att_rec = db_session.scalars(
        select(AttendanceRecord).where(
            AttendanceRecord.session_id == seed_session.id,
            AttendanceRecord.student_id == seed_student.id,
        )
    ).first()
    print(f"[EMPIRICAL TEST] AttendanceRecord deducted_count in DB = {att_rec.deducted_count}")

    # Cancel leave and see how many tickets get refunded
    resp_cancel = client.post(
        f"/api/v1/sessions/{seed_session.id}/cancel-leave",
        json={"studentId": seed_student.id},
    )
    assert resp_cancel.status_code == 200
    db_session.refresh(seed_pack)
    post_cancel_remaining = seed_pack.remaining_count
    print(f"[EMPIRICAL TEST] After cancel_leave: Remaining={post_cancel_remaining} (Expected={initial_remaining})")
    assert second_remaining == initial_remaining - 1, f"Duplicate leave must not deduct second ticket! Was {second_remaining}"
    assert post_cancel_remaining == initial_remaining, f"After cancelling leave, balance should be restored to initial {initial_remaining}"


def test_adversarial_advance_leave_overwritten_by_late_leave(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    db_session: Session,
):
    """ADVERSARIAL ATTACK:
    Student rightfully requested advance leave at 30h (0 deduction).
    Later at 6h, student resubmits or sends updated note.
    Does the system overwrite the advance status and deduct a ticket?
    """
    initial_remaining = seed_pack.remaining_count

    # 1. Advance leave at 30h
    resp1 = client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": 30.0, "leaveReason": "事前出差請假"},
    )
    assert resp1.status_code == 200
    assert resp1.json()["isAdvance"] is True
    db_session.refresh(seed_pack)
    assert seed_pack.remaining_count == initial_remaining

    # 2. Resubmitted at 6h
    resp2 = client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": 6.0, "leaveReason": "出差地點變更補充說明"},
    )
    assert resp2.status_code == 200
    db_session.refresh(seed_pack)
    assert seed_pack.remaining_count == initial_remaining, "Advance leave must not be overwritten to deduct tickets!"
    assert resp2.json()["record"]["status"] == "leave_advance"
    print(f"\n[EMPIRICAL TEST] Advance leave resubmitted at 6h: remaining count = {seed_pack.remaining_count}, status = {resp2.json()['record']['status']}")


# ============================================================================
# 3. ADVERSARIAL CHALLENGE: LEAVE ON CANCELLED SESSIONS
# ============================================================================

def test_adversarial_leave_on_cancelled_session(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    db_session: Session,
):
    """ADVERSARIAL ATTACK:
    A class session is cancelled by studio due to under-threshold ($E < 4).
    A student then submits a late leave request on this cancelled session.
    Does the system deduct a ticket from the student for a session that is CANCELLED?
    """
    initial_remaining = seed_pack.remaining_count

    # 1. Cancel session
    resp_cancel_sess = client.post(f"/api/v1/sessions/{seed_session.id}/cancel-threshold")
    assert resp_cancel_sess.status_code == 200

    # 2. Attempt check-in on cancelled session (should be rejected)
    resp_checkin = client.post(
        f"/api/v1/sessions/{seed_session.id}/check-in",
        json={"studentId": seed_student.id, "signatureDataUrl": "data:image/png;base64,iVBORw0KGgo="},
    )
    assert resp_checkin.status_code == 400
    print("\n[EMPIRICAL TEST] Check-in on cancelled session correctly rejected:", resp_checkin.json()["detail"])

    # 3. Attempt leave on cancelled session
    resp_leave = client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": 12.0, "leaveReason": "不知道已經停課而請假"},
    )
    db_session.refresh(seed_pack)
    assert resp_leave.status_code == 400, "Leave on cancelled session must be rejected with 400!"
    assert "已取消" in resp_leave.json()["detail"]
    assert seed_pack.remaining_count == initial_remaining, "Cancelled session must not allow leave or deduct ticket!"


# ============================================================================
# 4. MASSIVE BASE64 SIGNATURE INGESTION & BYTE-FOR-BYTE FIDELITY (500KB, 1MB, 2MB)
# ============================================================================

@pytest.mark.parametrize("payload_bytes, label", [
    (500 * 1024, "500KB"),
    (1024 * 1024, "1MB"),
    (2 * 1024 * 1024, "2MB"),
])
def test_massive_base64_signature_byte_fidelity(
    client: TestClient,
    db_session: Session,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
    payload_bytes: int,
    label: str,
):
    """Stress test: Ingest massive Base64 PNG signature payloads up to 2MB,
    and verify byte-for-byte SHA-256 fidelity across:
    1. POST /check-in response
    2. GET /sessions/{id}/attendance response
    3. Direct SQLite database TEXT storage query
    """
    # Generate deterministic pseudo-random binary payload
    raw_binary = os.urandom(payload_bytes)
    b64_str = base64.b64encode(raw_binary).decode("ascii")
    signature_data_url = f"data:image/png;base64,{b64_str}"

    total_string_len = len(signature_data_url)
    expected_sha256 = hashlib.sha256(signature_data_url.encode("utf-8")).hexdigest()

    start_time = datetime.now()

    # 1. Post Check-in
    resp = client.post(
        f"/api/v1/sessions/{seed_session.id}/check-in",
        json={"studentId": seed_student.id, "signatureDataUrl": signature_data_url},
    )
    post_elapsed = (datetime.now() - start_time).total_seconds()
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["success"] is True

    # Verify returned signature in check-in response
    returned_sig_resp = data["record"]["signatureDataUrl"]
    resp_sha256 = hashlib.sha256(returned_sig_resp.encode("utf-8")).hexdigest()
    assert resp_sha256 == expected_sha256, f"Mismatch in check-in response for {label}"

    # 2. Verify retrieval via GET /attendance
    get_start = datetime.now()
    resp_att = client.get(f"/api/v1/sessions/{seed_session.id}/attendance")
    get_elapsed = (datetime.now() - get_start).total_seconds()
    assert resp_att.status_code == 200
    records = resp_att.json()
    student_record = next((r for r in records if r["studentId"] == seed_student.id), None)
    assert student_record is not None
    get_sig = student_record["signatureDataUrl"]
    get_sha256 = hashlib.sha256(get_sig.encode("utf-8")).hexdigest()
    assert get_sha256 == expected_sha256, f"Mismatch in GET /attendance response for {label}"

    # 3. Verify direct SQLite database storage
    direct_record = db_session.scalars(
        select(AttendanceRecord).where(
            AttendanceRecord.session_id == seed_session.id,
            AttendanceRecord.student_id == seed_student.id,
        )
    ).first()
    assert direct_record is not None
    db_sha256 = hashlib.sha256(direct_record.signature_data_url.encode("utf-8")).hexdigest()
    assert db_sha256 == expected_sha256, f"Mismatch in SQLite TEXT column for {label}"

    print(
        f"\n[STRESS TEST {label}] Ingested {total_string_len:,} chars ({payload_bytes / 1024:.0f} KB binary): "
        f"POST={post_elapsed:.3f}s, GET={get_elapsed:.3f}s, SHA256={db_sha256[:16]}... "
        f"BYTE-FOR-BYTE FIDELITY PRESERVED"
    )


# ============================================================================
# 5. BULK SIGNATURE INGESTION & ROSTER SERIALIZATION STRESS
# ============================================================================

def test_bulk_500kb_signatures_roster_serialization(
    client: TestClient,
    db_session: Session,
    seed_session: ClassSession,
):
    """Stress test: 5 students each submit 500KB signature.
    Tests if GET /sessions/{id}/attendance handles multi-megabyte payload serialization smoothly.
    """
    hashes = {}
    total_binary_bytes = 0

    for i in range(5):
        stu = Student(
            id=f"stu-bulk-{i}",
            name=f"大量簽名學員{i}",
            phone=f"0911-000-00{i}",
            registered_at="2026-01-01",
        )
        db_session.add(stu)
        pack = TicketPack(
            id=f"pack-bulk-{i}",
            student_id=stu.id,
            type="10_class",
            total_count=10,
            remaining_count=10,
            purchase_date="2026-08-01",
            expiry_date="2026-11-15",
            status="active",
            price_paid=5000,
        )
        db_session.add(pack)
        db_session.commit()

        # 500KB unique payload per student
        raw = os.urandom(500 * 1024)
        total_binary_bytes += len(raw)
        sig = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
        hashes[stu.id] = hashlib.sha256(sig.encode("utf-8")).hexdigest()

        resp = client.post(
            f"/api/v1/sessions/{seed_session.id}/check-in",
            json={"studentId": stu.id, "signatureDataUrl": sig},
        )
        assert resp.status_code == 200

    # Retrieve all signatures via single GET call
    start_t = datetime.now()
    resp_roster = client.get(f"/api/v1/sessions/{seed_session.id}/attendance")
    elapsed = (datetime.now() - start_t).total_seconds()
    assert resp_roster.status_code == 200
    records = resp_roster.json()
    assert len(records) == 5

    # Verify every student's signature is preserved with 100% fidelity
    for r in records:
        expected = hashes[r["studentId"]]
        actual = hashlib.sha256(r["signatureDataUrl"].encode("utf-8")).hexdigest()
        assert actual == expected, f"Corruption detected in roster for student {r['studentId']}"

    response_body_size = len(resp_roster.content)
    print(
        f"\n[BULK STRESS] Ingested 5 x 500KB signatures (Total {total_binary_bytes / 1024:.0f} KB binary). "
        f"Roster JSON payload size = {response_body_size:,} bytes ({response_body_size / 1024 / 1024:.2f} MB). "
        f"GET roster retrieval took {elapsed:.3f}s. All 5 SHA-256 hashes matched."
    )


# ============================================================================
# 6. EDGE CASE: DEPLETED PACK & NEGATIVE HOURS LEAVE
# ============================================================================

def test_depleted_pack_late_leave_rejected(
    client: TestClient,
    db_session: Session,
    seed_session: ClassSession,
    seed_student: Student,
):
    """Edge case: Student with 0 remaining tickets attempts late leave (<24h).
    Must be rejected with 400 Bad Request because venue cost share ticket cannot be deducted.
    """
    pack = TicketPack(
        id="pack-depleted-zero",
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

    resp = client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": 12.0},
    )
    assert resp.status_code == 400
    assert "用罄" in resp.json()["detail"] or "無可用票卡" in resp.json()["detail"]
    print("\n[EDGE CASE] Depleted pack late leave correctly rejected with HTTP 400:", resp.json()["detail"])


def test_depleted_pack_advance_leave_allowed(
    client: TestClient,
    db_session: Session,
    seed_session: ClassSession,
    seed_student: Student,
):
    """Edge case: Student with 0 remaining tickets requests advance leave (>=24h).
    Since advance leave deducts 0 tickets, does the API allow the reservation to be cancelled?
    """
    pack = TicketPack(
        id="pack-depleted-zero-adv",
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

    resp = client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": 30.0},
    )
    assert resp.status_code == 200
    assert resp.json()["isAdvance"] is True
    assert resp.json()["deductedCount"] == 0
    print("\n[EDGE CASE] Depleted pack advance leave allowed without deduction (deductedCount=0)")


def test_negative_simulation_hours_behavior(
    client: TestClient,
    seed_session: ClassSession,
    seed_student: Student,
    seed_pack: TicketPack,
):
    """Edge case: simulationHours = -3.0 (class was 3 hours ago).
    Behavior observation: hours_left < 24.0 -> late leave with 1 ticket deduction.
    """
    initial_remaining = seed_pack.remaining_count
    resp = client.post(
        f"/api/v1/sessions/{seed_session.id}/leave",
        json={"studentId": seed_student.id, "simulationHours": -3.0, "leaveReason": "課後事後請假補單"},
    )
    assert resp.status_code == 200
    assert resp.json()["isAdvance"] is False
    assert resp.json()["deductedCount"] == 1
    resp_stu = client.get("/api/v1/students")
    stu = next((s for s in resp_stu.json() if s["id"] == seed_student.id), None)
    assert stu["activePack"]["remainingCount"] == initial_remaining - 1
    print("\n[EDGE CASE] Post-class negative simulation hours treated as late leave (1 ticket deducted).")

