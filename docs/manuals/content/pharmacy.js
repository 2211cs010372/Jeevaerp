const S = require("../svg");

const counterFlow = S.lanes(
  [
    {
      name: "Patient",
      steps: [
        { label: "Chit tho vastadu", sub: "OPD or ward", col: 0, tone: "plain" },
        { label: "Medicine + bill", sub: "Counter lo money", col: 4, tone: "amber" },
      ],
    },
    {
      name: "Pharmacy",
      steps: [
        { label: "Prescriptions", sub: "Queue lo chit kanipistundi", col: 1, tone: "teal" },
        { label: "Dispense", sub: "Batch select, qty", col: 2, tone: "teal" },
        { label: "Bill", sub: "Counter or room", col: 3, tone: "teal" },
      ],
    },
    {
      name: "Ward patient",
      steps: [{ label: "Room ki charge", sub: "Discharge lo collect", col: 4, tone: "blue" }],
    },
  ],
  { cols: 5, title: "Counter flow - chit nunchi bill varaku" }
);

const buyCycle = S.chain(
  [
    { label: "Reorder", sub: "Enni thakkuva unnayo", tone: "amber" },
    { label: "Purchase order", sub: "Supplier ki order", tone: "teal" },
    { label: "Receive goods", sub: "Batch + expiry + rate", tone: "teal" },
    { label: "Stock", sub: "Rack meeda vaadukalo", tone: "teal" },
    { label: "Alerts", sub: "Expiry / low stock", tone: "amber" },
    { label: "Returns", sub: "Supplier ki వెనక్కి", tone: "rose" },
  ],
  { perRow: 3, title: "Stock ela lopaliki vastundi, ela bayataki potundi" }
);

const stockMoves = S.chain(
  [
    { label: "Receive", sub: "PO delivery / direct", tone: "teal" },
    { label: "Dispense", sub: "Patient ki ichadam", tone: "blue" },
    { label: "Remove", sub: "Damage / expiry write-off", tone: "rose" },
    { label: "Return", sub: "Supplier ki credit note", tone: "rose" },
  ],
  { perRow: 4, title: "Stock number maare 4 chotlu - inkellina maaradu" }
);

module.exports = {
  key: "pharmacy",
  file: "Jeeva-Pharmacy-Portal-User-Manual.docx",
  title: "Pharmacy Portal",
  edition: "Jeeva HMS · Staff manual · Version 1.0",
  cover: [
    "Pharmacy counter staff kosam - prescriptions, dispensing, stock, batches & expiry, purchase orders, goods receipt, returns and the counter's day close.",
    "Ee manual Telugu (Latin script) lo raasindi. Screen names, button labels app lo unnattu ne English lo unnayi.",
  ],

  blocks: [
    { t: "h1", x: "1. Ee manual evariki" },
    { t: "lead", x: "Medicine counter lo pani chese pharmacist ki, and stock/purchase choose vaariki." },
    { t: "p", x: "Pharmacy portal lo **rendu rakala pani** untundi, and sidebar kuda ade rendu ga divide chesi undi:" },
    {
      t: "ul",
      items: [
        "**At the counter** - patient ki medicine ivvadam, bill cheyyadam, ward dues collect cheyyadam, day close.",
        "**The shelf / Buying it in** - stock, expiry alerts, reorder, purchase orders, goods receive, supplier returns.",
      ],
    },
    {
      t: "note",
      title: "Modati sutram",
      lines: [
        "Rack meeda unna medicine and system lo unna number **okate ga undali**. Medicine chetito ichi system lo enter cheyyakapothe - stock tappu, expiry alert tappu, bill tappu, motham lekka tappu. **Prati transaction system lo pettandi.**",
      ],
    },

    { t: "h1", x: "2. Login & screen" },
    { t: "p", x: "Hospital ichina pharmacy portal address open chesi username (udaharanaki `pharmacy.suresh`) tho login cheyyandi. **SMS code** (default) or **Password** - rendintilo edaina vaadochu." },
    {
      t: "table",
      head: ["Bhagam", "Em chestundi"],
      widths: [26, 74],
      rows: [
        ["Sidebar", "Screens anni. **Dues to collect** pakkana orange number - adi ward lo collect cheyyalsina bills sankhya."],
        ["Search (Ctrl + K)", "Medicine peru type chesi vెంటనే vetakochu - stock, dispense, alerts ki direct links kuda vastayi."],
        ["Live updates", "Reception prescription pampinchina вెంటనే queue lo kanipistundi - refresh cheyyakkarledu."],
      ],
    },
    { t: "img", name: "pharmacy-counter-flow", svg: counterFlow },
    { t: "caption", x: "Ward patient ki money counter lo teesukoru - adi room ki charge ayyi discharge lo vasulu avutundi." },

    { t: "pb" },
    { t: "h1", x: "3. Prescriptions - queue lo unna chits" },
    { t: "p", x: "Reception scan chesina, or doctor pampina prescriptions ikkada vastayi. Rendu tabs untayi - **Charged to the room** (ward patients) and **Dispensed** (ayipoyinavi)." },
    {
      t: "steps",
      items: [
        "Queue lo unna chit meeda click cheyyandi - patient peru, doctor, and raasina medicines kanipistayi.",
        "Chit photo unte adi kuda chudochu - doctor చేతిrata check cheyyandi.",
        "**Dispense** ki velli aa patient ki medicines ivvandi (section 4).",
        "Stock lo lekapothe - generic (salt) okate unna vere brand suggest avutundi. Substitute ivvali ante doctor ki cheppi ne ivvandi.",
      ],
    },

    { t: "h1", x: "4. Dispense - medicine ivvadam" },
    {
      t: "steps",
      items: [
        "**1 · Patient** - peru, phone, or OP number tho search cheyyandi. Walk-in customer ayithe (chit ledu, file ledu) akkade name + mobile pettochu.",
        "**2 · Medicines** - medicine peru type cheyyandi. Stock lo entha undo pakkane kanipistundi.",
        "Qty pettandi - **dispensing units lo** (tablets, ml), pack lo kaadu. Ante 1 strip = 10 tablets ayithe **10** ani pettali.",
        "Batch automatic ga select avutundi (mundu expire ayye batch modata - FEFO). Vere batch kavali ante maarchandi.",
        "Total chusi - counter lo money teesukoni **bill raise cheyyandi**, or ward patient ayithe **room ki charge cheyyandi**.",
        "Bill print chesi patient ki ivvandi.",
      ],
    },
    {
      t: "warn",
      title: "Ward patient (inpatient) ayithe",
      lines: [
        "Aa medicine bill **counter lo collect cheyyakoodadu** - adi aa patient stay tab meeda padutundi and discharge time lo motham kalipi vasulu chestaru. Screen lo \"**Charged to the room**\" ani kanipistundi.",
        "Ee line ni tarvata **ward staff maarchaleru** - reception/insurance screen lo aa line meeda Edit / Remove pani cheyyavu. Tappu ayithe **pharmacy loney** correct cheyyali, ledaka return / reverse cheyyali. Enduku ante shelf meeda nunchi nijam ga medicine వెళ్ళindi - dani record ni ward maarchakoodadu.",
      ],
    },
    {
      t: "stop",
      title: "System oppukoni panulu",
      lines: [
        "**Expire ayina batch nunchi dispense cheyyalemu.**",
        "**Stock lo unna daani kanna ekkuva ivvalemu** - rack meeda unte, ante system lo receive cheyyaledu ani artham. Modata receive cheyyandi.",
      ],
    },

    { t: "h1", x: "5. Dues to collect - ward bills" },
    { t: "p", x: "Ward ki ichina medicines ki money inka raanivi ikkada untayi. **Paina unna ward bills** mukhyam - aa bill due unnantha varaku aa patient **discharge avvadu**, ante family bayata wait chestunnaru ani artham." },
    {
      t: "steps",
      items: [
        "List paina nunchi start cheyyandi.",
        "Family counter ki vachinappudu aa bill teesi money collect cheyyandi.",
        "Receipt print chesi ivvandi.",
      ],
    },
    {
      t: "note",
      lines: [
        "Cashless (insurance) patient ayithe aa bill **insurer ki velthundi** - family ni money adagakandi. Screen lo adi \"on the claim\" ani gurtu tho kanipistundi.",
      ],
    },

    { t: "h1", x: "6. Day close - counter drawer" },
    { t: "p", x: "Shift ayipoyaka pharmacy counter lo entha vachindo ikkada untundi - cash, UPI, card veru veru ga. Drawer lo unna cash tho match chesi print teesi pettandi. **Idi pharmacy counter money matrame** - reception, lab counters ki vaalla sonta day close untundi." },

    { t: "pb" },
    { t: "h1", x: "7. Stock - rack meeda em undi" },
    { t: "p", x: "Prati medicine ki **batch** ga stock untundi - batch number, expiry date, purchase rate, MRP. Okate medicine ki rendu batches unte rendu veru rows ga untayi, and expiry mundu unnadi modata dispense avutundi." },
    { t: "img", name: "pharmacy-stock-moves", svg: stockMoves },
    { t: "caption", x: "Stock number ee naalugu chotla matrame maarutundi. Inkelaina maarite - ante evaro system lo pettakunda medicine teesukellaru." },
    {
      t: "table",
      head: ["Pani", "Ela", "Eppudu"],
      widths: [26, 44, 30],
      rows: [
        ["**Receive stock**", "Medicine, batch, expiry, qty, purchase rate, MRP pettandi", "Direct ga stock vachinappudu (PO lekunda)"],
        ["**Remove stock**", "Qty + reason (damage, expired, broken)", "Bottle padipoyindi, expire ayindi, leakage"],
        ["Batch details maarchadam", "Aa batch row meeda click chesi correct cheyyandi", "Expiry date tappu ga type ayithe"],
      ],
    },
    {
      t: "warn",
      lines: [
        "**Expiry date correct ga pettandi.** Tappu date pettithe expire ayina medicine alerts lo raadu, and adi patient ki వెళ్ళochu. Idi ee counter lo జరిగే problems anniti kanna pedda risk.",
      ],
    },

    { t: "h1", x: "8. Alerts - expiry & low stock" },
    {
      t: "table",
      head: ["Tab", "Em chupistundi", "Em cheyyali"],
      widths: [26, 40, 34],
      rows: [
        ["**Expiring soon**", "Konni rojullo expire ayye batches (roju sankhya admin set chestaru)", "Modata ee batch ne dispense cheyyandi, ledaka supplier ki **expiry return** pampandi"],
        ["**Reorder**", "Thakkuva ayipoyina medicines", "Reorder screen lo velli purchase order pettandi"],
      ],
    },
    {
      t: "tip",
      lines: [
        "Expiring soon list ni **prati vaaram** okasari chudandi. Expiry ki 2-3 nెలalu mundu supplier ki pampithe credit note vastundi; expire ayyaka pampithe adi motham hospital nashtam.",
      ],
    },

    { t: "h1", x: "9. Konadam - Reorder, Purchase orders, Receive, Returns" },
    { t: "img", name: "pharmacy-buy-cycle", svg: buyCycle },

    { t: "h2", x: "9.1 Reorder" },
    { t: "p", x: "Ye medicines thakkuva unnayo, entha konali anedi ee screen chupistundi. Ikkada select chesi direct ga purchase order create cheyyochu." },

    { t: "h2", x: "9.2 Purchase orders (PO)" },
    {
      t: "steps",
      items: [
        "**Purchase orders** → kotta PO create cheyyandi.",
        "Supplier select cheyyandi (Suppliers screen lo mundu add chesi undali).",
        "Medicines + quantities pettandi.",
        "PO save chesi supplier ki pampandi. PO ki **PO number** vastundi.",
        "PO page lo **Ordered / Deliveries / Timeline / Notes** untayi - entha vachindi, entha రావాలi antha akkade kanipistundi.",
      ],
    },

    { t: "h2", x: "9.3 Receive goods - stock vachinappudu" },
    {
      t: "steps",
      items: [
        "**Receive goods** screen lo **Expected deliveries** lo aa PO select cheyyandi.",
        "Supplier invoice lo unna prakaram - **batch number, expiry date, qty, purchase rate, MRP** prati item ki pettandi.",
        "Free goods (scheme) vaste avi kuda qty lo kalapandi - lekapothe stock tappu avutundi.",
        "Total chusi supplier bill amount tho **match ayinda choodandi**, tarvata save cheyyandi.",
        "Save ayyaka aa qty stock loki vastundi and dispense cheyyadaniki సిద్ధం.",
      ],
    },
    {
      t: "warn",
      lines: [
        "Batch number and expiry **supplier invoice / strip meeda unnadi ne** pettandi - guess cheyyakandi. Ivi tappu ayithe tarvata aa batch ni return cheyyalemu, expiry alert raadu.",
      ],
    },

    { t: "h2", x: "9.4 Returns - supplier ki వెనక్కి" },
    {
      t: "table",
      head: ["Reason", "Eppudu"],
      widths: [40, 60],
      rows: [
        ["**Damaged in transit**", "Box lo bottle padipoyi / leak ayyi vachindi"],
        ["**Excess / not ordered**", "Order cheyyanidi pampinchaaru, or ekkuva pampinchaaru"],
        ["**Expiry credit - near-dated stock**", "Expire avvadaniki mundu ne supplier ki pampi credit teesukovadam"],
        ["**Expired stock**", "Already expire ayipoyindi"],
      ],
    },
    {
      t: "steps",
      items: [
        "Return create chesi medicine, batch, qty, reason pettandi - adi **DRAFT** lo untundi.",
        "Supplier ki pampinchaka **Mark as sent** kottandi.",
        "Supplier credit note ichaka **Amount actually credited** pettandi - appudu adi **CREDITED** avutundi.",
        "Credit raanivi \"**Money owed to us**\" lo untayi - vaati gurinchi supplier ni adagandi.",
      ],
    },

    { t: "h2", x: "9.5 Suppliers" },
    { t: "p", x: "Distributor peru, phone, GSTIN, address ikkada undali. **Manufacturer veru, supplier veru** - medicine ni thayaru chesevaadu manufacturer (masters lo), meeku ammevaadu supplier." },

    { t: "pb" },
    { t: "h1", x: "10. Masters - pharmacy vocabularies" },
    { t: "p", x: "Okate screen lo 8 tabs. Ivi \"ee pharmacy vaade padalu\" - kotta medicine add chese mundu ivi set chesi undali." },
    {
      t: "table",
      head: ["Tab", "Em pettali"],
      widths: [26, 74],
      rows: [
        ["**Categories**", "Shelf grouping (antibiotics, syrups...). Price/tax meeda effect ledu"],
        ["**Generics / salts**", "Andulo unna nijamaina salt. Stock leni时 substitute cheyyadaniki idi ne aadharam"],
        ["**Manufacturers**", "Evaru thayaru chesaro. (Ammevaadu Suppliers lo)"],
        ["**Dosage forms**", "Tablet, capsule, syrup, injection"],
        ["**Units**", "Dispensing unit - patient chetiki iche okati (tablet, ml). Pack kaadu"],
        ["**Tax rates**", "GST rates. Ivi maarusthe **already ammina bills maaravu**"],
        ["**HSN codes**", "Government classification - GST return deeni meeda file avutundi"],
        ["**Drug schedules**", "H, H1, X - mee licence documents lo unnadi ne pettandi. Idi automatic ga raadu"],
      ],
    },

    { t: "h1", x: "11. Problem vaste - em cheyyali" },
    {
      t: "table",
      head: ["Problem", "Enduku", "Em cheyyali"],
      widths: [28, 34, 38],
      rows: [
        ["Stock lo undi ani chupistundi, rack lo ledu", "Dispense system lo enter cheyyakunda ichaaru, or damage write-off cheyyaledu", "**Remove stock** lo reason tho correct cheyyandi and in-charge ki cheppandi"],
        ["Rack lo undi, system lo ledu", "Receive cheyyaledu", "**Receive goods** or **Receive stock** lo batch + expiry tho enter cheyyandi"],
        ["Expire ayina medicine alert raaledu", "Expiry date tappu ga enter ayindi", "Aa batch lo expiry correct cheyyandi"],
        ["Ward patient counter lo money adugutunnaru", "Adi room ki charge ayindi", "Discharge lo collect avutundi ani cheppandi - counter lo teesukokandi"],
        ["Ward tab lo pharmacy line tappu undi", "Ward nunchi daanni maarchalemu", "Pharmacy lo aa dispense ni reverse / correct cheyyandi"],
        ["Prescription queue lo raaledu", "Reception medicines type cheyyaledu", "Reception ki cheppandi - chit photo matrame unte list raadu"],
        ["Supplier bill total match avvatledu", "Free goods / scheme qty, or rate tappu", "Receive screen lo qty and rate malli check cheyyandi"],
      ],
    },

    { t: "h1", x: "12. Padalu (Glossary)" },
    {
      t: "table",
      head: ["Padam", "Artham"],
      widths: [26, 74],
      rows: [
        ["**Batch**", "Okate medicine lo okate sari vachina lot - sonta expiry, sonta rate"],
        ["**Expiry (FEFO)**", "First Expiry First Out - mundu expire ayyedi mundu ivvali"],
        ["**Dispensing unit**", "Patient chetiki iche okati - tablet, ml. Pack kaadu"],
        ["**MRP**", "Strip meeda print ayina rate"],
        ["**Purchase rate**", "Supplier nunchi meeku vachina rate"],
        ["**PO**", "Purchase order - supplier ki iche order"],
        ["**Credit note**", "Return chesina stock ki supplier ivve money/credit"],
        ["**Charged to the room**", "Ward patient medicine - counter lo kaakunda discharge bill lo vasulu"],
        ["**Write-off**", "Damage/expiry valla stock ni theeyadam"],
      ],
    },
  ],
};
