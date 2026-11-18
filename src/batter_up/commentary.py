"""booth commentary for every pitch in the game, written by claude ahead of time.

the site is static and has no api key, so the lines are written once and shipped as json
next to the at-bats. players never call claude. there are two ways to write them:

- free, the default: `batter-up commentary` writes one prompt file with the rules and
  every at-bat. a claude code session (the /booth skill in .claude/skills) reads it and
  writes web/public/data/commentary.json, then `batter-up commentary --check` makes sure
  every pitch has a line. this runs on a claude plan, no api key.
- with an api key: `batter-up commentary --api` sends every at-bat as one request in a
  single message batch and collects the replies, held to a json schema.

either way claude sees the whole at-bat, so the prompt is strict about one thing: a line
about pitch 3 can only use what happened through pitch 3, because the game shows it right
after pitch 3 is revealed and before you call pitch 4.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

MODEL = "claude-opus-5-5"

SYSTEM = """\
you write the booth commentary for a baseball guessing game. the player is shown a real \
at-bat one pitch at a time and has to call each pitch (type and location) before it's \
thrown. a machine learning model calls it too. after each pitch is revealed, your line \
for that pitch appears on screen.

voice: a sharp, warm color commentator on a los angeles broadcast. plain words, a little \
dry humor, real baseball sense (sequencing, counts, tunneling, chasing, pitch-clock era \
habits). all lowercase, like the rest of the game. no emoji, no hashtags.

rules, in order of importance:
1. a line for pitch n may only use what happened up to and including pitch n. never \
mention, hint at or set up anything that happens later in the at-bat, including how it \
ends. the player has not seen it yet.
2. only state facts given to you. don't invent velocities, counts, injuries, history \
between these players, season stats or anything else not in the data.
3. each pitch line is one or two sentences, at most 28 words. say something about why \
the pitch made sense (or didn't) in that count, or what it did. when the model's call is \
interesting (it nailed it, or it was confident and wrong), you can mention it, but not \
every time.
4. the wrap is one or two sentences, at most 35 words, on how the at-bat was won or lost. \
it is shown only after the last pitch, so it can use everything."""

SCHEMA = {
    "type": "object",
    "properties": {
        "pitches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"n": {"type": "integer"}, "line": {"type": "string"}},
                "required": ["n", "line"],
                "additionalProperties": False,
            },
        },
        "wrap": {"type": "string"},
    },
    "required": ["pitches", "wrap"],
    "additionalProperties": False,
}

ZONE_WORDS = {
    "1": "up and to the catcher's left",
    "2": "up, middle",
    "3": "up and to the catcher's right",
    "4": "middle height, catcher's left",
    "5": "middle middle",
    "6": "middle height, catcher's right",
    "7": "down and to the catcher's left",
    "8": "down, middle",
    "9": "down and to the catcher's right",
    "chase": "out of the zone",
}


def _runners(on: list[bool]) -> str:
    names = [base for base, here in zip(("first", "second", "third"), on, strict=True) if here]
    return "bases empty" if not names else "runners on " + " and ".join(names)


def describe_at_bat(ab: dict, pitch_calls: list[str]) -> str:
    """the at-bat as plain facts, pitch by pitch, for the prompt."""
    p, b = ab["pitcher"], ab["batter"]
    mix = ", ".join(f"{k} {v:.0%}" for k, v in sorted(p["mix"].items(), key=lambda kv: -kv[1]))
    lines = [
        f"date: {ab['date']}",
        f"{ab['team']} pitching vs {ab['opponent']}, {ab['half']} of the {ab['inning']}, "
        f"{ab['outs']} out, {_runners(ab['runners'])}, "
        f"score {ab['team']} {ab['score']['pitching']}, {ab['opponent']} {ab['score']['batting']}",
        f"pitcher: {p['name']}, throws {p['throws']}, {p['pitchesToday']} pitches so far today",
        f"his mix in earlier games: {mix or 'no history'}",
        f"batter: {b['name']}, bats {b['stands']}",
        "",
        "pitches:",
    ]
    for pitch in ab["pitches"]:
        odds = dict(zip(pitch_calls, pitch["model"]["pitch"], strict=True))
        model_pitch, model_zone = pitch["model"]["call"]
        spin = f", {pitch['spin']} rpm" if pitch.get("spin") else ""
        lines.append(
            f"{pitch['n']}. count {pitch['count']}: {pitch['mph']} mph {pitch['name'].lower()}"
            f"{spin}, {ZONE_WORDS[pitch['zone']]}, result: {pitch['result'].replace('_', ' ')}. "
            f"model called {model_pitch}, {ZONE_WORDS[model_zone]} "
            f"(gave {pitch['pitch']} a {odds[pitch['pitch']]:.0%} chance)"
        )
    lines += ["", f"how it ended (wrap only): {ab['des']}"]
    return "\n".join(lines)


def request(ab: dict, pitch_calls: list[str]) -> dict:
    """one message batch request for one at-bat."""
    return {
        "custom_id": ab["id"],
        "params": {
            "model": MODEL,
            "max_tokens": 16000,
            "system": SYSTEM,
            "output_config": {
                "effort": "medium",
                "format": {"type": "json_schema", "schema": SCHEMA},
            },
            "messages": [
                {
                    "role": "user",
                    "content": "write a line for every pitch, then the wrap.\n\n"
                    + describe_at_bat(ab, pitch_calls),
                }
            ],
        },
    }


def parse(ab: dict, text: str) -> dict:
    """claude's json, checked against the at-bat. raises if a pitch is missing."""
    data = json.loads(text)
    lines = {int(p["n"]): p["line"].strip() for p in data["pitches"]}
    wanted = [p["n"] for p in ab["pitches"]]
    missing = [n for n in wanted if not lines.get(n)]
    if missing:
        raise ValueError(f"{ab['id']}: no line for pitch {missing}")
    return {"pitches": [lines[n] for n in wanted], "wrap": data["wrap"].strip()}


def prompt_document(payload: dict) -> str:
    """everything a claude code session needs to write commentary.json by hand."""
    parts = [
        "# booth commentary",
        "",
        "write web/public/data/commentary.json for the at-bats below. then run "
        "`uv run batter-up commentary --check` and fix anything it reports.",
        "",
        "## the rules",
        "",
        SYSTEM,
        "",
        "## the file",
        "",
        "one entry per at-bat id, with one line per pitch in pitch order and a wrap:",
        "",
        "```json",
        json.dumps(
            {
                "version": 1,
                "model": "claude code session",
                "atBats": {"<at-bat id>": {"pitches": ["line for pitch 1", "..."], "wrap": "..."}},
            },
            indent=2,
        ),
        "```",
        "",
        "## the at-bats",
    ]
    for ab in payload["atBats"]:
        parts += ["", f"### {ab['id']}", "", describe_at_bat(ab, payload["pitchCalls"])]
    return "\n".join(parts) + "\n"


def check(payload: dict, written: dict) -> list[str]:
    """problems with a commentary file, empty when the game can use all of it."""
    problems = []
    lines = written.get("atBats", {})
    for ab in payload["atBats"]:
        entry = lines.get(ab["id"])
        if entry is None:
            problems.append(f"{ab['id']}: no lines")
            continue
        pitches = entry.get("pitches", [])
        if len(pitches) != len(ab["pitches"]):
            problems.append(f"{ab['id']}: {len(pitches)} lines for {len(ab['pitches'])} pitches")
        if any(not isinstance(x, str) or not x.strip() for x in pitches):
            problems.append(f"{ab['id']}: an empty line")
        if not str(entry.get("wrap", "")).strip():
            problems.append(f"{ab['id']}: no wrap")
        for text in [*pitches, entry.get("wrap", "")]:
            if isinstance(text, str) and len(text.split()) > 40:
                problems.append(f"{ab['id']}: a line runs {len(text.split())} words")
    extra = set(lines) - {ab["id"] for ab in payload["atBats"]}
    problems += [f"{x}: not an at-bat in atbats.json" for x in sorted(extra)]
    return problems


def submit(client: Any, payload: dict) -> str:
    requests = [request(ab, payload["pitchCalls"]) for ab in payload["atBats"]]
    batch = client.messages.batches.create(requests=requests)
    return batch.id


def wait(client: Any, batch_id: str, *, every: float = 30, log=print, sleep=time.sleep) -> None:
    while True:
        batch = client.messages.batches.retrieve(batch_id)
        if batch.processing_status == "ended":
            return
        log(f"{batch_id}: {batch.request_counts.processing} still writing")
        sleep(every)


def collect(client: Any, batch_id: str, payload: dict, *, log=print) -> dict:
    """read the batch results into the commentary file the game loads."""
    by_id = {ab["id"]: ab for ab in payload["atBats"]}
    lines: dict[str, dict] = {}
    for result in client.messages.batches.results(batch_id):
        ab = by_id.get(result.custom_id)
        if ab is None:
            continue
        kind = result.result.type
        if kind != "succeeded":
            log(f"{result.custom_id}: {kind}, the game will go without lines for it")
            continue
        message = result.result.message
        if message.stop_reason != "end_turn":
            log(f"{result.custom_id}: stopped on {message.stop_reason}, skipped")
            continue
        text = next((block.text for block in message.content if block.type == "text"), "")
        try:
            lines[ab["id"]] = parse(ab, text)
        except (ValueError, KeyError, json.JSONDecodeError) as err:
            log(f"{result.custom_id}: couldn't use the reply ({err})")
    return {
        "version": 1,
        "model": MODEL,
        "batch": batch_id,
        "written": datetime.now(UTC).date().isoformat(),
        "atBats": lines,
    }


def run(
    client: Any,
    payload: dict,
    *,
    batch_id: str | None = None,
    log: Callable[[str], None] = print,
    sleep=time.sleep,
) -> dict:
    if batch_id is None:
        batch_id = submit(client, payload)
        log(f"sent {len(payload['atBats'])} at-bats as batch {batch_id}")
    wait(client, batch_id, log=log, sleep=sleep)
    out = collect(client, batch_id, payload, log=log)
    log(f"lines for {len(out['atBats'])} of {len(payload['atBats'])} at-bats")
    return out
