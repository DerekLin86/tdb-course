"""apps/api/routers/system.py
System reset and administrative utilities.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from database import Session, get_db, is_production, reset_db
from schemas.system import SystemResetResponse

router = APIRouter(prefix="/system", tags=["System Utilities"])


@router.post("/reset", response_model=SystemResetResponse, status_code=status.HTTP_200_OK)
def reset_system_data(db: Session = Depends(get_db)):
    """Reset SQLite database and repopulate with initial demo mock datasets."""
    if is_production():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="系統處於生產模式 (production)，禁止執行重置與示範資料清除作業",
        )
    reset_db()
    return SystemResetResponse(
        message="系統資料已成功重置為初始示範狀態",
        students_count=10,
        ticket_packs_count=10,
        sessions_count=2,
        attendance_count=2,
    )
