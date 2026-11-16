from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from shipping_ai.models import (
    DEFAULT_WORKSPACE,
    AutomationRun,
    CdcMasterVersion,
    Company,
    CompanyMember,
    IntakeCase,
    WorkspaceMember,
)

WORKSPACE_COOKIE = "shipping_workspace"


@dataclass(frozen=True)
class Access:
    workspace_id: UUID | None
    user_id: UUID
    admin: bool


def bind_access(db: Session, user_id: UUID, workspace: str) -> None:
    memberships = (
        select(WorkspaceMember)
        .where(WorkspaceMember.user_id == user_id)
        .order_by(
            (WorkspaceMember.workspace_id == DEFAULT_WORKSPACE).desc(), WorkspaceMember.workspace_id
        )
    )
    try:
        selected = UUID(workspace)
    except ValueError:
        selected = None
    member = (
        db.scalar(memberships.where(WorkspaceMember.workspace_id == selected)) if selected else None
    )
    if member is None:
        member = db.scalar(memberships.limit(1))
    db.info["access"] = Access(
        member.workspace_id if member else None, user_id, bool(member and member.role == "admin")
    )


def access(db: Session) -> Access:
    return db.info["access"]


def require_workspace(db: Session, *, admin: bool = False) -> UUID:
    scope = access(db)
    if scope.workspace_id is None or (admin and not scope.admin):
        raise HTTPException(
            403, "Workspace administrator access required" if admin else "Select a workspace first"
        )
    return scope.workspace_id


def company_access(db: Session, *, workspace_only=False):
    scope = access(db)
    where = Company.workspace_id == scope.workspace_id
    if not scope.admin and not workspace_only:
        where = and_(
            where,
            Company.id.in_(
                select(CompanyMember.company_id).where(CompanyMember.user_id == scope.user_id)
            ),
        )
    return where


def case_access(db: Session):
    scope = access(db)
    where = IntakeCase.workspace_id == scope.workspace_id
    if not scope.admin:
        where = and_(where, IntakeCase.company_id.in_(select(Company.id).where(company_access(db))))
    return where


def master_access(db: Session):
    scope = access(db)
    where = CdcMasterVersion.workspace_id == scope.workspace_id
    if not scope.admin:
        where = and_(
            where, CdcMasterVersion.company_id.in_(select(Company.id).where(company_access(db)))
        )
    return where


def run_access(db: Session):
    scope = access(db)
    linked = AutomationRun.intake_case_id.in_(select(IntakeCase.id).where(case_access(db)))
    if scope.admin:
        return or_(
            linked,
            and_(
                AutomationRun.intake_case_id.is_(None),
                AutomationRun.workspace_id == scope.workspace_id,
            ),
        )
    return linked


def visible_case(db: Session, case_id: UUID, *, lock: bool = False) -> IntakeCase:
    query = select(IntakeCase).where(IntakeCase.id == case_id, case_access(db))
    case = db.scalar(query.with_for_update() if lock else query)
    if case is None:
        raise HTTPException(404, "Intake not found")
    return case


def visible_company(db: Session, company_id: UUID) -> Company:
    company = db.scalar(select(Company).where(Company.id == company_id, company_access(db)))
    if company is None:
        raise HTTPException(404, "Company not found")
    return company
