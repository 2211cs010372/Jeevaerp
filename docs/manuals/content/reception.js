const S = require("../svg");

const opdFlow = S.chain(
  [
    { label: "Register", sub: "Kotta patient → UHID", tone: "teal" },
    { label: "Book", sub: "Doctor + slot + fee", tone: "teal" },
    { label: "Check in", sub: "Vacharu ani tap cheyyi", tone: "teal" },
    { label: "Doctor", sub: "Meeru emi cheyyakkarledu", tone: "plain" },
    { label: "Prescription", sub: "Chit scan + medicines", tone: "blue" },
    { label: "Lab tests", sub: "Order + payment", tone: "blue" },
    { label: "Billing", sub: "Migilina money collect", tone: "amber" },
    { label: "Day close", sub: "Saayantram drawer tally", tone: "amber" },
  ],
  { perRow: 4, title: "OPD patient - modati nunchi chivari varaku" }
);

const ipdFlow = S.chain(
  [
    { label: "Admit", sub: "Bed board → patient + doctor", tone: "teal" },
    { label: "Advance", sub: "Deposit + receipt", tone: "teal" },
    { label: "Running tab", sub: "Roju charges padutayi", tone: "teal" },
    { label: "Ward work", sub: "Labs, medicines, transfer", tone: "blue" },
    { label: "Discharge summary", sub: "Doctor rasedi", tone: "blue" },
    { label: "Discharge & bill", sub: "Advance minus, GST", tone: "amber" },
    { label: "Collect", sub: "Cash / UPI / card", tone: "amber" },
    { label: "Print", sub: "Bill + summary ivvandi", tone: "plain" },
  ],
  { perRow: 4, title: "Inpatient (IPD) - admission nunchi discharge varaku" }
);

const moneyMap = S.lanes(
  [
    {
      name: "Counter",
      steps: [
        { label: "OP fee", sub: "Booking lo teesukuntaru", col: 0, tone: "teal" },
        { label: "Lab bill", sub: "Test order tho", col: 1, tone: "teal" },
        { label: "Pharmacy bill", sub: "Medicine window", col: 2, tone: "teal" },
        { label: "IPD bill", sub: "Discharge lo", col: 3, tone: "teal" },
      ],
    },
    {
      name: "Billing screen",
      steps: [{ label: "Migilinadi collect", sub: "Due unna bill ye ikkada", col: 4, tone: "amber" }],
    },
    {
      name: "Day close",
      steps: [{ label: "Reception drawer", sub: "Cash / UPI / card totals", col: 5, tone: "amber" }],
    },
  ],
  { cols: 6, title: "Money ekkada nunchi ekkadiki - reception drawer varaku" }
);

module.exports = {
  key: "reception",
  file: "Jeeva-Reception-Portal-User-Manual.docx",
  title: "Reception Portal",
  edition: "Jeeva HMS · Staff manual · Version 1.0",
  cover: [
    "Front desk staff kosam - patient registration, appointment booking, prescriptions, lab orders, billing, admissions and discharge.",
    "Ee manual Telugu (Latin script) lo raasindi. Screen names, button labels antha app lo unnattu ne English lo unnayi - so document lo chusina peru screen meeda kuda ade untundi.",
  ],

  blocks: [
    { t: "h1", x: "1. Ee manual evariki" },
    { t: "lead", x: "Reception portal ni roju vaade evarikaina - front desk staff, shift lo unna help desk, and kotta ga join ayina staff ki training kosam." },
    { t: "p", x: "Reception portal hospital lo **modati counter**. Patient hospital lo entering ayyaka jarige prati vishayam - registration, appointment, prescription, lab test, bill, admission, discharge - antha ikkada nunchi start avutundi. Migilina portals (pharmacy, labs, doctor, insurance) ee counter ichina information meeda ne pani chestayi." },
    { t: "p", x: "**Ee manual ela vaadali:** modati sari chadivetappudu section 2, 3, 4 chadavandi - login, sidebar, roju flow. Tarvata prati screen ki oka section undi; meeku kavalsina screen ni Contents lo choosi direct ga velli chadavandi." },
    {
      t: "note",
      title: "Oka mukhyamaina matter",
      lines: [
        "Ee system lo meeru chese prati action - bill correct cheyyadam, price maarchadam, patient records merge cheyyadam - **mee peru tho record avutundi** (audit log). Idi mimmalni doubt cheyyadaniki kaadu; nెలa tarvata \"ee bill ఎవరు maarcharu\" ani question vachinappudu answer undali ani.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "2. Portal ni open cheyyadam" },

    { t: "h2", x: "2.1 Login" },
    { t: "p", x: "Browser lo hospital ichina reception portal address open cheyyandi. Rendu vidhaala login cheyyochu:" },
    {
      t: "table",
      head: ["Method", "Ela", "Eppudu vaadali"],
      widths: [22, 45, 33],
      rows: [
        ["**SMS code** (default)", "Username type cheyyandi (udaharanaki `reception.ravi`) → mee registered mobile ki 6-digit code vastundi → aa code enter cheyyandi", "Counter lo andaru vaade common computer meeda. Password evariki teliyadu."],
        ["**Password**", "Login screen lo *Password* tab select chesi username + password", "Mee sonta computer / laptop. SMS raanappudu kuda idi pani chestundi."],
      ],
    },
    {
      t: "warn",
      title: "Login raakapothe",
      lines: [
        "**Code raaledu:** 60 seconds aagi *Resend* kottandi. Mee mobile number system lo tappu unte admin matrame correct cheyyagalaru.",
        "**Username marchipoyaru:** Username ekkuva ga `role.peru` format lo untundi (`reception.ravi`). Admin ki cheppi teesukondi - migilina staff ki mee username teliyadu.",
        "Password ni **evariki cheppakandi**. Mee login tho jarigina prati pani mee peru meeda record avutundi.",
      ],
    },

    { t: "h2", x: "2.2 Screen lo em untundi" },
    {
      t: "table",
      head: ["Bhagam", "Em chestundi"],
      widths: [26, 74],
      rows: [
        ["Sidebar (edamavaipu)", "Anni screens ki links. Konni links pakkana **number badge** untundi - adi \"idi chudakapothe money/patient waiting\" ani artham."],
        ["Search bar (Ctrl + K)", "Ekkada nunchi ayina keyboard lo **Ctrl + K** kottandi. Patient peru, phone number, or UHID type chesi direct ga aa patient ki vellochu, or \"Register a new patient\", \"Collect a payment\" lanti panulu vెంటనే open cheyyochu."],
        ["Settings (kudivaipu paina)", "Mee peru, theme (light / dark), logout."],
        ["Live updates", "Screen **automatic ga update avutundi**. Doctor prescription pampinchina, pharmacy bill raise chesina, meeru refresh cheyyakkarledu - number ala ne marutundi."],
      ],
    },
    {
      t: "tip",
      title: "Roju panilo time save chese oka alavatu",
      lines: [
        "Patient peru vetakadaniki sidebar lo Patients ki vellakandi - **Ctrl + K** kotti peru type cheyyandi. Patient dorikaka \"Open patient file\", \"Book appointment\", \"Order lab tests\", \"Admit to a bed\" - anni okate chota vastayi.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "3. Roju flow - patient ela velthadu" },
    { t: "p", x: "Sidebar lo screens ee kramam lo ne petharu - paina nunchi kindaki chadivithe patient journey ye." },
    { t: "img", name: "reception-opd-flow", svg: opdFlow },
    { t: "caption", x: "OPD patient: registration nunchi day close varaku. Neela boxes doctor tarvata jarige panulu." },
    { t: "p", x: "**Muఖyamaina point:** patient doctor daggara unnappudu meeku pani ledu. Doctor chit raasi ichaka - prescription scan cheyyadam, tests order cheyyadam, and money collect cheyyadam - ee moodu mee pani." },
    { t: "img", name: "reception-ipd-flow", svg: ipdFlow },
    { t: "caption", x: "Inpatient: bed allot chesinappudu nunchi discharge bill varaku." },

    { t: "pb" },
    { t: "h1", x: "4. Today - roju modati screen" },
    { t: "p", x: "Login ayyaka modati ga kanipinche screen. Ee roju appointments anni, evaru vacharu, evaru waiting - antha ikkada." },

    { t: "h2", x: "4.1 Patient vacharu ani cheppadam (Check in)" },
    {
      t: "steps",
      items: [
        "**Appointment queue** lo aa patient peru vetakandi (peru or phone number tho search cheyyochu).",
        "Patient vachaka aa row lo **Check in** kottandi.",
        "Adi tapte doctor screen lo aa patient queue lo kanipistadu. Meeru inkemi cheyyakkarledu.",
      ],
    },
    {
      t: "note",
      lines: [
        "Check in cheyyakapothe **doctor ki aa patient kanipinchadu**. Patient bayata kurchoni untaru, doctor \"evaru leru\" ani anukuntaru. Roju lo ekkuva ga jarige potpu idi.",
      ],
    },

    { t: "h2", x: "4.2 Emergency / casualty patient" },
    { t: "p", x: "Ratri 2 gantalaki emergency vachinappudu - appointment book cheyyadaniki time ledu. Today screen meeda unna **red emergency chip** kottandi; adi direct ga registration ni emergency mode lo open chestundi. Doctor peru appudu teliyakapoina parledu - tarvata **Who attended this emergency?** lo aa doctor ni pettochu." },

    { t: "h2", x: "4.3 Visit cancel cheyyadam / time maarchadam" },
    {
      t: "table",
      head: ["Situation", "Em cheyyali"],
      widths: [34, 66],
      rows: [
        ["Patient raanu ani phone chesaru", "Aa row lo **Cancel this visit?** → reason cheppandi. Slot malli khaali avutundi."],
        ["Patient late ga vastanu annaru", "**Move this visit** - vere slot ki maarchandi. Kotta ga book cheyyakandi, lekapothe okate patient ki rendu OP numbers vastayi."],
        ["Doctor raaledu", "Aa doctor patients andarini vere doctor ki or vere time ki move cheyyandi, and phone chesi cheppandi."],
      ],
    },

    { t: "pb" },
    { t: "h1", x: "5. Callback requests - website nunchi phone requests" },
    { t: "p", x: "Hospital website lo \"call me back\" ani number ichina vaallu ikkada vastaru. **Ivi appointments kaadu** - vaalliki inka slot ledu, OP number ledu, patient file kuda ledu. Unna okate vishayam: verify ayina mobile number." },
    {
      t: "steps",
      items: [
        "List **paina unna vaadi nunchi** start cheyyandi - ekkuva sepu wait chesina vaadu paina untadu.",
        "Phone cheyyandi.",
        "Vaalliki appointment kavali ante - **Book** chesthe patient file, OP number, slot - moodu okesari create avutayi.",
        "Kavaddu / phone teeyaledu / tappu number ayithe - **Close this request** chesi reason cheppandi.",
      ],
    },

    { t: "h1", x: "6. Register patient - kotta patient file" },
    { t: "p", x: "Kotta face vachinappude idi. Patient ki **UHID** (Jeeva ID) istundi - adi aa patient ki jeevitham antha okate number." },
    {
      t: "table",
      head: ["Field", "Em pettali", "Gurthu"],
      widths: [24, 46, 30],
      rows: [
        ["Full name", "Aadhaar / ration card lo unna peru", "Bill meeda, claim meeda ide print avutundi"],
        ["Mobile", "10-digit number, patient di or intilo vaalladi", "SMS, OTP, callback antha ee number ki"],
        ["Age / Gender", "Correct ga", "Lab reference values ivi choosi ne decide avutayi"],
        ["Address", "Village / area varaku", "GST bill meeda print avutundi"],
      ],
    },
    {
      t: "warn",
      title: "Modati ga search, tarvata register",
      lines: [
        "Register cheyyadaniki mundu **Ctrl + K** lo aa phone number kottandi. Aa patient already unte malli register cheyyakandi - lekapothe okate manishi ki rendu UHID lu vastayi, history rendu chotla చీలిపోతుంది, and insurance claim time lo problem avutundi.",
        "Rendu files already ayipoyi unte - Patients screen lo **Merge two records** undi (section 12 chudandi).",
      ],
    },

    { t: "h1", x: "7. Book appointment" },
    {
      t: "steps",
      items: [
        "Patient ni search cheyyandi (UHID / peru / phone). Kotta vaaru ayithe akkade register cheyyochu.",
        "**Doctor** select cheyyandi - aa doctor khaali unna slots matrame kanipistayi.",
        "Slot kottandi. **Fee automatic ga vastundi** - meeru type cheyyakkarledu.",
        "Money teesukoni payment mode (cash / UPI / card) select chesi confirm cheyyandi.",
        "Confirmation screen lo **OP number** vastundi - adi patient ki cheppandi, sheet print cheyyandi.",
      ],
    },
    {
      t: "note",
      title: "After-hours charge",
      lines: [
        "OP clinic time ayipoyaka book chesthe fee **automatic ga ekkuva** chupistundi (hospital settings lo set chesina rate prakaram). Adi tappu kaadu - system correct ga ne chestundi. Patient adigithe \"after-hours consultation charge\" ani cheppandi.",
      ],
    },

    { t: "h1", x: "8. Prescriptions - doctor chit ni system lo pettadam" },
    { t: "p", x: "Doctor chetito raasina chit ni ikkada scan/photo upload cheyyandi, and andulo unna medicines & tests ni type cheyyandi. Idi chesthe ne pharmacy ki, lab ki aa order velthundi." },
    {
      t: "steps",
      items: [
        "**1 · Patient** - patient and aa roju consultation select cheyyandi.",
        "**3 · Vitals** - BP, weight, temperature - chit meeda unte pettandi (optional).",
        "**4 · Medicines, labs & sheet** - medicine peru type cheste stock lo unna medicines suggest avutayi. Tests kuda ikkade add cheyyochu. Chit photo attach cheyyandi.",
        "Save chesthe - pharmacy queue lo aa prescription kanipistundi; tests lab queue loki velthayi.",
      ],
    },
    {
      t: "tip",
      lines: [
        "Chit photo matrame upload chesi medicines type cheyyakapothe pharmacy ki **list raadu** - vaallu photo choosi type cheyyali, and akkade tappulu vastayi. Time unte medicines type cheyyandi.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "9. Lab tests" },
    { t: "p", x: "Sidebar lo **Lab tests** pakkana orange number kanipiste - adi \"doctor advise chesina tests, kaani inka evaru order cheyyaledu\" ani artham. Aa number roju chివari ki 0 avvali." },
    {
      t: "steps",
      items: [
        "**1 · Who is it for?** - patient select cheyyandi (admitted patient ayithe kuda ikkade dorukutadu).",
        "**2 · Which tests?** - tests select cheyyandi. Prati test pakkana rate kanipistundi.",
        "**Summary** lo total chusi payment teesukondi. Admitted patient ayithe payment ippude teesukokunda **room tab** ki pettochu - adi discharge bill lo vastundi.",
      ],
    },
    {
      t: "warn",
      title: "Rate ₹0 ani chupisthe",
      lines: [
        "Aa test ki price set cheyyaledu ani artham. **Lab test prices** screen lo (sidebar lo Lab tests kinda ne undi) correct rate pettandi - lab staff leni time lo kuda meeru cheyyochu. Prati price change mee peru tho record avutundi, so correct rate matrame pettandi.",
      ],
    },

    { t: "h1", x: "10. Billing - money collect cheyyadam" },
    { t: "p", x: "Ee screen lo **inka due unna bills** untayi - OP, lab, pharmacy, inpatient anni. Patient money ichinappudu ikkade record cheyyali." },
    {
      t: "table",
      head: ["Pani", "Ela cheyyali", "Gurthu"],
      widths: [26, 46, 28],
      rows: [
        ["**Collect payment**", "Bill teesi amount + mode (cash/UPI/card) enter cheyyandi. Konchem konchem ga kuda teesukovachu.", "Part payment chesthe migilinadi due lo ne untundi"],
        ["**Split payment**", "Okate bill lo ₹500 cash + migilinadi UPI - rendu legs add cheyyochu", "Motham bill kanna ekkuva teesukolemu"],
        ["**Give money back** (refund)", "Reason raasi refund amount enter cheyyandi", "Teesukunna daani kanna ekkuva refund cheyyalemu"],
        ["**Void this bill**", "Tappu ga raise ayina bill ni cancel cheyyadam", "Money already teesukunte mundu refund cheyyali"],
        ["**Edit bill**", "Bill lo lines / date / discount correct cheyyadam", "Admin ee facility **on** chesthe ne kanipistundi"],
      ],
    },
    {
      t: "stop",
      title: "System oppukoni panulu",
      lines: [
        "**Already collect chesina money kanna thakkuva ki bill ni maarchalemu** - modati refund ivvali, tarvata bill edit cheyyali.",
        "**Cancel ayina bill ni malli edit cheyyalemu.** Kotta bill raise cheyyali.",
        "**e-Invoice (IRN) file ayina bill ni maarchalemu** - adi government copy. Admin tho matladandi.",
      ],
    },
    { t: "img", name: "reception-money-map", svg: moneyMap },
    { t: "caption", x: "Prati counter sonta bill raise chestundi. Due unnavi Billing screen lo kanipistayi, and roju chivari lo Day close lo tally avutayi." },

    { t: "h1", x: "11. Day close - roju chivari lekka" },
    { t: "p", x: "Shift / roju ayipoyaka **Day close** open cheyyandi. Ikkada **reception drawer** lo entha రావాలో untundi - cash entha, UPI entha, card entha." },
    {
      t: "steps",
      items: [
        "Day close screen lo cash total chudandi.",
        "Drawer lo unna nijamaina cash lekka pettandi.",
        "Rendu okate ayithe print teesi sign chesi pettandi.",
        "Theda unte - aa roju bills lo evaraina refund ichara, ledaka mode tappu ga select ayinda choodandi. Theda ni **alage vadilesi vellakandi**; shift in-charge ki cheppandi.",
      ],
    },
    {
      t: "note",
      lines: [
        "Ee screen lo **reception counter money matrame** untundi. Pharmacy, lab counters vaalla sonta day close vaallaki untundi. Motham hospital lekka admin console lo untundi.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "12. Admissions (IPD) - patient ni bed lo cherchadam" },

    { t: "h2", x: "12.1 Bed board & admit" },
    {
      t: "steps",
      items: [
        "**Admissions** screen lo ward & bed board untundi - green khaali, occupied bed meeda patient peru untundi.",
        "Khaali bed meeda click chesi **Admit a patient** open cheyyandi.",
        "Patient UHID, attending doctor, reason select cheyyandi.",
        "**Payer** select cheyyandi - Self pay or Insurance. Insurance ayithe insurer peru kuda pettandi.",
        "Admit kottandi - **IP number** vastundi.",
      ],
    },
    {
      t: "warn",
      title: "Insurance patient ayithe",
      lines: [
        "Admission time lo payer **Insurance** ani pettakapothe - insurance desk ki aa patient kanipinchadu, pre-authorization raadu, and insurer motham stay ni refuse cheyyochu. Policy card chusina వెంటనే idi correct ga pettandi.",
      ],
    },

    { t: "h2", x: "12.2 Advance (deposit)" },
    { t: "p", x: "Stay screen lo **Take an advance** - family ichina deposit ni ikkada record cheyyandi. Receipt number vastundi; adi discharge bill lo automatic ga minus avutundi. Receipt malli print cheyyali ante ade screen lo advances list lo undi." },

    { t: "h2", x: "12.3 The running tab - roju charges" },
    { t: "p", x: "Patient bed lo unnantha sepu aa stay ki entha ayindo ee list chupistundi:" },
    {
      t: "ul",
      items: [
        "**Bed charges** - roju rate × entha rojulu (automatic).",
        "**Nursing care** - roju rate (automatic).",
        "**Service charges** - procedure, doctor round, oxygen, dressing lanti వాటిని meeru add chestaru.",
        "**Pharmacy / lab bills** - aa stay ki raise ayina bills, paid or due ani gurtu tho.",
      ],
    },
    { t: "h3", x: "Tab ki charge add cheyyadam" },
    {
      t: "steps",
      items: [
        "Kinda **Add to the tab** section lo velli **rate card** dropdown nunchi service select cheyyandi - description and rate automatic ga padatayi.",
        "Rate card lo lekapothe description, qty, rate manually type cheyyochu.",
        "GST ekkuva hospital services ki **0** - CA cheppithe tappa maarchakandi.",
        "**Add** kottandi.",
      ],
    },
    { t: "h3", x: "Tappu ga padina line ni correct cheyyadam" },
    { t: "p", x: "Prati service charge line pakkana **Edit** button undi (pharmacy nunchi vachina lines tappa). Adi kottite oka dialog open avutundi - andulo **Qty, Rate, GST, and Date & time given** maarchochu." },
    {
      t: "table",
      head: ["Enduku vaadali", "Udaharana"],
      widths: [34, 66],
      rows: [
        ["**Date correct cheyyadam**", "Ward paper meeda raasi ichindi meeru saayantram 4 gantalaki ekkinchinappudu - anni lines aa saayantram time tho print avutayi. Nijam ga eppudu ichcharo aa date pettandi. Print ayye tab/bill meeda ade kanipistundi."],
        ["**Rate correct cheyyadam**", "Dressing ₹450 ani padindi, nijam ga ₹350. Line delete chesi malli add cheyyakandi - Edit lo rate maarchandi, appudu **evaru modata add chesaro aa record poddu**."],
      ],
    },
    {
      t: "note",
      title: "Dialog lo em kanipistundo",
      lines: [
        "Paina aa line ye chupistundi (\"Now 1 × ₹450.00 = ₹450.00 · 16-08-2026, 4:10 PM\") - tappu line ni maarchakunda undataniki.",
        "Kinda kotta total and theda chupistundi: \"↓ ₹100.00 on what this line bills today.\"",
        "Date **stay lopala** ne undali - admission ki mundu, discharge tarvata, or future date accept cheyyadu.",
        "**Rate box khaali chesi Save cheyyalemu.** Charge ni theeyali ante **Remove** vaadandi.",
      ],
    },
    {
      t: "warn",
      title: "Discharge ayina stay lo rate maarusthe",
      lines: [
        "Bill already issue ayindi kabatti, qty/rate/GST maarusthe aa **discharge bill malli issue avutundi** (receipt number ade untundi). Already collect chesina money kanna thakkuva ki maarusthe system oppukodu.",
        "**Date matrame** maarusthe bill malli issue avvadu - date invoice meeda undadu.",
      ],
    },

    { t: "h2", x: "12.4 Ward lo migilina panulu" },
    {
      t: "table",
      head: ["Pani", "Ekkada", "Em avutundi"],
      widths: [26, 30, 44],
      rows: [
        ["Lab tests order", "**Order lab tests**", "Tests room tab ki charge avutayi, lab queue loki velthayi"],
        ["Medicines", "IP prescription", "Pharmacy ki velthundi; medicine room ki charge avutundi, counter lo patient ni money adagaru"],
        ["Bed maarchadam", "**Move to another bed**", "General → ICU. Mundu unna rojulu paatha rate tho ne untayi; kotta rate aa roju nunchi"],
        ["Transfer tappu ayithe", "**Remove this transfer**", "Bed charge malli lekkistundi"],
        ["Nursing notes", "**Nursing & observation notes**", "Shift handover - vitals, night ela gadichindi. Ivi **edit / delete cheyyalemu**"],
        ["Bed/nursing rate, dates correct", "**Correct the stay's charges**", "Bed rate, nursing rate, admission/discharge date - bill lo pedda numbers ivi"],
      ],
    },

    { t: "h2", x: "12.5 Discharge" },
    {
      t: "steps",
      items: [
        "Doctor **discharge summary** raasaadu ani confirm cheyyandi (stay screen lo Discharge summary).",
        "Pharmacy / lab bills due unnaya choodandi - stay screen lo amber lo kanipistayi.",
        "**Discharge & bill** kottandi. Advance automatic ga minus avutundi.",
        "Migilina money collect cheyyandi (split payment kuda cheyyochu).",
        "**Bill + discharge summary print** chesi family ki ivvandi.",
      ],
    },
    {
      t: "stop",
      title: "Discharge aagipothe",
      lines: [
        "Pharmacy or lab bill due unte hospital settings prakaram discharge **block** avutundi. Aa money collect cheyyandi, ledaka in-charge permission tho \"discharge with dues\" option vaadandi - adi mee peru tho record avutundi.",
      ],
    },

    { t: "pb" },
    { t: "h1", x: "13. Patients - files, history, merge" },
    { t: "p", x: "Patient file lo **Patient details, Visits, Prescriptions, Bills** anni okate chota untayi. Patient \"naaku last time em rasaru\" ani adigithe ikkada chudandi." },
    {
      t: "h3", x: "Rendu files okate manishi ki unte (Merge)",
    },
    {
      t: "steps",
      items: [
        "Patients screen lo **Merge two records** open cheyyandi.",
        "**Yedi undali** (main file) and **yedi kaliపోవali** (duplicate) select cheyyandi - phone number, age chusi confirm cheyyandi.",
        "Merge chesaka duplicate file lo unna visits, bills, tests anni main file loki vastayi.",
      ],
    },
    {
      t: "warn",
      lines: [
        "Merge **వెనక్కి teesukoleru**. Rendu files okate manishi vi ani 100% confirm ayyaka ne cheyyandi - peru okate unna ఇద్దరు వేరే manushulu కావchu (phone number, age chudandi).",
      ],
    },

    { t: "h1", x: "14. Schedule & Doctors" },
    {
      t: "table",
      head: ["Screen", "Deniki"],
      widths: [22, 78],
      rows: [
        ["**Schedule**", "Ye doctor eppudu unnaru ani chudadaniki. Patient \"doctor eppudu vastaru\" ani adigithe ikkada chudandi."],
        ["**Doctors**", "Roster - doctor peru, department, qualification, fee correct cheyyadam; kotta doctor ni add cheyyadam. **Idi login account kaadu** - doctor ki portal login kavali ante admin create cheyyali."],
      ],
    },

    { t: "h1", x: "15. Print - em print cheyyochu" },
    {
      t: "table",
      head: ["Document", "Ekkada nunchi"],
      widths: [34, 66],
      rows: [
        ["OP sheet", "Booking confirm ayyaka, or patient file lo aa visit nunchi"],
        ["Bill / invoice", "Billing screen, or patient file lo Bills"],
        ["Lab report", "Lab test row nunchi"],
        ["Running tab (statement)", "Stay screen lo **Print tab** - idi bill kaadu, \"ippati varaku entha ayindi\" ani chupinche statement"],
        ["Advance receipt", "Stay screen lo advances list nunchi"],
        ["Discharge summary / final bill", "Stay screen nunchi"],
        ["Blank OPD sheet", "Ctrl + K → \"Print a blank OPD sheet\" - **current pothe** chetito raayadaniki"],
      ],
    },

    { t: "pb" },
    { t: "h1", x: "16. Problem vaste - em cheyyali" },
    {
      t: "table",
      head: ["Problem", "Enduku vastundi", "Em cheyyali"],
      widths: [28, 36, 36],
      rows: [
        ["Doctor screen lo patient kanipinchatledu", "Check in cheyyaledu", "Today lo aa patient ki **Check in** kottandi"],
        ["Pharmacy ki prescription raaledu", "Chit upload chesaru kaani medicines type cheyyaledu / save avvaledu", "Prescriptions screen lo malli open chesi medicines pettandi"],
        ["Lab test rate ₹0", "Aa test ki price set cheyyaledu", "**Lab test prices** lo correct rate pettandi"],
        ["Patient ki rendu UHID lu", "Duplicate registration", "Patients → **Merge two records**"],
        ["Discharge avvatledu", "Pharmacy / lab bill due undi", "Aa bill collect cheyyandi, or in-charge tho \"discharge with dues\""],
        ["Bill edit button kanipinchatledu", "Admin bill editing off chesaru", "Admin ni adagandi - adi hospital settings lo switch"],
        ["Printed tab lo anni charges okate date tho", "Anni oke sari ekkinchaaru", "Prati line ki **Edit** → correct date pettandi (12.3 chudandi)"],
        ["Screen load avvatledu / error", "Internet or server problem", "Page refresh cheyyandi. Malli vaste screenshot teesi admin ki pampandi - error automatic ga record avutundi"],
      ],
    },

    { t: "h1", x: "17. Padalu (Glossary)" },
    {
      t: "table",
      head: ["Padam", "Artham"],
      widths: [26, 74],
      rows: [
        ["**UHID / Jeeva ID**", "Patient ki jeevitham antha okate number. Prati visit, bill, test deeni kinda ne untundi"],
        ["**OP number**", "Aa roju aa consultation ki number"],
        ["**IP number**", "Aa admission (stay) ki number"],
        ["**Running tab**", "Patient bed lo unnappudu perige charges list. Idi bill kaadu"],
        ["**Advance**", "Admission time lo teesukune deposit. Discharge bill lo minus avutundi"],
        ["**Due**", "Bill lo inka raavalsina money"],
        ["**Void**", "Tappu ga raise ayina bill ni cancel cheyyadam"],
        ["**Refund**", "Teesukunna money ni వెనక్కి ivvadam"],
        ["**Day close**", "Aa roju aa counter lo entha vachindo lekka"],
        ["**Cashless / Insurance stay**", "Bill patient kaakunda insurer ki velle stay"],
        ["**Audit log**", "Evaru em maarcharo record chese list - admin daggara untundi"],
      ],
    },
    {
      t: "note",
      title: "Chivariki",
      lines: [
        "Ee manual lo cheppanidi screen meeda kanipiste - or screen lo unna daani kanna manual lo veru ga unte - admin ki cheppandi. Software update ayithe manual kuda update cheyyali.",
      ],
    },
  ],
};
