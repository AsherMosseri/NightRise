# NightCheck

A night-themed checklist game for getting things done before bed. Build your night out
of sections and tasks, check them off, and watch the moon fill up. Finishing things earns
XP and levels, holds a streak, and pays **stardust** you can spend on skies, companions,
constellations and supplies.

The point is not to organise your evening. It is to **make getting to bed more fun than
scrolling**, so you go earlier — which means the app is measured against a feed, not
against another todo list, and every decision in here is downstream of that. It pays you
for showing up before you have earned anything. It closes its own shop half an hour before
your bedtime. It rewards the gap between two check-offs looking like you went and did the
thing. And when you finish, it takes the screen away instead of handing you back a lit
phone at midnight.

Everything runs in the browser. No accounts, no server, no build step, no dependencies —
your night lives in `localStorage` and can be exported to a JSON file whenever you like.
About 21,000 lines, and all of it ships as written.

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
- **Double-tapping a control does not zoom the page.** This app is a fixed-viewport layer
  cake — the sky canvas is `position: fixed; inset: 0` and the page gradient is
  `background-attachment: fixed`, both sized to the *layout* viewport. iOS keeps
  double-tap-to-zoom on by default, so the instant it zoomed the *visual* viewport in,
  neither covered what you were looking at and the night sky was simply gone behind
  whatever panel was open. `touch-action: manipulation` drops that one gesture. Pinch-zoom
  stays, deliberately: killing zoom outright would take a real accessibility affordance
  from someone reading at 1am.
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
- **The app pays for starting, not only for finishing.** The whole economy used to pay at
  the far end of a task, which for someone who dreads the task puts every bit of the
  reward on the other side of the exact moment they bail. The card leads with **Start it**:
  a small advance, the clock running, and an ask about the next three seconds rather than
  the next fifteen minutes. Nothing is printed — the advance comes off what finishing
  pays, so `+3` up front becomes "+9 XP left on this one" and finishing lands on the same
  total it always did. Starting buys no stardust, does not feed momentum, and does not
  move the percentage, and what it can pay is bounded by the same nightly ceiling as
  everything else. `Done` never gets smaller.
- **What a task pays, before you do it.** The card says `+12 XP` under the title,
  computed with the identical call chain the payment uses, so the promise and the payout
  cannot drift. It is rendered once and left stale on purpose: the multiplier decays with
  wall-clock time, and a number ticking down while you decide is a pressure clock.
- **The clock survives leaving the card.** Press `Later`, glance at the list, background
  the phone — the minutes are still there when you come back, and the card says "4m in
  already". A clock that keeps counting while you are elsewhere is a guilt machine, so
  it stops whenever the app does. But a pause the *app* took is not a pause you asked
  for: leaving for ten seconds used to stop the clock for good, because coming back
  redrew the top bar and never the card. The one it took, it gives back; the one you
  pressed stands.
- **The line about the clock is the clock's.** "Under a minute in already" was assembled
  once when the card rendered and then left standing whatever happened next — so it
  announced itself minutes late, when some unrelated update happened to redraw, and it
  sat there over a clock you had visibly resumed. It repaints four times a second with
  everything else the clock owns.
- **The three buttons under the card never move.** `Later`, `Rain check` and `More`, in
  that order, on every card. `Undo` used to take the `Later` slot for exactly one card
  after a check-off — the two most-used minor actions sharing a pixel on a rotation you
  cannot predict — so reaching for `Later` out of habit un-completed the thing you had
  just finished. Undo is a chip in the header now, away from the row.
- **A timer that refuses to end.** Each card counts down from its own estimate (`T`, or
  automatically if you turn that on in Settings). At zero it does not alarm, block or ask
  to be dismissed — it turns over and counts *up* in a warmer colour. Nothing beeps. The
  message is "this is taking longer than you thought", not "you failed".
- Every task carries a minute estimate that drives the bedtime pacing.

**What a night is worth**
- **The taper.** Adding a task is free and checking it pays, so the economy used
  to price *rows* rather than evenings: the same forty-five minutes of work paid 183 XP
  written as four tasks and 6,440 written as four hundred. That is backwards for an app
  whose whole argument is get off the phone — the highest-yield action in it was sitting
  in it typing rows — and it punished anyone whose list was honest.
- `taskXp` is now a row's **face value** — what the row is worth on its own. What the
  night *pays* for that face runs through one curve: the first 450 XP pays pound for
  pound, which covers a good honest night with headroom, and past that each further pound
  pays a little less than the one before. No wall — a longer list earns more, just never
  proportionally more. The same evening now varies 6.1x across granularities instead of
  35x, and four hundred ten-hour rows at perfect momentum pay 1,439 XP instead of
  4,928,040.
- **And the same rule one level down, for the row.** Bounding the evening does not bound
  the *row*, and the duration field goes to ten hours, so the cheapest way to earn was
  still to type one number: a single 600-minute task paid **765 XP for one tap** — more
  than a genuine eighteen-task night pays for eighteen. The night taper could not catch
  it, because one row of face 1,525 looks exactly like a long honest night from the
  outside. So a row's minutes get their own full-pay band and their own log tail: **the
  first thirty minutes are priced exactly as before**, which is every real task on a
  bedtime list, and past that a longer estimate is still worth more but never
  proportionally more. The ten-hour row is now worth about twice the half-hour one rather
  than twenty times it, and that one tap pays 154. Monotonic, like the night curve and for
  the same reason: raising an estimate can never lower what the task pays.
- **Reversibility is structural, not maintained.** What the profile holds from tonight is
  a pure function of the face tonight holds, so any sequence returning the records to a
  previous shape returns the balance with them — un-tick the third of forty, delete a
  section and undo, reset the checkmarks. Nothing is reconciled by amount or by presence,
  which is the bug class that produced two separate unbounded duplicators.
- The curve is monotonic, so **no tap can ever cost you XP** — the failure that
  disqualified the rival design, where a single checkmark could pay −150.
- **The quest and lights out sit outside the taper** and always pay in full. So at exactly
  the moment a long list stops being worth much, going to bed becomes the best-paying
  thing left, and the card says so: *"+3 XP · tonight has had its fill — lights out still
  pays in full"*. The arithmetic finally agrees with the prose.
- **Stopping early pays the same whether your list was short or long.** Lights out scales
  with how early you stopped and with the *fraction* of your list you did — but it also
  carried a flat `+2 XP` per finished task, left over from the version where that was the
  only scaling and never removed when the fraction replaced it. So three tasks finished
  and ended at ten o'clock earned less for stopping than eighteen did: a per-row payment
  in the one reward deliberately kept free of them, which is the same padding pressure the
  taper exists to remove, in the last place it should be. It is gone. Doing none of your
  list still ends for less than finishing it, and earlier is still better than later.
- **Stardust is slower now, and it has to be.** An eighteen-row night used to pay out
  fast enough to own every sky, every companion and every constellation inside about a
  fortnight — and an app you have finished is an app you stop opening. Task stardust went
  from `xp/5` to `xp/8`, and the three places a reset could mint fresh dust were closed:
  clearing your progress no longer forgets which levels and achievement rungs have already
  been paid for, clearing your stardust no longer forgets what you owe, and clearing your
  unlocks no longer leaves you holding the freezes and rain checks it refunded. **Nobody
  loses savings over it** — the migration multiplies the balance you already had, so a
  jar of dust buys exactly what it bought the day before the change.
- What that buys, simulated through the real action layer rather than estimated — and it
  depends on your list more than on how many rows it has. An eighteen-row night of
  eight-minute tasks pays about **200 stardust early on**, settling to **131**. The same
  eighteen rows totalling twenty-five minutes pays **88 at ×1 momentum and 267 at ×2.5**,
  because a one-minute task is worth 11 XP and 11/8 rounds to one stardust. Short lists
  live at the coarse end of that division, and momentum is what lifts them off it.
- The nights-to-afford figures below are from the eight-minute list, so read them as the
  middle of a range rather than a promise: a companion's last tier on night 3, all twenty
  constellation shapes on night 136, the whole market on **night 234**, everything there
  is on night 981. The market was night 60 before it was filled out.

**The night cycle**
- A night rolls over at **4am**, so anything you tick off at 1am still counts for the
  night before.
- On rollover the night is banked into your history, the checklist resets, and a new
  bonus quest is rolled.
- Hit 60% and your **list streak** grows. Miss a night — including nights you never opened
  the app — and a **Streak Freeze** is spent automatically to cover it, if you have one.
  That streak is about the list and says so: finishing everything at 1am still counts for
  it. Bedtime keeps its own streak, and its own record.

**Getting you off the phone**

These are the parts that exist because the real competitor is not another todo app —
it's the scroll.

- **The envelope.** One good thing happens the moment you open the app, before you've
  earned anything: stardust, a rain check, a head start. Every other reward is downstream
  of doing chores, which does nothing for the night the app stays closed. Tapping it
  unfolds the button into a card and spins a four-cell reel past three things you didn't
  get — see **Motion**, below, for why the three you didn't get are the point.
- **The mat.** Come back after a week away and the first thing on screen is "3 envelopes
  waiting", not a broken streak. A night you skipped used to vanish silently and forever,
  and the app greeted a returning user with a red chip and a reset notice — which is
  exactly the moment you close it and open a feed. Being away is the reason there is
  something to open. Capped at three, paid from the same weight table as any night you
  turned up for (a test opens the same date both ways and asserts the same drop), and
  while anything is still on the mat the streak chip stays quiet. The gift lands before
  the accounting.
- **One sentence about tomorrow, on the last frame.** This app can never notify you —
  see **Known trade-offs** — so the only channel it has is memory and the only moment it
  controls is the one before you put the phone down. The good-night screen names
  tomorrow's quest, and says whether tomorrow's envelope is one of the rare ones without
  naming the prize. Both come off the same seeds the real rolls use, so neither can
  overclaim. No countdown, no second mention when you open: a named prize waiting is an
  obligation, and that is the grammar of the apps this one exists to beat.
- **Permission to stop.** When there is more work left than time left, the Lights out
  button lights up and reads "Call it here · the rest can wait". The app already knew you
  could not finish and its only suggestion was "rain check something?". Never after
  bedtime, where that would be a scolding, and never while the list is still winnable.
- **The nudge is an offer.** "Screens off has slipped 6 nights running" was the one purely
  punitive number here, aimed at exactly the task you dread most, with nothing you could
  do about it. Tap it: do it first tonight, say it takes less, **retire it**, leave it. A
  task that has slipped six nights is usually not a task, it is a monument, and no todo
  app will ever suggest you delete it — so it sits there taxing every glance at the list.
  "Say it takes less" says *you'll be told it takes 7½m, not 15m — the job is the same
  size*, because halving an estimate does not halve the work.
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
- **The streak in the top bar is about the clock, not the list.** It counts **clean
  nights**: everything that counted, finished, and finished before your bedtime. It used
  to count nights you got 60% through a list, which goes up just as happily at 2am — the
  same mistake as pricing rows instead of evenings, in the number people actually watch.
  And when it *was* only about the clock, it was far looser than it sounded: one task of
  eleven carried it, and so did a task merely started and never finished. Now both halves
  have to be true. A rain check takes a task out of "everything", which is exactly what
  rain checks are for and what stops a rule this strict ending your streak on the first
  bad evening. The list streak still exists, as the quiet chip beside the countdown.
- **You do not have to press anything.** Pressing Lights out counts, and so does simply
  finishing before your bedtime and closing the app — inferred at 4am from your last
  check-off, or the last task you started on a night where nothing got finished. A night
  nobody opened is not a clean night, and getting that right meant *not* reading
  `night.startedAt`, which sounds like when you started but is when the night record was
  made, at the 4am rollover. It is there on every night including untouched ones, and 4am
  is before any bedtime, so it would have handed the streak a night for every day the app
  sat unopened.
- **A Streak Freeze covers the streak it says it covers.** It guards the clean-night
  streak — all or nothing, enough to cover every missed night or none are spent, because
  half-covering a gap burns the tokens and loses the streak anyway.
- XP with a level curve and eight titles, from Dreamer upward. You can see the level each
  one arrives at but never what it is called until you get there — a list of every name you
  will ever be given is a list of endings, and the reveal is the reward.
- A nightly bonus quest, seeded by the date so it never rerolls on you.
- **Achievements that level up.** Nine families — nights banked, list streak, nights on
  time, nights cleared, level, momentum, unlocks, constellations, companion — each with
  three to five rungs and a progress bar. They were thirteen separate on/off badges, so
  "Turned In" for one night on time and "Clockwork" for three sat side by side as though
  they were unrelated things; now they are the first two rungs of one ladder, and the
  card tells you it is 3 of 7 rather than that you have 4 of 13 badges. Every family is
  a *number*, and each tier's wording is generated from the very threshold it compares
  against, so a hint cannot come to say seven while the check says three. You see the
  next rung's requirement but never its name — same as the titles. Reaching one pays
  stardust, once per rung, ever.
- **A rung comes off only if you can undo the thing that earned it with a tap.** Exactly
  two families can: the level you dropped back out of, and tonight's cleared list you
  un-ticked. Every other one is a record or a running total that can only fall through a
  deliberate reset — and a reset must never be what quietly takes a rung, because it has
  its own checkbox. So tonight's clear is on loan until 4am banks it, and once banked it
  survives anything you do to tonight, to the history, or to the streak.
  Nothing in the game rewards being awake late: there was
  a badge for checking something off past 1am, in the app whose whole argument is that
  you should be asleep, and it is gone.
- Un-checking a task reverses its exact award, and if that drops you below a level it
  takes the level with it: the level-up stardust goes back and the level tier comes off
  again. The completion bonus is banked so it can be paid once and taken back precisely,
  and every achievement tier's stardust is paid against a high-water mark, so falling out
  of one and climbing back is not a way to print it.
  Nothing you can un-tick leaves you holding what it paid for.

**Spending stardust**
- **Skies** — twelve of them, from Midnight through Harbour, Hollow, Dunes, Thunderhead,
  Paper Lantern and Abyss. Each restyles the whole app *and* the live canvas sky: the
  canvas reads seven of a sky's twenty-six custom properties back out through
  `getComputedStyle`, so a sky that forgot one would not throw, it would inherit — and
  you would get the previous sky's moon hanging in the new one's gradient. A test parses
  the stylesheet and holds every sky to the whole contract, to its own swatch, and to
  4.5:1 for body *and* secondary text. Secondary too, rather than taking the large-text
  exemption, because "47m of tasks left" is small and it is 11pm.
- **Weather** — rain, snow, a firefly field and northern lights, drawn as one particle
  layer over the sky. Every sky used to be only a recolour, so two of them differed in
  hue and nothing else; weather is what makes them differ in *motion*. A Meteor Shower was
  cut from this shelf for selling something the app already does for free — an ambient
  shooting star fires every 22 to 67 seconds on its own.
- **Moons** — the one focal object on the screen, and it fills with tonight's completion,
  so every skin is checked for luminance separation between its lit and unlit halves. The
  narrowest is 7.9:1. Their lore is real: the Harvest Moon is the full moon nearest the
  autumn equinox, and a genuinely blue moon is what smoke from a very large fire does.
- **Marks** — the glyph that lands in the box when you check something off, which is the
  single most-seen graphic here. Measured with `getBBox` and a 200-sample path centroid,
  not estimated, so each one inherits the same optical centring as every interface icon.
- **Envelopes** — skins for the nightly ceremony, the one reward opened every single
  night. Dark paper and a light hand, because a bright rectangle at 11pm is the opposite
  of the point, and the ink is checked against the note it sits on rather than the paper.
- **Companions** — eight now: owl, cat, fox, bat, hare, hedgehog, moth and raccoon. Each
  lives in the corner, reacts to your progress, and evolves through four tiers as you feed
  it.
- **Star map** — light constellations one star at a time. Finish one and it is drawn
  permanently into your night sky. Twenty real figures, from Ursa Minor's little dipper to
  Scorpius' hook, each one placed where it actually sits and joined along the lines people
  actually draw. They are ordered by price so the map ramps: Delphinus and Corona Borealis
  are small and early, Perseus and Scorpius are large and late. Ursa Minor is yours on the
  first night; all twenty shapes are 152 stars and 23,342 dust, which lands around
  **night 136**.
- **And then the faint stars.** A finished constellation used to be finished, which made
  the whole map a thing you could run out of. Now every figure keeps going: past its last
  bright star the button offers **a fainter star**, drawn smaller and dimmer and left
  unjoined, filling in the real sky around the shape you already own. 229 of them across
  the twenty, on the same escalating curve, which is 87,691 more dust: the whole map, both
  tiers, is **night 713**. Not endless — when a figure's last faint star is lit its button
  goes quiet rather than inventing more, because an invented star beside Cassiopeia reads
  as the real content having run out. Just long enough that it is never the reason you
  stop opening the app.
- **Sounds, trails and type** — seven synthesised sound packs (nothing is downloaded; a
  kalimba, a low temple bell for when somebody else in the room is asleep, and a pulse
  that is barely a note), seven trails, and six typefaces. Type stops at six on purpose:
  there are only so many genuinely distinct faces already installed on a phone, and a web
  font would break working offline.
- **Supplies** — Streak Freezes, Rain Checks, and two that act on tonight rather than
  becoming something you hold: a **Head Start** begins the evening at ×1.5 momentum, and a
  **Second Wind** trades tonight's bonus quest for a different one, once a night and never
  after you have claimed it. Deliberately *not* sold: anything that extends the curfew.
  That would be selling you the right to be on your phone at bedtime.
- **What is in there:** 53 things to buy across ten shelves — twelve skies, eight
  companions, seven sound packs, seven trails, six typefaces, six moons, five weather
  layers, five marks, five envelopes and four supplies. It was 18 across five shelves, and
  bought out on night 60.
- **Level gates that actually gate.** Anything over 600 stardust asks for a level as well
  as the price, and the level is *derived from the price* rather than typed on each item —
  because typed numbers drift away from a curve nobody re-measures, which is exactly what
  had happened. Eleven hand-written gates had become nine that never once bound: level 13
  arrives on night 17 and the level-13 sky takes thirteen nights to save for, so the card
  said "Reach level 13" about a barrier that was never the barrier. The bands are set
  against the measured curve, so every gate now opens **two to nine nights after** you
  could first have afforded the thing. Nothing under 600 is gated: early on the market
  should be something you can reach into, not a wall of locks.
- Every shelf reads cheapest first — three of them had drifted out of order simply by
  having new entries appended, so Skies read 400, 700, 920, 1150, 1550, 620, 840.
- **A price you cannot meet is information, not a dead call to action.** All four spend
  buttons — the market, the supplies shelf, the feed button, the star map — were typed out
  by hand and all four stayed `btn--primary` while disabled: a full accent gradient
  carrying near-black label text, dimmed to 45%. Measured as painted, across all twelve
  skies, that was **1.02–1.43:1** — the label telling you *why* you could not buy the thing
  was the least readable pixel on the card and simultaneously the loudest, on nearly every
  card at once, because you cannot afford most of a 24,000-stardust market on most nights.
  One helper builds all four now, and the unaffordable state is its own quiet style:
  **6.4–7.5:1**, sleep-safe mode included. The supplies shelf also said its shortfall only
  in a `title`, which a phone has no way to show — so the button read "Buy" and did nothing.

**The rest**
- A live canvas sky: parallax twinkling stars that drift on their own, a shooting star on
  every check-off but the last — that one gets the finale instead — and a moon whose phase
  fills with tonight's completion.
- **The sky keeps the record.** One star, permanently, for every night you went to bed on
  time. Not bought — earned by sleeping, and the only thing here that grows forever. Each
  is placed from a seed derived from its night key, so the sky you built is the same one
  on every device. The good-night screen used to paint a flat black sheet over the canvas;
  it is a vignette now, so the last thing you see is your own sky rather than a receipt on
  a black rectangle. Insights counts them in words too.
- Bedtime target with a countdown and an on-pace / cutting-it-close / over-budget read.
- Night history as a heatmap, plus per-task insight — which tasks you actually do, and
  which have quietly slipped six nights running. Its stats say which thing they count:
  **every task done** is nights you cleared the list, sitting beside **to bed on time**,
  which is the clock. It used to be called "perfect nights", one tile away from a bedtime
  number, and read like a second one.
- **A bedtime record, kept separately from the chores.** Every night you end with Lights
  out is stamped with the time and with the target as it stood that night, so changing
  your bedtime later cannot rewrite whether you made it. Insights shows the on-time
  streak, the on-time rate, your average bedtime this week **against the week before** —
  the only one of those numbers that answers "am I getting better" — plus earliest and
  latest, and three weeks of nights charted against your target line: green if it beat the
  target in force *that* night, red if it did not, faint dots for nights nobody ended. Each
  stem hangs from the target that night was judged against, with a small tick marking it
  whenever that is not where today's dashed line sits — so moving your bedtime shows up as
  a moved tick rather than quietly recolouring the past. Averaging clock times is done
  in minutes from noon, so 11:50pm and 12:10am are twenty minutes apart rather than 1420.
- **Sleep-safe dim mode** — warm and dark, not sepia. It used to run `sepia(0.35)` over
  everything, and sepia does not warm a colour, it *replaces* it: the whole app collapsed
  onto one brown ramp and a deep blue night came out looking like a muddy tan photograph,
  with the panels above the veil washing out to grey. What matters at 1am is less blue
  light and less light, and both of those are brightness and a warm overlay. Hue is left
  alone now, so a Frost night still reads as Frost.
- Dim reaches the dialogs and sheets too, with the same numbers as the veil — they have to
  match exactly or the two halves of the screen dim differently. Sound effects (muted by
  default), full keyboard control, and `prefers-reduced-motion` support throughout.
- **Reset what you actually mean.** Settings asks which of eight things should go —
  tonight's checkmarks, the task list, history, level and XP, streaks, stardust, unlocks,
  settings — and then confirms exactly those. They are separate because the reasons are:
  wanting to start the streak count again is not wanting to lose your level, and clearing
  a stardust balance is not giving back the skies you bought with it. Clearing tonight's
  checkmarks hands back the XP and stardust they paid, so it is not a way to farm the same
  night twice.
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

## Motion

Two set-pieces and a lot of small things. The governing rule is that **this app exists to
get you to bed earlier**, so nothing may ask you to sit through it: no ceremony here uses a
scrim, an overlay, or changes `pointer-events` on anything. There is nothing to dismiss.

**The envelope.** The sealed button you tap unfolds into a card in the middle of the screen
— an inverted FLIP, so the card is built at its final size and pushed back into the
button's footprint and is genuinely squashed flat rather than appearing over it. The flap
swings back, and a four-cell reel spins past three drops you didn't get and stops on the
one you did. 860ms, legible at 460, and the tap that ends it is not consumed, so it also
lands on whatever it hit.

The reel is what has to survive night 40. Its decoys are seeded from the night key — so a
reload replays the identical spin, the same rule the drop itself follows — and they are
*ordered*, not shuffled: win something common and the last cell before the landing is the
rarest thing you missed; win something rare and the last cell is common, so the landing
reads as an upgrade. Same shape every night, different contents. Six lines, and it is the
difference between a reveal you watch once and one that still works in a month.

**Finishing the list.** A line of light travels from the checkbox you just tapped up to the
moon, drawn head-first along a curve with a dash offset. The moon sweeps closed and blooms
— the glow gradient it already draws every frame, widened and brightened, so the bloom
costs nothing. The star field brightens in a wave that reaches nearer stars first, so it
reads as something spreading from the moon rather than the screen flashing. Then the Lights
out button scrolls into reach and a light sweeps across it.

That last beat is the argument. Finishing your list used to hand you a fully lit,
fully interactive phone at 11:40pm, which is the exact shape of the thing NightCheck
exists to beat. A nightly ceremony is only survivable if it makes the session *shorter*, so
this one ends by pointing at the exit. And everything it announces is permanent — the full
moon, the sealed dial, the lit button are all still there afterwards — so you can blink and
miss it and lose nothing. That is the opposite of a toast, which punishes you for looking
away.

**And the small things**, which matter more in aggregate: the box you tick pops and draws a
line across the task; the completion dial's arc travels and its percentage counts; stardust
flies from your thumb to the counter it changed; the XP bar fills to the top and restarts
from empty on a level-up instead of sliding backwards; rows slide when the list changes
shape instead of teleporting; panels close in 170ms instead of vanishing.

**Reduced motion is a branch in JavaScript, not only in CSS.** `base.css` crushes
`animation-duration` under `[data-motion="off"]`, and that rule does not reach the Web
Animations API at all — so a WAAPI ceremony would have played at full speed for exactly the
people who asked it not to. Every entry point checks first, and the still forms are not
shortened animations but permanent state changes: the moon simply stays brighter, the card
is replaced by the sentence it would have shown you.

## Keyboard

| Key | Does |
| --- | --- |
| `Space` | Check off the focused task |
| `↑` `↓` | Move between tasks |
| `Alt + ↑/↓` | Move the focused task or section |
| `E` | Rename the focused task or section |
| `Delete` | Delete it (with undo) |
| `X` | Rain-check the focused task |
| `N` / `/` | Jump to quick add |
| `S` | Add a section |
| `F` | One task at a time |
| `→` / `T` | In one-at-a-time: leave for later / start or pause the timer |
| `B` `G` `H` `I` `,` | Night Market, star map, history, insights, settings |
| `M` / `D` | Mute sounds / sleep-safe dim |
| `?` | The full list |
| `Esc` | Close a dialog or cancel an edit |

Quick add understands `Floss #wind-down !2` — title, section, minutes — and `!30s` or
`!7.5` for odd durations. A `#hint` matches a section in any script, so `#ערב` and
`#تنظيف` work as well as `#wind-down`.

Single-key shortcuts can be turned off in Settings (WCAG 2.1.4 asks for a way out, and a
letter that opens a panel is easy to hit by accident on a focused row). `Esc` always works
either way.

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

**240 tests, 14 suites, zero dependencies**, on Node's built-in runner. No install step:

```bash
node --test "tests/*.test.js"
```

They cover the pure modules — everything that can be reasoned about without a browser:

| Suite | What it pins down |
| --- | --- |
| `night` `time` | the 4am boundary, rollover, banking, streaks, freezes, forward-only clock handling |
| `game` `economy` | the XP curve, levels, momentum, and every way a reward could be paid twice |
| `achievements` | tiers, what a rung is worth, and what can take one back |
| `quests` `bedtime` `bedtimestats` | quest predicates, the envelope, the bedtime record and its averages |
| `reset` `storage` | what each reset part clears, migration, and old saves |
| `duration` `timer` `insights` `interaction` | half-minute estimates, the card clock, the history stats, quick-add parsing |

Several exist because of a specific bug and say so in the test name — `a rain check is not
a task you did`, `Clockwork needs three nights that really were consecutive`, `checking
everything and resetting on a loop earns nothing after the first`, `starting then
finishing pays exactly what finishing alone paid`, `a week away hands you three
envelopes, not seven`, `stopping early with an untouched list is not the best move in the
game`, `every ladder can actually be climbed to the top`. Two are guards on
language rather than logic: no two things you can earn may share a name, and no achievement
outside the on-time family may be *named* as though it measures sleep.

Anything that needs a real browser — the ceremonies, the canvas, layout, focus — is
verified by driving Chromium directly rather than mocked.

The PWA icons are generated from the same design as `assets/icon.svg` by a small
dependency-free rasteriser:

```bash
node tools/make-icons.mjs
```

## Layout

About 21,000 lines: 12,800 of application JavaScript, 4,700 of tests, 3,200 of CSS, and
the rest markup, the service worker and one icon generator. Nothing is generated, bundled
or installed.

```
index.html               app shell — every host element the renderers write into
sw.js                    cache-first service worker, versioned cache
css/                     base tokens · themes (6 skies + dim) · layout · components

js/main.js               bootstrap and wiring only — events to effects, nothing else
js/state.js              the single store: getState / update / subscribe / emit
js/actions.js            every mutation the UI can perform
js/storage.js            debounced localStorage, schema normalise, migrate, export/import
js/model.js              factories and the starter night

js/night.js              night keys, the 4am boundary, banking, streaks, freezes
js/time.js               bedtime countdown and pacing
js/game.js               XP curve, levels, titles, momentum, stardust
js/achievements.js       tiered achievement families, measured off live numbers
js/quests.js             the nightly bonus quest and its predicates
js/envelope.js           the unconditional nightly reward and its drop table
js/reset.js              what each part of "reset" actually clears
js/timer.js              the card clock: countdown, overtime, pause
js/bedtime.js            the bedtime record: averages, trend, on-time rate
js/insights.js           per-task stats and the history numbers
js/shop.js               catalog, purchase, equip, consumables
js/constellations.js     the star map and its per-star economy
js/skins.js              every cosmetic catalog, as data and nothing else
js/companion.js          the companion, its moods and evolution tiers

js/sky.js                the canvas: stars, moon, meteors, particles, ribbons, rings
js/audio.js              WebAudio chimes and sound packs (muted by default)
js/dnd.js  js/keys.js    drag/keyboard reorder · shortcuts and quick-add parsing
js/dom.js  js/util.js    element builders, the icon set, small pure helpers
js/optical.js            measures the loaded font and publishes --icon-nudge
js/updates.js            keeps an installed copy from booting last week's build
js/toast.js              the toast/celebrate queue

js/render/motion.js         reduced-motion branch, bar transitions, counters, flight
js/render/envelope-open.js  the envelope ceremony and its reel
js/render/finale.js         the all-tasks-done set-piece
js/render/checklist.js      the list, inline edit, FLIP, check-off animation
js/render/header.js         stats, the dial, tonight panel, companion, lights out
js/render/modals.js         market, star map, history, insights, settings, help
js/render/cards.js          One Card mode
js/render/goodnight.js      the ending and the fade to black
js/render/sheet.js          the phone bottom sheet
js/render/confirm.js        the app's own confirm and chooser dialogs
js/render/add-task.js       the three-tap add flow and the number pad

tests/                   17 suites, node --test, no dependencies
tools/make-icons.mjs     PWA icon generator
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

Three consequences of that shape are worth knowing before changing anything:

- **Renders are wholesale.** A panel is rebuilt, not patched. So a CSS transition on a
  freshly-built node has no previous value to travel from and silently does nothing —
  which is why four declared transitions in this app had never once run. `js/render/motion.js`
  remembers the last value *by key* and hands it back for one frame.
- **Actions notify synchronously.** The button you just tapped is usually gone by the next
  statement. Anything that must outlive its origin measures a rect first and animates on a
  body-level layer.
- **A persistent class belongs on the host, never on a child.** `#tonight` and `#nightend`
  survive; everything inside them does not.

The whole project has one recurring failure mode, and most of the interesting commits are
instances of it: **copy that claims more than the code measures.** A quest called "Front
Loaded" that described a deadline but counted only completions. A "night streak" that
implied bedtime and counted the list. "Perfect nights" sitting one tile from "to bed on
time" while counting neither. A badge for being awake past 1am, in an app about sleeping.
Each was fixed at the measurement rather than the wording, and left behind a test. It is
why achievement hints are *generated from the same number the check compares against* — a
hint physically cannot drift into saying seven while the code says three.

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
- The canvas sits behind the panels, which are translucent and blurred. The sky is fully
  visible at the edges and in the gaps, and the moon is placed clear of the top bar, but a
  set-piece down in the middle of the screen would be watched through frosted glass. That
  is why the finale happens *at* the moon and the envelope happens in the DOM.
- Reduced motion loses the ceremonies entirely rather than getting gentle versions of them.
  An arc and a 3D flip have no honest "calm" form; the still mode gives you the same
  information as a state change and a sentence instead.
- The nightly quest and the envelope are seeded by the date, so they cannot be rerolled —
  which also means a night you dislike is a night you are stuck with.
