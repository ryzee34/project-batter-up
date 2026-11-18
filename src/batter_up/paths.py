"""where the pipeline reads and writes. everything lives under data/ at the repo root.

set BATTER_UP_DATA to point the whole pipeline somewhere else, which is how the synthetic
practice season stays out of the way of the real one.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("BATTER_UP_DATA", ROOT / "data")).resolve()
RAW = DATA / "raw" / "statcast"
INTERIM = DATA / "interim"
MODELS = DATA / "models"
WEB_DATA = ROOT / "web" / "public" / "data"
