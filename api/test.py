"""Small import/readiness smoke check for the Convia API workspace."""

from main import app


def check_readiness():
    routes = {rule.rule for rule in app.url_map.iter_rules()}
    if "/" not in routes:
        raise RuntimeError("Convia API root route is not registered")
    return {"app": app.name, "routes": len(routes)}


def main():
    readiness = check_readiness()
    print(
        f"Convia API import is ready: app={readiness['app']}, "
        f"routes={readiness['routes']}"
    )


if __name__ == "__main__":
    main()
