"""apps/api/tests/test_financials.py
Tests for financial break-even calculation, 4-person threshold alerts, and emergency refunds.
"""
from fastapi.testclient import TestClient
from database import Session
from models.session import ClassSession
from models.student import Student, TicketPack
from models.attendance import AttendanceRecord


def test_breakeven_at_exact_4_students(client: TestClient, db_session: Session, seed_session: ClassSession):
    """E-06: 4 expected attendees -> isAtRisk == False, net profit == 0."""
    for i in range(1, 11):
        stu = Student(id=f"stu-fin-{i}", name=f"學員{i}", phone=f"0900-000-00{i}", registered_at="2026-01-01")
        db_session.add(stu)
        if i > 4:
            # 6 advance leaves -> remaining 4 expected
            att = AttendanceRecord(
                id=f"att-fin-{i}",
                session_id=seed_session.id,
                student_id=f"stu-fin-{i}",
                student_name=f"學員{i}",
                status="leave_advance",
                deducted_count=0,
            )
            db_session.add(att)
    db_session.commit()

    resp = client.get(f"/api/v1/sessions/{seed_session.id}/financials")
    assert resp.status_code == 200
    data = resp.json()
    assert data["expectedAttendees"] == 4
    assert data["minThreshold"] == 4
    assert data["isAtRisk"] is False
    assert data["effectiveRevenue"] == 2000  # 4 * 500
    assert data["venueCost"] == 2000
    assert data["estimatedNetProfit"] == 0


def test_under_threshold_triggers_risk_alert(client: TestClient, db_session: Session, seed_session: ClassSession):
    """E-07: 3 expected attendees -> isAtRisk == True, net profit == -500."""
    for i in range(1, 11):
        stu = Student(id=f"stu-risk-{i}", name=f"學員{i}", phone=f"0900-000-10{i}", registered_at="2026-01-01")
        db_session.add(stu)
        if i > 3:
            # 7 advance leaves -> only 3 expected attendees
            att = AttendanceRecord(
                id=f"att-risk-{i}",
                session_id=seed_session.id,
                student_id=f"stu-risk-{i}",
                student_name=f"學員{i}",
                status="leave_advance",
                deducted_count=0,
            )
            db_session.add(att)
    db_session.commit()

    resp = client.get(f"/api/v1/sessions/{seed_session.id}/financials")
    assert resp.status_code == 200
    data = resp.json()
    assert data["expectedAttendees"] == 3
    assert data["isAtRisk"] is True
    assert data["effectiveRevenue"] == 1500  # 3 * 500
    assert data["venueCost"] == 2000
    assert data["estimatedNetProfit"] == -500


def test_financials_with_mixed_attendance_statuses(
    client: TestClient, db_session: Session, seed_session: ClassSession
):
    """Mixed case: 2 attended, 2 registered, 1 late leave, 1 absent, 4 advance leaves."""
    statuses = [
        ("stu-m-1", "attended"),
        ("stu-m-2", "attended"),
        ("stu-m-3", "registered"),
        ("stu-m-4", "registered"),
        ("stu-m-5", "leave_late"),
        ("stu-m-6", "absent"),
        ("stu-m-7", "leave_advance"),
        ("stu-m-8", "leave_advance"),
        ("stu-m-9", "leave_advance"),
        ("stu-m-10", "leave_advance"),
    ]
    for sid, st in statuses:
        stu = Student(id=sid, name=sid, phone=f"0900-000-{sid}", registered_at="2026-01-01")
        db_session.add(stu)
        if st != "registered":
            deducted = 1 if st in ["attended", "leave_late", "absent"] else 0
            att = AttendanceRecord(
                id=f"att-{sid}",
                session_id=seed_session.id,
                student_id=sid,
                student_name=sid,
                status=st,
                deducted_count=deducted,
            )
            db_session.add(att)
    db_session.commit()

    resp = client.get(f"/api/v1/sessions/{seed_session.id}/financials")
    assert resp.status_code == 200
    data = resp.json()
    # Expected attendees = registered (2) + attended (2) = 4
    assert data["expectedAttendees"] == 4
    assert data["actualAttendedCount"] == 2
    assert data["isAtRisk"] is False

    # Billable = attended (2) + registered (2) + late_leave (1) + absent (1) = 6
    assert data["effectiveRevenue"] == 6 * 500  # 3000
    assert data["venueCost"] == 2000
    assert data["estimatedNetProfit"] == 1000


def test_cancel_session_refunds_all_deductions_atomically(
    client: TestClient, db_session: Session, seed_session: ClassSession
):
    """E-08: Emergency cancellation atomically refunds all deducted tickets."""
    # Student A: Attended (deducted 1)
    stu_a = Student(id="stu-a", name="學員A", phone="0911-000-001", registered_at="2026-01-01")
    pack_a = TicketPack(
        id="pack-a", student_id="stu-a", type="5_class", total_count=5, remaining_count=4,
        purchase_date="2026-08-01", expiry_date="2026-11-01", status="active", price_paid=2500,
    )
    att_a = AttendanceRecord(
        id="att-a", session_id="session-test-upcoming", student_id="stu-a", student_name="學員A",
        status="attended", deducted_count=1,
    )

    # Student B: Late leave (deducted 1)
    stu_b = Student(id="stu-b", name="學員B", phone="0911-000-002", registered_at="2026-01-01")
    pack_b = TicketPack(
        id="pack-b", student_id="stu-b", type="10_class", total_count=10, remaining_count=8,
        purchase_date="2026-08-01", expiry_date="2026-11-01", status="active", price_paid=5000,
    )
    att_b = AttendanceRecord(
        id="att-b", session_id="session-test-upcoming", student_id="stu-b", student_name="學員B",
        status="leave_late", deducted_count=1,
    )

    db_session.add_all([stu_a, pack_a, att_a, stu_b, pack_b, att_b])
    db_session.commit()

    # Teacher triggers cancellation
    resp = client.post(
        f"/api/v1/sessions/{seed_session.id}/cancel-threshold",
        json={"reason": "人數不足4人開班門檻，順延停課避虧"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["refundedCount"] == 2

    # Verify both students had tickets restored (+1 each)
    db_session.refresh(pack_a)
    db_session.refresh(pack_b)
    assert pack_a.remaining_count == 5
    assert pack_b.remaining_count == 9

    # Verify session is cancelled
    db_session.refresh(seed_session)
    assert seed_session.status == "cancelled"
