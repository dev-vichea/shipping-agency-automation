import argparse
from getpass import getpass

from pydantic import EmailStr, TypeAdapter
from sqlalchemy.dialects.postgresql import insert

from shipping_ai.models import User

from .auth import PASSWORD
from .db import session_factory


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["create-staff"])
    parser.add_argument("email")
    args = parser.parse_args()
    email = TypeAdapter(EmailStr).validate_python(args.email).casefold()
    password = getpass("Password (12–128 characters): ")
    if not 12 <= len(password) <= 128 or password != getpass("Confirm password: "):
        parser.exit(2, "Passwords did not match or were outside the allowed length.\n")
    with session_factory().begin() as db:
        result = db.scalar(
            insert(User)
            .values(email=email, password_hash=PASSWORD.hash(password))
            .on_conflict_do_nothing(index_elements=[User.email])
            .returning(User.id)
        )
    if result is None:
        parser.exit(2, "Staff account already exists.\n")
    print("Staff account created.")


if __name__ == "__main__":
    main()
