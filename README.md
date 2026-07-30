# NightCheck

A night-themed checklist game for getting things done before bed. Build your night out
of sections and tasks, check them off, and watch the moon fill up. Finishing things earns
XP and levels, holds a streak, and pays **stardust** you can spend on skies, companions,
constellations and supplies.

Everything runs in the browser. No accounts, no server, no build step, no dependencies —
your night lives in `localStorage` and can be exported to a JSON file whenever you like.

## What's in it

**The checklist**
- Sections and tasks: add, rename (double-click or `E`), delete (with undo), reorder.
- Reorder by dragging, with the ↑/↓ buttons, or with `Alt + ↑/↓` — tasks move between
  sections at the edges, so nothing needs a mouse.
- On a phone every row action lives in a bottom sheet behind `⋯` — thumb-sized targets,
  and the task title gets the width instead of five buttons. Drag-and-drop is a pointer
  affordance; touch reordering goes through the sheet. The sheet's grip is a real handle:
  drag or flick it down to dismiss.
- **Nothing hands you to the operating system.** No `<select>`, no `confirm()`, no native
  time wheel — the bedtime, the motion setting and every "are you sure" are the app's own
  controls, in the app's own type, and none of them slide a grey system panel over your
  night.
- Adding a section asks what to call it first, rather than dropping a row named
  "New section" into the list.
- **Adding a task is three taps**: type the words, tap how long (30s/1/2/5/10/15/30), tap
  which part of the night. The sheet stays open so you can rattle off several. Nothing
  asks you to remember a syntax at midnight — though the quick-add box on a keyboard
  still understands `Floss #wind-down !2` if you want it.
- **Odd durations are first-class.** Estimates are stored in minutes and quantised to a
  half, so a thirty-second job is `30s` and a shower is `7½m`. `Other…` opens a number
  pad of our own — eleven big keys and a delete, no system keyboard shoving the sheet off
  the screen. Typing works too: the row chip, or `!7.5` / `!30s` in quick add.
- **You name your own first section.** With an empty list the add sheet asks what to call
  this part of the night (`Tonight` if you leave it blank) instead of inventing a section
  behind your back and telling you about it in a toast.
- **One at a time** (`F`) hides the list and shows a single task with a check target
  filling the bottom third of the screen. A twelve-row list at 11:40pm is twelve
  decisions; a card is a prompt. `Later` pushes one to the back of the sitting.
- **A timer that refuses to end.** Each card counts down from its own estimate (`T`, or
  automatically if you turn that on in Settings). At zero it does not alarm, block or ask
  to be dismissed — it turns over and counts *up* in a warmer colour. Nothing beeps. The
  message is "this is taking longer than you thought", not "you failed".
- Every task carries a minute estimate that drives the bedtime pacing.

**The night cycle**
- A night rolls over at **4am**, so anything you tick off at 1am still counts for the
  night before.
- On rollover the night is banked into your history, the checklist resets, and a new
  bonus quest is rolled.
- Hit 60% and your streak grows. Miss a night — including nights you never opened the
  app — and a **Streak Freeze** is spent automatically to cover it, if you have one.

**Getting you off the phone**

These are the parts that exist because the real competitor is not another todo app —
it's the scroll.

- **The envelope.** One good thing happens the moment you open the app, before you've
  earned anything: stardust, a rain check, a head start. Every other reward is downstream
  of doing chores, which does nothing for the night the app stays closed.
- **Lights out.** A pill in the corner that ends the night. It stamps when you stopped,
  pays its biggest reward for stopping *early*, and then fades the screen to black instead
  of handing you back a lit phone at midnight. It keeps its own streak — nights you went
  to bed on time, which is the number that actually matters. It takes a press and hold,
  because it sits under your thumb on a list you scroll and it is the one button in the
  app you must never hit by accident.
- **Momentum, not speed.** The multiplier rises when the gap between check-offs looks
  like you went and did the thing: longer than a token tap, shorter than a drift. Tapping
  through the list in ten seconds earns nothing.
- **Curfew.** The shop, star map, history and insights close 30 minutes before bedtime.
  Four browsing surfaces with a currency attached are the same product NightCheck is
  supposed to be rescuing you from. A deliberate second tap still gets you in.

**The game**
- XP with a level curve and eight titles, from Dreamer upward. You can see the level each
  one arrives at but never what it is called until you get there — a list of every name you
  will ever be given is a list of endings, and the reveal is the reward.
- A nightly bonus quest, seeded by the date so it never rerolls on you.
- Badges for streaks, perfect nights, early nights and collection milestones. Nothing in
  the game rewards being awake late: there was a badge for checking something off past
  1am, in the app whose whole argument is that you should be asleep, and it has been
  replaced by two for stopping *before* your bedtime.
- Un-checking a task reverses its exact award, and if that drops you below a level it
  takes the level with it: the level-up stardust goes back and a level badge comes off
  again. The completion bonus is banked so it can be paid once and taken back precisely.
  Nothing you can un-tick leaves you holding what it paid for.

**Spending stardust**
- **Skies** — Midnight, Aurora, Deep Space, City Skyline, Frost, Blood Moon. Each one
  restyles the whole app *and* the live canvas sky.
- **Companions** — an owl, cat, fox or bat that lives in the corner, reacts to your
  progress, and evolves through four tiers as you feed it.
- **Star map** — light constellations one star at a time. Finish one and it is drawn
  permanently into your night sky.
- **Sounds, trails and type** — swappable sound packs, pointer trails and font packs.
- **Supplies** — Streak Freezes and Rain Checks (a rain check excuses one task from
  tonight's percentage).

**The rest**
- A live canvas sky: parallax twinkling stars, shooting stars on every check-off, and a
  moon whose phase fills with tonight's completion.
- Bedtime target with a countdown and an on-pace / cutting-it-close / over-budget read.
- Night history as a heatmap, plus per-task insight — which tasks you actually do, and
  which have quietly slipped six nights running.
- Sleep-safe dim mode (which reaches the dialogs and sheets too), sound effects (muted by
  default), full keyboard control, and `prefers-reduced-motion` support throughout.
- **Reset what you actually mean.** Settings asks which of six things should go —
  tonight's checkmarks, the list, history, level and streak, stardust and unlocks,
  settings — and then confirms exactly those. Clearing tonight's checkmarks hands back
  the XP and stardust they paid, so it is not a way to farm the same night twice.
- Two tabs stay in sync instead of clobbering each other, pending writes are flushed when
  the tab is backgrounded, and unreadable saved data is preserved under
  `nightcheck.v1.corrupt` rather than silently discarded.
- Installable as a PWA and fully offline-capable — and it can actually update
  itself. An installed app is a cache that boots, so this asks the service worker
  to look for a new build on launch and on every return to the foreground, then
  reloads on the spot if nothing is open, or offers a toast if you are mid-task.
  Settings shows which build is running and has a **Refresh the app** button that
  empties the caches and reloads — the effect of deleting and reinstalling the
  app, without deleting anything. Your night, streak and unlocks are in
  `localStorage` and are never touched by it.

## Running it locally

Any static file server will do — ES modules need `http://`, not `file://`.

```bash
python3 -m http.server 8000
# or: npx http-server -p 8000 -c-1
```

Then open <http://localhost:8000>.

## Hosting on GitHub Pages

There is nothing to build. In the repository's **Settings → Pages**, choose
*Deploy from a branch* and pick the branch holding this code with the folder set to
`/ (root)`. The site works from a project sub-path (`/NightCheck/`) as well as a custom
domain — every path in the app is relative.

## Tests

Pure logic — the night cycle, streaks and freezes, the XP curve, combos, quests, quick-add
parsing, the constellation economy and storage migration — is covered by Node's built-in
test runner. No install step, no dependencies:

```bash
node --test "tests/*.test.js"
```

The PWA icons are generated from the same design as `assets/icon.svg` by a small
dependency-free rasteriser:

```bash
node tools/make-icons.mjs
```

## Layout

```
index.html            app shell
css/                  base tokens, themes, layout, components
js/                   state, actions, game rules, canvas sky, renderers
js/render/            checklist, header, modals, sheet, confirm, add-task, cards, goodnight
js/reset.js           what each part of "reset" actually clears
js/timer.js           the card clock: countdown, overtime, pause
js/updates.js         keeps an installed copy from booting last week's build
tests/                node --test suites over the pure modules
tools/make-icons.mjs  PWA icon generator
sw.js                 cache-first service worker
```

Icons are one set: every glyph is measured once, then centred and scaled to a common
optical span with its stroke width compensated, so a dense cog and a sparse bar chart
read at the same weight. Where an icon sits beside a label, `js/optical.js` measures the
font the device actually loaded and publishes `--icon-nudge`, which lifts the glyph onto
the label's cap-height centre — `align-items: center` aligns line boxes, and a line box
is mostly the empty room a font reserves for accents and descenders.

State flows one way: the UI calls an action, the action mutates the single store in
`js/state.js`, and subscribers re-render. One-off effects (sounds, shooting stars, toasts)
ride a small event bus rather than being triggered from render code.

## Your data

Everything is stored under the single `localStorage` key `nightcheck.v1` in the browser
you're using — it is not synced anywhere. **Settings → Export JSON** writes a backup you
can import into another browser or keep somewhere safe.

## Dev hatch

For poking at the night cycle without waiting until 4am, the app exposes a small helper
on `window.__nightcheck`:

```js
__nightcheck.getState()             // the live state object
__nightcheck.setNightKey('2026-07-01')  // pretend tonight is another night
__nightcheck.rollover()             // bank the night and start a fresh one
__nightcheck.addStardust(500)
__nightcheck.addXp(500)
__nightcheck.openModal('starmap')   // shop | starmap | history | insights | settings | help
```

## Known trade-offs

- Everything is per-browser. There is no sync; export/import is the bridge.
- Nothing can notify you — a static site cannot schedule a notification, and iOS will not
  run a timer for a page that is closed. The intended cue is your phone's own alarm; the
  app rewards you for showing up when it goes off.
- Reordering by drag needs a pointer. On touch, use the `⋯` sheet.
