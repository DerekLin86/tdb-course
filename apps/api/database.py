"""apps/api/database.py
SQLite database engine, session management, and lightweight ORM.
Implements standard SQLAlchemy-compatible ORM patterns using SQLite.
"""
from __future__ import annotations
import os
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Generator, Generic, List, Optional, Set, Type, TypeVar, Union


def get_environment() -> str:
    return os.getenv("ENVIRONMENT", "development").lower()


def is_production() -> bool:
    return get_environment() == "production"


# Database file location
BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DB_FILE = BASE_DIR / ("triple_d_ballet.prod.db" if is_production() else "triple_d_ballet.dev.db")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_FILE}")

T = TypeVar("T")


class ColumnExpr:
    """Represents a SQL expression on a column."""
    def __init__(self, col_name: str, op: str, val: Any):
        self.col_name = col_name
        self.op = op
        self.val = val

    def to_sql(self, params: list) -> str:
        if self.op == "IS NULL":
            return f"{self.col_name} IS NULL"
        elif self.op == "IS NOT NULL":
            return f"{self.col_name} IS NOT NULL"
        elif self.op == "IN":
            if not self.val:
                return "1 = 0"
            placeholders = ", ".join("?" for _ in self.val)
            params.extend(self.val)
            return f"{self.col_name} IN ({placeholders})"
        else:
            params.append(self.val)
            return f"{self.col_name} {self.op} ?"


class OrderByExpr:
    def __init__(self, col_name: str, direction: str = "ASC"):
        self.col_name = col_name
        self.direction = direction

    def to_sql(self) -> str:
        return f"{self.col_name} {self.direction}"


def desc(col_expr: Any) -> OrderByExpr:
    col_name = col_expr.name if hasattr(col_expr, "name") else str(col_expr)
    return OrderByExpr(col_name, "DESC")


def asc(col_expr: Any) -> OrderByExpr:
    col_name = col_expr.name if hasattr(col_expr, "name") else str(col_expr)
    return OrderByExpr(col_name, "ASC")


class Column:
    def __init__(
        self,
        col_type: Any = None,
        primary_key: bool = False,
        nullable: bool = True,
        default: Any = None,
        unique: bool = False,
        index: bool = False,
        onupdate: Any = None,
        foreign_key: Optional[str] = None,
    ):
        self.name: str = ""
        self.col_type = col_type
        self.primary_key = primary_key
        self.nullable = nullable
        self.default = default
        self.unique = unique
        self.index = index
        self.onupdate = onupdate
        self.foreign_key = foreign_key

    def __set_name__(self, owner, name):
        self.name = name

    def __eq__(self, other: Any) -> ColumnExpr:  # type: ignore[override]
        if other is None:
            return ColumnExpr(self.name, "IS NULL", None)
        return ColumnExpr(self.name, "=", other)

    def __ne__(self, other: Any) -> ColumnExpr:  # type: ignore[override]
        if other is None:
            return ColumnExpr(self.name, "IS NOT NULL", None)
        return ColumnExpr(self.name, "!=", other)

    def __gt__(self, other: Any) -> ColumnExpr:
        return ColumnExpr(self.name, ">", other)

    def __ge__(self, other: Any) -> ColumnExpr:
        return ColumnExpr(self.name, ">=", other)

    def __lt__(self, other: Any) -> ColumnExpr:
        return ColumnExpr(self.name, "<", other)

    def __le__(self, other: Any) -> ColumnExpr:
        return ColumnExpr(self.name, "<=", other)

    def in_(self, values: list) -> ColumnExpr:
        return ColumnExpr(self.name, "IN", list(values))

    def desc(self) -> OrderByExpr:
        return OrderByExpr(self.name, "DESC")

    def asc(self) -> OrderByExpr:
        return OrderByExpr(self.name, "ASC")


# Type helpers for models
class String:
    def __init__(self, length: Optional[int] = None):
        self.length = length

class Integer:
    pass

class Text:
    pass

class DateTime:
    pass

class ForeignKey:
    def __init__(self, target: str, ondelete: Optional[str] = None):
        self.target = target
        self.ondelete = ondelete

class UniqueConstraint:
    def __init__(self, *columns: str, name: Optional[str] = None):
        self.columns = columns
        self.name = name

class Relationship:
    def __init__(self, target_model: str, back_populates: Optional[str] = None, cascade: Optional[str] = None, order_by: Optional[str] = None):
        self.target_model = target_model
        self.back_populates = back_populates
        self.cascade = cascade
        self.order_by = order_by
        self.name: str = ""

    def __set_name__(self, owner, name):
        self.name = name

def relationship(target_model: str, back_populates: Optional[str] = None, cascade: Optional[str] = None, order_by: Optional[str] = None) -> Relationship:
    return Relationship(target_model, back_populates=back_populates, cascade=cascade, order_by=order_by)


class Metadata:
    def __init__(self):
        self.tables: Dict[str, Type[BaseModel]] = {}

    def register(self, model_cls: Type[BaseModel]):
        if hasattr(model_cls, "__tablename__") and model_cls.__tablename__:
            self.tables[model_cls.__tablename__] = model_cls

    def create_all(self, bind: Engine):
        with bind._lock:
            conn = bind.get_connection()
            cur = conn.cursor()
            for table_name, model_cls in self.tables.items():
                cols = dict(getattr(model_cls, "_columns", {}))
                if not cols:
                    for k, v in model_cls.__dict__.items():
                        if isinstance(v, Column):
                            cols[k] = v
                    model_cls._columns = cols
                if not cols:
                    continue
                col_defs = []
                for name, col in cols.items():
                    sqlite_type = "TEXT"
                    if isinstance(col.col_type, Integer):
                        sqlite_type = "INTEGER"
                    elif isinstance(col.col_type, (String, Text, DateTime)):
                        sqlite_type = "TEXT"
                    
                    constraints = []
                    if col.primary_key:
                        constraints.append("PRIMARY KEY")
                    if not col.nullable and not col.primary_key:
                        constraints.append("NOT NULL")
                    if col.unique and not col.primary_key:
                        constraints.append("UNIQUE")
                    
                    default_val = ""
                    if col.default is not None and not callable(col.default):
                        if isinstance(col.default, str):
                            default_val = f" DEFAULT '{col.default}'"
                        elif isinstance(col.default, (int, float)):
                            default_val = f" DEFAULT {col.default}"

                    col_defs.append(f"{name} {sqlite_type}{' ' + ' '.join(constraints) if constraints else ''}{default_val}")

                # Unique constraints
                table_args = getattr(model_cls, "__table_args__", ())
                for arg in table_args:
                    if isinstance(arg, UniqueConstraint):
                        cols_str = ", ".join(arg.columns)
                        name_str = f"CONSTRAINT {arg.name} " if arg.name else ""
                        col_defs.append(f"{name_str}UNIQUE ({cols_str})")

                create_sql = f"CREATE TABLE IF NOT EXISTS {table_name} ({', '.join(col_defs)});"
                cur.execute(create_sql)

                # Lightweight auto-migration: add any missing columns without data loss
                cur.execute(f"PRAGMA table_info({table_name});")
                existing_cols = {row["name"] for row in cur.fetchall()}
                for name, col in cols.items():
                    if name not in existing_cols:
                        sqlite_type = "TEXT"
                        if isinstance(col.col_type, Integer):
                            sqlite_type = "INTEGER"
                        default_clause = ""
                        if col.default is not None and not callable(col.default):
                            if isinstance(col.default, str):
                                default_clause = f" DEFAULT '{col.default}'"
                            elif isinstance(col.default, (int, float)):
                                default_clause = f" DEFAULT {col.default}"
                        alter_sql = f"ALTER TABLE {table_name} ADD COLUMN {name} {sqlite_type}{default_clause};"
                        cur.execute(alter_sql)

            conn.commit()

    def drop_all(self, bind: Engine):
        with bind._lock:
            conn = bind.get_connection()
            cur = conn.cursor()
            for table_name in reversed(list(self.tables.keys())):
                cur.execute(f"DROP TABLE IF EXISTS {table_name};")
            conn.commit()


default_metadata = Metadata()


class ModelMeta(type):
    def __new__(mcs, name, bases, namespace):
        columns = {}
        for k, v in list(namespace.items()):
            if isinstance(v, Column):
                columns[k] = v
        namespace["_columns"] = columns
        cls = super().__new__(mcs, name, bases, namespace)
        default_metadata.register(cls)
        return cls


class BaseModel:
    _columns: Dict[str, Column] = {}
    __tablename__: str = ""

    def __init__(self, **kwargs):
        for k, col in self._columns.items():
            if k in kwargs:
                setattr(self, k, kwargs[k])
            else:
                default = col.default
                if callable(default):
                    default = default()
                setattr(self, k, default)


class Base(BaseModel, metaclass=ModelMeta):
    metadata = default_metadata


class SelectQuery(Generic[T]):
    def __init__(self, model_cls: Type[T], session: Session):
        self.model_cls = model_cls
        self.session = session
        self._where_clauses: List[ColumnExpr] = []
        self._order_by: List[OrderByExpr] = []
        self._limit: Optional[int] = None
        self._offset: Optional[int] = None

    def where(self, *clauses: ColumnExpr) -> SelectQuery[T]:
        self._where_clauses.extend(clauses)
        return self

    def filter(self, *clauses: ColumnExpr) -> SelectQuery[T]:
        return self.where(*clauses)

    def order_by(self, *order_exprs: Union[OrderByExpr, Any]) -> SelectQuery[T]:
        for expr in order_exprs:
            if isinstance(expr, OrderByExpr):
                self._order_by.append(expr)
            elif isinstance(expr, str) and expr.startswith("desc(") and expr.endswith(")"):
                col_name = expr[5:-1].split(".")[-1]
                self._order_by.append(OrderByExpr(col_name, "DESC"))
            elif hasattr(expr, "name"):
                self._order_by.append(OrderByExpr(expr.name, "ASC"))
        return self

    def limit(self, n: int) -> SelectQuery[T]:
        self._limit = n
        return self

    def offset(self, n: int) -> SelectQuery[T]:
        self._offset = n
        return self

    def _execute(self) -> List[sqlite3.Row]:
        sql = f"SELECT * FROM {self.model_cls.__tablename__}"
        params: list = []
        if self._where_clauses:
            where_strs = [c.to_sql(params) for c in self._where_clauses]
            sql += " WHERE " + " AND ".join(where_strs)

        if self._order_by:
            order_strs = [o.to_sql() for o in self._order_by]
            sql += " ORDER BY " + ", ".join(order_strs)

        if self._limit is not None:
            sql += f" LIMIT {self._limit}"
        if self._offset is not None:
            sql += f" OFFSET {self._offset}"

        with self.session.engine._lock:
            conn = self.session.engine.get_connection()
            cur = conn.cursor()
            cur.execute(sql, params)
            return cur.fetchall()

    def all(self) -> List[T]:
        rows = self._execute()
        results = []
        for row in rows:
            inst = self.session._get_or_create_instance(self.model_cls, dict(row))
            results.append(inst)
        return results

    def first(self) -> Optional[T]:
        self._limit = 1
        res = self.all()
        return res[0] if res else None

    def count(self) -> int:
        sql = f"SELECT COUNT(*) as cnt FROM {self.model_cls.__tablename__}"
        params: list = []
        if self._where_clauses:
            where_strs = [c.to_sql(params) for c in self._where_clauses]
            sql += " WHERE " + " AND ".join(where_strs)
        with self.session.engine._lock:
            conn = self.session.engine.get_connection()
            cur = conn.cursor()
            cur.execute(sql, params)
            row = cur.fetchone()
            return row["cnt"] if row else 0


def select(model_cls: Type[T]) -> SelectQuery[T]:
    # Will be bound to session when executed via db.scalars(...)
    return SelectQuery(model_cls, session=None)  # type: ignore[arg-type]


class Session:
    def __init__(self, engine: Engine):
        self.engine = engine
        self._new: List[BaseModel] = []
        self._deleted: List[BaseModel] = []
        self._identity_map: Dict[tuple, BaseModel] = {}

    def _get_or_create_instance(self, model_cls: Type[T], row_dict: dict) -> T:
        pk_val = row_dict.get("id")
        key = (model_cls.__tablename__, pk_val)
        if key in self._identity_map:
            inst = self._identity_map[key]
            for k, v in row_dict.items():
                setattr(inst, k, v)
            return inst  # type: ignore[return-value]
        inst = model_cls(**row_dict)
        if pk_val is not None:
            self._identity_map[key] = inst
        return inst

    def query(self, model_cls: Type[T]) -> SelectQuery[T]:
        return SelectQuery(model_cls, session=self)

    def scalars(self, query: SelectQuery[T]) -> SelectQuery[T]:
        query.session = self
        return query

    def get(self, model_cls: Type[T], ident: Any) -> Optional[T]:
        key = (model_cls.__tablename__, ident)
        if key in self._identity_map:
            return self._identity_map[key]  # type: ignore[return-value]
        with self.engine._lock:
            conn = self.engine.get_connection()
            cur = conn.cursor()
            cur.execute(f"SELECT * FROM {model_cls.__tablename__} WHERE id = ?", (ident,))
            row = cur.fetchone()
            if not row:
                return None
            return self._get_or_create_instance(model_cls, dict(row))

    def add(self, instance: BaseModel):
        if instance not in self._new:
            self._new.append(instance)
            pk = getattr(instance, 'id', None)
            if pk is not None:
                self._identity_map[(instance.__tablename__, pk)] = instance

    def add_all(self, instances: list):
        for inst in instances:
            self.add(inst)

    def merge(self, instance: BaseModel) -> BaseModel:
        self.add(instance)
        return instance

    def delete(self, instance: BaseModel):
        if instance in self._new:
            self._new.remove(instance)
        if instance not in self._deleted:
            self._deleted.append(instance)

    def commit(self):
        with self.engine._lock:
            conn = self.engine.get_connection()
            cur = conn.cursor()

            deleted_keys = set()
            for inst in list(self._deleted):
                pk = getattr(inst, 'id', None)
                if pk is not None:
                    key = (inst.__class__.__tablename__, pk)
                    deleted_keys.add(key)
                    cur.execute(f"DELETE FROM {inst.__tablename__} WHERE id = ?", (pk,))
                    self._identity_map.pop(key, None)
            self._deleted.clear()

            seen_ids = set()
            all_instances = [
                inst for inst in list(self._identity_map.values()) + list(self._new)
                if (inst.__class__.__tablename__, getattr(inst, 'id', None)) not in deleted_keys
            ]
            for inst in all_instances:
                pk = getattr(inst, 'id', None)
                if not pk:
                    continue
                inst_key = (inst.__class__.__tablename__, pk)
                if inst_key in seen_ids:
                    continue
                seen_ids.add(inst_key)

                col_names = [col for col in inst._columns.keys()]
                col_vals = [getattr(inst, col, None) for col in col_names]

                placeholders = ", ".join("?" for _ in col_names)
                cols_str = ", ".join(col_names)
                update_str = ", ".join(f"{c} = excluded.{c}" for c in col_names if c != 'id')

                upsert_sql = (
                    f"INSERT INTO {inst.__tablename__} ({cols_str}) VALUES ({placeholders}) "
                    f"ON CONFLICT(id) DO UPDATE SET {update_str};"
                )
                cur.execute(upsert_sql, col_vals)

            conn.commit()
            self._new.clear()

    def rollback(self):
        with self.engine._lock:
            conn = self.engine.get_connection()
            conn.rollback()
            self._new.clear()
            self._deleted.clear()
            self._identity_map.clear()

    def refresh(self, instance: BaseModel):
        pk = getattr(instance, 'id', None)
        if not pk:
            return
        with self.engine._lock:
            conn = self.engine.get_connection()
            cur = conn.cursor()
            cur.execute(f"SELECT * FROM {instance.__tablename__} WHERE id = ?", (pk,))
            row = cur.fetchone()
            if row:
                for k, v in dict(row).items():
                    setattr(instance, k, v)

    def close(self):
        self._new.clear()
        self._deleted.clear()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.rollback()
        self.close()


class Engine:
    def __init__(self, url: str, connect_args: Optional[dict] = None, poolclass: Any = None):
        self.url = url
        self.connect_args = connect_args or {}
        self.poolclass = poolclass
        self._local = threading.local()
        self._lock = threading.RLock()
        self._memory_conn: Optional[sqlite3.Connection] = None
        self._conns: List[sqlite3.Connection] = []

    def get_connection(self) -> sqlite3.Connection:
        db_path = self.url.replace("sqlite:////", "/").replace("sqlite:///:memory:", ":memory:").replace("sqlite:///", "")

        if db_path == ":memory:":
            with self._lock:
                if self._memory_conn is None:
                    check_same_thread = self.connect_args.get("check_same_thread", False)
                    conn = sqlite3.connect(":memory:", check_same_thread=check_same_thread, timeout=30.0)
                    conn.row_factory = sqlite3.Row
                    cur = conn.cursor()
                    cur.execute("PRAGMA foreign_keys = ON;")
                    self._memory_conn = conn
                return self._memory_conn

        if not hasattr(self._local, "conn") or self._local.conn is None:
            check_same_thread = self.connect_args.get("check_same_thread", False)
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(db_path, check_same_thread=check_same_thread, timeout=30.0)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("PRAGMA foreign_keys = ON;")
            try:
                cur.execute("PRAGMA journal_mode = WAL;")
            except Exception:
                pass
            try:
                cur.execute("PRAGMA busy_timeout = 30000;")
            except Exception:
                pass
            self._local.conn = conn
            with self._lock:
                self._conns.append(conn)
        return self._local.conn

    def close_all(self):
        with self._lock:
            if self._memory_conn:
                try:
                    self._memory_conn.close()
                except Exception:
                    pass
                self._memory_conn = None
            for c in self._conns:
                try:
                    c.close()
                except Exception:
                    pass
            self._conns.clear()
            self._local = threading.local()


def create_engine(url: str, connect_args: Optional[dict] = None, poolclass: Any = None, echo: bool = False) -> Engine:
    return Engine(url, connect_args=connect_args, poolclass=poolclass)


class StaticPool:
    pass


class sessionmaker:
    def __init__(self, autocommit: bool = False, autoflush: bool = False, bind: Optional[Engine] = None):
        self.bind = bind

    def __call__(self, bind: Optional[Engine] = None) -> Session:
        engine = bind or self.bind
        if not engine:
            raise ValueError("Session must be bound to an engine")
        return Session(engine)


# Default Engine and Session
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency for database session lifecycle."""
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def backfill_course_enrollments(engine: Engine) -> int:
    """Idempotently backfills course_enrollments from existing attendance_records and class_sessions.
    Ensures PROD zero-downtime, zero-data-loss, and preserves all signatures and histories.
    """
    with engine._lock:
        conn = engine.get_connection()
        cur = conn.cursor()
        backfill_sql = """
        INSERT INTO course_enrollments (id, course_id, student_id, enrolled_at, status, created_at, updated_at)
        SELECT 
            'enr-' || s.course_id || '-' || a.student_id AS id,
            s.course_id,
            a.student_id,
            COALESCE(SUBSTR(MIN(a.created_at), 1, 10), strftime('%Y-%m-%d', 'now')) AS enrolled_at,
            'active' AS status,
            strftime('%Y-%m-%dT%H:%M:%f', 'now') AS created_at,
            strftime('%Y-%m-%dT%H:%M:%f', 'now') AS updated_at
        FROM attendance_records a
        JOIN class_sessions s ON a.session_id = s.id
        WHERE s.course_id IS NOT NULL 
          AND s.course_id != ''
          AND NOT EXISTS (
              SELECT 1 FROM course_enrollments ce
              WHERE ce.course_id = s.course_id AND ce.student_id = a.student_id
          )
        GROUP BY s.course_id, a.student_id;
        """
        cur.execute(backfill_sql)
        inserted_rows = cur.rowcount
        conn.commit()
        return inserted_rows


def init_db(seed: bool = True, force_seed: bool = False) -> None:
    """Initialize database tables and optionally seed mock data."""
    from models.student import Student, TicketPack
    from models.session import ClassSession
    from models.attendance import AttendanceRecord
    from models.course import Course
    from models.course_enrollment import CourseEnrollment
    from seed import seed_mock_data

    Base.metadata.create_all(bind=engine)
    try:
        backfill_course_enrollments(engine)
    except Exception as e:
        print(f"Warning: backfill_course_enrollments skipped or failed: {e}")

    if is_production() and not force_seed:
        return

    if seed or force_seed:
        with SessionLocal() as db:
            if force_seed or db.query(Student).count() == 0:
                seed_mock_data(db)


def reset_db() -> None:
    """Drop all tables, recreate, and re-seed with standard mock datasets."""
    if is_production():
        raise RuntimeError("reset_db is strictly prohibited in production environment")

    from models.student import Student, TicketPack
    from models.session import ClassSession
    from models.attendance import AttendanceRecord
    from models.course import Course
    from models.course_enrollment import CourseEnrollment

    Base.metadata.drop_all(bind=engine)
    engine.close_all()
    init_db(seed=True, force_seed=True)
