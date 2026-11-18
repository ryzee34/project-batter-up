---
name: booth
description: Write the booth commentary (web/public/data/commentary.json) for batter up's exported at-bats, inside this Claude Code session with no API key. Use after batter-up export, or when asked to write or refresh the commentary.
---

# write the booth lines

the game shows one line of color commentary after each pitch and a wrap after each
at-bat. you write them here, once, and they ship as a static file. players never call
claude, and this costs nothing beyond the claude plan.

1. run `uv run batter-up commentary`. it writes `data/booth-prompt.md` with the rules
   and every at-bat as plain facts. if it says the at-bats are synthetic, stop and say
   so unless the user asked for lines about the made up league.
2. read `data/booth-prompt.md` in full. the rules in it are the brief, follow them
   exactly. the one that matters most: the line for pitch n may only use what happened
   up to and including pitch n, never anything later, because the player reads it
   before calling the next pitch. only use facts from the file.
3. write `web/public/data/commentary.json` in the shape the prompt shows: every at-bat
   id, one line per pitch in order, and a wrap. set `"model"` to the model you are.
4. run `uv run batter-up commentary --check` and fix every problem it lists.
5. read a few at-bats back pitch by pitch, as a player would, and rewrite any line that
   gives away a later pitch or states something not in the file.
6. commit `web/public/data/commentary.json`.
