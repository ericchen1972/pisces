from demo_accounts import DEMO_ACCOUNTS, demo_account_for_email, is_public_demo_email


def test_public_demo_accounts_are_exact_and_normalized():
    assert set(DEMO_ACCOUNTS) == {"judy", "haland"}
    assert demo_account_for_email(" JUDY@GODS.TW ")["key"] == "judy"
    assert demo_account_for_email("haland@gods.tw")["display_name"] == "Haland"


def test_every_other_email_is_rejected():
    assert demo_account_for_email("judy@example.com") is None
    assert demo_account_for_email("eric@gods.tw") is None
    assert is_public_demo_email("") is False
