"""apps/api/tests/test_system_protection.py
Unit tests verifying production protection guards on system reset and database initialization.
"""
from pathlib import Path
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

from database import (
    BaseModel,
    Column,
    Integer,
    Metadata,
    Session,
    String,
    create_engine,
    get_environment,
    init_db,
    is_production,
    reset_db,
)
import seed


def test_system_reset_blocked_in_production(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify that POST /api/v1/system/reset returns 403 Forbidden in production environment."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    resp = client.post("/api/v1/system/reset")
    assert resp.status_code == 403
    detail = resp.json().get("detail", "")
    assert "production" in detail or "生產模式" in detail


def test_reset_db_function_raises_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify that reset_db() raises RuntimeError directly when running in production."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(RuntimeError) as exc_info:
        reset_db()
    assert "production" in str(exc_info.value).lower()


def test_init_db_in_production_does_not_seed_mock_data(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify init_db() creates schema metadata but avoids seeding mock data in production."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    mock_seed = MagicMock()
    monkeypatch.setattr(seed, "seed_mock_data", mock_seed)

    init_db(seed=True, force_seed=False)

    mock_seed.assert_not_called()


def test_system_reset_allowed_in_development(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify that POST /api/v1/system/reset succeeds in development environment."""
    monkeypatch.setenv("ENVIRONMENT", "development")
    resp = client.post("/api/v1/system/reset")
    assert resp.status_code == 200
    data = resp.json()
    assert "message" in data
    assert "重置" in data["message"]


def test_environment_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify get_environment() and is_production() correctly reflect environment variables."""
    # 1. Production setting
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert get_environment() == "production"
    assert is_production() is True

    # 2. Development setting
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert get_environment() == "development"
    assert is_production() is False

    # 3. Default fallback (when ENVIRONMENT is unset)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    assert get_environment() == "development"
    assert is_production() is False


def test_auto_migration_adds_new_column(tmp_path: Path) -> None:
    """Verify that Metadata.create_all dynamically and non-destructively adds new columns via ALTER TABLE."""
    test_db_file = tmp_path / "test_migration.db"
    test_engine = create_engine(f"sqlite:///{test_db_file}", connect_args={"check_same_thread": False})

    # 1. Create initial table directly via SQL
    conn = test_engine.get_connection()
    cur = conn.cursor()
    cur.execute("CREATE TABLE test_students (id TEXT PRIMARY KEY, name TEXT);")

    # 2. Insert test record (zero data loss baseline)
    cur.execute("INSERT INTO test_students (id, name) VALUES (?, ?);", ("stu-test-1", "張三"))
    conn.commit()

    # 3. Register model defining newly added columns (email, grade)
    test_meta = Metadata()

    class TestStudent(BaseModel):
        _metadata = test_meta
        __tablename__ = "test_students"

        id = Column(String(), primary_key=True)
        name = Column(String())
        email = Column(String())
        grade = Column(Integer())

    test_meta.register(TestStudent)

    # 4. Invoke create_all to trigger auto-migration
    test_meta.create_all(bind=test_engine)

    # 5. Verify existing record preserved and schema updated
    cur.execute("PRAGMA table_info(test_students);")
    columns = {row["name"] if hasattr(row, "keys") else row[1] for row in cur.fetchall()}
    assert "id" in columns
    assert "name" in columns
    assert "email" in columns
    assert "grade" in columns

    # 6. Verify read & write on newly migrated columns without data loss
    session = Session(test_engine)
    record = session.get(TestStudent, "stu-test-1")
    assert record is not None
    assert record.id == "stu-test-1"
    assert record.name == "張三"
    assert record.email is None
    assert record.grade is None

    # Update record with values in new columns
    record.email = "test@example.com"
    record.grade = 5
    session.commit()
    session.close()

    # Query back using a fresh session to confirm persistence
    verify_session = Session(test_engine)
    updated_record = verify_session.get(TestStudent, "stu-test-1")
    assert updated_record is not None
    assert updated_record.id == "stu-test-1"
    assert updated_record.name == "張三"
    assert updated_record.email == "test@example.com"
    assert updated_record.grade == 5
    verify_session.close()

    test_engine.close_all()

