const S = require("../svg");

const lifecycle = S.chain(
  [
    { label: "Admit", sub: "Payer = Insurance", tone: "teal" },
    { label: "Pre-auth", sub: "Estimate amount pettandi", tone: "teal" },
    { label: "Send to insurer", sub: "Claim SUBMITTED", tone: "teal" },
    { label: "Approve", sub: "Insurer ₹X authorise", tone: "blue" },
    { label: "Treatment", sub: "Tab perugutundi", tone: "plain" },
    { label: "Discharge bill", sub: "Anni bills insurer meeda", tone: "amber" },
    { label: "Final claim?", sub: "Estimate daatithe ne", tone: "amber" },
    { label: "Settle", sub: "Money bills meeda apply", tone: "blue" },
  ],
  { perRow: 4, title: "Cashless stay - modati nunchi money vachedaka" }
);

// The decision the desk makes after discharge - drawn, because it is the one
// rule the whole portal now turns on.
const decision = (() => {
  const W = 980;
  const H = 250;
  let b = S.caption("Discharge tarvata - final claim kavala, vaddha?", 4, 22, { size: 14 });
  b += S.box({ x: 8, y: 66, w: 190, h: 78, title: "Discharge bill ready", sub: "Insurer meeda unna anni bills", tone: "teal" });
  b += S.arrow(202, 105, 236, 105);
  b += S.diamond({ cx: 372, cy: 105, w: 268, h: 128, title: "Bill > authorised amount?", tone: "amber" });
  b += S.arrow(470, 72, 546, 52);
  b += S.arrow(470, 138, 546, 168);
  // Labels sit off the line, not on it - a mid-line label lands under the
  // arrowhead and reads as part of the box it is pointing at.
  b += S.caption("Avunu", 508, 40, { size: 12, fill: S.MUTED, anchor: "middle" });
  b += S.caption("Kaadu", 508, 190, { size: 12, fill: S.MUTED, anchor: "middle" });
  b += S.box({ x: 550, y: 18, w: 196, h: 74, title: "Final claim raise", sub: "Full bill or excess", tone: "rose" });
  b += S.box({ x: 550, y: 136, w: 196, h: 74, title: "Emi cheyyakkarledu", sub: "Authorisation ye settle chestundi", tone: "teal" });
  b += S.arrow(750, 55, 786, 55);
  b += S.box({ x: 790, y: 18, w: 182, h: 74, title: "Send to insurer", sub: "Approve → Settle", tone: "blue" });
  b += S.box({ x: 790, y: 136, w: 182, h: 74, title: "List nunchi poddu", sub: "\"To raise\" lo raadu", tone: "plain" });
  b += S.arrow(750, 173, 786, 173);
  return S.svg(W, H, b);
})();

const whoDoesWhat = S.lanes(
  [
    {
      name: "Reception / ward",
      steps: [
        { label: "Admit", sub: "Payer = Insurance", col: 0, tone: "teal" },
        { label: "Treatment", sub: "Tab, medicines, tests", col: 2, tone: "plain" },
        { label: "Discharge", sub: "Bill raise", col: 3, tone: "amber" },
      ],
    },
    {
      name: "Insurance desk",
      steps: [
        { label: "Pre-auth", sub: "Estimate + submit", col: 1, tone: "teal" },
        { label: "Final claim", sub: "Estimate daatithe", col: 4, tone: "rose" },
        { label: "Settle up", sub: "Money / patient ki", col: 5, tone: "blue" },
      ],
    },
  ],
  { cols: 6, title: "Ye pani evaru chestaru" }
);

module.exports = {
  key: "insurance",
  file: "Jeeva-Insurance-Desk-Portal-User-Manual.docx",
  title: "Insurance Desk Portal",
  edition: "Jeeva HMS · Staff manual · Version 1.0",
  cover: [
    "Insurance desk kosam - cashless admissions, pre-authorisation, claim submission, final claims, insurer decisions and settlement.",
    "Ee manual Telugu (Latin script) lo raasindi. Screen names, button labels app lo unnattu ne English lo unnayi.",
  ],

  blocks: [
    { t: "h1", x: "1. Ee manual evariki" },
    { t: "lead", x: "Insurance room lo kurchoni TPA / insurer tho claims chese vaariki." },
    { t: "p", x: "Ee portal lo mee pani okate vakyam lo: **hospital chesina treatment ki insurer nunchi money teppinchadam** - and adi jarigedaka aa stay ni marchipokunda undadam. Portal antha ade kramam lo build ayindi." },
    { t: "img", name: "insurance-who", svg: whoDoesWhat },

    { t: "h1", x: "2. Login & screen" },
    { t: "p", x: "Hospital ichina insurance portal address open chesi username (udaharanaki `insurance.lakshmi`) tho login cheyyandi - **SMS code** or **Password**." },
    {
      t: "table",
      head: ["Screen", "Deniki"],
      widths: [26, 74],
      rows: [
        ["**Dashboard**", "Rendu prashnalu - naa meeda em pending undi, hospital ki entha raavali"],
        ["**To raise**", "**Mee main screen.** Claim raayalsina stays, ekkuva sepu wait chesinavi paina"],
        ["**Insurance stays**", "Policy meeda unna prati patient - claim submit ayina saare ikkada untaru"],
        ["**Beds & admit**", "Ward board - policy card tho vachina family ni ikkade admit cheyyochu"],
        ["**Claims**", "Raise chesina anni claims and avi ekkada unnayo"],
        ["**Settle up**", "Insurer answer valla money ki em ayindi - waiting, patient must pay, done"],
      ],
    },
    {
      t: "note",
      lines: [
        "**To raise** pakkana unna erra number - claim raayalsina stays sankhya. Adi ekkuva sepu ala ne unte, aa stays ki hospital money adagakunda undipoyindi ani artham.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "3. Claim ela nadustundi - motham flow" },
    { t: "img", name: "insurance-lifecycle", svg: lifecycle },
    { t: "p", x: "Mee hospital lo follow ayye padhathi: **pre-auth lo estimate petti approve chesukuntaru; aa estimate lopala bill unte adе settle avutundi. Bill estimate daatithe ne final claim pampistaru.** System kuda ippudu ade rule prakaram pani chestundi." },
    { t: "img", name: "insurance-decision", svg: decision },
    { t: "caption", x: "Ee okka rule meeda ne \"To raise\" list and stay screen lo button rendu aadutayi." },

    { t: "h1", x: "4. Modati adugu - admission" },
    { t: "p", x: "Reception patient ni **payer = Insurance** ani admit cheyyagane, aa stay ki **₹0 draft pre-auth** automatic ga open avutundi and mee **To raise** list lo kanipistundi." },
    { t: "p", x: "Policy card tho family direct ga mee daggariki vaste - reception ki pampakandi. **Beds & admit** screen lo meere admit cheyyochu; akkada anni beds kanipistayi (self-pay patients unna beds kuda, enduku ante avi kuda khaali kaadu)." },
    {
      t: "warn",
      lines: [
        "Admission time lo payer **Insurance** ani pettakapothe - aa stay mee list lo eppatiki raadu. Discharge roju \"idi cashless\" ani telisi hadavudi padatam - anduke admission daggara ne idi correct ga undali.",
      ],
    },

    { t: "h1", x: "5. Pre-authorisation - estimate tho approve chesukovadam" },
    { t: "p", x: "Patient bed lo unnappudu ne, **motham stay ki entha avutundo estimate** chesi insurer ki pampali. Idi mukhyam: authorise cheyyakunda mundu chesina treatment ni insurer motham refuse cheyyochu." },
    {
      t: "steps",
      items: [
        "**To raise** → *Pre-authorization* group lo aa stay teeyandi.",
        "**Price the bill** / stay open chesi ippati varaku entha ayindo chudandi (running tab).",
        "Motham stay ki estimate cheyyandi - surgery, ICU rojulu, medicines antha kalipi. (Ippati varaku ayina amount kaadu - **motham** stay estimate.)",
        "Claim lo **Amount** set cheyyandi.",
        "**Send to insurer** kottandi - claim **SUBMITTED** avutundi and mee list nunchi aa row poddu (ippudu adi insurer chetilo undi).",
      ],
    },
    {
      t: "table",
      head: ["Row lo em kanipistundi", "Artham", "Mee tarvati adugu"],
      widths: [26, 40, 34],
      rows: [
        ["**RAISE**", "Aa stay ki claim ye ledu", "Kotta claim raise cheyyandi"],
        ["**SET_AMOUNT** (\"Price the bill\")", "Draft undi kaani ₹0", "Estimate amount pettandi"],
        ["**SUBMIT**", "Amount undi, insurer ki pampaledu", "Send to insurer"],
        ["Urgency chip (12h / 48h)", "Entha sepu wait chestundo", "48 gantalu daatithe adi **overdue** - modata adi cheyyandi"],
      ],
    },

    { t: "h1", x: "6. Insurer answer ni record cheyyadam" },
    { t: "p", x: "TPA nunchi letter/email vachaka aa claim open chesi answer ni system lo pettandi." },
    {
      t: "table",
      head: ["Insurer em cheppindi", "Meeru em cheyyali", "System em chestundi"],
      widths: [26, 34, 40],
      rows: [
        ["Approve chesaru", "**Approve** + **authorised amount**", "Aa stay bills meeda coverage split avutundi"],
        ["Konchem ne approve chesaru", "**Approve** + aa thakkuva amount", "Migilinadi family di ayipotundi; \"Settle up\" lo kanipistundi"],
        ["Documents adigaru", "**Query** + em adigaro note", "Claim QUERIED - answer ichaka malli send cheyyandi"],
        ["Refuse chesaru", "**Reject** + reason", "Aa stay bills ni family ki maarche option vastundi"],
        ["Money vachindi", "**Settle** + entha vachindo", "Aa money bills meeda apply avutundi (mode: Insurance)"],
      ],
    },
    {
      t: "stop",
      title: "Idi marchipothe motham flow tappu avutundi",
      lines: [
        "Insurer **entha approve chesaro aa amount** ni tappakunda enter cheyyandi. Aa figure lekapothe system ki \"entha authorise ayindo\" teliyadu - appudu aa stay ki *never authorised* ani chupinchi, avasaram lekapoyina final claim adugutundi.",
        "Approve amount raakunda direct ga money vaste - **Settle** lo aa amount pettandi; adi kuda authorisation ga teesukuntundi.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "7. Stay screen - bill meeda pani" },
    { t: "p", x: "Patient peru meeda click chesthe aa stay screen open avutundi. Claim raayadaniki kavalsinadi antha ikkade undi." },
    {
      t: "table",
      head: ["Section", "Em undi"],
      widths: [30, 70],
      rows: [
        ["**With the insurer**", "Ee stay ki unna claims - stage (Pre-auth / Final), status, claimed, approved. Ikkade amount pettadam, send cheyyadam"],
        ["**The running tab**", "Bed, nursing, service charges, and stay meeda unna pharmacy/lab bills"],
        ["**Every bill on this stay**", "Anni bills date order lo - assessor ela chustaro ala"],
        ["**Nursing & observation notes**", "Ward raasina notes - claim ki support document"],
        ["Print buttons", "Provisional bill (patient inka lopala unte), final claim bill, running tab, discharge summary"],
      ],
    },

    { t: "h2", x: "7.1 Tab line ni correct cheyyadam (rate / date)" },
    { t: "p", x: "TPA tariff prakaram rate maarchali ante, or ward tappu date tho ekkinchindi correct cheyyali ante - aa line pakkana **Edit** kottandi." },
    {
      t: "steps",
      items: [
        "Line pakkana **Edit** → dialog open avutundi.",
        "**Qty / Rate (₹) / GST %** - money maarchali ante ivi. Kinda kotta total and theda vెంటనే kanipistundi (\"↓ ₹100.00 on what this line bills today\").",
        "**Date & time given** - service nijam ga eppudu ichcharo. Idi stay lopala ne undali.",
        "Save cheyyandi.",
      ],
    },
    {
      t: "warn",
      title: "Discharge ayina stay lo rate maarusthe",
      lines: [
        "Aa **discharge bill malli issue avutundi** (receipt number ade untundi) - claim bill and tax invoice rendu okate ga undataniki. Already collect chesina money kanna thakkuva ki maarusthe system oppukodu.",
        "**Date matrame** maarusthe emi re-issue avvadu - date invoice meeda undadu.",
        "Pharmacy nunchi vachina lines ki Edit undadu - avi pharmacy lo ne correct cheyyali.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "8. Final claim - estimate daatinappudu" },
    { t: "p", x: "Patient discharge ayyi bill vachaka, system **insurer meeda unna anni bills** (discharge bill + pharmacy + lab) ni **authorised amount** tho compare chestundi." },

    { t: "h2", x: "8.1 Udaharana - Ramesh Kumar, IP-2026-0412, Star Health" },
    {
      t: "table",
      head: ["Emi jarigindi", "Amount"],
      widths: [58, 42],
      rows: [
        ["Pre-auth estimate petti submit chesaru", "₹1,40,000"],
        ["Star Health approve chesindi (meeru Approve lo enter chesaru)", "₹1,40,000"],
        ["Discharge bill (bed, nursing, surgery, tab charges)", "₹1,52,000"],
        ["Pharmacy bill (stay meeda)", "₹14,300"],
        ["Lab bill (stay meeda)", "₹5,700"],
        ["**Insurer meeda motham**", "**₹1,72,000**"],
        ["**Estimate daatindi**", "**₹32,000**"],
      ],
    },
    { t: "p", x: "Ee stay **To raise** lo *Final claim* group lo kanipistundi, and pakkana ala rastundi: **\"₹32,000 over the ₹1,40,000 approved\"**. Stay screen lo kuda \"With the insurer\" kinda blue box vastundi:" },
    {
      t: "note",
      title: "Stay screen lo kanipinchedi",
      lines: [
        "**This stay went ₹32,000.00 over what was authorised**",
        "Authorised ₹1,40,000.00 · Billed ₹1,72,000.00 across 3 bills pointed at Star Health.",
        "Button: **Raise for ₹1,72,000.00**  ·  kinda link: *or claim only the ₹32,000.00 excess*",
      ],
    },
    {
      t: "steps",
      items: [
        "**Raise for ₹1,72,000** kottandi - insurer full final bill adigithe idi. Insurer excess matrame adigithe kinda unna **excess** link kottandi (₹32,000).",
        "Form lo patient, insurer, policy, stage (**Final claim**), amount antha nindi untayi - chusi confirm cheyyandi. Diagnosis and remarks add cheyyandi.",
        "Save chesthe claim **DRAFT** ga create avutundi and ade screen lo paina kanipistundi.",
        "**Send to insurer** kottandi - SUBMITTED.",
        "Documents (discharge summary, bills, reports) TPA portal lo upload cheyyandi - print buttons ikkade unnayi.",
      ],
    },

    { t: "h2", x: "8.2 Eppudu final claim adagadu" },
    {
      t: "table",
      head: ["Stay", "System em chestundi"],
      widths: [46, 54],
      rows: [
        ["Authorised ₹1,40,000 · bill ₹1,32,000", "**Emi adagadu.** Authorisation ye settle chestundi - list nunchi poddu"],
        ["Authorised ₹1,40,000 · bill ₹1,40,000.40", "Adagadu - ₹1 varaku paise theda vadilesthundi"],
        ["Pre-auth ye raise cheyyaledu", "\"**never authorised**\" ani chupistundi - full bill ki claim adugutundi"],
        ["Claim reject ayyi bills family ki maarcharu", "Insurer meeda ₹0 - list nunchi poddu"],
        ["Final claim DRAFT lo undi", "\"To raise\" lo untundi (amount pettadam / send cheyyadam migilindi)"],
      ],
    },
    {
      t: "note",
      lines: [
        "Final claim send/approve/settle chesaka, aa stay ki vadaka migilipoyina **₹0 draft pre-auth automatic ga close** avutundi - \"Closed unused - the stay was claimed on its final claim instead\" ani note tho. Meeru manually close cheyyakkarledu.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "9. Settle up - insurer answer valla money ki em ayindi" },
    { t: "p", x: "Moodu tabs, meeru act chese kramam lo:" },
    {
      t: "table",
      head: ["Tab", "Em untundi", "Mee pani"],
      widths: [26, 38, 36],
      rows: [
        ["**Waiting on the insurer**", "Claim pampesaru, answer raaledu", "TPA ki follow up cheyyandi"],
        ["**Patient must pay**", "Insurer reject chesaru, or konchem ne approve chesaru - migilinadi family di", "**Bill the patient instead** chesi reason raayandi. Appudu aa bills reception Billing lo kanipistayi"],
        ["**Done**", "Insurer settle chesaru, or family ki maarcheశారు", "Emi ledu - record kosam"],
      ],
    },
    {
      t: "warn",
      title: "Enduku idi mukhyam",
      lines: [
        "Insurance ki point ayina bill ni system **dues lists nunchi teesestundi** - correct ga ne, endukante cashless patient family emi ivvakkarledu. Kaani insurer reject chesaka kuda adi ala ne unte - aa money ni **evaru adagaru**, reception ki kanipinchadu. Anduke reject vachaka **Bill the patient instead** cheyyadam meeru cheyyalsina panи.",
      ],
    },

    { t: "h1", x: "10. Insurance stays & Claims" },
    {
      t: "table",
      head: ["Screen", "Deniki"],
      widths: [26, 74],
      rows: [
        ["**Insurance stays**", "Policy meeda unna prati patient - claim submit ayyaka kuda ikkada untaru. Bill reprice cheyyadaniki, malli print cheyyadaniki idi vaadandi. Self-pay stay ki family sonta insurer ki **reimbursement claim** kuda ikkada nunchi raise cheyyochu"],
        ["**Claims**", "Anni claims okate board meeda - status wise. Kotta claim manual ga raise cheyyali ante ikkada **New claim** undi (stage: Pre-authorization / Final claim)"],
      ],
    },

    { t: "h1", x: "11. Print - TPA ki pampe documents" },
    {
      t: "table",
      head: ["Document", "Eppudu", "Ekkada"],
      widths: [30, 34, 36],
      rows: [
        ["**Provisional bill**", "Patient inka bed lo unnappudu - pre-auth ki", "Stay row lo *Provisional*"],
        ["**Final claim bill**", "Discharge tarvata", "Stay row lo *Bill*"],
        ["**Running tab**", "Ippati varaku entha ayindo statement", "Stay screen lo *Print tab*"],
        ["**Discharge summary**", "Claim tho tappaka pampalsindi", "Stay screen"],
        ["**Advance receipt**", "Family deposit ichinappudu", "Stay screen lo advances"],
      ],
    },

    { t: "h1", x: "12. Problem vaste - em cheyyali" },
    {
      t: "table",
      head: ["Problem", "Enduku", "Em cheyyali"],
      widths: [28, 34, 38],
      rows: [
        ["Cashless patient \"To raise\" lo raaledu", "Admission lo payer Insurance ani pettaledu", "Reception tho aa stay ni insurance ki maarpinchandi"],
        ["Settle ayina stay inka final claim adugutundi", "Approve amount enter cheyyaledu", "Aa pre-auth claim lo **Approve** + amount pettandi"],
        ["Okate stay ki rendu claims", "Rendu sarlu raise chesaru", "Vadanidi close cheyyandi - ye claim live lo untundo aa okkati ne vadandi"],
        ["Stay screen lo \"Raise final claim\" button raaledu", "Bill estimate lopala undi, or already claim undi, or bills family ki వెళ్ళayi", "Section 8.2 lo table choodandi"],
        ["Bill lo rate TPA tariff kanna ekkuva", "Counter rate tho charge ayindi", "Aa line meeda **Edit** → Rate maarchandi"],
        ["Reject ayina bills evaru collect cheyyatledu", "Insurer meeda ne unnayi", "**Settle up** → Patient must pay → *Bill the patient instead*"],
      ],
    },

    { t: "h1", x: "13. Padalu (Glossary)" },
    {
      t: "table",
      head: ["Padam", "Artham"],
      widths: [26, 74],
      rows: [
        ["**Cashless**", "Patient counter lo money ivvadu - bill insurer ki velthundi"],
        ["**Pre-authorisation**", "Treatment ki mundu insurer ichche approval, estimate meeda"],
        ["**Final claim**", "Discharge tarvata pampe claim - mee hospital lo estimate daatinappudu"],
        ["**Authorised amount**", "Insurer approve chesina amount - final claim kavala vaddha anedi deeni meeda ne"],
        ["**TPA**", "Third Party Administrator - insurer taraphuna claims chuse company"],
        ["**Reimbursement**", "Family sonta money tho pay chesi tarvata insurer nunchi teesukovadam"],
        ["**Settlement**", "Insurer nijam ga money pampinchadam"],
        ["**Coverage split**", "Approve ayina amount ni aa stay bills meeda pancadam"],
      ],
    },
  ],
};
