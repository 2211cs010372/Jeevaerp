import { Hero } from "@/components/marketing/hero";
import { Ticker } from "@/components/marketing/ticker";
import { ActionBar } from "@/components/marketing/action-bar";
import { Trust } from "@/components/marketing/trust";
import { Departments } from "@/components/marketing/why-choose";
import { CareModel } from "@/components/marketing/care-model";
import { NumbersBand } from "@/components/marketing/numbers-band";
import { SpecializedDoctors } from "@/components/marketing/specialized-doctors";
import { Journey } from "@/components/marketing/journey";
import { Facilities } from "@/components/marketing/facilities";
import { Wards } from "@/components/marketing/wards";
import { Testimonials } from "@/components/marketing/testimonials";
import { Visit } from "@/components/marketing/visit";
import { Faq } from "@/components/marketing/faq";
import { EmergencyBand } from "@/components/marketing/emergency";
import { PortalCta } from "@/components/marketing/portal-cta";
import { hospitalJsonLd } from "@/lib/site";

/**
 * The homepage, as eleven numbered chapters.
 *
 * The order is a narrative, and the tone column is the rhythm that carries it.
 * Porcelain is the resting state; the page drops into a full-bleed pine room
 * exactly three times, and each one is an emotional beat rather than a
 * decorative one:
 *
 *   Hero          paper   the building, the promise, the emergency number
 *   Ticker        PINE    proof there is substance behind the headline
 *   Lanes         paper   the four things people arrived to do
 *   01 Why        light   the claim, with numbers behind it
 *   02 Depts      paper   ★ the pinned rail - the one cinematic move
 *   03 Care       PINE    ★ what we believe, scrubbed word by word
 *   04 Numbers    light   capacity, in tabular figures
 *   05 Panel      paper   who will actually treat you
 *   06 Visit      light   what happens, in four steps
 *   07 Facility   paper   what is in the building
 *   08 Prices     PINE    ★ what it costs, published
 *   09 Stories    light   what people said on the way out
 *   10 Where      paper   address, hours, phone
 *   11 Questions  light   the front desk's fifty questions
 *   Emergency     RED     the one loud thing, and it is not a promotion
 *   Closing       PINE    two doors, running into the footer
 *
 * Three dark rooms and one red band across a page this long is restraint. A
 * fourth would make the contrast ordinary, and ordinary contrast is invisible.
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
      <Departments />
      <CareModel />
      <NumbersBand />
      <Journey />
      <Facilities />
      <Testimonials />
      <Visit />
      <Faq />

      <EmergencyBand />
      <PortalCta />
    </>
  );
}
