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
uv run pytest
```

no network or no patience? `synth` writes a made up league in the exact same csv format (pitchers are named like "LAD Arm 3", nobody real), so every step runs end to end in about a minute

```
export BATTER_UP_DATA=data/synthetic
uv run batter-up synth && uv run batter-up build && uv run batter-up features && uv run batter-up train
```

## the model

two lightgbm trees. the first reads the situation (count, outs, runners, score, handedness, the pitches already thrown this at-bat and this game, and his mix in every earlier game) and gives odds for each pitch type. the second is told the pitch type and gives odds for each of the ten zones, because where a slider goes isn't where a fastball goes. multiply them and you get odds for every pitch and zone pair, and the model's call is the likeliest one.

it's trained on every season before the test season, with the last of those held out to decide when to stop adding trees, then refit on all of them. the test season is never touched until the score. `train` prints the model next to the favorite pitch baseline, overall, for dodgers pitchers, and count by count, and saves it all to `data/models/metrics.json`

the game

```
cd web
npm install
npm run dev
```

## the data

pitch data comes from mlb's public statcast feed on baseball savant. this is a personal, non-commercial project and isn't affiliated with mlb or the dodgers.
