const S = require("../svg");

const moneyRollup = S.lanes(
  [
    {
      name: "Counters",
      steps: [
        { label: "Reception", sub: "OP, IPD, advances", col: 0, tone: "teal" },
        { label: "Pharmacy", sub: "Medicine counter", col: 1, tone: "teal" },
        { label: "Lab", sub: "Test bills", col: 2, tone: "teal" },
      ],
    },
    {
      name: "Admin console",
      steps: [
        { label: "Day close", sub: "Anni counters okate chota", col: 3, tone: "amber" },
        { label: "All bills", sub: "Prati bill, prati status", col: 4, tone: "amber" },
      ],
    },
    {
      name: "Compliance",
      steps: [{ label: "Accounts & GST", sub: "Tally export, IRN", col: 5, tone: "blue" }],
    },
  ],
  { cols: 6, title: "Money ela paiki vastundi - counter nunchi GST return varaku" }
);

const switchMap = S.chain(
  [
    { label: "Bill editing", sub: "Reception/lab bill correct cheyyagalara", tone: "amber" },
    { label: "Block discharge on dues", sub: "Due unte discharge aagipotundi", tone: "amber" },
    { label: "After-hours OP", sub: "Clinic mugisaka fee rate", tone: "amber" },
    { label: "Expiry alert days", sub: "Pharmacy alerts eppudu", tone: "amber" },
    { label: "Public website", sub: "Online booking / callback", tone: "amber" },
    { label: "SMS", sub: "Codes, confirmations", tone: "amber" },
  ],
  { perRow: 3, title: "Hospital settings lo unna switches - ivi vere portals ni maarustayi" }
);

const trail = S.chain(
  [
    { label: "Staff pani chestaru", sub: "Bill, price, merge, discharge", tone: "teal" },
    { label: "Audit log", sub: "Evaru, eppudu, em maarcharu", tone: "blue" },
    { label: "Login activity", sub: "Evaru ekkadi nunchi login", tone: "blue" },
    { label: "Errors", sub: "System crash ayina chotlu", tone: "rose" },
  ],
  { perRow: 4, title: "Jarigina prati vishayam ekkada record avutundo" }
);

module.exports = {
  key: "admin",
  file: "Jeeva-Admin-Console-User-Manual.docx",
  title: "Admin Console",
  edition: "Jeeva HMS · Staff manual · Version 1.0",
  cover: [
    "Hospital owner / administrator kosam - roju money position, anni bills, GST & Tally, pharmacy and insurance overview, staff accounts, hospital settings, audit log and errors.",
    "Ee manual Telugu (Latin script) lo raasindi. Screen names, button labels app lo unnattu ne English lo unnayi.",
  ],

  blocks: [
    { t: "h1", x: "1. Ee manual evariki" },
    { t: "lead", x: "Hospital owner ki, and admin ga pani chese vaariki - system ni set chesi, money ni chusi, staff accounts ni chuse vaariki." },
    { t: "p", x: "Migilina portals **pani cheyyadaniki**. Ee console **choodadaniki and set cheyyadaniki**. Ikkada meeru rendu rakala panulu chestaru:" },
    {
      t: "ul",
      items: [
        "**Chudadam** - roju entha vachindi, entha due undi, stock entha undi, claims ekkada unnayi, evaru em chesaru.",
        "**Set cheyyadam** - hospital details, staff accounts, prices, wards, and portals ela behave cheyyalo decide chese switches.",
      ],
    },
    {
      t: "warn",
      title: "Oka mukhyamaina hecharika",
      lines: [
        "Ee console lo meeru marche oka switch - udaharanaki \"bill editing\" - **prati counter meeda vెంటనే** effect avutundi. Prati change mee peru tho audit log lo padutundi. Ratri 2 gantalaki off chesi marchipothe, tarvata \"enduku pani cheyyatledu\" ani vetakadam kastam - anduke prati change ki reason theliyali.",
      ],
    },

    { t: "h1", x: "2. Login & console" },
    { t: "p", x: "Admin portal address open chesi username tho login cheyyandi (SMS code or password). Sidebar lo screens moodu rakalu ga unnayi - **money**, **hospital setup**, **security**." },
    { t: "img", name: "admin-money-rollup", svg: moneyRollup },

    { t: "h1", x: "3. Overview - hospital position" },
    { t: "p", x: "Login ayyaka modati screen. Ee roju / ee nెలa numbers - patients, bills, collection, dues, admissions. Prati number pakkana **paina-kinda arrow** untundi - adi mundu period tho pole." },
    {
      t: "note",
      lines: [
        "Ikkada kanipinche numbers **counters lo unna same numbers ye** - veru ga lekka kattadu. Reception day close lo ₹X ante ikkada kuda ₹X ne (ikkada anni counters kalipi).",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "4. Money - roju lekka nunchi GST varaku" },

    { t: "h2", x: "4.1 Day close" },
    { t: "p", x: "Aa roju **prati counter** entha teesukundo okate screen lo. Reception, pharmacy, lab veru veru ga, and:" },
    {
      t: "table",
      head: ["Section", "Em chupistundi"],
      widths: [34, 66],
      rows: [
        ["**What each counter took**", "Counter wise motham"],
        ["**By payment type**", "Cash, UPI, card, netbanking"],
        ["**By counter**", "Ye counter lo entha"],
        ["**Refunds given**", "Aa roju వెనక్కి ichina money"],
        ["**Raised today, still due**", "Bill ayyi money raanidi"],
        ["**Billed to insurers today**", "Cashless bills - ivi collection lo raavu, insurer nunchi raavali"],
      ],
    },
    {
      t: "tip",
      lines: [
        "Roju drawer tally cheyyadam counter staff pani. Meeru ikkada chudalsinadi - **refunds** and **still due**. Refunds ekkuva unte enduko adagandi; due perugutunte evaru collect cheyyatledo teliyali.",
      ],
    },

    { t: "h2", x: "4.2 All bills" },
    { t: "p", x: "Hospital lo raise ayina **prati bill** - counter, patient, amount, paid, due, status tho. Filter chesi vetakochu. Oka patient \"nenu already kattanu\" ante idi ne open cheyyandi." },

    { t: "h2", x: "4.3 Accounts & GST" },
    {
      t: "table",
      head: ["Bhagam", "Deniki"],
      widths: [30, 70],
      rows: [
        ["**Tally export**", "Date range select chesi export teesi mee accountant ki ivvandi - manual ga type cheyyakkarledu"],
        ["**e-Invoicing (IRN)**", "Government portal lo IRN generate chesaka aa number ikkada record cheyyandi. **IRN padina bill ni tarvata evaru edit cheyyaleru** - adi government copy"],
        ["**Registered buyer**", "Company GSTIN meeda bill kavali ante aa details"],
      ],
    },

    { t: "h1", x: "5. Insurance & Pharmacy - owner view" },
    {
      t: "table",
      head: ["Screen", "Em chupistundi", "Gurthu"],
      widths: [22, 48, 30],
      rows: [
        ["**Insurance claims**", "Rendu tabs - **money** (entha claim chesaru, entha approve ayindi, entha raavali) and claims board", "Claims ni nadipedi insurance desk - vaalla portal veru"],
        ["**Pharmacy**", "Naalugu tabs - stock value, expiry risk, purchases, sales", "**Read-only** - ikkada nunchi order / write-off cheyyalemu. Adi counter pani"],
      ],
    },
    {
      t: "note",
      lines: [
        "Ee rendu screens lo numbers **aa portals lo unna same service nunchi ne** vastayi. Anduke \"admin lo oka number, pharmacy lo inko number\" ani jaragadu.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "6. Hospital setup" },

    { t: "h2", x: "6.1 Patients & Appointments" },
    { t: "p", x: "**Patients** - anni patient files, search tho. **Appointments** - motham appointment history, and *Referrals by person* (evaru evarini refer chesaro)." },

    { t: "h2", x: "6.2 Lab catalog & GST · Lab test prices" },
    { t: "p", x: "Tests master and rates. Lab bench and reception kuda ade rows ni maarchagalaru - **okate record, moodu doors**. Meeru ikkada GST/HSN chustaru; rates okesari maarchali ante **Lab test prices** grid vaadandi." },

    { t: "h2", x: "6.3 Wards & beds" },
    { t: "p", x: "Wards create cheyyadam, prati ward ki **roju rate** and GST pettadam, beds add cheyyadam." },
    {
      t: "warn",
      lines: [
        "Ward rate maarusthe adi **kotta admissions ki matrame** vartistundi. Already admit ayina patients admission time lo unna rate tho ne untaru - anduke bill lo paatha rate kanipiste adi tappu kaadu.",
      ],
    },

    { t: "h2", x: "6.4 HR & staff - login accounts" },
    { t: "p", x: "System lo login cheyyagaligedi ikkada create ayina vaallu matrame." },
    {
      t: "steps",
      items: [
        "Staff peru, mobile, role select cheyyandi (Receptionist, Doctor, Lab tech, Pharmacist, Insurance desk, Admin).",
        "**Username automatic ga** taiyaru avutundi (screen lo \"Username becomes...\" ani chupistundi) - adi vaalliki cheppandi.",
        "Password generate ayithe daanni **reveal** chesi vaalliki ivvandi (staff long passwords marchipotaru).",
        "Staff velli poyaka **Remove** kottandi - appudu vaallu login cheyyaleru.",
      ],
    },
    {
      t: "table",
      head: ["Role", "Ye portal", "Mukhyamaina hakku"],
      widths: [24, 24, 52],
      rows: [
        ["**Receptionist**", "Reception", "Register, book, bill, admit, discharge, lab order"],
        ["**Doctor**", "Doctor", "Sonta patients queue, chart, results (read-mostly)"],
        ["**Pharmacist**", "Pharmacy", "Dispense, stock, purchase, returns"],
        ["**Lab tech**", "Labs", "Orders, results, lab bills, catalogue"],
        ["**Insurance desk**", "Insurance", "Claims, pre-auth, final claims, stay bills reprice"],
        ["**Admin**", "Admin console", "Antha - settings, accounts, audit"],
      ],
    },
    {
      t: "note",
      title: "Doctor roster veru, doctor login veru",
      lines: [
        "Reception **Doctors** screen lo doctor peru, department, fee maarchagalaru - adi **roster**, login kaadu. Doctor ki portal login kavali ante **ikkada HR & staff lo** account create cheyyali.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "7. Hospital settings - switches" },
    { t: "img", name: "admin-switch-map", svg: switchMap },
    {
      t: "table",
      head: ["Setting", "On chesthe", "Off chesthe"],
      widths: [24, 38, 38],
      rows: [
        ["**Branding**", "Logo + peru anni portals lo, bills meeda print avutundi", "Default stethoscope mark untundi"],
        ["**Legal identity**", "GST invoice meeda hospital peru, address, GSTIN print avutundi", "**Idi tappaka correct ga undali** - GST compliance"],
        ["**Bill editing**", "Reception / lab bills ni correct cheyyochu (audit log tho)", "Bill raise ayyaka evaru maarchaleru - kotta bill ne raayali"],
        ["**Block discharge on dues**", "Pharmacy/lab bill due unte discharge aagipotundi", "Due unna kuda discharge avutundi - money poye risk"],
        ["**After-hours OP charges**", "Clinic time tarvata booking ki ekkuva fee automatic", "Ye time lo ayina okate fee"],
        ["**Pharmacy expiry alert days**", "Enni rojula mundu expiry alert kavalo", "-"],
        ["**Public website**", "Online booking, callback requests pani chestayi", "Website nunchi requests raavu"],
        ["**SMS**", "OTP, confirmations bayataki velthayi", "Codes raavu - staff password tho ne login avvali"],
      ],
    },
    {
      t: "stop",
      title: "Off cheyyadaniki mundu alochinchandi",
      lines: [
        "**Block discharge on dues** off chesthe - patient bayataki వెళ్ళaka pharmacy bill collect cheyyadam chala kastam.",
        "**Bill editing** on chesthe - counter staff bill ni maarchagalaru. Adi avasaram, kaani prati edit ni audit log lo chudandi.",
        "**SMS** off unte - kotta staff, patients login cheyyaleru.",
      ],
    },

    { t: "h1", x: "8. Security - evaru em chesaru" },
    { t: "img", name: "admin-trail", svg: trail },
    {
      t: "table",
      head: ["Screen", "Deniki", "Ela vaadali"],
      widths: [22, 40, 38],
      rows: [
        ["**Audit log**", "Prati mukhyamaina action - bill edit, price change, patient merge, discharge, claim, settings change", "Filters vaadandi: oka patient meeda antha, or oka staff aa roju em chesaru"],
        ["**Login activity**", "Evaru eppudu login ayyaru", "Ratri times lo unexpected logins choodandi"],
        ["**Errors**", "System crash ayina chotlu, enni sarlu ayindo tho", "Roju okasari chudandi - counter lo problem vaste ikkada kanipistundi"],
      ],
    },
    {
      t: "tip",
      title: "Rendu prashnalu ki audit log ye samadhanam",
      lines: [
        "\"Ee patient records meeda em jarigindi?\" - patient tho filter cheyyandi (medico-legal case ki idi kavali).",
        "\"Ee staff aa roju em chesaru?\" - staff + date tho filter cheyyandi (money or medicine doubt vachinappudu).",
      ],
    },

    { t: "h1", x: "9. Problem vaste - em cheyyali" },
    {
      t: "table",
      head: ["Problem", "Enduku", "Em cheyyali"],
      widths: [28, 34, 38],
      rows: [
        ["Staff \"bill edit cheyyalekapotunna\" antunnaru", "Bill editing off undi", "Settings → Billing lo on cheyyandi (audit log gurthu pettukondi)"],
        ["Discharge aagipotundi", "Due unna bills unnayi + block discharge on", "Money collect cheyyinchandi, or aa setting off cheyyandi"],
        ["OP fee ekkuva vastundi", "After-hours charge apply avutundi", "Settings → After-hours OP charges chudandi"],
        ["Kotta staff login avvatledu", "Account create cheyyaledu / SMS off undi", "HR & staff lo account, and SMS setting chudandi"],
        ["Bill meeda hospital address tappu", "Legal identity fill cheyyaledu", "Settings → Legal identity correct cheyyandi"],
        ["Tally export lo bills raavu", "Date range tappu, or aa range lo bills levu", "Range maarchi malli try cheyyandi"],
        ["Errors screen lo chala rows", "System lo bug undi", "Screenshot tho developer ki pampandi - error details akkade untayi"],
      ],
    },

    { t: "h1", x: "10. Padalu (Glossary)" },
    {
      t: "table",
      head: ["Padam", "Artham"],
      widths: [26, 74],
      rows: [
        ["**Day close**", "Aa roju aa counter lo entha vachindo lekka"],
        ["**Due**", "Bill ayyi inka raavalsina money"],
        ["**IRN**", "e-Invoice ki government ichche number. Adi padina bill ni maarchaleru"],
        ["**HSN**", "GST classification code"],
        ["**Audit log**", "Evaru em maarcharo record - ee console lo matrame kanipistundi"],
        ["**Role**", "Staff ki system lo unna hakku - login ye portal loki velthundo decide chestundi"],
        ["**Cashless**", "Patient kaakunda insurer katte bill"],
        ["**Write-off**", "Damage/expiry valla stock theeyadam"],
      ],
    },
  ],
};
