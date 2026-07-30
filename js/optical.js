/* Where a label actually looks centred.
 *
 * `align-items: center` centres a label's *line box* — a box sized by the
 * font's ascent and descent, which reserve room for accents above and tails
 * below. Almost no label uses that room, so the letters you can actually see
 * sit high inside it, and an icon centred beside them reads as low. Measured on
 * the "+ Add it" button: the icon's centre sat 1.2px under the label's cap
 * box — small, and impossible to un-see once noticed.
 *
 * The correction is a font property, not a number we can pick: it depends on
 * the ascent, descent and cap height of whatever the device actually loaded,
 * which for a `system-ui` stack is a different face on every platform. So we
 * measure it here, once, in the browser that has the font, and hand CSS the
 * answer as `--icon-nudge`.
 */

/**
 * Cap height comes from a large sample, where a half-pixel of raster error is
 * a rounding error in em. The baseline offset has to come from the sizes we
 * actually ship at: the engine rounds a font's ascent and descent to whole
 * pixels before it lays out a line, so the offset is not quite proportional to
 * the font size. Sampling three real label sizes smooths that sawtooth.
 */
const CAP_SIZE = 400;
const PROBE_SIZES = [12.5, 14, 15.5];
/** Past this, something is wrong with the measurement — leave icons alone. */
const SANE_LIMIT = 0.2;

let lastKey = null;

/** How far the cap-height centre of a label sits from the flex cross centre. */
function driftAt(size, capEm, cs) {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;'
    + `display:flex;align-items:center;font-family:${cs.fontFamily};`
    + `font-weight:${cs.fontWeight};font-size:${size}px;line-height:1.5;`;

  // Stands in for an icon: a block of known height, centred like the real one.
  const box = document.createElement('span');
  box.style.cssText = 'display:block;width:2px;height:16px';

  const label = document.createElement('span');
  label.textContent = 'Hxpg';
  // A zero-height inline-block sits its bottom edge exactly on the baseline.
  // It has to live *inside* the label: as a flex child it would be centred
  // like any other item and tell us nothing.
  const marker = document.createElement('span');
  marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  label.appendChild(marker);

  probe.append(box, label);
  document.body.appendChild(probe);
  const boxRect = box.getBoundingClientRect();
  const baseline = marker.getBoundingClientRect().bottom;
  probe.remove();

  // Where the eye reads the middle of a line of text: halfway up the capital.
  const capCentre = baseline - (capEm * size) / 2;
  const iconCentre = boxRect.top + boxRect.height / 2;
  return (capCentre - iconCentre) / size;
}

function measure() {
  const cs = getComputedStyle(document.body);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontWeight} ${CAP_SIZE}px ${cs.fontFamily}`;
  const cap = ctx.measureText('H').actualBoundingBoxAscent;
  if (!Number.isFinite(cap) || !cap) return 0;
  const capEm = cap / CAP_SIZE;

  const samples = PROBE_SIZES.map((size) => driftAt(size, capEm, cs));
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/**
 * Measure and publish `--icon-nudge`. Cheap, but not free (it lays out a
 * probe), so it only re-runs when the thing it depends on — the font — changes.
 */
export function applyOpticalNudge() {
  const cs = getComputedStyle(document.body);
  const key = `${cs.fontFamily}|${cs.fontWeight}`;
  if (key === lastKey) return;
  lastKey = key;

  let em = 0;
  try {
    em = measure();
  } catch {
    em = 0;
  }
  if (!Number.isFinite(em) || Math.abs(em) > SANE_LIMIT) em = 0;
  document.documentElement.style.setProperty('--icon-nudge', `${em.toFixed(4)}em`);
}

export function initOptical() {
  applyOpticalNudge();
  // Web fonts and the font-pack setting both change the answer.
  if (document.fonts?.ready) document.fonts.ready.then(() => { lastKey = null; applyOpticalNudge(); });
}
