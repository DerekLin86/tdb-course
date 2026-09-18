"""apps/api/schemas/system.py
Pydantic schema for system reset response.
"""
from .base import CamelModel


class SystemResetResponse(CamelModel):
    message: str
    students_count: int = 10
    ticket_packs_count: int = 10
    sessions_count: int = 2
    attendance_count: int = 2
