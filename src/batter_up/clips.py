"""find baseball savant's broadcast clip for every pitch in the game.

savant has a page with the tv clip of nearly every pitch, keyed by a play id. the play ids
aren't in the statcast search csv, but savant's game feed (/gf) lists every pitch of a game
with its at-bat number, pitch number and play id. so this asks for the feed of each game in
atbats.json and writes the play id onto each pitch. the game only links out to savant's
page; no video is copied or served from the site.

run it after export, since export writes atbats.json from scratch.
"""

from __future__ import annotations

import time

import httpx

FEED_URL = "https://baseballsavant.mlb.com/gf"
CLIP_URL = "https://baseballsavant.mlb.com/sporty-videos?playId={}"


def play_ids(feed: dict) -> dict[tuple[int, int], str]:
    """(at-bat number, pitch number) -> play id, for every pitch in a game feed."""
    out = {}
    for side in ("team_home", "team_away"):
        for row in feed.get(side) or []:
            ab, n, pid = row.get("ab_number"), row.get("pitch_number"), row.get("play_id")
            if ab is None or n is None or not pid:
                continue
            out[(int(ab), int(n))] = str(pid)
    return out


def add_clips(payload: dict, client: httpx.Client, *, pause: float = 0.5, log=print) -> int:
    """write each pitch's play id into the payload as "clip". returns how many were found.
    a game whose feed fails just goes without clips."""
    games = sorted({int(ab["id"].split("-")[0]) for ab in payload["atBats"]})
    found = 0
    for game in games:
        try:
            response = client.get(FEED_URL, params={"game_pk": game})
            response.raise_for_status()
            ids = play_ids(response.json())
        except (httpx.HTTPError, ValueError) as exc:
            log(f"{game}: no feed ({exc.__class__.__name__})")
            ids = {}
        for ab in payload["atBats"]:
            pk, ab_number = (int(x) for x in ab["id"].split("-"))
            if pk != game:
                continue
            for p in ab["pitches"]:
                clip = ids.get((ab_number, int(p["n"])))
                if clip:
                    p["clip"] = clip
                    found += 1
                else:
                    p.pop("clip", None)
        if pause:
            time.sleep(pause)
    return found
