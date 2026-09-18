"""apps/api/seed.py
Seeds initial mock dataset matching Angular BalletStateService exact records.
"""
from database import Session
from models.student import Student, TicketPack
from models.session import ClassSession
from models.attendance import AttendanceRecord


def seed_mock_data(db: Session) -> None:
    # 1. 10 Students (Age 40~70 realistic scenarios)
    students = [
        Student(id='stu-1', name='陳秀琴', phone='0912-345-678', notes='芭蕾3年經驗', registered_at='2025-01-10'),
        Student(id='stu-2', name='王美玲', phone='0923-456-789', notes='膝蓋舊傷，動作適度', registered_at='2025-02-15'),
        Student(id='stu-3', name='林秋月', phone='0934-567-890', notes='退休公務員', registered_at='2025-03-01'),
        Student(id='stu-4', name='張月霞', phone='0945-678-901', notes='全勤模範生', registered_at='2025-01-20'),
        Student(id='stu-5', name='許素貞', phone='0956-789-012', notes='常與桂芬一起報名', registered_at='2025-04-12'),
        Student(id='stu-6', name='黃桂芬', phone='0967-890-123', notes='核心肌力極佳', registered_at='2025-04-12'),
        Student(id='stu-7', name='曾美雲', phone='0978-901-234', notes='熱心班長', registered_at='2025-02-01'),
        Student(id='stu-8', name='吳淑慧', phone='0989-012-345', notes='喜歡軟度伸展', registered_at='2025-05-05'),
        Student(id='stu-9', name='蔡玉蓮', phone='0911-222-333', notes='每週固定週六到課', registered_at='2025-03-20'),
        Student(id='stu-10', name='鄭麗卿', phone='0922-333-444', notes='新加入學員', registered_at='2025-06-01'),
    ]
    for s in students:
        db.merge(s)

    # 2. 10 Ticket Packs (5-class and 10-class schemes)
    packs = [
        TicketPack(id='pack-1', student_id='stu-1', type='10_class', total_count=10, remaining_count=7, purchase_date='2026-08-01', expiry_date='2026-11-15', status='active', price_paid=5000),
        TicketPack(id='pack-2', student_id='stu-2', type='5_class', total_count=5, remaining_count=1, purchase_date='2026-07-20', expiry_date='2026-09-28', status='active', price_paid=2500),
        TicketPack(id='pack-3', student_id='stu-3', type='10_class', total_count=10, remaining_count=4, purchase_date='2026-08-10', expiry_date='2026-11-20', status='active', price_paid=5000),
        TicketPack(id='pack-4', student_id='stu-4', type='10_class', total_count=10, remaining_count=9, purchase_date='2026-09-01', expiry_date='2026-12-15', status='active', price_paid=5000),
        TicketPack(id='pack-5', student_id='stu-5', type='5_class', total_count=5, remaining_count=3, purchase_date='2026-08-15', expiry_date='2026-10-30', status='active', price_paid=2500),
        TicketPack(id='pack-6', student_id='stu-6', type='10_class', total_count=10, remaining_count=5, purchase_date='2026-08-05', expiry_date='2026-11-25', status='active', price_paid=5000),
        TicketPack(id='pack-7', student_id='stu-7', type='10_class', total_count=10, remaining_count=6, purchase_date='2026-08-20', expiry_date='2026-11-30', status='active', price_paid=5000),
        TicketPack(id='pack-8', student_id='stu-8', type='5_class', total_count=5, remaining_count=2, purchase_date='2026-08-18', expiry_date='2026-10-25', status='active', price_paid=2500),
        TicketPack(id='pack-9', student_id='stu-9', type='10_class', total_count=10, remaining_count=8, purchase_date='2026-09-05', expiry_date='2026-12-20', status='active', price_paid=5000),
        TicketPack(id='pack-10', student_id='stu-10', type='5_class', total_count=5, remaining_count=4, purchase_date='2026-08-25', expiry_date='2026-11-05', status='active', price_paid=2500),
    ]
    for p in packs:
        db.merge(p)

    # 3. Class Sessions
    sessions = [
        ClassSession(
            id='session-upcoming',
            date='2026-09-19',
            day_of_week='週六',
            start_time='14:00',
            end_time='15:30',
            title='成人優雅芭蕾美姿體雕班',
            venue_name='敦南日光舞蹈排練室 A 廳',
            venue_cost=2000,
            fee_per_student=500,
            max_capacity=10,
            min_threshold=4,
            status='scheduled'
        ),
        ClassSession(
            id='session-prev',
            date='2026-09-12',
            day_of_week='週六',
            start_time='14:00',
            end_time='15:30',
            title='成人優雅芭蕾美姿體雕班',
            venue_name='敦南日光舞蹈排練室 A 廳',
            venue_cost=2000,
            fee_per_student=500,
            max_capacity=10,
            min_threshold=4,
            status='completed'
        ),
    ]
    for ses in sessions:
        db.merge(ses)

    # 4. Initial Attendance Records
    sample_signature = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><path d="M20,50 Q60,10 90,45 T170,30" fill="none" stroke="%231a365d" stroke-width="4" stroke-linecap="round"/></svg>'

    attendances = [
        AttendanceRecord(
            id='att-upcoming-stu-1',
            session_id='session-upcoming',
            student_id='stu-1',
            student_name='陳秀琴',
            status='attended',
            signature_data_url=sample_signature,
            signed_at='13:55:20',
            deducted_count=1,
            remark='教室 iPad 現場手寫簽到'
        ),
        AttendanceRecord(
            id='att-upcoming-stu-2',
            session_id='session-upcoming',
            student_id='stu-2',
            student_name='王美玲',
            status='leave_advance',
            deducted_count=0,
            leave_requested_at='2026-09-17T10:30:00',
            leave_reason='家族聚餐提前請假',
            remark='開課前 36 小時請假，完整保留堂數'
        ),
    ]
    for att in attendances:
        db.merge(att)

    db.commit()
