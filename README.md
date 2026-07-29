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
  affordance; touch reordering goes through the sheet.
- Quick add understands a small syntax: `Floss #wind-down !2` → task "Floss", in the
  Wind Down section, two minutes.
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
- **Lights out.** A permanent bar at the bottom that ends the night. It stamps when you
  stopped, pays its biggest reward for stopping *early*, and then fades the screen to
  black instead of handing you back a lit phone at midnight. It keeps its own streak —
  nights you went to bed on time, which is the number that actually matters.
- **Momentum, not speed.** The multiplier rises when the gap between check-offs looks
  like you went and did the thing: longer than a token tap, shorter than a drift. Tapping
  through the list in ten seconds earns nothing.
- **Curfew.** The shop, star map, history and insights close 30 minutes before bedtime.
  Four browsing surfaces with a currency attached are the same product NightCheck is
  supposed to be rescuing you from. A deliberate second tap still gets you in.

**The game**
- XP with a level curve and titles: Dreamer → Night Owl → Star Gazer → Moon Walker →
  Dusk Warden → Void Sailor → Constellation Keeper.
- A nightly bonus quest, seeded by the date so it never rerolls on you.
- Badges for streaks, perfect nights, late-night finishes and collection milestones.
- Un-checking a task reverses its exact award, the completion bonus is banked so it can
  be paid once and taken back precisely, and level-up stardust is paid against a
  high-water mark. The economy does not move when you fiddle with a checkbox.

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
- Two tabs stay in sync instead of clobbering each other, pending writes are flushed when
  the tab is backgrounded, and unreadable saved data is preserved under
  `nightcheck.v1.corrupt` rather than silently discarded.
- Installable as a PWA and fully offline-capable.

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
js/render/            checklist, header, modals, bottom sheet, the goodnight screen
tests/                node --test suites over the pure modules
tools/make-icons.mjs  PWA icon generator
sw.js                 cache-first service worker
```

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
