import { Hero } from "@/components/marketing/hero";
import { Ticker } from "@/components/marketing/ticker";
import { ActionBar } from "@/components/marketing/action-bar";
import { Trust } from "@/components/marketing/trust";
import { SpecializedDoctors } from "@/components/marketing/specialized-doctors";
import { Specialities } from "@/components/marketing/specialities";
import { FirstVisit } from "@/components/marketing/first-visit";
import { InsideHospital } from "@/components/marketing/inside-hospital";
import { Stories } from "@/components/marketing/stories";
import { Visit } from "@/components/marketing/visit";
import { Faq } from "@/components/marketing/faq";
import { EmergencyBand } from "@/components/marketing/emergency";
import { hospitalJsonLd } from "@/lib/site";

/**
 * The homepage, as eight numbered posters.
 *
 * One voice from top to bottom - plain white, 1.5rem edges, Instrument Serif
 * headlines over Montserrat, nothing bold - and one shape: every chapter opens
 * on the same intro (poster-intro.tsx) and its cards are 4:5. Seen on an iPad,
 * each chapter is a portrait poster; any card cropped out of a screenshot is an
 * Instagram post as it stands.
 *
 *   Hero        the building, the promise, the emergency number
 *   Marquee     the departments, in a line
 *   Lanes       the four things people arrived to do
 *   01 Why      the claim, with numbers behind it
 *   02 Panel    who will actually treat you
 *   03 Care     the six doors the departments sit behind
 *   04 Visit    a first visit, desk by desk
 *   05 Inside   what is in the building
 *   06 Stories  what people said on the way out
 *   07 Where    address, hours, phone, map
 *   08 Asked    six questions before you come
 *   Emergency   the one red thing, and it is not a promotion
 *
 * Dropped in the poster rebuild: the care-model chapter (the journey and "Why
 * Jeeva" already say it), the numbers band (folded into 05) and the portal
 * call-to-action (sign-in lives in the header). No chapter shows a price.
 */
export default function HomePage() {
  return (
    <>
      {/* the hospital itself, machine-readable: address, phone, OPD hours */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(hospitalJsonLd()) }}
      />
      <Hero />
      <Ticker />
      <ActionBar />
      <Trust />
      <SpecializedDoctors />
      <Specialities />
      <FirstVisit />
      <InsideHospital />
      <Stories />
      <Visit />
      <Faq />
      <EmergencyBand />
    </>
  );
}
