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
