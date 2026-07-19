"""Seed the two OpenAI Build Week judge accounts in the configured Firestore."""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from google.cloud import firestore

import main
from demo_seed import seed_demo_accounts


if __name__ == "__main__":
    result = seed_demo_accounts(
        main.get_firestore_client(),
        firestore.SERVER_TIMESTAMP,
    )
    print(
        json.dumps(
            {
                "ok": True,
                "accounts": {
                    key: {"id": value["id"], "email": value["email"]}
                    for key, value in result["accounts"].items()
                },
                "pair_key": result["friendship"]["pair_key"],
            },
            sort_keys=True,
        )
    )
