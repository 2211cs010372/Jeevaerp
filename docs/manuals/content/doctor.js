const S = require("../svg");

const dayFlow = S.chain(
  [
    { label: "Patient queue", sub: "Reception check-in chesaka", tone: "teal" },
    { label: "Case sheet", sub: "Print chesi raayandi", tone: "teal" },
    { label: "Chart", sub: "Paatha history, results", tone: "blue" },
    { label: "Seen", sub: "Ayipoyaka tap cheyyandi", tone: "teal" },
    { label: "Chit → reception", sub: "Medicines, tests ekkistaru", tone: "amber" },
    { label: "Results back", sub: "Report vachaka ikkade", tone: "blue" },
  ],
  { perRow: 3, title: "Consulting room - oka OP roju" }
);

const whereFrom = S.lanes(
  [
    {
      name: "Reception",
      steps: [
        { label: "Check in", sub: "Patient vacharu", col: 0, tone: "teal" },
        { label: "Chit ekkistaru", sub: "Medicines + tests", col: 3, tone: "amber" },
      ],
    },
    {
      name: "Meeru (doctor)",
      steps: [
        { label: "Queue lo kanipistaru", sub: "Today screen", col: 1, tone: "blue" },
        { label: "Chudandi + raayandi", sub: "Case sheet", col: 2, tone: "blue" },
      ],
    },
    {
      name: "Pharmacy / Lab",
      steps: [
        { label: "Medicine / test", sub: "Vaalla queue lo", col: 4, tone: "teal" },
        { label: "Result", sub: "Mee screen ki vastundi", col: 5, tone: "blue" },
      ],
    },
  ],
  { cols: 6, title: "Mee screen loki information ekkada nunchi vastundi" }
);

module.exports = {
  key: "doctor",
  file: "Jeeva-Doctor-Portal-User-Manual.docx",
  title: "Doctor Portal",
  edition: "Jeeva HMS · Staff manual · Version 1.0",
  cover: [
    "Consultant doctors kosam - roju patient queue, case sheets, patient chart (history, prescriptions, lab results) and inpatients.",
    "Ee manual Telugu (Latin script) lo raasindi. Screen names, button labels app lo unnattu ne English lo unnayi.",
  ],

  blocks: [
    { t: "h1", x: "1. Ee portal enduku chinnaga undi" },
    { t: "lead", x: "Doctor portal lo rendu screens matrame unnayi - **Today** and **Patient chart**. Adi taggipoyinadi kaadu, kaavalane ala design chesindi." },
    { t: "p", x: "Consulting room lo mee time patient tho gadavali, computer tho kaadu. Anduke ee portal lo **typing pani deadly ga thakkuva** - meeru chudalsinadi chupistundi, mee chit ni reception ekkistundi. Mee daggara okate button undi: **Seen**." },
    { t: "img", name: "doctor-day-flow", svg: dayFlow },

    { t: "h1", x: "2. Login" },
    { t: "p", x: "Hospital ichina doctor portal address open chesi username (udaharanaki `dr.ravi`) tho login cheyyandi." },
    {
      t: "ul",
      items: [
        "**SMS code** - username pettandi, mee mobile ki 6-digit code vastundi.",
        "**Password** - mee sonta laptop / phone lo idi convenient.",
      ],
    },
    {
      t: "note",
      lines: [
        "Mee login tho meeru chuse data mee patients di. Login ni evariki ivvakandi - staff meeku bदula ga login ayithe, aa records lo mee peru ne untundi.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "3. Today - roju screen" },
    { t: "img", name: "doctor-where-from", svg: whereFrom },

    { t: "h2", x: "3.1 Patient queue" },
    { t: "p", x: "Reception **check in** chesina patients ikkada line lo vastaru. Peru pakkana status untundi:" },
    {
      t: "table",
      head: ["Status", "Artham"],
      widths: [28, 72],
      rows: [
        ["**Booked**", "Appointment undi, patient inka raaledu"],
        ["**Checked-in**", "Patient hospital lo unnaru, meeku kosam wait chestunnaru"],
        ["**Completed**", "Meeru chusesaru"],
      ],
    },
    { t: "p", x: "**Next patient** card lo tarvata evaru ani chupistundi - room lo nunchi lechi bayata chudakkarledu." },

    { t: "h2", x: "3.2 Prati patient ki mee daggara unna moodu panulu" },
    {
      t: "table",
      head: ["Button", "Em chestundi", "Eppudu"],
      widths: [22, 44, 34],
      rows: [
        ["**Case sheet**", "Aa patient ki print ayye OP sheet - peru, age, vitals antha paina print ayyi vastundi", "Patient lopaliki వచ్చినappudu print teeyandi, meeru daani meeda raayandi"],
        ["**Chart / Open chart**", "Aa patient paatha history - mundu em raasaru, ye tests ayyayi, results em vachayi", "Follow-up patient ayithe modata idi chudandi"],
        ["**Seen**", "Aa consultation ayipoyindi ani gurtu pedutundi", "Patient bayataki వెళ్ళaka"],
      ],
    },
    {
      t: "tip",
      title: "Seen enduku kottali",
      lines: [
        "Meeru **Seen** kottakapothe - reception ki aa patient inka mee daggara ne unnattu kanipistundi, and roju chivari lekka lo \"entha mandini chusaru\" ani tappu ga vastundi. Patient bayataki వెళ్ళina వెంటనే okka tap.",
      ],
    },
    {
      t: "note",
      title: "Blank sheet",
      lines: [
        "**Blank sheet** ante khaali case sheet - current pothe, or emergency lo patient ki file lekapothe, print chesi chetito raayandi. Tarvata reception daanni system lo ekkistundi.",
      ],
    },

    { t: "h2", x: "3.3 Results back" },
    { t: "p", x: "Mee patients ki chesina lab tests results vachaka ikkada kanipistayi (rendu vaaralu varaku). **Report** button kottithe lab report PDF open avutundi. Patient malli raakundane result chudochu - phone chesi cheppochu." },

    { t: "h2", x: "3.4 Your inpatients" },
    { t: "p", x: "Mee kinda admit ayina patients list. Prati okkariki **Chart** undi - stay lo em jarigindi, ye medicines ichaaru, ye tests ayyayi antha chudochu." },

    { t: "pb" },
    { t: "h1", x: "4. Patient chart - patient charitra" },
    { t: "p", x: "**Patient chart** screen lo patient ni peru / UHID / phone tho vetakandi. Moodu bhagalu untayi:" },
    {
      t: "table",
      head: ["Bhagam", "Em untundi"],
      widths: [26, 74],
      rows: [
        ["**Prescriptions**", "Mundu ichina medicines - ee hospital lo ye doctor rasina saare"],
        ["**Lab results**", "Anni tests, values tho. Trend chudochu - sugar, creatinine ela marutundo"],
        ["**Visit history**", "Eppudu eppudu vachcharu, ye doctor daggara, em complaint tho"],
      ],
    },
    {
      t: "warn",
      lines: [
        "Patient \"nenu mundu ee hospital ki vacha\" ani cheppi chart lo emi kanipinchakapothe - vaalliki **rendu files** undochu (duplicate registration). Reception ki cheppandi, vaallu rendu records ni merge chestaru; appudu motham history okate chota vastundi.",
      ],
    },

    { t: "h1", x: "5. Mee chit tarvata em jarugutundi" },
    {
      t: "steps",
      items: [
        "Meeru case sheet meeda medicines and tests raastaru.",
        "Reception aa chit ni scan chesi, medicines and tests **system lo type chestaru**.",
        "Medicines pharmacy queue loki, tests lab queue loki velthayi.",
        "Test ayipoyaka result mee **Results back** section lo vastundi.",
        "Meeru advise chesina test ni evaru order cheyyakapothe - reception screen lo orange badge tho kanipistundi, so adi marchipoyye avakasam thakkuva.",
      ],
    },
    {
      t: "note",
      lines: [
        "Meeru raasina medicine peru clear ga lekapothe pharmacy vaallu confirm cheyyadaniki phone chestaru. Generic (salt) peru raasthe - stock lo leni brand unnappudu vaallu substitute cheyyagalaru (mee approval tho).",
      ],
    },

    { t: "h1", x: "6. Problem vaste - em cheyyali" },
    {
      t: "table",
      head: ["Problem", "Enduku", "Em cheyyali"],
      widths: [30, 34, 36],
      rows: [
        ["Patient bayata unnaru, queue lo raaledu", "Reception check in cheyyaledu", "Reception ki cheppandi - okka tap"],
        ["Result raaledu", "Lab lo inka run avvaledu, or report upload cheyyaledu", "Lab counter ki cheppandi - vaalla queue lo aa test status kanipistundi"],
        ["Chart lo paatha history ledu", "Patient ki rendu files unnayi", "Reception ki cheppi merge cheyyinchandi"],
        ["Inpatient list lo mee patient ledu", "Admission lo attending doctor veru ga padindi", "Reception / ward tho correct cheyyinchandi"],
        ["Case sheet print lo vitals ledu", "Reception vitals enter cheyyaledu", "Reception ki cheppandi - prescriptions screen lo vitals section undi"],
      ],
    },

    { t: "h1", x: "7. Padalu (Glossary)" },
    {
      t: "table",
      head: ["Padam", "Artham"],
      widths: [26, 74],
      rows: [
        ["**UHID**", "Patient ki jeevitham antha okate number"],
        ["**OP number**", "Aa roju aa consultation number"],
        ["**Case sheet**", "Meeru raase printed OP sheet"],
        ["**Checked-in**", "Patient hospital lo unnaru ani reception confirm chesindi"],
        ["**Seen**", "Aa consultation ayipoyindi"],
        ["**Chart**", "Patient motham history - prescriptions, results, visits"],
      ],
    },
  ],
};
