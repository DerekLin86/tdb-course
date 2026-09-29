"""apps/api/services/ticket_service.py
Ticket pack management: purchase, FIFO deduction, refund, expiry extension.
"""
from datetime import date, datetime, timedelta
import random
import time
from typing import Any, Dict, List, Optional
from fastapi import HTTPException
from database import Session, select, desc, asc
from models.student import Student, TicketPack


class TicketService:
    """Encapsulates business operations for student ticket packs."""

    PACK_CONFIGS: Dict[str, Dict[str, Any]] = {
        "5_class": {"total_count": 5, "validity_days": 60, "price_paid": 2500},
        "10_class": {"total_count": 10, "validity_days": 100, "price_paid": 5000},
        "single": {"total_count": 1, "validity_days": 30, "price_paid": 500},
        "trial": {"total_count": 1, "validity_days": 14, "price_paid": 400},
    }

    @staticmethod
    def purchase_pack(
        db: Session,
        student_id: str,
        pack_type: str,
        total_count: Optional[int] = None,
        validity_days: Optional[int] = None,
        price_paid: Optional[int] = None,
    ) -> TicketPack:
        """Purchases and activates a new ticket pack for a student."""
        if pack_type == "trial":
            stmt = (
                select(TicketPack).where(
                    TicketPack.student_id == student_id,
                    TicketPack.type == "trial"
                )
            )
            existing_trial = db.scalars(stmt).first()
            if existing_trial:
                raise HTTPException(
                    status_code=400,
                    detail="每位學員終身限購 1 次體驗課，無法重複購買！"
                )

        config = TicketService.PACK_CONFIGS.get(
            pack_type, {"total_count": 5, "validity_days": 60, "price_paid": 2500}
        )
        count = total_count if total_count is not None else config["total_count"]
        days = validity_days if validity_days is not None else config["validity_days"]
        price = price_paid if price_paid is not None else config["price_paid"]

        today = date.today()
        expiry = today + timedelta(days=days)

        pack_id = f"pack-{int(time.time() * 1000)}-{random.randint(100, 999)}"
        pack = TicketPack(
            id=pack_id,
            student_id=student_id,
            type=pack_type,
            total_count=count,
            remaining_count=count,
            purchase_date=today.strftime("%Y-%m-%d"),
            expiry_date=expiry.strftime("%Y-%m-%d"),
            status="active",
            price_paid=price,
        )
        db.add(pack)
        db.commit()
        db.refresh(pack)
        return pack

    @staticmethod
    def get_active_pack(db: Session, student_id: str) -> Optional[TicketPack]:
        """Retrieves the earliest-expiring active ticket pack with remaining tickets (FIFO)."""
        today_str = date.today().strftime("%Y-%m-%d")
        stmt = (
            select(TicketPack)
            .where(
                TicketPack.student_id == student_id,
                TicketPack.remaining_count > 0,
                TicketPack.expiry_date >= today_str,
            )
            .order_by(asc(TicketPack.expiry_date))
        )
        pack = db.scalars(stmt).first()
        if pack and pack.status != "active":
            pack.status = "active"
            db.commit()
            db.refresh(pack)
        return pack

    @staticmethod
    def deduct_ticket(
        db: Session, student_id: str, count: int = 1, commit: bool = True
    ) -> TicketPack:
        """Deducts tickets from the active pack using FIFO priority.
        Raises ValueError if insufficient balance.
        """
        pack = TicketService.get_active_pack(db, student_id)
        if not pack or pack.remaining_count < count:
            raise ValueError("票卡堂數已用罄，請先儲值！")

        pack.remaining_count -= count
        if pack.remaining_count <= 0:
            pack.status = "depleted"
        if commit:
            db.commit()
            db.refresh(pack)
        return pack

    @staticmethod
    def refund_ticket(
        db: Session, student_id: str, count: int = 1, commit: bool = True
    ) -> Optional[TicketPack]:
        """Refunds tickets back to student. Re-activates depleted packs if applicable.
        Bound check: remaining_count <= total_count.
        If active pack is full, refund into the most recently depleted pack with
        remaining_count < total_count and reactivate it if within validity.
        """
        today_str = date.today().strftime("%Y-%m-%d")

        target_pack: Optional[TicketPack] = None
        active_pack = TicketService.get_active_pack(db, student_id)

        if active_pack and (active_pack.remaining_count + count <= active_pack.total_count):
            target_pack = active_pack
        else:
            stmt = (
                select(TicketPack)
                .where(TicketPack.student_id == student_id)
                .order_by(desc(TicketPack.expiry_date))
            )
            all_student_packs = db.scalars(stmt).all()
            packs_with_room = [p for p in all_student_packs if p.remaining_count < p.total_count]
            if packs_with_room:
                target_pack = packs_with_room[0]
            elif active_pack:
                target_pack = active_pack
            elif all_student_packs:
                target_pack = all_student_packs[0]

        if target_pack:
            target_pack.remaining_count = min(
                target_pack.total_count, target_pack.remaining_count + count
            )
            if target_pack.remaining_count > 0 and target_pack.expiry_date >= today_str:
                target_pack.status = "active"
            if commit:
                db.commit()
                db.refresh(target_pack)
        return target_pack

    @staticmethod
    def extend_pack(db: Session, pack_id: str, extra_days: int = 30) -> TicketPack:
        """Extends pack expiration date. Reactivates expired pack if remaining > 0."""
        stmt = select(TicketPack).where(TicketPack.id == pack_id)
        pack = db.scalars(stmt).first()
        if not pack:
            raise ValueError(f"查無票卡 ID: {pack_id}")

        curr_expiry = datetime.strptime(pack.expiry_date, "%Y-%m-%d").date()
        new_expiry = curr_expiry + timedelta(days=extra_days)
        pack.expiry_date = new_expiry.strftime("%Y-%m-%d")

        today = date.today()
        if pack.remaining_count > 0 and new_expiry >= today:
            pack.status = "active"
        db.commit()
        db.refresh(pack)
        return pack

    @staticmethod
    def enrich_student_data(db: Session, student: Student) -> Dict[str, Any]:
        """Enriches student profile with active pack, daysUntilExpiry, and isNearExpiry."""
        active_pack = TicketService.get_active_pack(db, student.id)
        days_until_expiry = None
        is_near_expiry = False

        if active_pack:
            today = date.today()
            try:
                expiry = datetime.strptime(active_pack.expiry_date, "%Y-%m-%d").date()
                days_until_expiry = (expiry - today).days
                is_near_expiry = 0 <= days_until_expiry <= 14
            except ValueError:
                pass

        return {
            "id": student.id,
            "name": student.name,
            "phone": student.phone,
            "line_user_id": student.line_user_id,
            "avatar_url": student.avatar_url,
            "notes": student.notes,
            "registered_at": student.registered_at,
            "active_pack": active_pack,
            "days_until_expiry": days_until_expiry,
            "is_near_expiry": is_near_expiry,
        }
