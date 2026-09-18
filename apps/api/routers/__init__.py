"""apps/api/routers/__init__.py"""
from .students import router as students_router
from .sessions import router as sessions_router
from .attendance import router as attendance_router
from .system import router as system_router

__all__ = [
    "students_router",
    "sessions_router",
    "attendance_router",
    "system_router",
]
