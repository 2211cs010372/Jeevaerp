const S = require("../svg");

const labFlow = S.chain(
  [
    { label: "Order", sub: "Chit / reception / ward", tone: "teal" },
    { label: "Sample", sub: "Patient nunchi teesukondi", tone: "teal" },
    { label: "Bill", sub: "Counter lo or stay meeda", tone: "amber" },
    { label: "Run", sub: "Analyser / bench", tone: "plain" },
    { label: "Result", sub: "Values enter or PDF upload", tone: "blue" },
    { label: "Done", sub: "Report print / doctor ki", tone: "blue" },
  ],
  { perRow: 3, title: "Oka test - order nunchi report varaku" }
);

const whoOrders = S.lanes(
  [
    {
      name: "Reception",
      steps: [{ label: "OPD patient tests", sub: "Chit choosi order", col: 0, tone: "teal" }],
    },
    {
      name: "Ward (IPD)",
      steps: [{ label: "Stay meeda order", sub: "Room tab ki charge", col: 1, tone: "blue" }],
    },
    {
      name: "Lab counter",
      steps: [
        { label: "Walk-in", sub: "Register + order + bill okesari", col: 2, tone: "teal" },
        { label: "Test queue", sub: "Anni orders ikkade", col: 3, tone: "teal" },
      ],
    },
  ],
  { cols: 4, title: "Test order moodu chotla nunchi vastundi - queue okate" }
);

module.exports = {
  key: "labs",
  file: "Jeeva-Laboratory-Portal-User-Manual.docx",
  title: "Laboratory Portal",
  edition: "Jeeva HMS · Staff manual · Version 1.0",
  cover: [
    "Lab counter and bench staff kosam - test orders, sample queue, results & reports, lab billing, test catalogue and prices.",
    "Ee manual Telugu (Latin script) lo raasindi. Screen names, button labels app lo unnattu ne English lo unnayi.",
  ],

  blocks: [
    { t: "h1", x: "1. Ee manual evariki" },
    { t: "lead", x: "Lab counter lo kurchoni orders/bills chese vaariki, and bench meeda samples run chesi results ekkinche vaariki." },
    { t: "p", x: "Lab portal lo **rendu panulu** - counter pani (evaru, ye tests, money) and bench pani (sample, result, report). Rendintiki okate queue - counter lo order pettina вెంటనే bench queue lo kanipistundi." },
    { t: "img", name: "labs-flow", svg: labFlow },

    { t: "h1", x: "2. Login & screen" },
    { t: "p", x: "Hospital ichina labs portal address open chesi username (udaharanaki `lab.anitha`) tho login cheyyandi - **SMS code** or **Password**." },
    {
      t: "table",
      head: ["Screen", "Deniki"],
      widths: [26, 74],
      rows: [
        ["**Dashboard**", "Ee roju position - pending tests, report file kosam waiting unnavi, ayipoyinavi"],
        ["**Test queue**", "Bench pani - sample rakunda unnavi, result ekkincha valasinavi"],
        ["**Order tests**", "Counter ki vachina vaadiki tests order cheyyadam (kotta patient ayina sare)"],
        ["**Test catalog**", "Test peru, normal values, price"],
        ["**Test prices**", "Anni prices okate column lo - chala tests rates okesari correct cheyyadaniki"],
        ["**Billing / Invoices**", "Bill raise cheyyadam, unna bills correct/reprint cheyyadam"],
        ["**Patients**", "Aa patient ki mundu enni tests ayyayi, bills entha"],
        ["**Day close**", "Lab counter drawer lekka"],
      ],
    },
    { t: "img", name: "labs-who-orders", svg: whoOrders },
    { t: "caption", x: "Reception, ward, and lab counter - moodu chotla nunchi orders vastayi, kaani bench ki okate queue." },

    { t: "pb" },
    { t: "h1", x: "3. Order tests - counter ki vachina vaadiki" },
    { t: "p", x: "Patient chit tho counter ki vachadu ante - **ikkade antha ayipotundi**. Reception ki pampakkarledu: file lekapothe ikkade register cheyyochu, tests select cheyyochu, money kuda ikkade teesukovachu - antha okate submit." },
    {
      t: "steps",
      items: [
        "**Who** - patient ni search cheyyandi (peru / phone / UHID). File lekapothe peru + mobile pettandi, akkade register avutaru.",
        "**Which tests** - catalogue nunchi tests select cheyyandi. Prati test pakkana rate kanipistundi.",
        "**3 · Who referred them?** - ye doctor rasaru ani pettandi (bayata doctor ayithe kuda). Report meeda ide print avutundi.",
        "Money: **Order & bill** kottithe order + bill rendu okesari; **Order** matrame kottithe tests order avutayi, bill tarvata.",
        "Sample teesukoni queue lo aa row ni చూసుకోండి.",
      ],
    },
    {
      t: "note",
      title: "Admitted (ward) patient ayithe",
      lines: [
        "Aa patient tests **stay tab meeda** padatayi - counter lo money teesukokandi. Screen lo \"**Goes on the stay**\" ani kanipistundi, and discharge bill lo antha kalipi vasulu chestaru.",
      ],
    },

    { t: "h1", x: "4. Test queue - bench pani" },
    { t: "p", x: "**Okate order = okate row.** Okate patient nunchi okate sample lo 3 tests teesukunte, avi moodu veru rows kaakunda **okate row** ga untayi - aa row expand chesthe lopala 3 tests untayi." },
    {
      t: "steps",
      items: [
        "Row expand chesi ye tests unnayo chudandi.",
        "Test run chesaka - **values type cheyyandi**, or analyser/PDF report file **upload cheyyandi**.",
        "Prati test ki sonta **Done** undi - okati ayipoyi inkoti (culture lanti) inka pending unte, ayipoyina daani ni release cheyyochu.",
        "Report **print** chesi patient ki ivvandi, or doctor portal lo doctor ki kanipistundi.",
      ],
    },
    {
      t: "table",
      head: ["Status", "Artham"],
      widths: [30, 70],
      rows: [
        ["**PENDING**", "Order ayindi, result inka raaledu"],
        ["**Pending result**", "Sample teesukunnaru, values inka ekkincha ledu"],
        ["**Awaiting a report file**", "Values unnayi kaani PDF/scan attach cheyyaledu"],
        ["**Completed**", "Result unnadi, doctor ki kanipistundi, print cheyyochu"],
      ],
    },
    {
      t: "warn",
      lines: [
        "Result values ekkinche mundu **patient peru and test peru rendu confirm cheyyandi**. Tappu patient meeda result ekkisthe - adi doctor decision ni maarustundi. Row expand chesinappudu paina patient peru, UHID untayi.",
        "Age / gender tappu unte **normal range tappu ga chupistundi** - patient file lo correct cheyyamani reception ki cheppandi.",
      ],
    },

    { t: "h1", x: "5. Billing - lab bill" },
    { t: "p", x: "**Generate lab bill** screen lo moodu rakala vaallaki bill cheyyochu:" },
    {
      t: "ul",
      items: [
        "Mundu tests order ayyi bill kaani patient - **2 · Unbilled tests** lo avi kanipistayi, select chesi bill cheyyandi.",
        "File unna patient, ippude chit tho vachadu - **Add tests from the catalogue** lo tests pettandi; avi order + bill okesari avutayi.",
        "File ye leni vaadu - ikkade register chesi, tests pettandi, bill cheyyandi.",
      ],
    },
    {
      t: "steps",
      items: [
        "Patient select / register cheyyandi.",
        "Tests select cheyyandi (unbilled list nunchi or catalogue nunchi).",
        "**Order summary** lo total chudandi. Discount ivvali ante discount box lo pettandi.",
        "**Raise the bill now** - money mode (cash / UPI / card) select chesi save cheyyandi.",
        "Bill print chesi ivvandi.",
      ],
    },
    {
      t: "note",
      lines: [
        "Patient admitted ayithe screen lo \"**Billed to the stay**\" ani chupistundi - appudu ikkada money teesukoru, adi discharge bill lo velthundi.",
      ],
    },

    { t: "h1", x: "6. Invoices - unna bills" },
    { t: "p", x: "Lab counter raise chesina bills anni ikkada. Bill malli print cheyyadaniki, or tappu unte correct cheyyadaniki idi vaadandi." },
    {
      t: "table",
      head: ["Pani", "Gurthu"],
      widths: [34, 66],
      rows: [
        ["Bill reprint", "Patient receipt poyindi ante ikkada nunchi teeyandi"],
        ["Bill edit", "Lines, date, discount correct cheyyochu - **admin ee facility on chesthe ne** kanipistundi"],
        ["Bill date maarchadam", "Sample Saturday teesukoni Monday bill chesthe - correct date pettochu"],
      ],
    },
    {
      t: "stop",
      title: "System oppukoni panulu",
      lines: [
        "Already collect chesina money kanna **thakkuva ki bill maarchalemu** - modata refund, tarvata edit.",
        "Cancel ayina bill ni edit cheyyalemu.",
        "e-Invoice (IRN) file ayina bill ni maarchalemu.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "7. Test catalog - tests master" },
    { t: "p", x: "Prati test ki peru, code, sample type, **normal values (reference ranges)**, and price ikkada untayi. Report meeda print ayye \"Normal range\" ikkadi nunchi ne vastundi." },
    {
      t: "steps",
      items: [
        "Kotta test add cheyyali ante - peru, code, price, sample type pettandi.",
        "Normal values rows ga add cheyyandi (male / female / age wise veru veru unte veru rows).",
        "Save chesaka aa test order screens lo kanipistundi.",
      ],
    },
    {
      t: "warn",
      lines: [
        "Normal values maarchinappudu - avi **kotta reports meeda ne** effect avutayi. Mundu print ayina reports lo paatha values ne untayi, and adi correct - aa roju aa range prakaram ne report ichaaru.",
      ],
    },

    { t: "h1", x: "8. Test prices" },
    { t: "p", x: "Anni tests prices okate column lo - chala rates okesari correct cheyyadaniki. Import chesinappudu chala tests ₹0 tho untayi; avi ikkada okesari sarichеyyochu." },
    {
      t: "note",
      lines: [
        "Ee same prices reception and admin screens lo kuda kanipistayi - **okate record, moodu doors**. Meeru ikkada maarusthe reception lo kuda ade rate untundi.",
        "Prati price change **evaru, ye test, entha nunchi entha ki** ani record avutundi.",
      ],
    },

    { t: "h1", x: "9. Patients & Day close" },
    {
      t: "table",
      head: ["Screen", "Deniki"],
      widths: [24, 76],
      rows: [
        ["**Patients**", "Aa patient ki mundu enni tests ayyayi, results em vachayi, bills entha - antha okate chota. \"Last time ee test entha ki chesaru\" lanti prashnalaki"],
        ["**Day close**", "Lab counter drawer - cash/UPI/card totals. Drawer lo cash tho match chesi print teesi pettandi"],
      ],
    },

    { t: "h1", x: "10. Problem vaste - em cheyyali" },
    {
      t: "table",
      head: ["Problem", "Enduku", "Em cheyyali"],
      widths: [28, 34, 38],
      rows: [
        ["Test rate ₹0 ani vastundi", "Aa test ki price set cheyyaledu", "**Test prices** lo correct rate pettandi"],
        ["Doctor \"test advise chesa\" antunnaru, queue lo ledu", "Reception order cheyyaledu", "Reception ki cheppandi - vaalla screen lo orange badge lo aa test untundi"],
        ["Ward patient money adugutunnaru", "Adi stay meeda charge ayindi", "Discharge lo collect avutundi ani cheppandi"],
        ["Report lo normal range tappu", "Patient age/gender tappu, or catalogue lo range tappu", "Patient details reception tho correct cheyinchandi; range **Test catalog** lo choodandi"],
        ["Tappu patient meeda result ekkincha", "Row confirm cheyyakunda", "Vెంటనే in-charge ki cheppandi - correct chesi kotta report ivvali"],
        ["Bill edit button ledu", "Admin bill editing off chesaru", "Admin ni adagandi"],
      ],
    },

    { t: "h1", x: "11. Padalu (Glossary)" },
    {
      t: "table",
      head: ["Padam", "Artham"],
      widths: [26, 74],
      rows: [
        ["**Order**", "Okate patient nunchi okate sari order chesina tests motham - queue lo okate row"],
        ["**Reference / normal range**", "Normal values - age, gender batti maarutayi"],
        ["**Pending / Completed**", "Result raakapothe pending, result ekkinchaka completed"],
        ["**Goes on the stay**", "Admitted patient test - discharge bill lo vasulu avutundi"],
        ["**Referring doctor**", "Test ni raasina doctor - report meeda print avutundi"],
        ["**Day close**", "Aa roju lab counter lo entha vachindo lekka"],
      ],
    },
  ],
};
