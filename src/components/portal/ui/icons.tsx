/**
 * THE PORTAL ICON SET - HugeIcons behind the same door.
 *
 * The glyphs used to be hand-drawn SVG paths in this file. They are now
 * HugeIcons (@hugeicons/core-free-icons, MIT), but the component's contract has
 * not moved a millimetre: `<Icon name="rupee" size={15} />` renders what it
 * always did, so the 431 call sites across 78 files did not change and cannot
 * drift. Swapping icon sets again later is this file and nothing else.
 *
 * WHY THE NAMES STAYED SEMANTIC. Call sites ask for "rupee", not for
 * `RupeeIcon` - they name the MEANING, and the map below is the only place that
 * knows which drawing carries it. A screen that imported the vendor's symbol
 * directly would have to be edited the day the vendor renames it, and nav.ts
 * would be storing a third party's identifier in what is otherwise our own
 * routing table.
 *
 * STROKE WIDTH IS 1.8, NOT THE LIBRARY DEFAULT OF 1.5. The portal chrome was
 * drawn around the heavier stroke - at the 15px the topbar renders these at,
 * 1.5 reads as grey rather than as a line. Kept deliberately; change it here and
 * every icon in every portal changes together, which is the point.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardSquare01Icon, UserMultipleIcon, Calendar01Icon, StethoscopeIcon,
  Building02Icon, PillIcon, TestTube01Icon, Invoice01Icon, RupeeIcon,
  TradeUpIcon, BedIcon, Search01Icon, PlusSignIcon, Tick02Icon, Logout01Icon,
  ArrowRight01Icon, Activity01Icon, Clock01Icon, Alert02Icon, File01Icon,
  PrinterIcon, Shield01Icon, TruckIcon, Package01Icon, InboxIcon,
  ArrowTurnBackwardIcon, Cancel01Icon, Settings01Icon, PaintBoardIcon,
  ArrowUpRight01Icon,
} from "@hugeicons/core-free-icons";

export type IconName =
  | "grid" | "users" | "calendar" | "stethoscope" | "building" | "pill"
  | "flask" | "receipt" | "rupee" | "trend" | "bed" | "search" | "plus"
  | "check" | "logout" | "chevron" | "activity" | "clock" | "alert" | "file" | "printer" | "shield"
  | "truck" | "box" | "inbox" | "undo" | "x" | "settings" | "palette"
  | "external";

/** Meaning -> drawing. The only place the vendor's names appear. */
const glyphs: Record<IconName, typeof DashboardSquare01Icon> = {
  grid: DashboardSquare01Icon,
  users: UserMultipleIcon,
  calendar: Calendar01Icon,
  stethoscope: StethoscopeIcon,
  building: Building02Icon,
  pill: PillIcon,
  flask: TestTube01Icon,
  receipt: Invoice01Icon,
  rupee: RupeeIcon,
  trend: TradeUpIcon,
  bed: BedIcon,
  search: Search01Icon,
  plus: PlusSignIcon,
  check: Tick02Icon,
  logout: Logout01Icon,
  /* Points right. Rotated by callers that need it pointing elsewhere. */
  chevron: ArrowRight01Icon,
  activity: Activity01Icon,
  clock: Clock01Icon,
  alert: Alert02Icon,
  file: File01Icon,
  printer: PrinterIcon,
  shield: Shield01Icon,
  /* the distributor's van - procurement's one recognisable object */
  truck: TruckIcon,
  /* a carton: what a goods receipt is counting */
  box: Package01Icon,
  inbox: InboxIcon,
  /* stock going back the way it came */
  undo: ArrowTurnBackwardIcon,
  x: Cancel01Icon,
  settings: Settings01Icon,
  /* the swatch - appearance */
  palette: PaintBoardIcon,
  /* leaves this page - a link that opens somewhere else */
  external: ArrowUpRight01Icon,
};

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <HugeiconsIcon
      icon={glyphs[name]}
      size={size}
      color="currentColor"
      strokeWidth={1.8}
      className={className}
      aria-hidden
    />
  );
}
