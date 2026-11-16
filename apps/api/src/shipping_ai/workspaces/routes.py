from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError

from shipping_ai.core.access import (
    WORKSPACE_COOKIE,
    access,
    case_access,
    company_access,
    require_workspace,
    run_access,
    visible_company,
)
from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.core.config import settings
from shipping_ai.documents.languages import languages
from shipping_ai.intakes.schemas import ORM, Key, Label
from shipping_ai.models import (
    AutomationRun,
    Company,
    CompanyMember,
    IntakeCase,
    User,
    Workspace,
    WorkspaceMember,
)

router = APIRouter(tags=["workspace"])
mutation = [Depends(browser_origin)]


class WorkspaceName(BaseModel):
    name: Label


class MemberInput(BaseModel):
    email: EmailStr
    role: Literal["admin", "operator"] = "operator"

class CompanyInput(BaseModel):
    name: Label
    verified_english_name: Label | None = None
    aliases: list[Label] = Field(default_factory=list, max_length=30)
    identifier: Key | None = None
    contact_name: Label | None = None
    contact_email: EmailStr | None = None


    @field_validator("verified_english_name")
    @classmethod
    def valid_english_alias(cls, value):
        if value is not None and languages(value) != ["en"]:
            raise ValueError("Enter the verified English company name")
        return value


class CompanyView(CompanyInput, ORM):
    id: UUID
    created_at: datetime


class CompanyAccess(BaseModel):
    user_ids: list[UUID] = Field(max_length=100)


def identity_key(name: str) -> str:
    return " ".join(name.split()).lower()


def workspace_cookie(response: Response, workspace_id: UUID):
    response.set_cookie(
        WORKSPACE_COOKIE,
        str(workspace_id),
        httponly=True,
        secure=settings().session_secure,
        samesite="strict",
        path="/",
    )


@router.get("/workspaces")
def workspaces(db: DB, user: Staff):
    rows = db.execute(
        select(Workspace.id, Workspace.name, WorkspaceMember.role)
        .join(WorkspaceMember)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(Workspace.name, Workspace.id)
    )
    return {
        "active_id": access(db).workspace_id,
        "workspaces": [dict(row._mapping) for row in rows],
    }


@router.post("/workspaces", status_code=201, dependencies=mutation)
def create_workspace(payload: WorkspaceName, db: DB, user: Staff, response: Response):
    workspace = Workspace(name=payload.name)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="admin"))
    db.commit()
    workspace_cookie(response, workspace.id)
    return {"id": workspace.id, "name": workspace.name, "role": "admin"}


@router.post("/workspaces/{workspace_id}/select", status_code=204, dependencies=mutation)
def choose_workspace(workspace_id: UUID, db: DB, user: Staff, response: Response):
    if db.get(WorkspaceMember, (workspace_id, user.id)) is None:
        raise HTTPException(404, "Workspace not found")
    workspace_cookie(response, workspace_id)


@router.post("/workspace/settings", dependencies=mutation)
def update_workspace(payload: WorkspaceName, db: DB, _user: Staff):
    workspace = db.get(Workspace, require_workspace(db, admin=True))
    workspace.name = payload.name
    db.commit()
    return {"id": workspace.id, "name": workspace.name}


@router.get("/workspace/members")
def members(db: DB, _user: Staff):
    workspace_id = require_workspace(db, admin=True)
    rows = db.execute(
        select(User.id, User.email, WorkspaceMember.role)
        .join(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == workspace_id, User.active.is_(True))
        .order_by(User.email)
    )
    return [dict(row._mapping) for row in rows]


@router.post("/workspace/members", dependencies=mutation)
def set_member(payload: MemberInput, db: DB, user: Staff):
    workspace_id = require_workspace(db, admin=True)
    db.get(Workspace, workspace_id, with_for_update=True)
    target = db.scalar(
        select(User).where(User.email == payload.email.casefold(), User.active.is_(True))
    )
    if target is None:
        raise HTTPException(404, "No active staff account with that email")
    if target.id == user.id and payload.role != "admin":
        raise HTTPException(409, "Another administrator must change your role")
    membership = db.get(WorkspaceMember, (workspace_id, target.id), with_for_update=True)
    if membership is None:
        db.add(WorkspaceMember(workspace_id=workspace_id, user_id=target.id, role=payload.role))
    else:
        membership.role = payload.role
    commit_unique(db, "Membership changed concurrently. Try again.")
    return {"id": target.id, "email": target.email, "role": payload.role}


def commit_unique(db, message):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, message) from None


@router.get("/companies", response_model=list[CompanyView])
def companies(
    db: DB,
    _user: Staff,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    sort: Literal["name", "recent"] = "name",
):
    query = select(Company).where(company_access(db))
    if q.strip():
        term = q.strip()
        query = query.where(
            or_(
                Company.name.icontains(term, autoescape=True),
                Company.identifier.icontains(term, autoescape=True),
            )
        )
    order = func.lower(Company.name) if sort == "name" else Company.created_at.desc()
    return db.scalars(query.order_by(order, Company.id).offset(offset).limit(limit)).all()


@router.post("/companies", status_code=201, response_model=CompanyView, dependencies=mutation)
def create_company(payload: CompanyInput, db: DB, _user: Staff):
    workspace_id = require_workspace(db, admin=True)
    company = Company(
        workspace_id=workspace_id, identity_key=identity_key(payload.name), **payload.model_dump()
    )
    db.add(company)
    commit_unique(db, "A company with that name already exists")
    return company


@router.get("/companies/{company_id}")
def company_detail(company_id: UUID, db: DB, _user: Staff):
    company = visible_company(db, company_id)
    rows = db.execute(
        select(User.id, User.email)
        .join(CompanyMember)
        .where(CompanyMember.company_id == company.id, User.active.is_(True))
        .order_by(User.email)
    )
    return {
        **CompanyView.model_validate(company).model_dump(),
        "staff": [dict(row._mapping) for row in rows],
    }


@router.post("/companies/{company_id}", response_model=CompanyView, dependencies=mutation)
def edit_company(company_id: UUID, payload: CompanyInput, db: DB, _user: Staff):
    require_workspace(db, admin=True)
    company = visible_company(db, company_id)
    for name, value in payload.model_dump(exclude_unset=True).items():
        setattr(company, name, value)
    company.identity_key = identity_key(payload.name)
    commit_unique(db, "A company with that name already exists")
    return company


@router.post("/companies/{company_id}/staff", status_code=204, dependencies=mutation)
def assign_staff(company_id: UUID, payload: CompanyAccess, db: DB, _user: Staff):
    workspace = require_workspace(db, admin=True)
    visible_company(db, company_id)
    db.get(Company, company_id, with_for_update=True)
    ids = set(payload.user_ids)
    allowed = set(
        db.scalars(
            select(WorkspaceMember.user_id)
            .join(User)
            .where(
                WorkspaceMember.workspace_id == workspace,
                User.active.is_(True),
                WorkspaceMember.user_id.in_(ids),
            )
        )
    )
    if ids != allowed:
        raise HTTPException(422, "Assign active staff from this workspace")
    db.execute(delete(CompanyMember).where(CompanyMember.company_id == company_id))
    db.add_all(CompanyMember(company_id=company_id, user_id=ident) for ident in ids)
    db.commit()


@router.get("/workspace/overview")
def overview(db: DB, _user: Staff, company_id: UUID | None = None):
    cases = [case_access(db)]
    runs = [run_access(db)]
    if company_id:
        visible_company(db, company_id)
        cases.append(IntakeCase.company_id == company_id)
        runs.append(AutomationRun.intake_case_id.in_(select(IntakeCase.id).where(*cases)))
    counts = dict(
        db.execute(
            select(IntakeCase.state, func.count()).where(*cases).group_by(IntakeCase.state)
        ).all()
    )
    run_counts = dict(
        db.execute(
            select(AutomationRun.state, func.count()).where(*runs).group_by(AutomationRun.state)
        ).all()
    )
    processing = db.scalar(
        select(func.count())
        .select_from(IntakeCase)
        .where(
            *cases,
            IntakeCase.state == "queued",
            select(AutomationRun.id)
            .where(
                AutomationRun.intake_case_id == IntakeCase.id,
                AutomationRun.input_revision == IntakeCase.analysis_revision,
                AutomationRun.state == "running",
            )
            .exists(),
        )
    )
    return {"cases": counts, "runs": run_counts, "processing": processing}


@router.post("/workspace/members/{user_id}/remove", status_code=204, dependencies=mutation)
def remove_member(user_id: UUID, db: DB, user: Staff):
    workspace_id = require_workspace(db, admin=True)
    if user_id == user.id:
        raise HTTPException(409, "Another administrator must remove your workspace access")
    db.get(Workspace, workspace_id, with_for_update=True)
    company_ids = select(Company.id).where(Company.workspace_id == workspace_id)
    db.execute(
        delete(CompanyMember).where(
            CompanyMember.company_id.in_(company_ids), CompanyMember.user_id == user_id
        )
    )
    db.execute(
        delete(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id
        )
    )
    db.commit()
