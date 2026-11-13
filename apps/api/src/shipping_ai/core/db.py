from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(table_name)s_%(column_0_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


@lru_cache
def engine():
    return create_engine(
        str(settings().database_url),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        hide_parameters=True,
        connect_args={"connect_timeout": 3, "options": "-c timezone=UTC"},
    )


@lru_cache
def session_factory() -> sessionmaker[Session]:
    return sessionmaker(engine(), expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with session_factory()() as db:
        yield db
