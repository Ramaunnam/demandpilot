/**
 * Branding: the real JoulesToWatts wordmark, and a drawn fallback mark.
 *
 * `Wordmark` is the supplied PNG. It is a wide lockup (400 x 194, roughly 2:1)
 * built for light backgrounds, so it needs two accommodations:
 *
 *  - **Dark mode gets a light plate behind it.** Measured against the dark
 *    surface the red runs 2.50:1 and the grey 2.70:1, both well under readable;
 *    on white they are 6.78:1 and 6.29:1. The fix is to give the logo the
 *    background it was drawn for, not to recolour someone's brand mark.
 *  - **It is never used below about 24px tall.** The "Time Matters" tagline is
 *    under a tenth of the image height, so it stops being type and starts being
 *    texture. Anywhere narrower than the lockup — the 52px collapsed rail, the
 *    browser tab — uses `Mark` instead, which is the usual full-lockup-versus-
 *    icon split rather than a second brand.
 */
import logo from '@/assets/j2w-logo.png'

export function Wordmark({ height = 26, className = '' }: { height?: number; className?: string }) {
  return (
    <span
      // The padding is unconditional and only the plate is themed: making the
      // padding dark-only changed the element's width on a theme toggle, which
      // nudged everything beside it.
      className={`inline-grid place-items-center shrink-0 rounded-md px-1.5 py-1 dark:bg-white/95 ${className}`}
    >
      <img
        src={logo}
        alt="JoulesToWatts"
        style={{ height, width: 'auto' }}
        className="block select-none"
        draggable={false}
      />
    </span>
  )
}

/**
 * The drawn mark, for anywhere the lockup cannot fit. Takes the house colour
 * from the same token every chip and button reads, so it follows light and dark
 * without a second copy.
 */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="J2W"
      title="JoulesToWatts"
      className="shrink-0 grid place-items-center rounded-lg bg-primary text-primary-fg
                 font-extrabold leading-none tracking-[-.05em] select-none"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      J2W
    </span>
  )
}

/**
 * Sidebar brand. `compact` is the collapsed rail, where the lockup has nowhere
 * to go and the drawn mark stands in for it.
 */
export default function Logo({ compact }: { compact?: boolean }) {
  if (compact) return <Mark size={28} />
  return (
    <span className="flex items-center gap-2 min-w-0">
      <Wordmark height={24} />
      <span className="w-px h-6 bg-line shrink-0" aria-hidden />
      <span className="text-base font-bold truncate">DemandPilot</span>
    </span>
  )
}
