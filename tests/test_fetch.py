from datetime import date

import httpx
import pytest

from batter_up.data.fetch import Season, cache_path, days, fetch_range, search_params

CSV = "pitch_type,game_date\nFF,2025-06-01\nSL,2025-06-01\n"


def test_season_window():
    season = Season.of(2025)
    assert season.start == date(2025, 3, 15)
    assert season.end == date(2025, 10, 5)


def test_pre_pitch_clock_seasons_are_left_out():
    with pytest.raises(ValueError):
        Season.of(2022)


def test_days_is_inclusive():
    assert list(days(date(2025, 6, 1), date(2025, 6, 3))) == [
        date(2025, 6, 1),
        date(2025, 6, 2),
        date(2025, 6, 3),
    ]


def test_search_params_ask_for_one_regular_season_day():
    params = search_params(date(2025, 6, 1))
    assert params["game_date_gt"] == params["game_date_lt"] == "2025-06-01"
    assert params["hfGT"] == "R|"
    assert params["type"] == "details"


def test_fetch_caches_and_skips_cached_days(tmp_path):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.params["game_date_gt"])
        return httpx.Response(200, text="﻿" + CSV)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    cached = cache_path(tmp_path, date(2025, 6, 2))
    cached.parent.mkdir(parents=True)
    cached.write_text("already here")

    paths = fetch_range(
        date(2025, 6, 1), date(2025, 6, 3), tmp_path, client=client, pause=0, log=lambda _: None
    )

    assert seen == ["2025-06-01", "2025-06-03"]
    assert [p.name for p in paths] == ["2025-06-01.csv", "2025-06-02.csv", "2025-06-03.csv"]
    assert paths[0].read_text() == CSV  # byte order mark stripped
    assert cached.read_text() == "already here"


def test_html_error_pages_are_not_cached(tmp_path):
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, text="<html>oops</html>"))
    )
    with pytest.raises(RuntimeError, match="html"):
        fetch_range(date(2025, 6, 1), date(2025, 6, 1), tmp_path, client=client, pause=0)
    assert not cache_path(tmp_path, date(2025, 6, 1)).exists()


def test_dropped_connections_are_retried(tmp_path):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ReadError("connection reset by peer")
        if len(calls) == 2:
            return httpx.Response(503, text="busy")
        return httpx.Response(200, text=CSV)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    paths = fetch_range(
        date(2025, 6, 1),
        date(2025, 6, 1),
        tmp_path,
        client=client,
        pause=0,
        retry_wait=0,
        log=lambda _: None,
    )
    assert len(calls) == 3
    assert paths[0].read_text() == CSV


def test_client_errors_are_not_retried(tmp_path):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(400, text="bad query")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(httpx.HTTPStatusError):
        fetch_range(date(2025, 6, 1), date(2025, 6, 1), tmp_path, client=client, pause=0)
    assert len(calls) == 1
