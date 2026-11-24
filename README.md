# batter up

read the pitcher and call the next pitch before it's thrown. you get dropped into a real dodgers at-bat with the count, the runners, the score and every pitch so far. the pitcher comes set and starts his motion, and it stops just before he lets go. what he showed you (where his glove sat, how high he kicked, how long he held, where his arm came from), his real scouting book and your own notes on him are what you call the pitch with. then you pick up, down, in or away and hit ready. he throws the real pitch in a 3d ballpark, on its real path, while a model trained on every pitch since 2023 makes its own call. then you see who read it, and a line from the booth tells you what just happened.

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
                                                                           scout ────┤  his book from the seasons before
                                                                                     ▼
          web/public/data/atbats.json  model.json  scouting.json  commentary.json (claude code, /booth)
                                                                                     │
                                                    static site on github pages <────┘
                                                    typescript + vite, three.js ballpark
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
uv run batter-up scout      # the scouting book on every pitcher in those at-bats, from the seasons before
uv run batter-up commentary # writes the prompt for the booth lines, then /booth in claude code writes them
uv run pytest
```

no network or no patience? `synth` writes a made up league in the exact same csv format (pitchers are named like "LAD Arm 3", nobody real), so every step runs end to end in about a minute. ci runs the whole pipeline this way on every pr.

```
export BATTER_UP_DATA=data/synthetic
uv run batter-up synth && uv run batter-up build && uv run batter-up features && uv run batter-up train && uv run batter-up export && uv run batter-up scout
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

## reading the pitcher

the first version of the game was mostly luck. you picked one of seven pitches and one of thirteen spots with nothing but his mix to go on, and real pitch choice is close to a coin flip: the model, with two million pitches behind it, gets the type right about 44% of the time. so now the game is about reading him, and what you can read is either real or honestly made up.

**his book is real.** `batter-up scout` (`src/batter_up/scout.py`) goes through every pitch each pitcher in the game threw in the seasons before the test season, the same seasons the model trains on, and writes `web/public/data/scouting.json`. split by the batter's side, it has his mix overall and in each kind of count (first pitch, early, behind, two strikes, full), what he throws after each pitch type in the same at-bat, and where each pitch goes. the game shows you the lines that fit the pitch you're calling, and once you pick a pitch, where he puts it against this side.

**his arm slot is real.** the book also keeps where his hand is when each pitch type comes out. on every pitch the game compares this pitch's real release point to those, and tells you when it's clearly closer to one of them ("like his slider"). the 3d pitcher leans his arm up or down to match, exaggerated so a few inches show. for most pitchers it's faint, which is the truth: the book says how often his arm slot alone names the pitch, and for most of them that's under half. it's the one tell real hitters look for.

**the other tells are made up.** real pitchers almost never tip, so every pitcher gets one or two tells in his delivery that only exist in this game: where his glove sits at the set, a high leg kick or a slide step, a quick set or a long hold. `web/src/tells.ts` seeds them on his id, so they're the same every day and you can learn them. the first tell splits his hard stuff from his soft stuff, the second splits each of those again, so a pitcher with two tells can give away four pitches. the real pitch is known ahead of time, so a cue with a tell behind it shows the right way as often as he's honest and is a coin flip otherwise, and a cue without a tell is always a coin flip. you see all three cues on every pitch, and part of the game is working out which of them mean anything for him.

**how much he gives away depends on who he is.** the book sorts pitchers into three kinds from their real numbers: relievers are an open book (two tells, honest 90% of the time), starters tip some (two tells, 75%), and starters who miss a lot of bats (a whiff rate of 28% or more) are aces with a poker face (one tell, 65%).

**you learn him as you go.** your notebook, kept in your browser, logs every cue you've seen from each pitcher next to what the pitch turned out to be, so you can spot his tells yourself. after 5 pitches from him the scouts tell you his first tell, and after 12 his second.

## the game

plain typescript, no framework. `web/src/game.ts` is the rules (a session walks pitch by pitch through a few at-bats, and you and the model are graded the same way: 3 for the pitch type, 1 for the way it went, up, down, in or away, and every call counts double once you've read 3 pitches in a row, until you miss) and is tested with vitest, like `tells.ts`. the model's thirteen spots fold into the four ways for its call. the page re-renders from one state object on every click. the game is one screen: the ballpark with the zone laid over it and a pitcher cam in the corner, and a panel beside it (under it on a phone) with what he showed, your call, the book on him and your notebook. the zone is drawn from the catcher's view with in and away marked for the batter, cut into four by lines from its corners to the middle, so a pitch belongs to whichever way it's furthest out. the actual pitch lands at its real plate_x and plate_z. after the pitch a small table lines up what was thrown, what you called and what the model called.

the ballpark is three.js, all drawn in code with no models or textures to download (`web/src/stage.ts`): the field, the stands, the lights, and a pitcher and batter built from capsules and spheres with a few keyframed poses (`web/src/players.ts`). it's a telephoto broadcast view from behind the plate, with a second, tighter camera on the pitcher drawn into the corner. for each pitch he comes set showing that pitch's cues, holds, starts his motion and stops with his arm up, just before the ball comes out. when you hit ready he finishes it and lets go from his real release point, the batter swings if the real one did, and the pitch plays once at real speed and again slowed down with its path drawn. the clickable zone is a regular html layer, lined up with the 3d one by projecting the frame's corners through the camera. statcast describes every pitch as nine numbers, a velocity and an acceleration at 50 feet from the plate, so the path is just constant acceleration, solved backwards from where the ball crossed the plate (`web/src/flight.ts`, tested against the plate location). three.js loads in the background after the title screen paints, then sits behind the title card, and if webgl doesn't work the game falls back to a flat zone, shows the cues as text and skips straight to the result. fonts (inter and barlow condensed) are bundled with the site, nothing loads from a font cdn.

the daily three come from a seeded shuffle of the date in los angeles (`web/src/daily.ts`), so everyone gets the same at-bats without a server and the day turns over at midnight at the stadium. results stay in your browser. share copies a grid like this, with no spoilers (green for the pitch and where it went, yellow for one of them), and save card draws a png of it on a canvas.

```
batter up #3 ⚾ beat the model
me 31 · model 27
🟩🟨⬜🟨🟩
🟨🟩⬜
🟨⬜🟩🟨
ryzee34.github.io/project-batter-up
```

keyboard works too: f s c l u h p for the pitch, the arrow keys for where it goes, w to watch his delivery again, enter to call it.

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
