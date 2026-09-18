"""apps/api/main.py
FastAPI application entry point for Triple Dream Ballet (TDB).
Provides RESTful endpoints, Mode A Canvas signature check-in, 24-hour leave rules,
break-even financial indicators, and CORS support.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routers.students import router as students_router
from routers.sessions import router as sessions_router
from routers.attendance import router as attendance_router
from routers.system import router as system_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables and seed mock data on startup
    init_db()
    yield


app = FastAPI(
    title="Triple Dream Ballet API",
    description=(
        "Production-grade FastAPI backend for Triple Dream Ballet class management, "
        "Mode A iPad Canvas signature check-in, 24-hour leave policy rule, "
        "and break-even financial metrics."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# CORS Configuration
# Enables Angular frontend at http://localhost:4200 and http://127.0.0.1:4200
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",
        "http://127.0.0.1:4200",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Routers under /api/v1 (Canonical REST routes)
app.include_router(students_router, prefix="/api/v1")
app.include_router(sessions_router, prefix="/api/v1")
app.include_router(attendance_router, prefix="/api/v1")
app.include_router(system_router, prefix="/api/v1")

# Also mount under /api for client convenience
app.include_router(students_router, prefix="/api")
app.include_router(sessions_router, prefix="/api")
app.include_router(attendance_router, prefix="/api")
app.include_router(system_router, prefix="/api")


@app.get("/", tags=["Health"])
def health_check():
    return {
        "status": "ok",
        "service": "Triple Dream Ballet API",
        "version": "1.0.0",
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
