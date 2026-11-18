# batter up

call the next pitch before it's thrown. you get dropped into a real dodgers at-bat with the count, the runners, the score and every pitch so far, then you pick the pitch type and where it's going. a model trained on years of public pitch-by-pitch data makes its call at the same time, and the pitch plays out from the catcher's spot so you can see who got it right.

work in progress, being built in small prs.

## how its put together

- `src/batter_up` is the python side. it pulls the pitch data, builds the features, trains the model and writes everything the game needs to small json files
- `web` is the game, typescript and vite with three.js for the pitch view. it only reads those json files, so the site is static and runs on github pages with no server
- `tests` are the python tests. the important ones check that no feature can see anything that happened after the pitch it's predicting

## running it

python side, with [uv](https://docs.astral.sh/uv/)

```
uv sync
uv run batter-up fetch      # downloads every regular season pitch since 2023, about 800 requests
uv run batter-up build      # cleans them into data/interim/pitches_<year>.parquet
uv run batter-up features   # everything the model knows before each pitch
uv run batter-up baseline   # how often "his favorite pitch" is right, the number to beat
uv run batter-up train      # trains the model on 2023-2025 and scores it on 2026 next to the baseline
uv run batter-up export     # picks the at-bats and writes them with the model's calls to web/public/data
uv run batter-up commentary # writes the prompt for the booth lines, then /booth in claude code writes them
uv run pytest
```

no network or no patience? `synth` writes a made up league in the exact same csv format (pitchers are named like "LAD Arm 3", nobody real), so every step runs end to end in about a minute

```
export BATTER_UP_DATA=data/synthetic
uv run batter-up synth && uv run batter-up build && uv run batter-up features && uv run batter-up train
```

when the game data was made this way, `atbats.json` says `"synthetic": true` and the game says so on screen

## the model

two lightgbm trees. the first reads the situation (count, outs, runners, score, handedness, the pitches already thrown this at-bat and this game, and his mix in every earlier game) and gives odds for each pitch type. the second is told the pitch type and gives odds for each of the ten zones, because where a slider goes isn't where a fastball goes. multiply them and you get odds for every pitch and zone pair, and the model's call is the likeliest one.

it's trained on every season before the test season, with the last of those held out to decide when to stop adding trees, then refit on all of them. the test season is never touched until the score. `train` prints the model next to the favorite pitch baseline, overall, for dodgers pitchers, and count by count, and saves it all to `data/models/metrics.json`

the game

```
cd web
npm install
npm run dev
```

## what the game gets

`export` picks about 40 dodgers at-bats from the test season, so every call the model makes in the game is one it made blind. it favors at-bats that are fun to call (long, late, close, runners on, full counts, strikeouts and homers) and spreads them across pitchers and games. each pitch carries the count, what was thrown and where, the flight numbers to replay it, the model's odds for every pitch type and zone, its single call, and the baseline's call. the pitcher's scouting report is his mix in every game before that day. it all comes to about 130 KB of json.

## the game

plain typescript, no framework. `web/src/game.ts` is the rules (a session walks pitch by pitch through a few at-bats, and you and the model are graded the same way: 2 for the pitch type, 1 for the zone, 1 more for both) and is tested with vitest. the page re-renders from one state object on every click. the zone is drawn from the catcher's view, with the box as the strike zone and the frame around it as the chase area, and the actual pitch lands at its real plate_x and plate_z.

after each call the pitch replays in three.js from just behind the catcher, once at real speed and once slowed down with its path drawn. statcast describes every pitch as nine numbers, a velocity and an acceleration at 50 feet from the plate, so the path is just constant acceleration, solved backwards from where the ball crossed the plate (`web/src/flight.ts`, tested against the plate location). three.js only loads after your first call, so the first screen stays small, and the 2d zone still works if webgl doesn't.

keyboard works too: f s c l u h p for the pitch, 1 to 9 for the zone, 0 for a chase, enter to call it.

## the booth

after each pitch a line of color commentary shows up, written by claude ahead of time. the site is static, so players never call claude and playing costs nothing. the lines are written once and shipped as `web/public/data/commentary.json`.

the free way, and the default, is a claude code session. `uv run batter-up commentary` turns every at-bat into plain facts (situation, pitcher's mix, every pitch with its count, speed, spot, result and what the model called) and writes them with the rules into one prompt file. then `/booth` in claude code (the skill in `.claude/skills/booth`) reads it, writes the json, and runs `uv run batter-up commentary --check`, which fails if any pitch is missing a line. no api key, it runs on the claude plan.

`--api` does the same thing through the claude api instead, if you have a key: every at-bat goes into one message batch (half price, nobody's waiting), each reply is held to a json schema with structured outputs and checked before it's kept, and refusals or bad replies are skipped. `--dry-run` prints that prompt without calling anything.

either way the hard rule is that the line for pitch 3 can only use what happened through pitch 3, because you read it before calling pitch 4, and that it only uses the facts it's given, no made up stats. at-bats without lines just play without them.

## the data

pitch data comes from mlb's public statcast feed on baseball savant. this is a personal, non-commercial project and isn't affiliated with mlb or the dodgers.
