from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import (
    agents,
    applications,
    environments,
    goals,
    integrations,
    llm_profiles,
    mcp_servers,
    self_healing,
    skills,
    workflows,
)

settings = get_settings()

app = FastAPI(title=settings.app_name, debug=settings.debug)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(applications.router, prefix="/api")
app.include_router(goals.router, prefix="/api")
app.include_router(integrations.router, prefix="/api")
app.include_router(skills.router, prefix="/api")
app.include_router(environments.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(llm_profiles.router, prefix="/api")
app.include_router(mcp_servers.router, prefix="/api")
app.include_router(workflows.router, prefix="/api")
app.include_router(self_healing.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
