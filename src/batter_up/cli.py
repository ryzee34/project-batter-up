"""call the pitch: data pipeline and pitch model."""

from __future__ import annotations

import argparse
from datetime import date

from batter_up import __version__, paths


def _season_range(years: list[int]) -> list[int]:
    return sorted(set(years))


def cmd_fetch(args: argparse.Namespace) -> int:
    from batter_up.data.fetch import Season, fetch_range

    if args.start or args.end:
        if not (args.start and args.end):
            raise SystemExit("--start and --end go together")
        fetch_range(date.fromisoformat(args.start), date.fromisoformat(args.end), paths.RAW)
        return 0
    for year in _season_range(args.season):
        season = Season.of(year)
        print(f"fetching {year}, {season.start} to {season.end}")
        fetch_range(season.start, season.end, paths.RAW, pause=args.pause)
    return 0


def cmd_synth(args: argparse.Namespace) -> int:
    from batter_up.data.synthetic import synth_season

    for year in _season_range(args.season):
        synth_season(year, paths.RAW, games=args.games, seed=args.seed)
    # export reads this to mark the game data as made up
    (paths.DATA / "SYNTHETIC").write_text("made up by batter-up synth\n")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    from batter_up.data.pitches import build

    build(paths.RAW, paths.INTERIM, _season_range(args.season))
    return 0


def cmd_features(args: argparse.Namespace) -> int:
    import pandas as pd

    from batter_up.features import build_features

    seasons = sorted(paths.INTERIM.glob("pitches_*.parquet"))
    if not seasons:
        raise SystemExit("no cleaned seasons yet, run fetch and build first")
    pitches = pd.concat([pd.read_parquet(p) for p in seasons], ignore_index=True)
    df = build_features(pitches)
    out = paths.INTERIM / "features.parquet"
    df.to_parquet(out, index=False)
    print(f"{len(df):,} pitches from {len(seasons)} seasons -> {out.name}")
    return 0


def cmd_baseline(args: argparse.Namespace) -> int:
    import pandas as pd

    from batter_up.features import split_by_season
    from batter_up.model.baseline import FavoritePitch, score

    df = pd.read_parquet(paths.INTERIM / "features.parquet")
    train, test = split_by_season(df, args.test_season)
    baseline = FavoritePitch.fit(train)
    pitch_call, zone_call = baseline.predict(test)
    print(
        "\n".join(score(test, pitch_call, zone_call).lines(f"favorite pitch, {args.test_season}"))
    )
    dodgers = test["pitching_team"].eq("LAD")
    dodger_scores = score(test[dodgers], pitch_call[dodgers], zone_call[dodgers])
    print("\n".join(dodger_scores.lines("  dodgers pitching only")))
    return 0


def _train_test(test_season: int):
    import pandas as pd

    from batter_up.features import split_by_season

    path = paths.INTERIM / "features.parquet"
    if not path.exists():
        raise SystemExit("no features yet, run batter-up features first")
    return split_by_season(pd.read_parquet(path), test_season)


def cmd_train(args: argparse.Namespace) -> int:
    from batter_up.model.evaluate import evaluate, lines
    from batter_up.model.lgbm import PitchModel, write_json

    train, test = _train_test(args.test_season)
    print(f"training on {len(train):,} pitches from before {args.test_season}")
    model = PitchModel.fit(train)
    model.save(paths.MODELS)
    report = evaluate(model, train, test)
    write_json(paths.MODELS / "metrics.json", report)
    print("\n".join(lines(report)))
    return 0


def cmd_evaluate(args: argparse.Namespace) -> int:
    from batter_up.model.evaluate import evaluate, lines
    from batter_up.model.lgbm import PitchModel, write_json

    train, test = _train_test(args.test_season)
    report = evaluate(PitchModel.load(paths.MODELS), train, test)
    write_json(paths.MODELS / "metrics.json", report)
    print("\n".join(lines(report)))
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    import json

    import pandas as pd

    from batter_up.export import Pick, check, export
    from batter_up.model.lgbm import PitchModel

    metrics_path = paths.MODELS / "metrics.json"
    if not metrics_path.exists():
        raise SystemExit("no trained model yet, run batter-up train first")
    metrics = json.loads(metrics_path.read_text())
    features = pd.read_parquet(paths.INTERIM / "features.parquet")
    payload, summary = export(
        features,
        PitchModel.load(paths.MODELS),
        metrics["test_season"],
        metrics,
        pick=Pick(at_bats=args.at_bats, team=args.team),
        synthetic=(paths.DATA / "SYNTHETIC").exists(),
    )
    check(payload)
    paths.WEB_DATA.mkdir(parents=True, exist_ok=True)
    out = paths.WEB_DATA / "atbats.json"
    out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    (paths.WEB_DATA / "model.json").write_text(json.dumps(summary, indent=2) + "\n")
    pitches = sum(len(ab["pitches"]) for ab in payload["atBats"])
    size = out.stat().st_size / 1024
    print(f"{len(payload['atBats'])} at-bats, {pitches} pitches -> {out.name} ({size:.0f} KB)")
    return 0


def cmd_scout(args: argparse.Namespace) -> int:
    import json

    import pandas as pd

    from batter_up.scout import scout

    path = paths.WEB_DATA / "atbats.json"
    if not path.exists():
        raise SystemExit("no at-bats yet, run batter-up export first")
    payload = json.loads(path.read_text())
    ids = sorted({ab["pitcher"]["id"] for ab in payload["atBats"]})
    seasons = [y for y in range(2023, payload["season"])]
    files = [paths.INTERIM / f"pitches_{y}.parquet" for y in seasons]
    files = [f for f in files if f.exists()]
    if not files:
        raise SystemExit("no cleaned seasons before the test season, run fetch and build first")
    pitches = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    book = scout(pitches, ids, sorted(int(y) for y in pitches["game_year"].unique()))
    out = paths.WEB_DATA / "scouting.json"
    out.write_text(json.dumps(book, separators=(",", ":")), encoding="utf-8")
    missing = len(ids) - len(book["pitchers"])
    size = out.stat().st_size / 1024
    print(f"{len(book['pitchers'])} pitchers, {missing} with no book -> {out.name} ({size:.0f} KB)")
    return 0


def cmd_commentary(args: argparse.Namespace) -> int:
    import json

    from batter_up import commentary

    path = paths.WEB_DATA / "atbats.json"
    if not path.exists():
        raise SystemExit("no at-bats yet, run batter-up export first")
    payload = json.loads(path.read_text())
    target = paths.WEB_DATA / "commentary.json"

    if args.check:
        if not target.exists():
            raise SystemExit(f"no {target.name} yet")
        problems = commentary.check(payload, json.loads(target.read_text()))
        for problem in problems:
            print(problem)
        print(f"{len(payload['atBats'])} at-bats, {len(problems)} problems")
        return 1 if problems else 0

    if args.dry_run:
        print(commentary.SYSTEM, "\n")
        first = commentary.request(payload["atBats"][0], payload["pitchCalls"])
        print(first["params"]["messages"][0]["content"])
        return 0

    if payload.get("synthetic") and not args.allow_synthetic:
        raise SystemExit(
            "these at-bats are from the made up league. export the real ones first, "
            "or pass --allow-synthetic to write lines about made up players"
        )

    if not args.api:
        out = paths.DATA / "booth-prompt.md"
        out.write_text(commentary.prompt_document(payload), encoding="utf-8")
        print(f"wrote {out}")
        print("open claude code in this repo and run /booth, or ask it to follow that file")
        return 0

    import anthropic

    out = commentary.run(anthropic.Anthropic(), payload, batch_id=args.batch_id)
    target.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"-> {target.name}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="batter-up", description=__doc__)
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", metavar="command")

    fetch = sub.add_parser("fetch", help="download statcast pitches from baseball savant")
    fetch.add_argument("--season", type=int, nargs="+", default=[2023, 2024, 2025, 2026])
    fetch.add_argument("--start", help="first day, yyyy-mm-dd, instead of whole seasons")
    fetch.add_argument("--end", help="last day, yyyy-mm-dd")
    fetch.add_argument("--pause", type=float, default=1.0, help="seconds between requests")
    fetch.set_defaults(func=cmd_fetch)

    synth = sub.add_parser("synth", help="write a made up league in savant's format, for practice")
    synth.add_argument("--season", type=int, nargs="+", default=[2023, 2024, 2025, 2026])
    synth.add_argument("--games", type=int, default=160, help="games per team per season")
    synth.add_argument("--seed", type=int, default=7)
    synth.set_defaults(func=cmd_synth)

    build = sub.add_parser("build", help="clean downloaded days into one parquet per season")
    build.add_argument("--season", type=int, nargs="+", default=[2023, 2024, 2025, 2026])
    build.set_defaults(func=cmd_build)

    features = sub.add_parser("features", help="build model features from the cleaned seasons")
    features.set_defaults(func=cmd_features)

    baseline = sub.add_parser("baseline", help="score the favorite pitch baseline")
    baseline.add_argument("--test-season", type=int, default=2026)
    baseline.set_defaults(func=cmd_baseline)

    train = sub.add_parser("train", help="train the pitch model and score it against the baseline")
    train.add_argument("--test-season", type=int, default=2026)
    train.set_defaults(func=cmd_train)

    evaluate = sub.add_parser("evaluate", help="score the saved model again")
    evaluate.add_argument("--test-season", type=int, default=2026)
    evaluate.set_defaults(func=cmd_evaluate)

    exp = sub.add_parser("export", help="write the game's at-bats and model calls to web/")
    exp.add_argument("--at-bats", type=int, default=40)
    exp.add_argument("--team", default="LAD")
    exp.set_defaults(func=cmd_export)

    book = sub.add_parser("scout", help="write the scouting book on every pitcher in the game")
    book.set_defaults(func=cmd_scout)

    talk = sub.add_parser("commentary", help="get claude to write booth lines for every pitch")
    talk.add_argument("--check", action="store_true", help="check commentary.json covers it all")
    talk.add_argument("--api", action="store_true", help="use the batch api (needs a paid key)")
    talk.add_argument("--batch-id", help="with --api, pick up a batch that was already sent")
    talk.add_argument("--dry-run", action="store_true", help="print the first prompt and stop")
    talk.add_argument("--allow-synthetic", action="store_true")
    talk.set_defaults(func=cmd_commentary)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
