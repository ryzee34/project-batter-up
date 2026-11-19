"""download pitch-by-pitch statcast data from baseball savant, one day per request.

savant caps a search at 25,000 rows, and a full day of the league is about 4,000 to 5,000
pitches, so a day at a time stays well under it. each day is cached as its own csv, so a
rerun only asks for the days it doesn't have yet.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import httpx

SEARCH_URL = "https://baseballsavant.mlb.com/statcast_search/csv"

# the pitch clock and the shift ban both started in 2023, so earlier seasons are a
# different game and we leave them out
FIRST_SEASON = 2023


@dataclass(frozen=True)
class Season:
    year: int
    # wide enough to cover opening day and the last day of the regular season every year.
    # days with no games just come back as an empty csv
    start: date
    end: date

    @classmethod
    def of(cls, year: int) -> Season:
        if year < FIRST_SEASON:
            raise ValueError(f"seasons before {FIRST_SEASON} are left out, got {year}")
        return cls(year, date(year, 3, 15), date(year, 10, 5))


def days(start: date, end: date) -> Iterator[date]:
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def search_params(day: date) -> dict[str, str]:
    """query for every regular season pitch thrown on one day."""
    iso = day.isoformat()
    return {
        "all": "true",
        "type": "details",
        "player_type": "pitcher",
        "hfGT": "R|",  # regular season only
        "game_date_gt": iso,
        "game_date_lt": iso,
        "min_pitches": "0",
        "min_results": "0",
        "min_abs": "0",
        "group_by": "name",
        "sort_col": "pitches",
        "sort_order": "desc",
    }


def cache_path(raw_dir: Path, day: date) -> Path:
    return raw_dir / str(day.year) / f"{day.isoformat()}.csv"


def fetch_day(client: httpx.Client, day: date) -> str:
    response = client.get(SEARCH_URL, params=search_params(day))
    response.raise_for_status()
    text = response.text.lstrip("﻿")
    # savant answers some bad queries with a 200 and an html error page
    if text.lstrip().startswith("<"):
        raise RuntimeError(f"savant sent html instead of csv for {day}")
    return text


def fetch_day_retrying(
    client: httpx.Client, day: date, *, tries: int = 4, wait: float = 5.0, log=print
) -> str:
    """fetch_day, trying again when the connection drops or savant has a bad moment.

    a full season is about 200 requests, and over that many a reset connection or a 5xx
    is likely. waits double each time. anything else, like an html error page, is raised
    right away because asking again won't fix it.
    """
    for attempt in range(1, tries + 1):
        try:
            return fetch_day(client, day)
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            server_side = not isinstance(exc, httpx.HTTPStatusError) or (
                exc.response.status_code >= 500 or exc.response.status_code == 429
            )
            if not server_side or attempt == tries:
                raise
            log(f"{day} failed ({exc.__class__.__name__}), trying again in {wait:.0f}s")
            if wait:
                time.sleep(wait)
            wait *= 2
    raise AssertionError("unreachable")


def fetch_range(
    start: date,
    end: date,
    raw_dir: Path,
    *,
    client: httpx.Client | None = None,
    pause: float = 1.0,
    log=print,
    retry_wait: float = 5.0,
) -> list[Path]:
    """download every day in [start, end] that isn't cached yet. returns the cached paths."""
    owns_client = client is None
    if client is None:
        client = httpx.Client(
            timeout=120,
            follow_redirects=True,
            headers={"User-Agent": "batter-up (personal project)"},
        )
    paths: list[Path] = []
    try:
        for day in days(start, end):
            path = cache_path(raw_dir, day)
            if not path.exists():
                text = fetch_day_retrying(client, day, wait=retry_wait, log=log)
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".part")
                tmp.write_text(text, encoding="utf-8")
                tmp.replace(path)
                rows = max(text.count("\n") - 1, 0)
                log(f"{day} {rows} pitches")
                if pause:
                    time.sleep(pause)
            paths.append(path)
    finally:
        if owns_client:
            client.close()
    return paths
