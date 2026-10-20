"""apps/api/tests/test_sessions_batch.py
Tests for class session batch creation, chronological date ordering,
automatic course roster population, and chronological session index re-indexing.
"""
from fastapi.testclient import TestClient


def test_batch_create_sessions_and_date_sorting(client: TestClient):
    """Test creating multiple sessions in unordered sequence and verifying
    both batch response and GET /sessions return items in asc(date), asc(start_time) order.
    """
    payload = {
        "sessions": [
            {
                "id": "batch-s4-late",
                "date": "2026-06-15",
                "dayOfWeek": "週一",
                "startTime": "14:00",
                "endTime": "15:30",
                "title": "成人芭蕾 D 班",
                "venueName": "敦南排練室 A 廳",
            },
            {
                "id": "batch-s2-mid-afternoon",
                "date": "2026-05-10",
                "dayOfWeek": "週日",
                "startTime": "16:00",
                "endTime": "17:30",
                "title": "成人芭蕾 B 班",
                "venueName": "敦南排練室 A 廳",
            },
            {
                "id": "batch-s1-early",
                "date": "2026-05-01",
                "dayOfWeek": "週五",
                "startTime": "14:00",
                "endTime": "15:30",
                "title": "成人芭蕾 A 班",
                "venueName": "敦南排練室 B 廳",
            },
            {
                "id": "batch-s3-mid-morning",
                "date": "2026-05-10",
                "dayOfWeek": "週日",
                "startTime": "10:00",
                "endTime": "11:30",
                "title": "成人芭蕾 C 班",
                "venueName": "敦南排練室 A 廳",
            },
        ]
    }

    resp = client.post("/api/v1/sessions/batch", json=payload)
    assert resp.status_code == 201
    created_sessions = resp.json()
    assert len(created_sessions) == 4

    # Verify chronological ascending order by (date, start_time)
    expected_order = [
        ("batch-s1-early", "2026-05-01", "14:00"),
        ("batch-s3-mid-morning", "2026-05-10", "10:00"),
        ("batch-s2-mid-afternoon", "2026-05-10", "16:00"),
        ("batch-s4-late", "2026-06-15", "14:00"),
    ]
    for s, (exp_id, exp_date, exp_start) in zip(created_sessions, expected_order):
        assert s["id"] == exp_id
        assert s["date"] == exp_date
        assert s["startTime"] == exp_start

    # Verify GET /sessions also preserves ascending order
    list_resp = client.get("/api/v1/sessions")
    assert list_resp.status_code == 200
    all_sessions = list_resp.json()
    batch_ids = [item[0] for item in expected_order]
    filtered_list = [s for s in all_sessions if s["id"] in batch_ids]
    for s, (exp_id, exp_date, exp_start) in zip(filtered_list, expected_order):
        assert s["id"] == exp_id
        assert s["date"] == exp_date
        assert s["startTime"] == exp_start

    # Verify empty batch returns empty list
    empty_resp = client.post("/api/v1/sessions/batch", json={"sessions": []})
    assert empty_resp.status_code == 201
    assert empty_resp.json() == []


def test_batch_create_sessions_auto_roster(client: TestClient):
    """Test that creating sessions for a course automatically creates attendance records
    (status='registered', deducted_count=0, remark='期班建立課堂自動帶入名冊')
    for all active enrolled students in both batch and single creation.
    """
    # 1. Create a course
    c_resp = client.post("/api/v1/courses", json={
        "id": "course-auto-roster-1",
        "title": "秋季常態芭蕾專班",
        "totalSessions": 8,
    })
    assert c_resp.status_code == 201

    # 2. Create 2 students
    s1_resp = client.post("/api/v1/students", json={
        "id": "stu-auto-1",
        "name": "林小曼",
        "phone": "0911-000-111",
    })
    assert s1_resp.status_code == 201

    s2_resp = client.post("/api/v1/students", json={
        "id": "stu-auto-2",
        "name": "張雅琳",
        "phone": "0922-000-222",
    })
    assert s2_resp.status_code == 201

    # 3. Enroll students into the course
    enr1_resp = client.post("/api/v1/courses/course-auto-roster-1/students", json={
        "studentId": "stu-auto-1",
    })
    assert enr1_resp.status_code == 201

    enr2_resp = client.post("/api/v1/courses/course-auto-roster-1/students", json={
        "studentId": "stu-auto-2",
    })
    assert enr2_resp.status_code == 201

    # 4. Batch create 2 sessions for this course
    batch_payload = {
        "sessions": [
            {
                "id": "session-auto-w1",
                "courseId": "course-auto-roster-1",
                "date": "2026-08-01",
                "dayOfWeek": "週六",
                "startTime": "14:00",
                "endTime": "15:30",
                "title": "秋季常態芭蕾專班 (第 1 堂)",
                "venueName": "敦南日光舞蹈排練室 A 廳",
            },
            {
                "id": "session-auto-w2",
                "courseId": "course-auto-roster-1",
                "date": "2026-08-08",
                "dayOfWeek": "週六",
                "startTime": "14:00",
                "endTime": "15:30",
                "title": "秋季常態芭蕾專班 (第 2 堂)",
                "venueName": "敦南日光舞蹈排練室 A 廳",
            },
        ]
    }
    b_resp = client.post("/api/v1/sessions/batch", json=batch_payload)
    assert b_resp.status_code == 201

    # Verify both sessions have automatically populated rosters for stu-auto-1 and stu-auto-2
    for sess_id in ["session-auto-w1", "session-auto-w2"]:
        att_resp = client.get(f"/api/v1/sessions/{sess_id}/attendance")
        assert att_resp.status_code == 200
        roster = att_resp.json()
        assert len(roster) == 2

        stu_ids = {r["studentId"] for r in roster}
        assert stu_ids == {"stu-auto-1", "stu-auto-2"}

        for r in roster:
            assert r["status"] == "registered"
            assert r["deductedCount"] == 0
            assert r["remark"] == "期班建立課堂自動帶入名冊"

    # 5. Also verify single session creation automatically populates attendance roster
    single_resp = client.post("/api/v1/sessions", json={
        "id": "session-auto-w3",
        "courseId": "course-auto-roster-1",
        "date": "2026-08-15",
        "dayOfWeek": "週六",
        "startTime": "14:00",
        "endTime": "15:30",
        "title": "秋季常態芭蕾專班 (第 3 堂)",
        "venueName": "敦南日光舞蹈排練室 A 廳",
    })
    assert single_resp.status_code == 201

    att3_resp = client.get("/api/v1/sessions/session-auto-w3/attendance")
    assert att3_resp.status_code == 200
    roster3 = att3_resp.json()
    assert len(roster3) == 2
    for r in roster3:
        assert r["status"] == "registered"
        assert r["deductedCount"] == 0
        assert r["remark"] == "期班建立課堂自動帶入名冊"


def test_chronological_session_reindexing(client: TestClient):
    """Test adding sessions in out-of-order dates and verifying that session_index
    is reordered chronologically (1, 2, 3...) based on asc(date), asc(start_time),
    and auto-generated titles with '第 X 堂' are updated appropriately.
    """
    # 1. Create course
    c_resp = client.post("/api/v1/courses", json={
        "id": "course-reindex-1",
        "title": "進階芭蕾美姿專班",
        "totalSessions": 4,
    })
    assert c_resp.status_code == 201

    # 2. Batch create 3 initial sessions on 2026-07-10, 2026-07-17, 2026-07-24
    initial_batch = {
        "sessions": [
            {
                "id": "session-reindex-w1",
                "courseId": "course-reindex-1",
                "date": "2026-07-10",
                "dayOfWeek": "週五",
                "startTime": "14:00",
                "endTime": "15:30",
                "title": "進階芭蕾美姿專班 (第 1 堂)",
                "venueName": "敦南排練室",
            },
            {
                "id": "session-reindex-w2",
                "courseId": "course-reindex-1",
                "date": "2026-07-17",
                "dayOfWeek": "週五",
                "startTime": "14:00",
                "endTime": "15:30",
                "title": "進階芭蕾美姿專班 (第 2 堂)",
                "venueName": "敦南排練室",
            },
            {
                "id": "session-reindex-w3",
                "courseId": "course-reindex-1",
                "date": "2026-07-24",
                "dayOfWeek": "週五",
                "startTime": "14:00",
                "endTime": "15:30",
                "title": "進階芭蕾美姿專班 (第 3 堂)",
                "venueName": "敦南排練室",
            },
        ]
    }
    resp1 = client.post("/api/v1/sessions/batch", json=initial_batch)
    assert resp1.status_code == 201
    s1_list = resp1.json()
    assert [s["sessionIndex"] for s in s1_list] == [1, 2, 3]

    # 3. Insert an earlier session on 2026-07-03 via POST /sessions
    earlier_session = {
        "id": "session-reindex-w0-earlier",
        "courseId": "course-reindex-1",
        "date": "2026-07-03",
        "dayOfWeek": "週五",
        "startTime": "14:00",
        "endTime": "15:30",
        "title": "進階芭蕾美姿專班 (第 1 堂)",
        "venueName": "敦南排練室",
    }
    resp2 = client.post("/api/v1/sessions", json=earlier_session)
    assert resp2.status_code == 201
    created_w0 = resp2.json()
    assert created_w0["sessionIndex"] == 1
    assert created_w0["title"] == "進階芭蕾美姿專班 (第 1 堂)"

    # 4. Verify existing sessions are chronologically shifted to indices 2, 3, 4
    w1_resp = client.get("/api/v1/sessions/session-reindex-w1")
    assert w1_resp.status_code == 200
    w1_data = w1_resp.json()
    assert w1_data["sessionIndex"] == 2
    assert w1_data["title"] == "進階芭蕾美姿專班 (第 2 堂)"

    w2_resp = client.get("/api/v1/sessions/session-reindex-w2")
    assert w2_resp.status_code == 200
    w2_data = w2_resp.json()
    assert w2_data["sessionIndex"] == 3
    assert w2_data["title"] == "進階芭蕾美姿專班 (第 3 堂)"

    w3_resp = client.get("/api/v1/sessions/session-reindex-w3")
    assert w3_resp.status_code == 200
    w3_data = w3_resp.json()
    assert w3_data["sessionIndex"] == 4
    assert w3_data["title"] == "進階芭蕾美姿專班 (第 4 堂)"

    # 5. Insert an interstitial session on 2026-07-14 (between w1 07-10 and w2 07-17)
    interstitial_session = {
        "id": "session-reindex-interstitial",
        "courseId": "course-reindex-1",
        "date": "2026-07-14",
        "dayOfWeek": "週二",
        "startTime": "14:00",
        "endTime": "15:30",
        "title": "進階芭蕾美姿專班 (第 1 堂)",
        "venueName": "敦南排練室",
    }
    resp3 = client.post("/api/v1/sessions", json=interstitial_session)
    assert resp3.status_code == 201
    created_inter = resp3.json()
    assert created_inter["sessionIndex"] == 3
    assert created_inter["title"] == "進階芭蕾美姿專班 (第 3 堂)"

    # Verify all 5 sessions are strictly sequenced from 1 to 5
    sessions_overview = client.get("/api/v1/sessions").json()
    course_sessions = [s for s in sessions_overview if s.get("courseId") == "course-reindex-1"]
    course_sessions.sort(key=lambda s: (s["date"], s["startTime"]))
    assert len(course_sessions) == 5
    expected_indices = [1, 2, 3, 4, 5]
    expected_dates = ["2026-07-03", "2026-07-10", "2026-07-14", "2026-07-17", "2026-07-24"]
    assert [s["sessionIndex"] for s in course_sessions] == expected_indices
    assert [s["date"] for s in course_sessions] == expected_dates
    for s, idx in zip(course_sessions, expected_indices):
        assert f"第 {idx} 堂" in s["title"]
