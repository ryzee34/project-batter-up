import json

import numpy as np
import pandas as pd

from batter_up.scout import BUCKET_OF, direction, pitcher_book, scout


def test_direction_names_the_way_it_is_furthest_out():
    ways = direction(
        [0.0, 0.2, -1.2, 0.9, np.nan],
        [3.9, 1.1, 2.6, 2.4, 2.0],
        [1.6] * 5,
        [3.4] * 5,
    )
    assert list(ways) == ["up", "down", "left", "right", None]


def test_every_count_has_a_bucket():
    counts = [f"{b}-{s}" for b in range(4) for s in range(3)]
    assert sorted(BUCKET_OF) == sorted(counts)


def test_the_book_only_uses_the_seasons_it_is_given(league):
    lad = league[league["pitching_team"].eq("LAD")]
    pid = int(lad["pitcher"].value_counts().index[0])
    book = scout(league, [pid], [2024, 2025])
    assert book["seasons"] == [2024, 2025]
    mine = book["pitchers"][str(pid)]
    before = league[league["pitcher"].eq(pid) & league["game_year"].isin([2024, 2025])]
    assert mine["pitches"] == len(before)
    # a pitcher who never threw in those seasons gets no book
    assert scout(league, [pid], [2019])["pitchers"] == {}
    json.dumps(book)  # it all has to go in a json file


def test_a_book_reads_his_tendencies():
    # a made up pitcher: always a fastball first, always a slider after a fastball, and
    # his curveball comes out a foot higher than everything else
    rows = []
    for ab in range(40):
        for n, (call, z) in enumerate([("fastball", 5.6), ("slider", 5.6), ("curveball", 6.6)]):
            rows.append(
                {
                    "game_pk": ab // 10,
                    "game_date": pd.Timestamp("2025-05-01") + pd.Timedelta(days=ab // 10),
                    "game_year": 2025,
                    "at_bat_number": ab,
                    "pitch_number": n + 1,
                    "pitcher": 7,
                    "stand": "R" if ab % 2 else "L",
                    "balls": 0,
                    "strikes": n,
                    "pitch_call": call,
                    "description": "swinging_strike" if call == "slider" else "foul",
                    "plate_x": 0.0,
                    "plate_z": 1.0 if call == "slider" else 3.0,
                    "sz_bot": 1.6,
                    "sz_top": 3.4,
                    "release_pos_x": -2.0 + 0.01 * (ab % 3),
                    "release_pos_z": z + 0.01 * (ab % 5),
                }
            )
    book = pitcher_book(pd.DataFrame(rows))
    right = book["sides"]["R"]
    assert right["counts"]["first"] == {"fastball": 1.0}
    assert right["after"]["fastball"] == {"slider": 1.0}
    assert right["location"]["slider"] == {"down": 1.0}
    assert book["release"]["curveball"][1] > book["release"]["fastball"][1] + 0.9
    # the curveball's slot gives it away, the other two come from the same place
    assert 0.6 <= book["slotRead"] < 1.0
    assert book["tier"] == 1  # three pitches a game is a reliever
