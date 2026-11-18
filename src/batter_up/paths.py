"""where the pipeline reads and writes. everything lives under data/ at the repo root."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RAW = DATA / "raw" / "statcast"
INTERIM = DATA / "interim"
