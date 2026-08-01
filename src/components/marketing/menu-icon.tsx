/**
 * The menu toggle's three lines, folding into a cross.
 *
 * An SVG rather than swapping a Menu icon for an X icon, because swapping two
 * glyphs is a cut and this is a movement: the same three strokes travel to a
 * new position, so the button reads as one control changing state rather than
 * two controls sharing a spot. The outer pair rotate into the cross while the
 * middle one retracts into the centre and goes; on the way back out it draws
 * itself again from nothing.
 *
 * All of the motion is CSS, in site-theme.css under `.menu-icon` - there is no
 * JavaScript in the animation and nothing to hydrate. With `prefers-reduced-
 * motion` set, the lines jump between the two positions instead.
 *
 * The viewBox is 24 wide with the strokes inset to 4/20 so the cross has room
 * to rotate inside its own box without clipping.
 */
export function MenuIcon({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      focusable="false"
      data-open={open}
      className={`menu-icon ${className}`}
    >
      <line className="m-top" x1="4" y1="7" x2="20" y2="7" />
      <line className="m-mid" x1="4" y1="12" x2="20" y2="12" />
      <line className="m-bot" x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}
