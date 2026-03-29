from __future__ import annotations

from config import AppConfig
from server.runtime import run_server_streamable_http


def main() -> None:
    run_server_streamable_http(AppConfig.from_env())


if __name__ == "__main__":
    main()
