import httpx

from batter_up.clips import add_clips, play_ids


def feed(*rows):
    return {"team_home": list(rows[:1]), "team_away": list(rows[1:])}


def test_play_ids_come_from_both_sides_of_the_feed():
    ids = play_ids(
        feed(
            {"ab_number": 3, "pitch_number": 1, "play_id": "a"},
            {"ab_number": 4, "pitch_number": 2, "play_id": "b"},
            {"ab_number": 5, "pitch_number": 1, "play_id": None},
        )
    )
    assert ids == {(3, 1): "a", (4, 2): "b"}


def test_add_clips_matches_pitches_by_at_bat_and_pitch_number():
    payload = {
        "atBats": [
            {"id": "100-3", "pitches": [{"n": 1}, {"n": 2}]},
            {"id": "200-7", "pitches": [{"n": 1, "clip": "stale"}]},
        ]
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params["game_pk"] == "100":
            return httpx.Response(
                200, json=feed({"ab_number": 3, "pitch_number": 2, "play_id": "x"})
            )
        return httpx.Response(500)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    found = add_clips(payload, client, pause=0, log=lambda *_: None)
    assert found == 1
    assert "clip" not in payload["atBats"][0]["pitches"][0]
    assert payload["atBats"][0]["pitches"][1]["clip"] == "x"
    # a game whose feed failed loses any old clip rather than keeping a wrong one
    assert "clip" not in payload["atBats"][1]["pitches"][0]
