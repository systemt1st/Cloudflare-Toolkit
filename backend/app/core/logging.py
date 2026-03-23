from __future__ import annotations

import logging
import sys

from app.config import settings


def setup_logging() -> None:
    level = logging.DEBUG if settings.ENV == "dev" else logging.INFO
    logging.basicConfig(
        level=level,
        format='{"time":"%(asctime)s","level":"%(levelname)s","name":"%(name)s","message":"%(message)s"}',
        handlers=[logging.StreamHandler(sys.stdout)],
    )
