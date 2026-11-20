# batter up

call the next pitch before it's thrown. you get dropped into a real dodgers at-bat with the count, the runners, the score, the pitcher's scouting report and every pitch so far, then you pick the pitch type and where it's going. a model trained on every pitch since 2023 makes its call at the same time, the pitch replays from behind the plate, and a line from the booth tells you what just happened.

play it at **[ryzee34.github.io/project-batter-up](https://ryzee34.github.io/project-batter-up/)**. everyone gets the same three at-bats each day, with a spoiler free grid to share, and there's a practice mode with random ones.

## how its put together

```
baseball savant ──fetch──> daily csvs ──build──> pitches per season ──features──> what a catcher knows before each pitch
                                                                                     │
                                                         favorite pitch baseline <───┤
                                                                                     ▼
                                    lightgbm pitch type + zone model, trained 2023-2025, scored on 2026
                                                                                     │
                                                                          export ────┤
                                                                                     ▼
                         web/public/data/atbats.json  model.json  commentary.json (claude code, /booth)
                                                                                     │
                                                    static site on github pages <────┘
                                                    typescript + vite, three.js replay
```

- `src/batter_up` is the python side. it pulls the pitch data, builds the features, trains the model and writes everything the game needs to small json files
- `web` is the game. it only reads those json files, so the site is static and has no server and no api key
- `tests` are the python tests. the important ones check that no feature can see anything that happened after the pitch it's predicting, and that the test season never reaches training

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

no network or no patience? `synth` writes a made up league in the exact same csv format (pitchers are named like "LAD Arm 3", nobody real), so every step runs end to end in about a minute. ci runs the whole pipeline this way on every pr.

```
export BATTER_UP_DATA=data/synthetic
uv run batter-up synth && uv run batter-up build && uv run batter-up features && uv run batter-up train && uv run batter-up export
```

when the game data was made this way, `atbats.json` says `"synthetic": true` and the game says so on screen.

the game

```
cd web
npm install
npm run dev
npm test
```

## the model

two lightgbm trees. the first reads the situation (count, outs, runners, score, handedness, the pitches already thrown this at-bat and this game, and his mix in every earlier game, overall and against this side) and gives odds for each pitch type. the second is told the pitch type and gives odds for each of the thirteen spots, the nine boxes of the zone and the four ways to miss it (a chase up, down, or off either side of the plate), because where a slider goes isn't where a fastball goes. a chase is named for the edge the ball missed by the most feet. with one big "chase" bucket the model called chase on every pitch, since about half of all pitches miss the zone; split four ways it has to pick a side. multiply them and you get odds for every pitch and zone pair. the model calls its likeliest pitch, then that pitch's likeliest spot. it doesn't call the likeliest pair, because then a pitch that always lands in the same spot, like a slider in the dirt, beats a likelier pitch whose spots are spread out, and the pitch call gets worse.

it's trained on every season before the test season, with the last of those held out to decide when to stop adding trees, then refit on all of them. the test season is never touched until the score. `train` prints the model next to the favorite pitch baseline, overall, for dodgers pitchers, and count by count, and saves it all to `data/models/metrics.json`. the title screen shows the headline number from it.

## what the game gets

`export` picks about 40 dodgers at-bats from the test season, so every call the model makes in the game is one it made blind. it favors at-bats that are fun to call (long, late, close, runners on, full counts, strikeouts and homers) and spreads them across pitchers and games. each pitch carries the count, what was thrown and where, the flight numbers to replay it, the model's odds for every pitch type and zone, its single call, and the baseline's call. the pitcher's scouting report is his mix in every game before that day. it all comes to about 130 KB of json.

## the game

plain typescript, no framework. `web/src/game.ts` is the rules (a session walks pitch by pitch through a few at-bats, and you and the model are graded the same way: 2 for the pitch type, 1 for the zone, 1 more for both) and is tested with vitest. the page re-renders from one state object on every click. each pitch is two steps: pick the pitch (his mix against that side of the plate is right on the buttons) and pick the spot. the zone is drawn from the catcher's view with in and away marked for the batter, the box is the strike zone and the frame around it is cut into the four chase areas, and the actual pitch lands at its real plate_x and plate_z. after the pitch a small table lines up what was thrown, what you called and what the model called.

after each call the pitch replays in three.js from just behind the catcher, once at real speed and once slowed down with its path drawn. statcast describes every pitch as nine numbers, a velocity and an acceleration at 50 feet from the plate, so the path is just constant acceleration, solved backwards from where the ball crossed the plate (`web/src/flight.ts`, tested against the plate location). three.js loads in the background once you start playing, so the title screen stays small, and the reveal falls back to the 2d zone if webgl doesn't work. fonts (inter and barlow condensed) are bundled with the site, nothing loads from a font cdn.

the daily three come from a seeded shuffle of the date in los angeles (`web/src/daily.ts`), so everyone gets the same at-bats without a server and the day turns over at midnight at the stadium. results stay in your browser. share copies a grid like this, with no spoilers, and save card draws a png of it on a canvas.

```
batter up #3 ⚾ beat the model
me 31 · model 27
🟩🟨⬜🟨🟩
🟨🟩⬜
🟨⬜🟩🟨
ryzee34.github.io/project-batter-up
```

keyboard works too: f s c l u h p for the pitch, 1 to 9 for the zone, the arrow keys for a chase, enter to call it.

## the booth

after each pitch a line of color commentary shows up, written by claude ahead of time. the site is static, so players never call claude and playing costs nothing. the lines are written once and shipped as `web/public/data/commentary.json`.

the free way, and the default, is a claude code session. `uv run batter-up commentary` turns every at-bat into plain facts (situation, pitcher's mix, every pitch with its count, speed, spot, result and what the model called) and writes them with the rules into one prompt file. then `/booth` in claude code (the skill in `.claude/skills/booth`) reads it, writes the json, and runs `uv run batter-up commentary --check`, which fails if any pitch is missing a line. no api key, it runs on the claude plan.

`--api` does the same thing through the claude api instead, if you have a key: every at-bat goes into one message batch (half price, nobody's waiting), each reply is held to a json schema with structured outputs and checked before it's kept, and refusals or bad replies are skipped. `--dry-run` prints that prompt without calling anything.

either way the hard rule is that the line for pitch 3 can only use what happened through pitch 3, because you read it before calling pitch 4, and that it only uses the facts it's given, no made up stats. at-bats without lines just play without them.

## deploying

`.github/workflows/pages.yml` tests, builds and publishes `web/dist` to github pages on every push to main. the one time setup is repo settings > pages > source: github actions.

## what it costs

nothing past a claude plan. the pitch data is public, github actions and pages are free for a public repo, the model trains in seconds on a laptop, and the booth lines are written in a claude code session. the only paid path is the optional `--api` flag.

## the data

pitch data comes from mlb's public statcast feed on baseball savant. this is a personal, non-commercial project and isn't affiliated with mlb or the dodgers.
