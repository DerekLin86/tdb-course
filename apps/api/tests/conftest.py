"""apps/api/tests/conftest.py
Pytest fixtures: in-memory SQLite database, FastAPI TestClient, and domain test entities.
"""
import os
import sys
from typing import Generator
import pytest
from fastapi.testclient import TestClient

# Ensure apps/api is in sys.path
api_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if api_dir not in sys.path:
    sys.path.insert(0, api_dir)

from database import Base, create_engine, sessionmaker, Session, get_db, StaticPool
from main import app
from models.student import Student, TicketPack
from models.session import ClassSession
from models.attendance import AttendanceRecord

TEST_DATABASE_URL = "sqlite:///:memory:"

test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(scope="function")
def db_session() -> Generator[Session, None, None]:
    """Creates a fresh in-memory database session for each test function."""
    Base.metadata.create_all(bind=test_engine)
    session = TestingSessionLocal(bind=test_engine)
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(scope="function")
def client(db_session: Session) -> Generator[TestClient, None, None]:
    """FastAPI TestClient with overridden get_db dependency pointing to in-memory DB."""
    def _override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def sample_signature() -> str:
    """Standard valid 1x1 Base64 PNG signature Data URL."""
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


@pytest.fixture
def seed_student(db_session: Session) -> Student:
    """Seeds a test student."""
    stu = Student(
        id="stu-test-1",
        name="陳秀琴",
        phone="0912-345-678",
        notes="芭蕾基礎班學員",
        registered_at="2026-01-10",
    )
    db_session.add(stu)
    db_session.commit()
    db_session.refresh(stu)
    return stu


@pytest.fixture
def seed_pack(db_session: Session, seed_student: Student) -> TicketPack:
    """Seeds an active 10-class ticket pack for seed_student."""
    pack = TicketPack(
        id="pack-test-1",
        student_id=seed_student.id,
        type="10_class",
        total_count=10,
        remaining_count=7,
        purchase_date="2026-08-01",
        expiry_date="2026-11-15",
        status="active",
        price_paid=5000,
    )
    db_session.add(pack)
    db_session.commit()
    db_session.refresh(pack)
    return pack


@pytest.fixture
def seed_session(db_session: Session) -> ClassSession:
    """Seeds a scheduled class session."""
    session = ClassSession(
        id="session-test-upcoming",
        date="2026-09-19",
        day_of_week="週六",
        start_time="14:00",
        end_time="15:30",
        title="成人優雅芭蕾美姿體雕班",
        venue_name="敦南日光舞蹈排練室 A 廳",
        venue_cost=2000,
        fee_per_student=500,
        max_capacity=10,
        min_threshold=4,
        status="scheduled",
    )
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)
    return session
