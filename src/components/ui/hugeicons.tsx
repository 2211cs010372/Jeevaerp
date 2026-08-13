/**
 * THE PUBLIC SITE'S ICON SET - HugeIcons, wearing lucide's shape.
 *
 * The marketing pages imported ~30 icons straight from `lucide-react` and used
 * them as plain components: `<Phone className="size-4" />`, and in a few places
 * passed by reference into a data array (`{ icon: Bed }`). HugeIcons ships a
 * different shape - one `<HugeiconsIcon icon={…} />` component fed a glyph - so
 * a direct swap would have meant rewriting 90 call sites by hand across 25
 * files, for no change in what anybody sees.
 *
 * So the vendor difference is absorbed HERE instead. Each export below is a
 * component with lucide's own name and lucide's own props, drawn by HugeIcons.
 * Every page changes by exactly one line: the module it imports from. Ninety
 * chances to mistype a prop become zero.
 *
 * The portal set is separate on purpose (components/portal/ui/icons.tsx). It
 * addresses icons by MEANING ("rupee") because it owns its own vocabulary; this
 * file keeps lucide's vocabulary because 25 marketing files already speak it,
 * and renaming their icons is a different job from changing who draws them.
 *
 * Props pass straight through, so `className`, `strokeWidth`, `aria-hidden` and
 * the rest behave as they did. `size` is left at HugeIcons' default rather than
 * pinned: the marketing pages size their icons with Tailwind classes, and a
 * width attribute here would win over `size-4` and silently shrink them.
 */

import { HugeiconsIcon, type HugeiconsProps } from "@hugeicons/react";
import {
  Activity01Icon, ArrowLeft01Icon, ArrowRight01Icon, ArrowUpRight01Icon,
  BedIcon, Calendar01Icon, CalendarCheckIcon, Tick02Icon, CheckmarkCircle02Icon,
  ArrowDown01Icon, Clock01Icon, ArrowTurnBackwardIcon, Download01Icon, EyeIcon,
  File01Icon, TestTube01Icon, FolderOpenIcon, GraduationCapIcon, Loading01Icon,
  Logout01Icon, Mail01Icon, Location01Icon, TelephoneIcon, CallOutgoing01Icon,
  PlusSignIcon, QuoteDownIcon, Invoice01Icon, Search01Icon, StethoscopeIcon,
  UserIcon, Restaurant01Icon, Alert02Icon, PulseRectangle01Icon, SecurityCheckIcon,
} from "@hugeicons/core-free-icons";

type Props = Omit<HugeiconsProps, "icon">;

/** One glyph, wrapped as a component under the name the pages already use. */
const as = (icon: typeof Activity01Icon) => {
  const C = (props: Props) => <HugeiconsIcon icon={icon} {...props} />;
  return C;
};

export const Activity = as(Activity01Icon);
export const ArrowLeft = as(ArrowLeft01Icon);
export const ArrowRight = as(ArrowRight01Icon);
export const ArrowUpRight = as(ArrowUpRight01Icon);
export const Bed = as(BedIcon);
export const Calendar = as(Calendar01Icon);
export const CalendarCheck = as(CalendarCheckIcon);
export const Check = as(Tick02Icon);
export const CheckCircle2 = as(CheckmarkCircle02Icon);
export const ChevronDown = as(ArrowDown01Icon);
export const Clock = as(Clock01Icon);
/** The return-key arrow beside a search box - "press enter". */
export const CornerDownLeft = as(ArrowTurnBackwardIcon);
export const Download = as(Download01Icon);
export const Eye = as(EyeIcon);
export const FileText = as(File01Icon);
export const FlaskConical = as(TestTube01Icon);
export const FolderOpen = as(FolderOpenIcon);
export const GraduationCap = as(GraduationCapIcon);
/** Spun by the caller's `animate-spin`, exactly as lucide's was. */
export const Loader2 = as(Loading01Icon);
export const LogOut = as(Logout01Icon);
export const Mail = as(Mail01Icon);
export const MapPin = as(Location01Icon);
export const Phone = as(TelephoneIcon);
export const PhoneCall = as(CallOutgoing01Icon);
export const Plus = as(PlusSignIcon);
export const Quote = as(QuoteDownIcon);
export const Receipt = as(Invoice01Icon);
export const Search = as(Search01Icon);
export const Stethoscope = as(StethoscopeIcon);
export const User = as(UserIcon);
export const Utensils = as(Restaurant01Icon);
export const AlertTriangle = as(Alert02Icon);
/** The care pages' vitals motif - a trace on a monitor, not an anatomical heart. */
export const HeartPulse = as(PulseRectangle01Icon);
/** "Checked and safe" - HugeIcons draws this as a ticked security mark. */
export const ShieldCheck = as(SecurityCheckIcon);
