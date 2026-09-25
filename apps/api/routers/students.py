"""apps/api/routers/students.py
REST router for students and ticket packs.
"""
from datetime import datetime
import sqlite3
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from database import Session, get_db
from models.student import Student, TicketPack
from schemas.student import (
    StudentCreate,
    StudentUpdate,
    StudentResponse,
    TicketPackCreate,
    TicketPackResponse,
    TicketPackExtendRequest,
)
from services.ticket_service import TicketService

router = APIRouter(tags=["Students & Ticket Packs"])


@router.get("/students", response_model=List[StudentResponse])
def get_students(db: Session = Depends(get_db)):
    """Fetch all students enriched with active ticket pack and expiration status."""
    students = db.query(Student).all()
    result = []
    for stu in students:
        enriched = TicketService.enrich_student_data(db, stu)
        active_pack = enriched["active_pack"]
        pack_resp = TicketPackResponse.model_validate(active_pack) if active_pack else None
        stu_dict = {
            "id": stu.id,
            "name": stu.name,
            "phone": stu.phone,
            "line_user_id": stu.line_user_id,
            "avatar_url": stu.avatar_url,
            "notes": stu.notes,
            "registered_at": stu.registered_at,
            "active_pack": pack_resp,
            "days_until_expiry": enriched["days_until_expiry"],
            "is_near_expiry": enriched["is_near_expiry"],
        }
        result.append(StudentResponse.model_validate(stu_dict))
    return result


@router.post("/students", response_model=StudentResponse, status_code=status.HTTP_201_CREATED)
def create_student(payload: StudentCreate, db: Session = Depends(get_db)):
    """Register a new student. Rejects duplicate phone numbers with 409 Conflict."""
    existing_phone = db.query(Student).filter(Student.phone == payload.phone).first()
    if existing_phone:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"電話號碼 {payload.phone} 已被註冊（學員：{existing_phone.name}）",
        )

    stu_id = payload.id or f"stu-{int(datetime.now().timestamp() * 1000)}"
    reg_date = payload.registered_at or datetime.now().strftime("%Y-%m-%d")

    student = Student(
        id=stu_id,
        name=payload.name,
        phone=payload.phone,
        line_user_id=payload.line_user_id,
        avatar_url=payload.avatar_url,
        notes=payload.notes,
        registered_at=reg_date,
    )
    try:
        db.add(student)
        db.commit()
    except (sqlite3.IntegrityError, Exception) as err:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"學員建立衝突（電話號碼或 ID 已存在）: {str(err)}",
        )
    db.refresh(student)
    return StudentResponse.model_validate(student)


@router.get("/students/{student_id}", response_model=StudentResponse)
def get_student_by_id(student_id: str, db: Session = Depends(get_db)):
    """Get student profile by ID."""
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="查無該學員")

    enriched = TicketService.enrich_student_data(db, student)
    active_pack = enriched["active_pack"]
    pack_resp = TicketPackResponse.model_validate(active_pack) if active_pack else None

    return StudentResponse(
        id=student.id,
        name=student.name,
        phone=student.phone,
        line_user_id=student.line_user_id,
        avatar_url=student.avatar_url,
        notes=student.notes,
        registered_at=student.registered_at,
        active_pack=pack_resp,
        days_until_expiry=enriched["days_until_expiry"],
        is_near_expiry=enriched["is_near_expiry"],
    )


@router.put("/students/{student_id}", response_model=StudentResponse)
def update_student(student_id: str, payload: StudentUpdate, db: Session = Depends(get_db)):
    """Update student details (name, phone, notes). Validates phone uniqueness."""
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="查無該學員")

    if payload.phone and payload.phone != student.phone:
        existing_phone = db.query(Student).filter(Student.phone == payload.phone, Student.id != student_id).first()
        if existing_phone:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"電話號碼 {payload.phone} 已被註冊（學員：{existing_phone.name}）",
            )
        student.phone = payload.phone

    if payload.name is not None:
        student.name = payload.name
    if payload.notes is not None:
        student.notes = payload.notes
    if payload.line_user_id is not None:
        student.line_user_id = payload.line_user_id
    if payload.avatar_url is not None:
        student.avatar_url = payload.avatar_url

    student.updated_at = datetime.now().isoformat()
    db.commit()
    db.refresh(student)

    enriched = TicketService.enrich_student_data(db, student)
    active_pack = enriched["active_pack"]
    pack_resp = TicketPackResponse.model_validate(active_pack) if active_pack else None

    return StudentResponse(
        id=student.id,
        name=student.name,
        phone=student.phone,
        line_user_id=student.line_user_id,
        avatar_url=student.avatar_url,
        notes=student.notes,
        registered_at=student.registered_at,
        active_pack=pack_resp,
        days_until_expiry=enriched["days_until_expiry"],
        is_near_expiry=enriched["is_near_expiry"],
    )


@router.delete("/students/{student_id}", status_code=status.HTTP_200_OK)
def delete_student(student_id: str, db: Session = Depends(get_db)):
    """Delete a student and cascade-remove associated tickets and attendance records."""
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="查無該學員")

    student_name = student.name
    db.delete(student)
    db.commit()
    return {"message": f"學員 {student_name} 已成功刪除", "success": True}


@router.post("/ticket-packs", response_model=TicketPackResponse, status_code=status.HTTP_201_CREATED)
def purchase_ticket_pack(payload: TicketPackCreate, db: Session = Depends(get_db)):
    """Purchase a 5-class or 10-class ticket pack for a student."""
    student = db.get(Student, payload.student_id)
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="查無該學員")

    try:
        pack = TicketService.purchase_pack(
            db,
            student_id=payload.student_id,
            pack_type=payload.type,
            total_count=payload.total_count,
            validity_days=payload.validity_days,
            price_paid=payload.price_paid,
        )
        return TicketPackResponse.model_validate(pack)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch("/ticket-packs/{pack_id}/extend", response_model=TicketPackResponse)
@router.post("/ticket-packs/{pack_id}/extend", response_model=TicketPackResponse)
def extend_ticket_pack(pack_id: str, payload: TicketPackExtendRequest, db: Session = Depends(get_db)):
    """Extend pack expiration date (default +30 days) and reactivate if expired."""
    try:
        pack = TicketService.extend_pack(db, pack_id=pack_id, extra_days=payload.extra_days)
        return TicketPackResponse.model_validate(pack)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
