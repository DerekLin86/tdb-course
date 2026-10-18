"""apps/api/tests/test_courses.py
Tests for course curriculum management, session linkage, and default financials.
"""
from fastapi.testclient import TestClient


def test_create_course(client: TestClient):
    payload = {
        "title": "週日精選初階芭蕾專班 (8週)",
        "description": "零基礎學員友善，著重體態雕塑與基礎把杆訓練",
        "totalSessions": 8,
        "defaultVenueCost": 2200,
        "defaultTeacherFee": 1500,
        "defaultFeePerStudent": 600,
        "minThreshold": 4,
        "status": "active",
        "startDate": "2026-04-01",
        "endDate": "2026-05-20",
    }
    resp = client.post("/api/v1/courses", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "週日精選初階芭蕾專班 (8週)"
    assert data["description"] == "零基礎學員友善，著重體態雕塑與基礎把杆訓練"
    assert data["totalSessions"] == 8
    assert data["defaultVenueCost"] == 2200
    assert data["defaultTeacherFee"] == 1500
    assert data["defaultFeePerStudent"] == 600
    assert data["minThreshold"] == 4
    assert data["status"] == "active"
    assert data["startDate"] == "2026-04-01"
    assert data["endDate"] == "2026-05-20"
    assert "id" in data


def test_create_course_defaults(client: TestClient):
    payload = {
        "title": "晨間成人體態雕塑",
    }
    resp = client.post("/api/v1/courses", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "晨間成人體態雕塑"
    assert data["totalSessions"] == 8
    assert data["defaultVenueCost"] == 2000
    assert data["defaultTeacherFee"] == 1200
    assert data["defaultFeePerStudent"] == 500
    assert data["minThreshold"] == 4
    assert data["status"] == "active"


def test_list_courses(client: TestClient):
    # Create two courses
    client.post("/api/v1/courses", json={"title": "課程 A", "totalSessions": 6})
    client.post("/api/v1/courses", json={"title": "課程 B", "totalSessions": 10})

    resp = client.get("/api/v1/courses")
    assert resp.status_code == 200
    courses = resp.json()
    assert len(courses) >= 2
    titles = [c["title"] for c in courses]
    assert "課程 A" in titles
    assert "課程 B" in titles


def test_get_course_by_id(client: TestClient):
    create_resp = client.post(
        "/api/v1/courses",
        json={"id": "course-test-1", "title": "特定課程測試"}
    )
    assert create_resp.status_code == 201

    resp = client.get("/api/v1/courses/course-test-1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "course-test-1"
    assert data["title"] == "特定課程測試"


def test_get_course_not_found(client: TestClient):
    resp = client.get("/api/v1/courses/non-existent-course-id")
    assert resp.status_code == 404
    assert "查無此課程" in resp.json()["detail"]


def test_create_session_with_course_linkage(client: TestClient):
    # 1. Create a parent course
    c_resp = client.post(
        "/api/v1/courses",
        json={"id": "course-linked-1", "title": "關聯課程專班"}
    )
    assert c_resp.status_code == 201

    # 2. Create a session linked to the course
    session_payload = {
        "id": "session-linked-1",
        "courseId": "course-linked-1",
        "sessionIndex": 1,
        "date": "2026-05-01",
        "dayOfWeek": "週五",
        "startTime": "19:00",
        "endTime": "20:30",
        "title": "關聯課程專班 - 第 1 堂",
        "venueName": "日光排練室 B 廳",
        "venueCost": 2200,
        "teacherFee": 1500,
        "otherCost": 200,
        "feePerStudent": 500,
        "maxCapacity": 10,
        "minThreshold": 4,
        "status": "scheduled",
    }
    s_resp = client.post("/api/v1/sessions", json=session_payload)
    assert s_resp.status_code == 201
    s_data = s_resp.json()
    assert s_data["courseId"] == "course-linked-1"
    assert s_data["sessionIndex"] == 1
    assert s_data["teacherFee"] == 1500
    assert s_data["otherCost"] == 200

    # 3. Fetch session by ID
    get_s_resp = client.get("/api/v1/sessions/session-linked-1")
    assert get_s_resp.status_code == 200
    detail = get_s_resp.json()
    assert detail["courseId"] == "course-linked-1"
    assert detail["sessionIndex"] == 1
    assert detail["teacherFee"] == 1500
    assert detail["otherCost"] == 200


def test_delete_course_success(client: TestClient):
    # 1. Create course
    c_resp = client.post("/api/v1/courses", json={"id": "course-del-1", "title": "待刪除期班"})
    assert c_resp.status_code == 201

    # 2. Create session linked to course
    s_resp = client.post("/api/v1/sessions", json={
        "id": "session-del-1",
        "courseId": "course-del-1",
        "date": "2026-06-01",
        "dayOfWeek": "週一",
        "startTime": "14:00",
        "endTime": "15:30",
        "title": "待刪除期班 - 第 1 堂",
        "venueName": "敦南排練室",
    })
    assert s_resp.status_code == 201

    # 3. Delete course
    del_resp = client.delete("/api/v1/courses/course-del-1")
    assert del_resp.status_code == 200
    data = del_resp.json()
    assert data["success"] is True
    assert "待刪除期班" in data["message"]

    # 4. Verify course and session are deleted
    assert client.get("/api/v1/courses/course-del-1").status_code == 404
    assert client.get("/api/v1/sessions/session-del-1").status_code == 404


def test_delete_course_not_found(client: TestClient):
    resp = client.delete("/api/v1/courses/non-existent-course-id")
    assert resp.status_code == 404
    assert "查無此課程" in resp.json()["detail"]
