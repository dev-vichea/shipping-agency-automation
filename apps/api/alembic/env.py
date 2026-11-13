from alembic import context
from shipping_ai import models
from shipping_ai.core.config import settings
from shipping_ai.core.db import engine

target_metadata = models.Base.metadata


def run_migrations_offline():
    context.configure(
        url=str(settings().database_url),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    with engine().connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
