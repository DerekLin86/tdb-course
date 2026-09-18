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

# Database file location
BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DB_FILE = BASE_DIR / "triple_d_ballet.db"
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
        elif isinstance(self.val, Column):
            return f"{self.col_name} {self.op} {self.val.name}"
        else:
            params.append(self.val)
            return f"{self.col_name} {self.op} ?"


class OrderByExpr:
    def __init__(self, col_name: str, direction: str = "ASC"):
        self.col_name = col_name
        self.direction = direction.upper()

    def to_sql(self) -> str:
        return f"{self.col_name} {self.direction}"


def desc(col: Union[Column, OrderByExpr, str]) -> OrderByExpr:
    if isinstance(col, Column):
        return OrderByExpr(col.name, "DESC")
    elif isinstance(col, OrderByExpr):
        col.direction = "DESC"
        return col
    elif isinstance(col, str):
        if " " in col:
            parts = col.split()
            return OrderByExpr(parts[0], parts[1])
        return OrderByExpr(col, "DESC")
    return OrderByExpr(str(col), "DESC")


def asc(col: Union[Column, OrderByExpr, str]) -> OrderByExpr:
    if isinstance(col, Column):
        return OrderByExpr(col.name, "ASC")
    elif isinstance(col, OrderByExpr):
        col.direction = "ASC"
        return col
    elif isinstance(col, str):
        if " " in col:
            parts = col.split()
            return OrderByExpr(parts[0], parts[1])
        return OrderByExpr(col, "ASC")
    return OrderByExpr(str(col), "ASC")


class Column:
    def __init__(
        self,
        col_type: Any,
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

    def __get__(self, instance, owner):
        if instance is None:
            return self
        return getattr(instance, f"_{self.name}", None)

    def __set__(self, instance, value):
        setattr(instance, f"_{self.name}", value)

def relationship(target: str, back_populates: Optional[str] = None, cascade: Optional[str] = None, order_by: Optional[str] = None) -> Relationship:
    return Relationship(target, back_populates=back_populates, cascade=cascade, order_by=order_by)


class Metadata:
    def __init__(self):
        self.tables: Dict[str, Type[BaseModel]] = {}

    def register(self, model_cls: Type[BaseModel]):
        if hasattr(model_cls, "__tablename__") and model_cls.__tablename__:
            self.tables[model_cls.__tablename__] = model_cls

    def create_all(self, bind: Engine):
        conn = bind.get_connection()
        cur = conn.cursor()
        for tablename, model_cls in self.tables.items():
            col_defs = []
            fk_defs = []
            pk_col = None
            for col_name, col in model_cls._columns.items():
                sqlite_type = "TEXT"
                if isinstance(col.col_type, Integer) or col.col_type is Integer:
                    sqlite_type = "INTEGER"

                parts = [col_name, sqlite_type]
                if col.primary_key:
                    parts.append("PRIMARY KEY")
                    pk_col = col_name
                if not col.nullable and not col.primary_key:
                    parts.append("NOT NULL")
                if col.unique and not col.primary_key:
                    parts.append("UNIQUE")

                col_defs.append(" ".join(parts))

                if col.foreign_key:
                    # e.g. students.id
                    target_table, target_col = col.foreign_key.target.split(".")
                    fk_clause = f"FOREIGN KEY ({col_name}) REFERENCES {target_table}({target_col})"
                    if col.foreign_key.ondelete:
                        fk_clause += f" ON DELETE {col.foreign_key.ondelete.upper()}"
                    fk_defs.append(fk_clause)

            table_constraints = []
            if hasattr(model_cls, "__table_args__"):
                for arg in model_cls.__table_args__:
                    if isinstance(arg, UniqueConstraint):
                        cols_str = ", ".join(arg.columns)
                        table_constraints.append(f"UNIQUE ({cols_str})")

            all_defs = col_defs + fk_defs + table_constraints
            create_sql = f"CREATE TABLE IF NOT EXISTS {tablename} ({', '.join(all_defs)});"
            cur.execute(create_sql)

        conn.commit()

    def drop_all(self, bind: Engine):
        conn = bind.get_connection()
        cur = conn.cursor()
        cur.execute("PRAGMA foreign_keys = OFF;")
        for tablename in list(self.tables.keys()):
            cur.execute(f"DROP TABLE IF EXISTS {tablename};")
        cur.execute("PRAGMA foreign_keys = ON;")
        conn.commit()


class ModelMeta(type):
    def __new__(mcs, name, bases, namespace):
        columns = {}
        for k, v in list(namespace.items()):
            if isinstance(v, Column):
                v.name = k
                columns[k] = v
            elif isinstance(v, Relationship):
                pass
        cls = super().__new__(mcs, name, bases, namespace)
        cls._columns = columns
        if bases != (object,) and hasattr(cls, "_metadata") and cls._metadata:
            cls._metadata.register(cls)
        return cls


class BaseModel(metaclass=ModelMeta):
    _columns: Dict[str, Column] = {}
    _metadata: Optional[Metadata] = None
    __tablename__: str = ""

    def __init__(self, **kwargs):
        # Set column defaults
        for col_name, col in self._columns.items():
            if col_name in kwargs:
                setattr(self, col_name, kwargs[col_name])
            else:
                if callable(col.default):
                    setattr(self, col_name, col.default())
                else:
                    setattr(self, col_name, col.default)
        # Set any extra attributes
        for k, v in kwargs.items():
            if k not in self._columns:
                setattr(self, k, v)

    def to_dict(self) -> Dict[str, Any]:
        return {col_name: getattr(self, col_name, None) for col_name in self._columns}

    def __repr__(self):
        pk_val = getattr(self, 'id', None)
        return f"<{self.__class__.__name__} id={pk_val}>"


metadata = Metadata()
BaseModel._metadata = metadata

def declarative_base():
    class DeclarativeBase(BaseModel):
        pass
    DeclarativeBase.metadata = metadata
    return DeclarativeBase

Base = declarative_base()


class SelectStatement:
    def __init__(self, model_cls: Type[BaseModel]):
        self.model_cls = model_cls
        self.where_exprs: List[ColumnExpr] = []
        self.order_by_exprs: List[OrderByExpr] = []

    def where(self, *exprs) -> SelectStatement:
        for expr in exprs:
            if isinstance(expr, ColumnExpr):
                self.where_exprs.append(expr)
        return self

    def order_by(self, *exprs) -> SelectStatement:
        for expr in exprs:
            if isinstance(expr, OrderByExpr):
                self.order_by_exprs.append(expr)
            elif isinstance(expr, Column):
                self.order_by_exprs.append(OrderByExpr(expr.name, "ASC"))
            elif isinstance(expr, str):
                self.order_by_exprs.append(desc(expr) if 'desc' in expr.lower() else asc(expr))
        return self


def select(model_cls: Type[BaseModel]) -> SelectStatement:
    return SelectStatement(model_cls)


class ScalarResult(Generic[T]):
    def __init__(self, items: List[T]):
        self._items = items

    def all(self) -> List[T]:
        return list(self._items)

    def first(self) -> Optional[T]:
        return self._items[0] if self._items else None

    def __iter__(self):
        return iter(self._items)


class Query(Generic[T]):
    def __init__(self, model_cls: Type[T], session: Session):
        self.model_cls = model_cls
        self.session = session
        self.where_exprs: List[ColumnExpr] = []
        self.order_by_exprs: List[OrderByExpr] = []

    def filter(self, *exprs) -> Query[T]:
        for expr in exprs:
            if isinstance(expr, ColumnExpr):
                self.where_exprs.append(expr)
        return self

    def order_by(self, *exprs) -> Query[T]:
        for expr in exprs:
            if isinstance(expr, OrderByExpr):
                self.order_by_exprs.append(expr)
            elif isinstance(expr, Column):
                self.order_by_exprs.append(OrderByExpr(expr.name, "ASC"))
            elif isinstance(expr, str):
                self.order_by_exprs.append(desc(expr) if 'desc' in expr.lower() else asc(expr))
        return self

    def _build_sql(self) -> tuple[str, list]:
        tablename = self.model_cls.__tablename__
        sql = f"SELECT * FROM {tablename}"
        params = []
        if self.where_exprs:
            clauses = [e.to_sql(params) for e in self.where_exprs]
            sql += " WHERE " + " AND ".join(clauses)
        if self.order_by_exprs:
            clauses = [e.to_sql() for e in self.order_by_exprs]
            sql += " ORDER BY " + ", ".join(clauses)
        return sql, params

    def all(self) -> List[T]:
        sql, params = self._build_sql()
        with self.session.engine._lock:
            conn = self.session.engine.get_connection()
            cur = conn.cursor()
            cur.execute(sql, params)
            rows = cur.fetchall()
            result = []
            for row in rows:
                obj = self.model_cls(**dict(row))
                self.session._identity_map[(self.model_cls, getattr(obj, 'id', id(obj)))] = obj
                result.append(obj)
            return result

    def first(self) -> Optional[T]:
        items = self.all()
        return items[0] if items else None

    def count(self) -> int:
        tablename = self.model_cls.__tablename__
        sql = f"SELECT COUNT(*) FROM {tablename}"
        params = []
        if self.where_exprs:
            clauses = [e.to_sql(params) for e in self.where_exprs]
            sql += " WHERE " + " AND ".join(clauses)
        with self.session.engine._lock:
            conn = self.session.engine.get_connection()
            cur = conn.cursor()
            cur.execute(sql, params)
            row = cur.fetchone()
            return row[0] if row else 0


class Session:
    def __init__(self, engine: Engine):
        self.engine = engine
        self._new: List[BaseModel] = []
        self._dirty: Set[BaseModel] = set()
        self._deleted: List[BaseModel] = []
        self._identity_map: Dict[tuple, BaseModel] = {}

    def query(self, model_cls: Type[T]) -> Query[T]:
        return Query(model_cls, self)

    def select(self, model_cls: Type[T]) -> SelectStatement:
        return SelectStatement(model_cls)

    def scalars(self, stmt: SelectStatement) -> ScalarResult[Any]:
        q = Query(stmt.model_cls, self)
        q.where_exprs = list(stmt.where_exprs)
        q.order_by_exprs = list(stmt.order_by_exprs)
        return ScalarResult(q.all())

    def get(self, model_cls: Type[T], ident: Any) -> Optional[T]:
        key = (model_cls, ident)
        if key in self._identity_map:
            return self._identity_map[key]  # type: ignore
        return self.query(model_cls).filter(model_cls._columns['id'] == ident).first()

    def add(self, instance: BaseModel):
        if instance not in self._new and instance not in self._dirty:
            self._new.append(instance)
            if hasattr(instance, 'id'):
                self._identity_map[(instance.__class__, instance.id)] = instance

    def add_all(self, instances: List[BaseModel]):
        for inst in instances:
            self.add(inst)

    def merge(self, instance: BaseModel) -> BaseModel:
        self.add(instance)
        return instance

    def delete(self, instance: BaseModel):
        self._deleted.append(instance)
        if instance in self._new:
            self._new.remove(instance)
        if hasattr(instance, 'id'):
            key = (instance.__class__, instance.id)
            if key in self._identity_map:
                del self._identity_map[key]

    def commit(self):
        with self.engine._lock:
            conn = self.engine.get_connection()
            cur = conn.cursor()

            # Handle deletes
            for inst in self._deleted:
                pk = getattr(inst, 'id', None)
                if pk is not None:
                    cur.execute(f"DELETE FROM {inst.__tablename__} WHERE id = ?", (pk,))
            self._deleted.clear()

            # Handle new & dirty (upsert via sqlite3)
            to_save = list(self._new) + list(self._identity_map.values())
            seen_ids = set()

            for inst in to_save:
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

        # In-memory database connection (shared across threads safely via self._lock)
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

        # File-based database: thread-local connection with WAL mode & busy timeout
        if not hasattr(self._local, "conn") or self._local.conn is None:
            check_same_thread = self.connect_args.get("check_same_thread", False)
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


def init_db(seed: bool = True, force_seed: bool = False) -> None:
    """Initialize database tables and optionally seed mock data."""
    # Import models here to register metadata
    from models.student import Student, TicketPack
    from models.session import ClassSession
    from models.attendance import AttendanceRecord
    from seed import seed_mock_data

    Base.metadata.create_all(bind=engine)
    if seed or force_seed:
        with SessionLocal() as db:
            if force_seed or db.query(Student).count() == 0:
                seed_mock_data(db)


def reset_db() -> None:
    """Drop all tables, recreate, and re-seed with standard mock datasets."""
    from models.student import Student, TicketPack
    from models.session import ClassSession
    from models.attendance import AttendanceRecord

    Base.metadata.drop_all(bind=engine)
    engine.close_all()
    init_db(seed=True, force_seed=True)

