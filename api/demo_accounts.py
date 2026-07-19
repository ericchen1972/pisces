"""Exact public identities available to OpenAI Build Week judges."""

from types import MappingProxyType


DEMO_ACCOUNTS = MappingProxyType(
    {
        "judy": MappingProxyType(
            {
                "key": "judy",
                "email": "judy@gods.tw",
                "display_name": "Judy",
            }
        ),
        "haland": MappingProxyType(
            {
                "key": "haland",
                "email": "haland@gods.tw",
                "display_name": "Haland",
            }
        ),
    }
)

_BY_EMAIL = {account["email"]: account for account in DEMO_ACCOUNTS.values()}


def normalize_demo_email(email):
    return str(email or "").strip().lower()


def demo_account_for_email(email):
    return _BY_EMAIL.get(normalize_demo_email(email))


def is_public_demo_email(email):
    return demo_account_for_email(email) is not None
