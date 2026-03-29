from __future__ import annotations

from config import AppConfig
from server.runtime import run_server_stdio


def main() -> None:
    run_server_stdio(AppConfig.from_env())


if __name__ == "__main__":
    main()
