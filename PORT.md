# Porting to Swift

This repo is the reference implementation for a native iOS app. It is not old code
to be replaced — it is a working specification with every balance decision measured
and every mistake documented. Read this before writing Swift, and keep the web app
running beside you: when the Swift economy disagrees with it, the web app is right
until you have proved otherwise.

The name changes at the port. The repo, the project and the app are all
**NightRise**; `NightCheck` is the old name and should not survive into Swift.

---

## Renaming NightCheck to NightRise

There are **35 mentions across 14 files** in the app itself, and 13 more in the
README. **Rename every one of them in the Swift port** — types, strings, comments,
log messages, the lot. Nothing should ship carrying the old name.

But this repo is not a find-and-replace target, because six of those strings are
**data**, not prose. Changing them changes behaviour:

| string | where | what changes if you rename it |
|---|---|---|
| `nightcheck.v1` | `model.js` `STORAGE_KEY` | **every existing save is orphaned.** The key itself does not cross over — Swift will use its own store — but the exported JSON must still be readable. |
| `nightcheck-stars` | `sky.js:90` | the starfield seed. Rename it and every sky re-randomises. Either carry the literal across or accept a one-time reshuffle, but know which you are choosing. |
| `nightcheck-v83` | `sw.js:7` | the cache name, and… |
| `startsWith('nightcheck-')` | `sw.js:85` | …the filter that deletes old caches. **A coupled pair.** Rename one and old caches are never collected. Neither crosses to Swift. |
| `nightcheck.updated-at` | `updates.js:23` | plus `updates.js:102`, which strips the `nightcheck-` prefix off the cache name. Coupled to `sw.js`. Does not cross over. |
| `__nightcheck_probe__` | `storage.js:420` | the localStorage availability probe. Harmless, but it is a key, not a label. |

Everything else is prose and renames freely: the `console.warn('NightCheck: …')`
family, the `.ics` `PRODID` and description, `index.html`'s title, the manifest
name, `package.json`, the export filenames, and the `window.__nightcheck` debug
hook.

The README needs the same treatment and has not had it: it still opens on the old
name in prose, still describes a browser app in the present tense, and still quotes
figures measured against the web build. When the Swift app exists, rewrite it to
describe **that** — and re-measure every number in it rather than carrying the ones
here across. `tools/economy-sim.mjs` is what prints them.

**One thing that makes the migration easy:** the export format carries no app name
at all. `serializeState` writes the state plus an `exportedAt` stamp, and
`parseImport` validates only that `template` is an object. So a NightCheck backup
imports into NightRise with no compatibility shim — which matters, because your
on-time nights are the one thing that cannot be regenerated and the Far Shelf
counts to 120.

---

## Why native at all

The honest limit of the web app is written into its own plan file: **a static PWA
cannot reach you when it is closed, and being closed is the failure mode.** Every
consequence in here — curfew, last call, the browsing budget, the stripped-back app
— only works while NightCheck is already open. That is the whole reason to move.

What native buys, in the order it matters:

1. **Screen Time.** `FamilyControls` + `ManagedSettings` + `DeviceActivity` can
   actually shield the app you opened instead. Nothing else on this list changes
   what the app *is*.
2. **HealthKit sleep.** `sleepAnalysis` makes `onTime` a **measurement** rather
   than a self-report. Today you press Lights Out and the app believes you; that is
   the single largest unmeasured claim in a codebase otherwise built on measuring.
3. **Local notifications.** `UNUserNotificationCenter` with a calendar trigger, no
   server. `js/alarm.js` — the `.ics` calendar file — exists only to work around
   its absence and should be deleted, not ported.
4. **Contextual triggers.** Plugging the phone in at 10pm is the most reliable
   physical signal that the night has started, and no web app can see it. Focus
   mode changes and arriving home are the same shape. Fire on intent, not on a
   clock.
5. **Storage that does not evaporate.** iOS clears web storage for sites unused for
   about a week. The Far Shelf's last rung is 120 nights. That mismatch is
   structural.
6. Live Activities, widgets, Shortcuts.

**Build (1) first.** It is the load-bearing assumption behind the whole port, the
development entitlement needs no Apple approval, and it only works on a physical
device — the simulator throws `FamilyControlsError` 3. If a shield at 11:30pm turns
out not to change your behaviour, you want to know that after a weekend rather than
after rebuilding 11,749 lines of presentation. Everything else here is a port of
something already proven. That part is the actual bet.

---

## What ports and what does not

Measured, not estimated:

| | lines | what happens to it |
|---|---:|---|
| rules and data | **6,306** | ports as shape — same functions, same names, same tests |
| tests over those rules | **399 across 20 suites** | port first, as the specification |
| presentation (`js/render/`, `sky.js`, `dom.js`, `main.js`) | 8,341 | genuine rewrite in SwiftUI |
| CSS | 3,408 | gone entirely |

So a little under half the app is portable and the rest is a rebuild. Do not treat
that as bad news: the half that ports is the half that took the longest to get
right, and it arrives with proofs attached.

### Module map

| JS | lines | Swift |
|---|---:|---|
| `time.js` | 272 | `NightClock` — night keys, the 4am roll, curfew, last call, `lateStage` |
| `bedtime.js` | 256 | `BedtimeRecord` — averages, trend, on-time rate, `suggestBedtime` |
| `night.js` | 534 | `Night` + `NightStats` — rollover, banking, streaks, clean nights |
| `game.js` | 557 | `Progression` — XP curve, levels, `TITLES`, momentum, task XP |
| `model.js` | 245 | the `Codable` structs; `SCHEMA_VERSION` |
| `storage.js` | 648 | `SaveFile` — normalisation, migrations, export/import |
| `shop.js` | 333 | `Market` — `allItems`, `canBuy`, `purchase`, `equip` |
| `skins.js` | 690 | pure data → a Swift catalog, ideally still data |
| `constellations.js` | 328 | `StarMap` — star costs, depth tier |
| `achievements.js` | 443 | `Achievements` — nine families, derived tiers |
| `quests.js` | 182 | `Quests` — seeded by the night key |
| `actions.js` | 478 | the command layer — folds into a `Store` reducer |
| `reset.js` | 245 | `Reset` — the revoke ledger |
| `insights.js` | 113 | derived reads; mostly free in Swift |
| `companion.js` | 192 | tiers port; the SVG art is a redraw |
| `render/goodnight.js` | — | **`lightsOutReward` is rules, not presentation.** Extract it. |
| `alarm.js` | 114 | **delete.** Replaced by `UNUserNotificationCenter`. |
| `sky.js` | 1,092 | SwiftUI `Canvas` + `TimelineView`, or SpriteKit |
| `render/modals.js` | 1,678 | sheets and the market; the largest single rewrite |
| `optical.js`, `dom.js`, `dnd.js`, `keys.js` | — | delete. SwiftUI and SF Symbols do this. |

`state.js` (73 lines) is a synchronous pub-sub store. Its one hazard — `update()`
notifying subscribers *during* the mutation — disappears under `@Observable`. Do not
port the mechanism, port the shape.

---

## The invariants

These are what the 399 tests actually hold. Port the tests first; if the Swift
passes them, the economy is the same economy.

**Time** (`time`, `lastcall`, `bedtimestats` — 59 tests)

- A night rolls at **04:00**. Anything ticked at 1am belongs to the night before.
- `bedtimeInstant` pivots at **noon**, not at the 4am boundary. A 04:00 bedtime
  resolved backwards once and read "18h over" all evening.
- Minutes-from-noon must be **calendar** arithmetic, not epoch. Epoch minutes made a
  3:30am lights-out read an hour off across a DST boundary.
- The bedtime minute itself is **on time** — `< 0`, never `<= 0`. Both `pacingStatus`
  and `lateStage` carry that scar. Last call is the opposite: the minute it lands on
  is already over the line.
- Last call clamps to the end of the night. 3:45 + 120min is 5:45, which this key
  never sees.

**The reward for stopping** (`leverage`, `economy` — 56 tests)

`lightsOutReward(minutesEarly, stats, earned)`:

```
ON_TIME  = { xp: 12,  dust: 3 }      FLOOR = { xp: 3, dust: 1 }
LATE_TAU = 70 minutes                EARLY_CAP = 90 minutes
SHARE    = { onTimeXp: 0.30, floorXp: 0.04, onTimeDust: 0.50, floorDust: 0.03 }
EARLY_PER_MIN = { xp: 0.7, dust: 0.15 }
```

Four properties, each with a test:

1. **Continuous at zero.** Stopping *on* the minute must never pay less than a
   minute early. The original cliff docked you for precision.
2. **Monotonic** across the whole range.
3. **Bounded** by the 90-minute earliness cap.
4. **Never zero.** It asymptotes to the floor. A reward that decays to nothing
   removes the last reason to stop at 3am, which inverts the entire feature.

Both ends scale with what the night earned, so a bigger night has more to lose by
running long. On an 81-dust night: **44 dust on time, 15 at ninety late.**

**The economy** (`economy`, `shop` — 82 tests)

- A settled eighteen-row night pays **157 stardust**. Every sink is paced off it.
  `tools/economy-sim.mjs` prints this and the sink totals; the README quotes it and
  a test pins it. Port the simulator too.
- The market is **43,130 dust across 67 items**, gated on **price alone**.
- The Far Shelf is **20,700 across 8 items**, gated on **nights slept on time**
  (3, 7, 14, 25, 40, 60, 85, 120) and nothing else.
- No item carries a level gate. A test fails if one comes back.
- Nothing is sold behind an empty picture — every shelf's preview is named and
  checked.

**Nothing is ever taken away** (`reset` — 20 tests)

Clearing progress must not forget which levels and achievement rungs have already
been paid for. Clearing stardust must not forget the debt. A guard goes back only
with the money it was guarding.

---

## Scars: things that must not come back

Each of these shipped, was found by measurement, and has a test holding it down.

- **Starlight.** A second currency, minted by stopping on time, that a star cost *in
  addition* to stardust. Wrong twice: the app already lights one star per on-time
  night for free, so the reward was duplicated — and duplicating it converted a
  reward into a restriction on the main sink. Reverted; the dust share carries it
  instead. **The general form: never gate an existing sink behind good behaviour.
  Pay for it.**
- **Level gates.** Rebuilt once from measurement and still deleted, because every
  band was open by night 23 and never bound again while 37 cards wore an expired
  lock. Replacing them with nights was measured and rejected: 80% of the market by
  cost, and at one on-time night in seven the last band moved from night 23 to
  night 161. Starlight at four times the scale.
- **Seeding a currency from the factory.** Starlight shipped seeded at 2, and
  `mergeDefaults` handed two unslept nights to every existing save.
- **`export { x as y }`.** Renames for importers and declares nothing locally. Killed
  all eight reorder paths at once, silently, because the throw was inside an event
  handler. Swift's compiler makes this impossible — one whole class of bug gone.
- **Copy that claims more than the code measures.** The recurring failure of this
  project. Fixed at the measurement every time, with a regression test. Examples:
  a settings hint that said "120 minutes past 3:45 AM, so 4:00 AM"; a README
  quoting 131 dust when the code paid 157; a comment calling Temple Bell "the
  quietest pack" after a quieter one shipped.
- **Measuring the wrong thing and believing it.** A contrast probe that returned
  1.00 everywhere; a horizon probe that returned Δ≈0 because the re-render did not
  apply cosmetics. **Invariance across inputs that should differ is the tell.**
- **Testing the code instead of the artifact.** `js/skins.js` was never in the
  service worker's precache list, for the entire life of the project. Everything
  in that list is served from cache; anything else needs the network. Five
  modules import skins.js, including `dom.js`, so a sleeping wifi took out
  `icon()` and the app came up as a logo, an empty panel and one dashed button —
  no toolbar, no `+`, no Lights out, no way to reach Settings. It reported
  **nothing**: a failed module inside an import graph never reaches `pageerror`.
  Every browser check ever run against this app passed while that sat there,
  because they all ran against a local server where every file resolves. The code
  was never wrong. **The delivery was, and nothing was looking at the delivery.**
- **A CSS shorthand silently resetting a fix.** `background-origin`/`repeat` were
  set on `.swatch` and put straight back by `background:` on each sky. The fix
  looked identical to no fix. Only re-measuring caught it.

---

## Principles

1. **Never punish.** Nothing is taken away, the reward never reaches zero, and no
   mechanic charges you twice for the same bad night. This is the app's one
   structural promise and the thing that stops it being deleted after a bad week.
2. **Measure, do not remember.** If prose quotes a number, something must print it.
   That is what `tools/economy-sim.mjs` is for.
3. **A preview may not promise what the app will not do.** Every shop card is drawn
   from the same data the renderer reads.
4. **Each mechanic does one job.** Market paced by price. Far Shelf paced by nights.
   Levels carry titles and gate nothing.
5. **AI may generate. AI may never decide.** On-device only (`FoundationModels`,
   iOS 26+, so never load-bearing). It may propose a starting list you then edit.
   It must never compute a reward, judge an excuse, set a bedtime, or decide whether
   a night counted. Those stay in tested Swift. And nothing in this app is ever
   allowed to tell you it thinks you are lying.
6. **Verify the artifact, not the tree.** A green test suite and a clean run on
   a dev server say the source is right. They say nothing about what actually
   reaches the device. Swift removes the specific bug above — assets are bundled
   — and keeps the shape of it. The native versions to watch:
   - a file added to the project but not to the **target's membership**, so it
     compiles locally and is absent from the archive;
   - `UIImage(named:)` / `Image("…")` against an asset-catalog name that does not
     exist — returns nil or a blank, never throws;
   - `Info.plist` usage keys missing, so a permission prompt never appears and
     the capability just quietly does nothing;
   - a SwiftData migration that is only ever exercised on a fresh install;
   - entitlements that work from Xcode on a device and fail on TestFlight,
     which is already noted under Shipping.

   The rule that follows: **run the release build on a real device, from
   TestFlight, on a bad network, before believing anything.** And treat a
   silent failure as more dangerous than a loud one — the loud ones get fixed.

---

## Order

1. **Screen Time prototype on a real device.** Shield something at a set time.
   Development entitlement, no approval, no simulator. Answer the bet first.
2. **Port the tests.** `time`, `lastcall`, `leverage`, `economy`, `shop` first —
   those five are 145 of the 399 and hold every invariant above.
3. **Port the rules** until the tests pass. No UI yet.
4. **Build the importer anyway**, even though there is now nothing to import.
   The original save was lost to the precache bug above, so the port starts from
   night zero — which is cleaner than it sounds, since the Far Shelf's first rung
   is three nights out and the whole ladder is live from the first night.
   The importer still has to exist: `parseImport` accepts any object with a
   `template`, so the format is already stable, and it is what makes the next
   save recoverable. Write it before there is something to lose, not after.
5. **Then the UI**, list before sky.
6. **HealthKit last** — it changes `onTime` from a claim to a measurement, and it
   should land on an economy already known to be correct.

Keep using the web app nightly while you build. It costs nothing and it is still
accumulating the only data that matters.

---

## Where the Swift lives

One repo, not two. The Xcode project goes **inside this one**, alongside the
JavaScript it is porting:

```
NightRise/
  ios/            the Xcode project
  js/             the reference implementation
  tests/          the specification, 399 of them
  tools/          economy-sim.mjs
  PORT.md
```

The whole instruction at the top of this file — *keep the web app running beside
you; when the Swift economy disagrees, the web app is right until you have proved
otherwise* — only works if both are in the same tree. Two repos means opening two
windows and checking neither.

`node --test 'tests/*.test.js'` keeps working from the root the entire time, which
is how you settle an argument about what a settled night pays.

---

## Shipping

Researched once, painful to re-derive. None of it is guesswork; the failure modes
listed were reported by developers who hit them.

### Screen Time entitlements

There are **two**, and only one needs Apple.

| | approval | works where |
|---|---|---|
| Family Controls **(Development)** | **none** | Xcode → a physical device |
| Family Controls **(Distribution)** | Apple reviews a form | TestFlight, App Store |

- **The simulator cannot do this.** `AuthorizationCenter.requestAuthorization(for:
  .individual)` throws `FamilyControlsError` 3. Screen Time work needs a device on a
  cable, always.
- The distribution form: `developer.apple.com/contact/request/family-controls-distribution`,
  signed into the developer account. It asks for the app and bundle ID.
- **Every extension needs its own request.** `DeviceActivityMonitor`,
  `DeviceActivityReport`, `ShieldAction`, `ShieldConfiguration` — four separate
  submissions if you use all four.
- Reported turnaround runs from about two days to four and a half weeks.
- Apple wants a genuine parental-control or personal digital-wellbeing case. It
  rejects collecting usage data for advertising or profiling. NightRise is squarely
  the former; do not drift toward the latter.
- Once granted, enable it under Identifiers → Additional Capabilities. The option
  does not appear until then.
- A recurring trap: it works from Xcode on device and then fails on TestFlight
  because the provisioning profile did not pick up the *extension* entitlements.
  Budget a day for signing.

A thing worth being honest about in the copy: **a shield is friction, not a wall.**
It can be dismissed, and the user can switch it off in Settings. A Screen Time
passcode raises the cost. It is far stronger than anything the web can do, and it is
not the same as "impossible" — this app does not overclaim.

Also: the activity picker returns **opaque tokens**. You can shield an app; you
cannot read which app it was or how long was spent in it. Any feature that would
need to name the app the user picked cannot be built.

### The bundle ID

- **Permanent** the moment an App Store Connect record attaches to it, or a build is
  uploaded. Free to change in Xcode before that.
- **Case-sensitive.** It must match character for character across Xcode, the
  registered App ID, the provisioning profile and App Store Connect. A capital that
  differs in one place is a known cause of upload failures.
- Reverse-DNS is conventionally lowercase, mirroring domains. `org.mosseri.nightrise`.

### The listing

`NightRise` on its own is **already taken** in App Store Connect — reserved by
another developer, with the "submit a trademark claim" error. That path needs
trademark rights this project does not have, and waiting for the reservation to
lapse is not a plan: Apple removed the old expiry (90, then 120, then 180 days) and
publishes no policy now.

It does not matter, because the store name and the name under the icon are
**different fields**:

| field | value | unique? |
|---|---|---|
| `CFBundleDisplayName` | **NightRise** | no — this is the one on the home screen |
| App Store Connect name (30) | **NightRise: Lights Out** | yes, globally |
| Subtitle (30) | **A game you win by going to bed** | no |
| Keywords (100) | `bedtime, sleep, wind down, screen time, night routine, doomscroll, evening, focus` | no |

*Lights Out* is the app's own word — the button you hold, the ceremony, the moment
the screen goes away. It also keeps "NightRise" and "Game" from sitting next to each
other, which is the one phrasing that collides with an unrelated Steam title called
*Nightrise*.

**Two words stay out of both fields: "Tracker" and "Habit".** They put this in the
habit-tracker aisle beside Streaks and Habitica — a category this app is explicitly
not in, does not compete in, and would lose in, since it tracks no habits. It does
one night. The subtitle is the second-strongest search field; spend it on what the
app is, not on the category it is nearest to.

The old `NightRise Tracker` draft record can stay where it is. A never-submitted
draft costs nothing and quietly holds a second name.

### Trademark

Class 9 (downloadable software) and Class 42 (SaaS) are clear. One Class 41
registration exists — serial **97083142**, filed 2021-10-20 — but its services are
*"arranging, organizing, conducting and hosting social entertainment events… ticket
reservation and booking"*. A nightlife business, not software. Classes are
administrative; the legal test is likelihood of confusion, which weighs the actual
goods and channels. Its status on Justia reads as of 2021 and looks stale — check
TSDR for the live record before relying on any of this. None of the above is legal
advice.
