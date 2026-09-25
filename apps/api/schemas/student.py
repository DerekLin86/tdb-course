"""apps/api/schemas/student.py
Pydantic schemas for Student and TicketPack.
"""
from typing import Literal, Optional, List
from pydantic import Field
from .base import CamelModel

TicketPackType = Literal['5_class', '10_class', 'single', 'trial']
TicketPackStatus = Literal['active', 'expired', 'depleted']


class TicketPackBase(CamelModel):
    student_id: str
    type: TicketPackType
    total_count: int
    remaining_count: int
    purchase_date: str  # YYYY-MM-DD
    expiry_date: str    # YYYY-MM-DD
    status: TicketPackStatus = 'active'
    price_paid: Optional[int] = None


class TicketPackCreate(CamelModel):
    student_id: str
    type: TicketPackType
    total_count: int
    validity_days: int
    price_paid: Optional[int] = None


class TicketPackExtendRequest(CamelModel):
    extra_days: int = Field(default=30, ge=1, description="Number of days to extend expiration")


class TicketPackResponse(TicketPackBase):
    id: str


class StudentBase(CamelModel):
    name: str
    phone: str
    line_user_id: Optional[str] = None
    avatar_url: Optional[str] = None
    notes: Optional[str] = None
    registered_at: Optional[str] = None


class StudentCreate(StudentBase):
    id: Optional[str] = None


class StudentUpdate(CamelModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    line_user_id: Optional[str] = None
    avatar_url: Optional[str] = None
    notes: Optional[str] = None


class StudentResponse(StudentBase):
    id: str
    active_pack: Optional[TicketPackResponse] = None
    days_until_expiry: Optional[int] = None
    is_near_expiry: Optional[bool] = None
