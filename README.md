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
uv run batter-up --help
uv run pytest
```

the game

```
cd web
npm install
npm run dev
```

## the data

pitch data comes from mlb's public statcast feed on baseball savant. this is a personal, non-commercial project and isn't affiliated with mlb or the dodgers.
