/**
 * Public site content.
 *
 * Copy principle: a person landing here is usually worried, often on a phone,
 * often on behalf of a parent. They want three answers fast - can I be seen
 * today, where are you, and who will I see. Everything else is secondary.
 * No "world-class healthcare solutions". Plain words, specific facts.
 */

export const HOSPITAL = {
  name: "Jeeva Multispeciality Hospital",
  shortName: "Jeeva",
  tagline: "Multispecialty care in Hanamkonda",
  address: "Road No. 4, Near Asian Cinema, Baala Samudhram, Hanamkonda, Telangana – 506001",
  locality: "Hanamkonda, Warangal",
  email: "info@jeevamultispecialityhospital.com",
  phone: "+91 9100005195",
  emergency: "+91 9100005195",
  opdHours: "8:00 AM – 8:00 PM",
  opdDays: "24/7",
  /**
   * JS day indices (0 = Sunday) on which routine OPD does not run. MUST be kept
   * in step with `opdDays` above - the navbar's live status pill reads this to
   * decide whether to say "open now", and without it the strip cheerfully told
   * visitors the OPD was open on a Sunday.
   */
  opdClosedDays: [0],
  mapUrl: "https://maps.google.com/?q=Hanamkonda,Telangana",
};

/** One thing a department does, with a line explaining it in plain words. */
export interface Service {
  name: string;
  /** What it is, or when you'd come in for it. One sentence, no jargon. */
  desc: string;
}

/**
 * The patient-education block on a department page.
 *
 * SAFETY NOTE for whoever edits this next: `warningSigns` is the part that
 * matters most and the part to be most conservative with. It exists to get
 * someone to a hospital sooner, so it errs towards "come in" - it must never
 * read as reassurance, and it must never be specific enough to be used as a
 * substitute for being seen. `prevention` and `selfCare` stay at the level of
 * ordinary, widely-agreed public health advice. Nothing here prescribes a drug,
 * a dose, or a treatment decision; that is the consultation's job.
 */
export interface DeptGuidance {
  /** A fuller description than the one-line blurb. */
  about: string;
  /** Red flags - reasons to come in now rather than book. */
  warningSigns: string[];
  /** What genuinely lowers the risk. */
  prevention: string[];
  /** Sensible things to do at home, alongside treatment. */
  selfCare: string[];
}

export interface Department {
  index: string;
  name: string;
  blurb: string;
  /** Anchors the card in something concrete a patient recognises. */
  common: string;
  /** Drop the photo into /public/images with this name and it appears;
   *  until then a designed icon tile renders in its place. */
  image: string;
  /**
   * What this department actually does, listed the way a patient searches for
   * it. These are the navbar's sub-items.
   *
   * Deliberately scoped to what Jeeva has already published elsewhere on this
   * site - the eight departments, an in-house lab and radiology, a day theatre,
   * ICU and a 24×7 emergency. Nothing here promises a service the hospital has
   * not claimed: listing a specialty a family then travels for is worse than
   * listing nothing.
   */
  services: Service[];
  guidance: DeptGuidance;
}

export const DEPARTMENTS: Department[] = [
  {
    index: "01", name: "Cardiology",
    blurb: "Chest pain, blood pressure and heart rhythm - assessed the same day, with ECG and echo in-house.",
    common: "ECG · 2D Echo · TMT", image: "/images/dept-cardiology.avif",
    services: [
      { name: "Chest pain assessment", desc: "Sudden or repeated chest pain, checked with an ECG before you leave the building." },
      { name: "High blood pressure", desc: "Readings that stay high, and the changes that bring them down and keep them there." },
      { name: "Palpitations & rhythm problems", desc: "A heart that races, skips or thumps - traced on an ECG to find why." },
      { name: "Heart failure follow-up", desc: "Regular review when the heart pumps weakly, to control breathlessness and swelling." },
      { name: "After a heart attack", desc: "Recovery checks, medicines, and honest answers on what you can safely do again." },
      { name: "Cholesterol & lipid review", desc: "A blood test and a plan if cholesterol is high or runs in your family." },
      { name: "ECG", desc: "A five-minute trace of your heartbeat, read by the doctor in the same visit." },
      { name: "2D Echocardiogram", desc: "An ultrasound showing how well the heart's valves and pumping are working." },
      { name: "Treadmill test (TMT)", desc: "Walking on a treadmill while monitored, to see how the heart copes under effort." },
      { name: "24-hour BP monitoring", desc: "A cuff worn for a day, so we see your real blood pressure - not the nervous reading." },
      { name: "Pre-surgery heart clearance", desc: "The heart check a surgeon asks for before an operation." },
    ],
    guidance: {
      about: "Heart problems rarely announce themselves clearly. Most people arrive with something vague - pressure in the chest while climbing stairs, unusual tiredness, a BP reading a chemist took. This department exists to settle those questions quickly rather than schedule them: ECG, echo and TMT are all in this building, so a first visit usually ends with an answer instead of a list of tests to arrange elsewhere.",
      warningSigns: [
        "Chest pain or heavy pressure lasting more than a few minutes - do not drive yourself, call for help",
        "Chest discomfort spreading to the jaw, neck, back or either arm",
        "Sudden breathlessness at rest, or waking at night gasping",
        "Fainting, or nearly fainting, with a racing or pounding heartbeat",
        "Cold sweat, nausea and unease alongside chest discomfort - common in women and in people with diabetes",
      ],
      prevention: [
        "Know your numbers: blood pressure, blood sugar and cholesterol, checked once a year after 30",
        "Stop tobacco in every form - it is the single biggest change most people can make",
        "Thirty minutes of brisk walking most days beats occasional hard exercise",
        "Cut down salt, deep-fried food and reused cooking oil",
        "Treat diabetes and blood pressure properly - they damage the heart quietly, long before symptoms",
      ],
      selfCare: [
        "Take heart and BP medicines every day, at the same time - not only when you feel unwell",
        "Never stop a heart medicine because you feel better; ask first",
        "Keep a home BP diary and bring it to appointments",
        "Weigh yourself daily if you have heart failure, and report a sudden gain",
        "Keep a written list of your medicines in your wallet, for an emergency",
      ],
    },
  },
  {
    index: "02", name: "Orthopaedics",
    blurb: "Fractures, joint pain and spine trouble. Digital X-ray on site, so you don't travel for a scan.",
    common: "Fractures · Knee · Spine", image: "/images/dept-orthopaedics.avif",
    services: [
      { name: "Fractures & trauma", desc: "Broken bones set and supported, with X-ray on site so nothing is missed." },
      { name: "Plaster and casting", desc: "New casts, cast changes, and removal once the bone has healed." },
      { name: "Knee pain & arthritis", desc: "Knees that ache, swell or lock - treated without jumping straight to surgery." },
      { name: "Hip pain", desc: "Pain in the hip or groin that makes walking, sitting or stairs difficult." },
      { name: "Shoulder & elbow pain", desc: "Frozen shoulder, tennis elbow and injuries that limit your reach." },
      { name: "Back and neck pain", desc: "Long-standing pain, including pain that travels down an arm or leg." },
      { name: "Sports injuries", desc: "Twists, tears and overuse injuries, with a plan to get you back to playing." },
      { name: "Sprains & ligament injury", desc: "Ankle and knee sprains checked properly, so a small tear doesn't become permanent." },
      { name: "Digital X-ray", desc: "On-site imaging, so you aren't sent across town and back for a picture." },
      { name: "Joint injections", desc: "Targeted injections for a painful joint when tablets aren't enough." },
      { name: "Post-operative physiotherapy", desc: "Guided exercise after surgery or a fracture, to get strength and movement back." },
    ],
    guidance: {
      about: "Bone and joint problems are where people wait longest - a knee is tolerated for years, a back is blamed on age. That waiting is usually what makes the treatment harder. With digital X-ray on site, most problems are seen, imaged and explained in one visit, and a good number are managed with physiotherapy, injections and load changes rather than an operation.",
      warningSigns: [
        "A limb that looks bent, or a bone you can see - keep it still and come in",
        "Numbness, pins and needles, or a limb going pale or cold after an injury",
        "Back pain with loss of bladder or bowel control, or numbness between the legs - this is an emergency",
        "A hot, swollen, intensely painful joint with fever",
        "Being unable to put any weight on a leg after a fall, especially in an older person",
      ],
      prevention: [
        "Keep weight in check - every extra kilo is several extra kilos through the knees",
        "Build leg and core strength; strong muscles protect the joints they surround",
        "Lift with the legs, close to the body, and never with a twist",
        "Make the house fall-proof for elders: lighting, dry floors, bathroom grab bars",
        "Calcium, protein and some daily sunlight - bone loss is silent until it breaks",
      ],
      selfCare: [
        "For a fresh sprain: rest, ice, a firm bandage and keep the limb raised",
        "Keep a plaster cast completely dry, and never poke anything inside it",
        "Do the physiotherapy exercises daily - recovery follows the exercises, not the calendar",
        "Keep moving gently with back pain; long bed rest makes most backs worse",
        "Use painkillers as advised, with food, and tell us if you need them every single day",
      ],
    },
  },
  {
    index: "03", name: "Gynaecology",
    blurb: "Antenatal care through delivery, and women's health at every stage of life.",
    common: "Antenatal · Delivery · Scan", image: "/images/dept-gynaecology.avif",
    services: [
      { name: "Antenatal (pregnancy) care", desc: "Regular checks through pregnancy - your health, the baby's growth, and the scans due at each stage." },
      { name: "Normal delivery", desc: "Delivery with the same doctor who has seen you through the pregnancy." },
      { name: "Caesarean delivery", desc: "Planned or emergency, with theatre and newborn care in the same building." },
      { name: "High-risk pregnancy", desc: "Closer monitoring for BP, diabetes, twins, or a difficult history." },
      { name: "Pregnancy scans", desc: "Dating, anomaly and growth scans, at the weeks they actually tell us something." },
      { name: "Menstrual problems", desc: "Periods that are heavy, painful, irregular, or have stopped." },
      { name: "PCOS & hormonal care", desc: "Irregular cycles, weight and hair changes - investigated and managed together." },
      { name: "Infertility first assessment", desc: "The first tests and honest advice for couples struggling to conceive." },
      { name: "Menopause care", desc: "Hot flushes, mood, sleep and bone health - and what genuinely helps." },
      { name: "Contraception advice", desc: "Options explained plainly, including what suits you after a delivery." },
      { name: "Cervical & breast screening", desc: "Pap smear and breast examination - the checks that find problems early." },
    ],
    guidance: {
      about: "Women's health here runs as continuous care rather than separate appointments: the doctor who confirms a pregnancy is the one at the delivery, and the same clinic handles the years before and after. A great deal of what comes through the door - heavy periods, PCOS, the changes around menopause - has been endured for years because it was assumed to be normal. It usually isn't, and it usually responds to treatment.",
      warningSigns: [
        "Any bleeding during pregnancy, at any stage",
        "Severe headache, blurred vision or sudden swelling of face and hands in later pregnancy",
        "Reduced or absent baby movements after the seventh month - come in the same day",
        "Fever with foul-smelling discharge, or heavy bleeding after a delivery",
        "Periods soaking through protection hourly, or bleeding after menopause",
      ],
      prevention: [
        "Start folic acid before conceiving, not after the test is positive",
        "Keep every antenatal appointment - most complications are caught at a routine visit",
        "Cervical screening from 30, then as advised; it prevents a cancer rather than finding one",
        "Learn how to examine your own breasts, and report any new lump without waiting",
        "Iron and calcium through pregnancy - anaemia is common here and entirely treatable",
      ],
      selfCare: [
        "In pregnancy: small frequent meals, plenty of water, and rest on your left side",
        "Count baby movements daily in the third trimester and know your usual pattern",
        "Never take any medicine, including home remedies, without asking during pregnancy",
        "After delivery, ask for help early if you feel low or unable to cope - it is common and treatable",
        "Keep your scan reports and antenatal card together, and bring them to every visit",
      ],
    },
  },
  {
    index: "04", name: "Paediatrics",
    blurb: "Newborns to teenagers - vaccinations, fevers, growth checks and the 2 a.m. worries.",
    common: "Vaccines · Fever · Growth", image: "/images/dept-paediatrics.avif",
    services: [
      { name: "Newborn check-ups", desc: "Weight, feeding, jaundice, and the questions every new parent has in the first weeks." },
      { name: "Vaccination schedule", desc: "Every vaccine your child is due, tracked so you don't lose the card or the date." },
      { name: "Childhood fever & infection", desc: "Fevers that won't settle, seen quickly rather than waited out." },
      { name: "Cough, cold & asthma", desc: "Repeated coughs and wheezing - and whether it is actually asthma." },
      { name: "Growth and nutrition", desc: "Height, weight and appetite measured against where your child should be." },
      { name: "Developmental checks", desc: "Sitting, walking, talking - reassurance, or early help if something is behind." },
      { name: "Diarrhoea & dehydration", desc: "Loose motions in a small child, treated before dehydration sets in." },
      { name: "Skin problems in children", desc: "Rashes, allergies and the infections common in young skin." },
      { name: "Adolescent health", desc: "Growth, puberty, acne and the things teenagers won't raise at home." },
      { name: "New-parent guidance", desc: "Feeding, sleep and safety - practical questions answered without judgement." },
      { name: "Child emergency care", desc: "Breathing trouble, injury or a very sick child. Come straight in, any hour." },
    ],
    guidance: {
      about: "Children are not small adults - they get sicker faster and recover faster, and the useful skill is telling those two apart. The clinic runs a long day for exactly that reason: a feverish child should be seen in hours, not next week. Alongside the sick visits, the steady work is vaccination, growth and development, where catching something early changes the whole course.",
      warningSigns: [
        "Fast, laboured breathing, or the skin sucking in between the ribs",
        "A baby under three months with any fever",
        "Too drowsy to wake properly, or floppy and unresponsive",
        "No urine for eight hours, no tears when crying, or a sunken soft spot",
        "A rash that does not fade when pressed with a glass, especially with fever",
        "A fit or convulsion, or refusing all feeds",
      ],
      prevention: [
        "Keep vaccinations exactly on schedule - a delay is a window of risk",
        "Exclusive breastfeeding for six months where possible, then continue alongside food",
        "Handwashing before meals prevents more childhood illness than any medicine",
        "Safe drinking water and freshly cooked food - most diarrhoea here is preventable",
        "Never keep medicines, kerosene or cleaning liquids within a child's reach",
      ],
      selfCare: [
        "For fever: light clothing, plenty of fluids, and paracetamol at the dose we give you by weight",
        "For loose motions: ORS after every episode - it matters far more than stopping the motions",
        "Never give a child antibiotics left over from someone else, or from a previous illness",
        "Keep the vaccination card safe and bring it to every visit, including sick visits",
        "Trust your instinct - a parent noticing 'something is not right' is a genuine reason to come in",
      ],
    },
  },
  {
    index: "05", name: "General Medicine",
    blurb: "The first door for fever, infection, diabetes and blood pressure. Where most visits start.",
    common: "Fever · Diabetes · BP", image: "/images/dept-general-medicine.avif",
    services: [
      { name: "Fever & seasonal infection", desc: "Typhoid, dengue, flu and the fevers going around - tested rather than guessed at." },
      { name: "Diabetes care", desc: "Sugar control, medicines, and the yearly checks that prevent complications." },
      { name: "Blood pressure", desc: "Getting high readings down, and keeping them down for good." },
      { name: "Thyroid problems", desc: "Tiredness, weight change and hair loss that turn out to be the thyroid." },
      { name: "Stomach & digestion", desc: "Acidity, pain, constipation and loose motions that keep coming back." },
      { name: "Breathlessness & cough", desc: "Breathing that has got harder, or a cough lasting more than three weeks." },
      { name: "Anaemia and weakness", desc: "Low haemoglobin and constant tiredness - found on a blood test, then treated." },
      { name: "Master health check-up", desc: "A full annual check with the results explained to you the same day." },
      { name: "Pre-employment check-up", desc: "The fitness certificate employers and colleges ask for." },
      { name: "Vaccination for adults", desc: "Tetanus, hepatitis, flu and travel vaccines." },
      { name: "Referral to a specialist", desc: "If it needs a specialist, you go to one in this building, with your file already there." },
    ],
    guidance: {
      about: "This is the front door. Most people don't know which specialist they need, and they shouldn't have to - the physician's job is to work out what is actually going on and either treat it or send you to the right department with the groundwork done. It is also where the long, quiet conditions live: diabetes, blood pressure and thyroid, which cause no symptoms for years and then cause everything.",
      warningSigns: [
        "Fever above 38.5°C lasting more than three days, or with a rash or bleeding gums",
        "Breathlessness at rest, or chest pain with breathing",
        "Coughing blood, or a cough lasting more than three weeks with weight loss",
        "Vomiting blood, or black tarry stools",
        "Sudden confusion, or a diabetic who is drowsy and hard to rouse",
        "Unexplained weight loss over a few months",
      ],
      prevention: [
        "One full check a year after 30 - blood pressure, sugar, haemoglobin and cholesterol",
        "Boiled or filtered water, and no standing water near the house through monsoon",
        "Keep to prescribed diabetes and BP medicines even when you feel completely well",
        "Move daily; thirty minutes of walking changes sugar and BP more than most tablets",
        "Never take antibiotics without a prescription - it is how they stop working when you need them",
      ],
      selfCare: [
        "For fever: paracetamol, fluids and rest - and come in if it hasn't broken in three days",
        "Keep a home diary of sugar or BP readings, and bring it to every visit",
        "Finish the full antibiotic course even after you feel better",
        "Bring all your medicines, including anything from another doctor, to each appointment",
        "Store your reports together; a comparison over years is often what makes the diagnosis",
      ],
    },
  },
  {
    index: "06", name: "Neurology",
    blurb: "Persistent headache, seizures and stroke care, supported by in-house imaging.",
    common: "Headache · Seizure · Stroke", image: "/images/dept-neurology.avif",
    services: [
      { name: "Persistent headache", desc: "Headaches that keep returning, investigated instead of medicated indefinitely." },
      { name: "Migraine", desc: "Attacks with light sensitivity or vomiting, and treatment that reduces how often they come." },
      { name: "Seizures & epilepsy", desc: "Fits assessed and brought under control, with medicines reviewed as you go." },
      { name: "Stroke assessment", desc: "Sudden weakness, drooping or slurred speech. Come immediately - do not wait." },
      { name: "Stroke rehabilitation", desc: "Regaining movement and speech afterwards, with physiotherapy support." },
      { name: "Giddiness & vertigo", desc: "The room spinning or balance going - separating ear causes from nerve ones." },
      { name: "Nerve pain and numbness", desc: "Burning, tingling or numb hands and feet, often linked to diabetes." },
      { name: "Weakness in arms or legs", desc: "Loss of strength or grip that has come on over days or weeks." },
      { name: "Memory problems", desc: "Forgetfulness that is worrying the family, assessed properly rather than dismissed as age." },
      { name: "Parkinson's & tremor", desc: "Shaking, stiffness and slowness - diagnosed and managed for the long term." },
      { name: "Sleep problems", desc: "Insomnia, disturbed nights, and sleeping far too much in the day." },
    ],
    guidance: {
      about: "Neurology deals with the symptoms people find most frightening, and where speed matters most. In a stroke, the treatment window is measured in hours - what is done in the first few decides how much movement and speech come back. Outside emergencies, much of the work is patient and long-term: getting seizures fully controlled, cutting migraine frequency, and telling ordinary forgetfulness apart from something that needs treating.",
      warningSigns: [
        "Face drooping, arm weakness or slurred speech - call for help immediately, note the time it started",
        "The worst headache of your life, coming on within seconds",
        "A first-ever fit, or a fit lasting more than five minutes",
        "Sudden loss of vision, double vision, or difficulty swallowing",
        "Headache with fever and a stiff neck",
        "Head injury followed by vomiting, drowsiness or confusion",
      ],
      prevention: [
        "Control blood pressure - it is by far the largest cause of stroke",
        "Stop tobacco, and keep alcohol low",
        "Treat diabetes and cholesterol; both damage small blood vessels in the brain",
        "Sleep at regular hours - irregular sleep triggers a great many migraines",
        "Wear a helmet, every ride, including short ones",
      ],
      selfCare: [
        "Never stop epilepsy medicines suddenly - it is the commonest reason fits return",
        "Keep a headache diary: timing, food, sleep and stress usually reveal the trigger",
        "Someone with epilepsy should avoid swimming alone, heights and cooking on open flame unsupervised",
        "During a fit: clear the space, turn them on their side, put nothing in the mouth, time it",
        "Keep doing the rehabilitation exercises after a stroke - recovery continues for many months",
      ],
    },
  },
  {
    index: "07", name: "Dermatology",
    blurb: "Skin, hair and allergy problems, with lab diagnostics to back the diagnosis.",
    common: "Skin · Hair · Allergy", image: "/images/dept-dermatology.avif",
    services: [
      { name: "Acne", desc: "Pimples and the marks they leave, treated as a course rather than a single visit." },
      { name: "Eczema & dermatitis", desc: "Itchy, dry, inflamed skin that flares and settles and flares again." },
      { name: "Psoriasis", desc: "Thick scaly patches - a long-term condition, managed to keep it quiet." },
      { name: "Fungal skin infection", desc: "Ringworm and stubborn itching that shop-bought creams haven't cleared." },
      { name: "Hair loss", desc: "Thinning or patchy hair, with blood tests first to find the cause." },
      { name: "Dandruff & scalp problems", desc: "Persistent flaking, itching and irritation of the scalp." },
      { name: "Allergy and hives", desc: "Sudden welts and itching, and working out what set them off." },
      { name: "Pigmentation", desc: "Dark patches, melasma and uneven skin tone." },
      { name: "Nail problems", desc: "Discoloured, thickened or lifting nails, often fungal." },
      { name: "Skin infection in children", desc: "Boils, impetigo and the rashes common in young skin." },
      { name: "Wound and scar care", desc: "Slow-healing wounds, and the scars they leave behind." },
    ],
    guidance: {
      about: "Skin problems are visible, which is why they're treated so casually - by chemists, by neighbours, by whatever cream worked for someone else. That is how a simple fungal patch becomes a resistant one covering half the body. This clinic diagnoses first, with the lab behind it where needed, and treats in proper courses. Most chronic skin conditions can't be cured in a week, but nearly all of them can be controlled.",
      warningSigns: [
        "A mole that changes shape, colour or size, or starts to bleed or itch",
        "Rapidly spreading redness with fever, pain and swelling",
        "Blistering or peeling skin, especially after starting a new medicine",
        "Any rash involving the eyes, mouth or genitals",
        "A sore or ulcer that has not healed in three weeks",
      ],
      prevention: [
        "Never use a steroid cream without a prescription - it is the main reason fungal infection spreads",
        "Keep skin folds dry, and change out of sweaty clothes promptly",
        "Sunscreen daily; sun is the largest cause of pigmentation and ageing here",
        "Don't share towels, combs, razors or footwear",
        "Wash and dry between the toes, and keep nails trimmed short",
      ],
      selfCare: [
        "Complete the full course - stopping when it looks better is why it comes back",
        "Moisturise damp skin straight after bathing, not dry skin later",
        "Use lukewarm water and a mild soap; hot water worsens almost every itch",
        "Don't pick or squeeze - that is what turns a spot into a permanent scar",
        "Wash clothes and bedding in hot water while treating a fungal infection",
      ],
    },
  },
  {
    index: "08", name: "ENT",
    blurb: "Ear, nose and throat - from hearing tests to minor day procedures.",
    common: "Hearing · Sinus · Throat", image: "/images/dept-ent.avif",
    services: [
      { name: "Ear pain & infection", desc: "Painful, blocked or discharging ears, in adults and children." },
      { name: "Hearing loss", desc: "Hearing that has dropped, in one ear or both." },
      { name: "Hearing test (audiometry)", desc: "A properly measured hearing test, rather than a guess." },
      { name: "Ear wax removal", desc: "Blocked ears cleared safely, without damage to the eardrum." },
      { name: "Sinus problems", desc: "Facial pressure and blockage that arrived with a cold and never left." },
      { name: "Nasal blockage & allergy", desc: "A nose that is permanently blocked or running, including allergic rhinitis." },
      { name: "Nose bleeds", desc: "Repeated bleeding, with the source found and dealt with." },
      { name: "Sore throat & tonsils", desc: "Throat infections that keep returning - and when tonsils should come out." },
      { name: "Voice and hoarseness", desc: "A voice that has changed or gone, lasting more than two weeks." },
      { name: "Snoring", desc: "Loud snoring and broken sleep, assessed for the underlying cause." },
      { name: "Day-case ENT procedures", desc: "Minor procedures in the hospital's own theatre - most people home the same evening." },
    ],
    guidance: {
      about: "Ear, nose and throat problems are dismissed more than almost any others: a blocked nose is 'just sinus', a child's hearing is 'just not listening'. Both are worth checking, because untreated ear infection affects hearing and untreated hearing loss affects a child's speech and schooling. Most of what comes here is straightforward, and a fair amount is fixed by a minor procedure with the patient home the same evening.",
      warningSigns: [
        "Sudden hearing loss in one ear - this is urgent, come the same day",
        "Difficulty breathing or swallowing, or drooling with a sore throat",
        "Severe ear pain with fever, swelling or redness behind the ear",
        "A nosebleed that will not stop after 15 minutes of firm pressure",
        "Hoarseness lasting more than three weeks, especially in a smoker",
        "A neck lump that persists beyond three weeks",
      ],
      prevention: [
        "Never put cotton buds, oil or any object into the ear canal",
        "Use ear protection around loud machinery, and keep headphone volume moderate",
        "Treat allergies properly - untreated allergic rhinitis is what leads to chronic sinus disease",
        "Don't smoke, and keep children away from smoke - it drives ear and throat infection",
        "Keep ears dry after swimming and bathing",
      ],
      selfCare: [
        "Steam inhalation and saline nasal rinses help most sinus and blockage complaints",
        "For a nosebleed: sit up, lean forward, pinch the soft part of the nose for 10-15 minutes",
        "Warm salt-water gargles for a sore throat, and rest the voice completely for hoarseness",
        "Finish antibiotics for an ear infection even after the pain settles",
        "If a child seems inattentive at school, have the hearing tested before assuming behaviour",
      ],
    },
  },
  {
    index: "09", name: "General Surgery",
    blurb: "Hernias, gallstones, appendix and lumps - assessed, operated where needed, and followed up in one place.",
    common: "Hernia · Gallbladder · Appendix", image: "/images/dept-general-surgery.avif",
    services: [
      { name: "Hernia repair", desc: "A bulge in the groin or abdomen, fixed before it becomes an emergency." },
      { name: "Gallbladder (gallstones)", desc: "Repeated pain after fatty meals, treated with keyhole gallbladder removal." },
      { name: "Appendix surgery", desc: "Appendicitis, operated the same day - a delay is what turns it dangerous." },
      { name: "Piles, fissure & fistula", desc: "Painful or bleeding conditions people put off for years, treated properly." },
      { name: "Lumps & swellings", desc: "Any new lump examined, and removed with the sample sent to the lab." },
      { name: "Abscess & wound care", desc: "Infected collections drained, and wounds that won't heal seen to." },
      { name: "Thyroid & breast lumps", desc: "Assessment, scans and surgery where a lump needs removing." },
      { name: "Keyhole (laparoscopic) surgery", desc: "Small-cut surgery where suitable, so recovery is quicker." },
      { name: "Diabetic foot care", desc: "Foot ulcers and infections in diabetes, managed before they threaten the limb." },
      { name: "Day-case procedures", desc: "Minor operations with most patients home the same evening." },
    ],
    guidance: {
      about: "General surgery covers the common problems that eventually need an operation - hernias, gallstones, the appendix, piles - plus the lump nobody wants to ignore. Much of it is now keyhole surgery, which means smaller cuts and a faster return home. The thing that changes outcomes most is timing: an appendix or an obstructed hernia left too long becomes an emergency, so the department is set up to assess quickly rather than add you to a long waiting list.",
      warningSigns: [
        "Sudden severe abdominal pain, especially with a hard, tender belly",
        "A hernia bulge that becomes painful, hard, or won't push back in",
        "Vomiting with no passage of stool or wind",
        "A wound that is spreading redness, hot, or leaking pus with fever",
        "Black tarry stools, or vomiting blood",
        "A lump that is growing quickly, hard, or fixed to the skin",
      ],
      prevention: [
        "Keep to a healthy weight - it lowers the risk of hernias and gallstones",
        "Eat enough fibre and drink water to keep bowels regular and avoid piles",
        "Don't ignore a small lump or a hernia hoping it will settle - early is easier",
        "Control diabetes tightly; it slows healing and drives foot infection",
        "Stop smoking well before any planned surgery - it halves wound problems",
      ],
      selfCare: [
        "After surgery, follow the wound-care and lifting limits you are given exactly",
        "Walk gently and often after an operation - it prevents clots and speeds recovery",
        "Keep the dressing clean and dry, and watch for spreading redness or fever",
        "Take the full course of any antibiotics, and the painkillers as advised",
        "Report any wound that reopens, leaks or smells, rather than waiting for the follow-up",
      ],
    },
  },
  {
    index: "10", name: "Plastic Surgery",
    blurb: "Reconstruction after injury, burns and wounds that won't heal - plus corrective and cosmetic procedures.",
    common: "Burns · Reconstruction · Scars", image: "/images/dept-plastic-surgery.avif",
    services: [
      { name: "Burns care", desc: "Fresh burns treated to limit scarring, and older burn scars released." },
      { name: "Wound reconstruction", desc: "Skin grafts and flaps for large or deep wounds that can't close on their own." },
      { name: "Scar correction", desc: "Improving thick, tight or disfiguring scars from injury or surgery." },
      { name: "Hand injuries", desc: "Cuts, crush injuries and tendon damage that need careful repair." },
      { name: "Cleft lip & palate", desc: "Surgical correction for children, timed to their growth." },
      { name: "Diabetic & pressure wounds", desc: "Non-healing ulcers reconstructed once the infection is controlled." },
      { name: "Skin lumps & cysts", desc: "Removal of lumps with attention to the cosmetic result." },
      { name: "Reconstructive surgery", desc: "Rebuilding form and function after trauma or cancer surgery." },
      { name: "Cosmetic procedures", desc: "Elective appearance procedures, discussed honestly and without pressure." },
    ],
    guidance: {
      about: "Plastic surgery is mostly reconstruction, not appearance - restoring skin, function and form after burns, accidents, infection and cancer surgery. Its other steady work is the wound that will not heal: diabetic ulcers, pressure sores and complex injuries that need a graft or flap rather than more dressings. Cosmetic procedures are part of the department too, offered plainly, with realistic expectations set before anything is booked.",
      warningSigns: [
        "A burn larger than the palm of the hand, or any burn to the face, hands or genitals - come in now",
        "A burn that looks white, leathery or painless (a deep burn needs urgent care)",
        "A deep cut with numbness or inability to move a finger",
        "A wound that has not healed in three to four weeks",
        "Spreading redness, swelling and fever around any wound",
      ],
      prevention: [
        "For burns first-aid: cool under running water for 20 minutes, never apply toothpaste, ice or oil",
        "Keep hot liquids, stoves and heaters out of children's reach",
        "Control diabetes and check the feet daily to catch ulcers early",
        "Protect healing skin and fresh scars from the sun for at least a year",
        "Don't self-treat a non-healing wound with repeated home remedies",
      ],
      selfCare: [
        "Massage and moisturise a healing scar once the wound is closed, as advised",
        "Do the hand or limb exercises given after a repair - function depends on them",
        "Keep grafts and flaps protected and elevated exactly as instructed",
        "Cover new scars from sun exposure to stop them darkening",
        "Attend every dressing and review appointment; wound healing is watched over time",
      ],
    },
  },
  {
    index: "11", name: "Urology",
    blurb: "Kidney stones, urine and prostate problems, and men's health - with scans and a day theatre on site.",
    common: "Stones · Prostate · Urine", image: "/images/dept-urology.avif",
    services: [
      { name: "Kidney & ureteric stones", desc: "The severe loin pain of a stone, diagnosed on scan and treated." },
      { name: "Urinary infections", desc: "Repeated or stubborn urine infections investigated for a cause." },
      { name: "Prostate enlargement", desc: "A weak stream and night-time trips to the toilet in older men." },
      { name: "Blood in the urine", desc: "Always checked properly - it can be minor, but it must never be ignored." },
      { name: "Difficulty passing urine", desc: "Poor flow, urgency or retention, assessed and relieved." },
      { name: "Men's health", desc: "Sexual and reproductive health concerns, discussed in confidence." },
      { name: "Kidney function review", desc: "Watching the kidneys where stones, diabetes or BP put them at risk." },
      { name: "Bladder problems", desc: "Leaking, urgency and frequency in men and women." },
      { name: "Scrotal & testicular problems", desc: "Swelling, lumps or pain in the scrotum, examined without delay." },
      { name: "Day-case urology", desc: "Stone and prostate procedures with a short hospital stay." },
    ],
    guidance: {
      about: "Urology handles the plumbing of the body - kidneys, bladder, prostate - and the problems people are most reluctant to talk about. Kidney stones bring some of the worst pain there is, and a stone stuck with a fever is an emergency. Prostate trouble creeps up on older men as a weakening stream and broken sleep. And blood in the urine, however small, is the one symptom never to wait on, because catching the cause early is what makes it treatable.",
      warningSigns: [
        "Severe loin or side pain with fever and shivering - a blocked, infected kidney is an emergency",
        "Being completely unable to pass urine despite a full, painful bladder",
        "Blood in the urine - any amount, even once",
        "Sudden severe pain and swelling in a testicle (urgent in boys and young men)",
        "Fever with burning urine and back pain",
      ],
      prevention: [
        "Drink enough water to keep urine pale - the single best defence against stones",
        "Cut down salt and very high-protein diets if you form stones",
        "Don't hold urine for long periods, and empty the bladder fully",
        "Men over 50: don't dismiss a weakening stream as just age - it is treatable",
        "Treat urine infections fully rather than stopping when the burning eases",
      ],
      selfCare: [
        "During a stone attack: keep drinking water and take the painkillers you are given",
        "Strain your urine if asked, so a passed stone can be sent for analysis",
        "Finish the whole antibiotic course for a urine infection",
        "Cranberry and good hydration help recurrent infections, but see a doctor if they keep returning",
        "Keep a simple diary of how often and how urgently you pass urine, to bring to review",
      ],
    },
  },
  {
    index: "12", name: "Neurosurgery",
    blurb: "Surgery for the brain, spine and nerves - head injury, slipped discs, tumours and pinched nerves.",
    common: "Head injury · Spine · Disc", image: "/images/dept-neurosurgery.avif",
    services: [
      { name: "Head injury", desc: "Assessment and surgery after a serious blow to the head." },
      { name: "Slipped (herniated) disc", desc: "Back or neck pain shooting down a limb, when it needs more than rest." },
      { name: "Spine surgery", desc: "Relief for nerves compressed in the neck or lower back." },
      { name: "Brain & spinal tumours", desc: "Diagnosis, imaging and surgery where a growth needs removing." },
      { name: "Pinched nerves", desc: "Persistent numbness, weakness or shooting pain from a trapped nerve." },
      { name: "Sciatica", desc: "Leg pain from a nerve in the lower back, assessed for its cause." },
      { name: "Brain haemorrhage care", desc: "Urgent management of bleeding in or around the brain." },
      { name: "Hydrocephalus", desc: "Treatment for a build-up of fluid pressure in the brain." },
      { name: "Spinal injury", desc: "Stabilising and treating the spine after a fall or accident." },
    ],
    guidance: {
      about: "Neurosurgery is the surgical side of brain, spine and nerve problems - and it works closely with neurology, which sees many of the same patients without an operation. Most people who come are not heading for surgery at all: a slipped disc or a trapped nerve is usually settled with time, physiotherapy and injections, and an operation is offered only when the pain is relentless or a nerve is genuinely at risk. The exceptions are the emergencies - a serious head injury or bleeding in the brain - where hours decide the outcome.",
      warningSigns: [
        "A head injury followed by vomiting, worsening drowsiness, confusion or a fit - come in now",
        "The worst headache of your life, coming on in seconds",
        "Weakness, numbness or clumsiness spreading in an arm or leg",
        "Back pain with loss of bladder or bowel control, or numbness between the legs - an emergency",
        "Sudden difficulty speaking, seeing or walking",
      ],
      prevention: [
        "Wear a helmet every time on a two-wheeler - it is the difference in most head injuries",
        "Lift with the legs and avoid twisting under load to protect the spine",
        "Keep the core and back muscles strong; they support the discs",
        "Control blood pressure - it is a major cause of bleeding in the brain",
        "Make the home safe from falls for elderly relatives",
      ],
      selfCare: [
        "Most disc pain settles with staying gently active - long bed rest makes it worse",
        "Do the prescribed back or neck exercises daily once cleared to",
        "After any head injury, have someone stay with you for 24 hours and watch for warning signs",
        "Take nerve-pain medicines regularly as prescribed, not just when it flares",
        "Return promptly if numbness or weakness is spreading rather than easing",
      ],
    },
  },
  {
    index: "13", name: "Anaesthesiology",
    blurb: "The doctors who keep you safe, still and pain-free during surgery - and who run pain and critical care.",
    common: "Surgery · Pain relief · ICU", image: "/images/dept-anaesthesiology.avif",
    services: [
      { name: "Anaesthesia for surgery", desc: "Keeping you safely asleep or numb, and stable, throughout an operation." },
      { name: "Pre-anaesthetic check-up", desc: "The fitness-for-surgery review before any planned operation." },
      { name: "Spinal & regional anaesthesia", desc: "Numbing part of the body so you avoid a full general anaesthetic where suitable." },
      { name: "Labour pain relief", desc: "Epidurals and pain relief in childbirth." },
      { name: "Chronic pain management", desc: "Long-standing pain treated with injections and a proper plan." },
      { name: "Critical care support", desc: "Managing the sickest patients in the ICU alongside the treating team." },
      { name: "Sedation for procedures", desc: "Safe, monitored sedation for scans and minor procedures." },
      { name: "Post-operative pain care", desc: "Keeping you comfortable after surgery so you recover faster." },
    ],
    guidance: {
      about: "Anaesthetists are the least visible doctors in the hospital and among the most important - they keep you safe and pain-free through surgery, watching your breathing, heart and pressure minute by minute while the surgeon works. Their job starts before the operation, with a pre-anaesthetic check that makes sure you are fit for it, and continues after, managing your pain and recovery. The department is booked through the surgical team and the front desk, not directly - which is why it shows 'by appointment' here.",
      warningSigns: [
        "Tell your surgeon early about any heart, lung, or kidney disease before a planned operation",
        "Declare all your medicines, especially blood thinners, diabetes and BP drugs, before surgery",
        "Report any past reaction to anaesthesia, in you or close family",
        "Mention loose teeth, dentures, or serious acidity before an anaesthetic",
        "Severe breathlessness or chest pain after surgery needs to be reported at once",
      ],
      prevention: [
        "Follow the fasting instructions before surgery exactly - it prevents a dangerous complication",
        "Stop smoking as far ahead of planned surgery as you can",
        "Bring an up-to-date list of every medicine to the pre-anaesthetic visit",
        "Get diabetes and blood pressure well controlled before an elective operation",
        "Arrange for someone to accompany you home after any sedation",
      ],
      selfCare: [
        "Do not eat or drink after the time you are told before surgery",
        "Take only the medicines the anaesthetist says to on the morning of surgery",
        "After sedation, do not drive, sign documents or operate machinery for 24 hours",
        "Start the breathing and leg exercises you are shown soon after an operation",
        "Take post-operative pain relief on time rather than waiting for pain to build",
      ],
    },
  },
  {
    index: "14", name: "Pulmonology",
    blurb: "The lungs and breathing - asthma, long cough, breathlessness, TB and sleep-related breathing problems.",
    common: "Asthma · Cough · Breathless", image: "/images/dept-pulmonology.avif",
    services: [
      { name: "Asthma", desc: "Wheezing and breathlessness controlled so attacks become rare." },
      { name: "Long-standing cough", desc: "A cough lasting more than three weeks, investigated for the cause." },
      { name: "Breathlessness", desc: "Getting short of breath more easily than you should, worked up properly." },
      { name: "COPD / smoker's lung", desc: "Ongoing management of chronic lung disease to keep you out of hospital." },
      { name: "Tuberculosis (TB) care", desc: "Diagnosis and the full supervised course of TB treatment." },
      { name: "Chest infections & pneumonia", desc: "Serious chest infections treated, with a chest X-ray on site." },
      { name: "Lung function testing", desc: "A breathing test that measures how well the lungs are working." },
      { name: "Snoring & sleep apnoea", desc: "Loud snoring and daytime sleepiness assessed for a treatable cause." },
      { name: "Allergic airway problems", desc: "Allergy-driven cough and breathing trouble managed together." },
    ],
    guidance: {
      about: "Pulmonology is breathing - the asthma that flares in the dust and cold, the cough that outstays a viral fever, the breathlessness that has crept up over months. In this region it also carries the steady, important work of tuberculosis: diagnosing it, and seeing every patient through the full course, because a course stopped halfway is how TB becomes drug-resistant. A chest X-ray and lung-function testing on site mean most breathing problems can be pinned down in a single visit.",
      warningSigns: [
        "Severe breathlessness at rest, or lips and fingertips turning blue - come in now",
        "An asthma attack not relieved by the usual inhaler",
        "Coughing up blood",
        "A cough lasting more than three weeks with fever, night sweats or weight loss",
        "Chest pain with breathing, alongside fever and breathlessness",
      ],
      prevention: [
        "Stop smoking - nothing else you can do protects the lungs remotely as much",
        "Avoid known triggers: dust, smoke, strong fumes and cold air if they set you off",
        "Take asthma preventer inhalers daily even when you feel well",
        "Complete the entire TB course exactly as prescribed - never stop early",
        "Get the flu and pneumonia vaccines if you have a long-term lung condition",
      ],
      selfCare: [
        "Learn correct inhaler technique - most people waste half the dose; ask us to check",
        "Keep a reliever inhaler with you at all times if you have asthma",
        "Track what triggers your attacks and share the pattern with the doctor",
        "For a productive cough, stay well hydrated and steam gently",
        "Never share TB medicines or stop them because you feel better - finish the course",
      ],
    },
  },
  {
    index: "15", name: "Psychiatry",
    blurb: "Mental health care without stigma - depression, anxiety, sleep, addiction and serious mental illness.",
    common: "Depression · Anxiety · Sleep", image: "/images/dept-psychiatry.avif",
    services: [
      { name: "Depression", desc: "Low mood, loss of interest and hopelessness - real, common, and treatable." },
      { name: "Anxiety & panic", desc: "Constant worry, fear and panic attacks that disrupt daily life." },
      { name: "Sleep problems", desc: "Insomnia and disturbed sleep, treated at the cause rather than just with pills." },
      { name: "Stress & burnout", desc: "When work, study or family pressure becomes more than you can carry." },
      { name: "Addiction & de-addiction", desc: "Help to stop alcohol, tobacco or drugs, with support through withdrawal." },
      { name: "Serious mental illness", desc: "Care for conditions like bipolar disorder and psychosis." },
      { name: "Memory & elderly mental health", desc: "Assessment of memory loss and mood changes in older people." },
      { name: "Child & adolescent concerns", desc: "Behaviour, mood and school difficulties in young people." },
      { name: "Counselling & follow-up", desc: "Talking therapy and steady review, not just a one-off prescription." },
    ],
    guidance: {
      about: "Mental illness is as real and as treatable as any physical illness, and far more common than most families realise - depression, anxiety and sleep problems touch nearly every household. The barrier is almost always shame, not the treatment. This clinic is confidential and unhurried, and it treats the whole range: the low mood that won't lift, the anxiety that runs the day, the drinking that has taken over, and the serious illnesses that need steady, expert care. Coming here is a sign of sense, not weakness.",
      warningSigns: [
        "Any thoughts of ending your life, or of harming yourself - please come in or call us today",
        "Talking about being a burden, giving away belongings, or saying goodbye",
        "Not eating, sleeping or functioning for days at a time",
        "Hearing or seeing things others don't, or intense fear that people mean harm",
        "Severe confusion or agitation coming on quickly, especially in an older person",
      ],
      prevention: [
        "Talk early - problems named sooner are far easier to treat",
        "Protect sleep, routine and some daily movement; all three steady the mind",
        "Keep alcohol low and avoid using it to cope with stress",
        "Stay connected to people, even when the urge is to withdraw",
        "Treat long-term physical illness and pain, which feed low mood",
      ],
      selfCare: [
        "Take mental-health medicines every day as prescribed; most take two to four weeks to work",
        "Never stop them suddenly because you feel better - talk to the doctor first",
        "Keep follow-up appointments even on good weeks; they are how the dose is got right",
        "Tell someone you trust what you are going through - carrying it alone makes it heavier",
        "In a crisis, do not wait for the next appointment - come in, or call the hospital",
      ],
    },
  },
  {
    index: "16", name: "Physiotherapy",
    blurb: "Getting movement and strength back - after surgery, injury, stroke or long-standing pain.",
    common: "Rehab · Back pain · Stroke", image: "/images/dept-physiotherapy.avif",
    services: [
      { name: "Post-surgery rehabilitation", desc: "Guided recovery of movement and strength after an operation." },
      { name: "Back & neck pain", desc: "Exercise and hands-on treatment for long-standing spinal pain." },
      { name: "Post-fracture recovery", desc: "Rebuilding a joint or limb once a fracture has healed." },
      { name: "Stroke rehabilitation", desc: "Regaining movement, balance and independence after a stroke." },
      { name: "Knee & joint rehab", desc: "Strengthening around a painful or replaced joint." },
      { name: "Sports injury rehab", desc: "A graded plan to return safely to activity after an injury." },
      { name: "Posture & ergonomics", desc: "Correcting the habits behind desk-work and phone-related pain." },
      { name: "Balance & fall prevention", desc: "Steadiness training for older people at risk of falls." },
      { name: "Pain relief therapy", desc: "Hands-on and machine-assisted relief alongside an exercise plan." },
    ],
    guidance: {
      about: "Physiotherapy is where recovery actually happens - the weeks after the surgery, the fracture or the stroke, when getting movement and strength back depends on doing the right exercises, correctly, every day. It also treats a great deal of ordinary pain: the back that aches from a desk, the knee that has stiffened, the shoulder that won't lift. The honest truth of the department is that the results come from the patient's own effort, guided well - which is why the exercises you are given matter more than the time on the machine.",
      warningSigns: [
        "New numbness, weakness or loss of bladder control with back pain - see a doctor, not just physio",
        "Severe pain after a fall before any injury has been ruled out on X-ray",
        "A joint that is hot, swollen and intensely painful",
        "Chest pain or breathlessness brought on by the exercises",
        "Pain that is getting sharply worse rather than easing with treatment",
      ],
      prevention: [
        "Keep moving - most joint and back pain worsens with inactivity, not activity",
        "Build strength in the muscles around a vulnerable joint before it gives trouble",
        "Set up desk, chair and phone use to keep the neck and back neutral",
        "Warm up before sport and progress training gradually",
        "For older people, regular balance work genuinely prevents falls and fractures",
      ],
      selfCare: [
        "Do the home exercises daily - recovery follows the exercises, not the appointments",
        "A little discomfort during exercise is normal; sharp or lasting pain is not - report it",
        "Be patient and consistent; strength and movement return over weeks, not days",
        "Use ice for a fresh flare and heat for stiff, chronic tightness, as advised",
        "Don't rush back to full activity before you are cleared - re-injury sets you back further",
      ],
    },
  },
];

/**
 * CARE AREAS - how the navbar is organised.
 *
 * Patients don't search for "Orthopaedics", they search for "bone doctor" or
 * arrive knowing only "something's wrong with my child". Care areas put the
 * eight clinical departments behind the five or six doors people actually
 * knock on, and the mega-menu then shows everything inside.
 */
export interface CareArea {
  /** The door: "Child Care", "Women Care"… */
  label: string;
  /** One or more clinical departments behind it. */
  departments: string[];
  blurb: string;
}

export const CARE_AREAS: CareArea[] = [
  { label: "Child Care", departments: ["Paediatrics"], blurb: "Newborns to teenagers - and the parents who worry about them." },
  { label: "Women Care", departments: ["Gynaecology"], blurb: "Pregnancy, delivery and women's health at every stage." },
  { label: "Surgical Care", departments: ["General Surgery", "Plastic Surgery", "Urology"], blurb: "Hernias, gallstones, stones and reconstruction - keyhole where possible." },
  { label: "Ortho & Rehab", departments: ["Orthopaedics", "Physiotherapy"], blurb: "Bones, joints and spine, with the physiotherapy that gets you moving again." },
  { label: "Neuro Care", departments: ["Neurology", "Neurosurgery"], blurb: "Headache, seizures, stroke and spine - medical and surgical, together." },
  { label: "More Care", departments: ["General Medicine", "ENT", "Pulmonology", "Psychiatry", "Cardiology", "Dermatology", "Anaesthesiology"], blurb: "General medicine, chest, mental health, ENT and more - where most visits start." },
];

/** Fast lanes for what people actually come in for - each maps to the
 *  department that treats it, pre-filtered on the booking page. */
export const QUICK_NEEDS = [
  { label: "Fever & infections", note: "Seasonal fevers, flu, typhoid - seen same day.", dept: "General Medicine", icon: "Fever" },
  { label: "Disease prevention", note: "Vaccinations, screenings and health checkups.", dept: "General Medicine", icon: "Prevention" },
  { label: "Children", note: "Newborn care to teens - growth and vaccines.", dept: "Paediatrics", icon: "Paediatrics" },
  { label: "Pregnancy", note: "Antenatal visits, scans and safe delivery.", dept: "Gynaecology", icon: "Gynaecology" },
] as const;

/** A degree the consultant holds, restated for someone who has never seen it. */
export interface Credential {
  /** As it appears after the name: "MS", "MCh Urology". */
  award: string;
  /** What that degree actually is, in plain words. */
  note: string;
}

/** Something this consultant does, with a line on when you would need it. */
export interface Procedure {
  name: string;
  desc: string;
}

/** A paper, talk or chapter the consultant has published. */
export interface Publication {
  title: string;
  /** Journal, book or meeting, with the year. */
  where: string;
  url?: string;
}

export interface Doctor {
  id: string;
  name: string;
  specialization: string;
  department: string;
  qualification: string;
  experience: number;
  age: number;
  fee: number;
  opd: string;
  days: string;
  image: string;
  /** The title on the consulting room door - fuller than `specialization`. */
  designation: string;
  /** Where to go once reception has registered you. */
  room: string;
  /** How they describe their practice. Mirrors Doctor.bio in the ERP. */
  bio: string;
  /**
   * The long read: two or three paragraphs on how this clinic actually runs -
   * what a first visit covers, what gets done in the room, what gets referred.
   */
  about: string[];
  /** Which languages you can be seen in - the first thing many families check. */
  languages: string;
  /** The four headline conditions. Cards and search read this. */
  focus: string[];
  /** Everything the clinic sees, not just the headline four. */
  treats: string[];
  /** Procedures and tests this consultant performs themselves. */
  procedures: Procedure[];
  /** The corners of the speciality they spend the most time in. */
  interests: string[];
  /** "Book this clinic if…" - written as the symptom, not the diagnosis. */
  seeIf: string[];
  /** What to bring, so a visit isn't spent arranging the next one. */
  prepare: string[];
  /** The degrees already published in `qualification`, spelled out. */
  education: Credential[];
  /**
   * Councils, colleges, societies, awards and papers.
   *
   * DELIBERATELY EMPTY. Everything above describes the PRACTICE - what a clinic
   * treats, on what equipment, in which languages - and the hospital can stand
   * behind all of it. These four describe the PERSON, and a membership or a
   * paper attributed to a named doctor who never claimed it is a lie with their
   * name on it. Fill them in from what each consultant supplies, and the
   * profile page renders the sections; leave them out and it skips them.
   */
  registration?: string;
  memberships?: string[];
  awards?: string[];
  publications?: Publication[];
}

/**
 * The consulting panel.
 *
 * Copy rule, unchanged since the first version of this file: describe the
 * practice, never the person's history. Where someone grew up, where they
 * trained and what they have won has to come from the doctor - see the
 * credential fields above.
 */
export const DOCTORS: Doctor[] = [
  {
    id: "Dr. Shireesha M",
    name: "Dr. Shireesha M",
    specialization: "Obstetrician & Gynaecologist",
    designation: "Consultant Obstetrician & Gynaecologist",
    department: "Gynaecology",
    qualification: "MBBS, MS",
    experience: 12,
    age: 40,
    fee: 600,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · First floor · Women's care",
    image: "/images/doctor-1.avif",
    bio: "Experienced consultant in women's health providing antenatal care, pregnancy management, gynaecological surgery and preventive women's healthcare.",
    about: [
      "Antenatal care is most of this clinic. A first visit dates the pregnancy, orders the blood work and sets the vaccination schedule; after that the visits run to a fixed rhythm that tightens as the date approaches, so anything drifting - blood pressure, sugars, the baby's growth - is caught while there is still time to act on it.",
      "The rest is gynaecology: periods that are heavy, painful or have stopped, discharge and infection, fibroids and cysts, contraception, fertility questions and the years around menopause. Ultrasound is done in the consulting room, so most of those questions are answered in the same visit instead of at the next one.",
      "Deliveries and gynaecological surgery run out of a theatre staffed round the clock. A normal delivery is the aim wherever it is safe to aim for one. Where it isn't, the caesarean is planned in advance and the reason is explained before the day rather than on it.",
    ],
    languages: "Telugu, English",
    focus: ["High-risk pregnancy", "Normal delivery", "Caesarean section", "Women's health"],
    treats: [
      "Pregnancy and routine antenatal care",
      "High-risk pregnancy",
      "Diabetes and high blood pressure in pregnancy",
      "Heavy, painful or irregular periods",
      "Polycystic ovary syndrome (PCOS)",
      "Fibroids and ovarian cysts",
      "Difficulty conceiving - first assessment",
      "Recurrent miscarriage",
      "Vaginal infection and discharge",
      "Pelvic pain",
      "Contraception and family planning",
      "Menopause and bleeding after menopause",
    ],
    procedures: [
      { name: "Normal delivery", desc: "Labour looked after by the team that saw you through the pregnancy, with theatre next door if it is needed." },
      { name: "Caesarean section", desc: "Planned ahead where the reason is known, and done as an emergency at any hour when it is not." },
      { name: "Antenatal ultrasound", desc: "Dating, anomaly and growth scans, done in the room during the visit." },
      { name: "Laparoscopic gynaecological surgery", desc: "Keyhole removal of cysts and fibroids - smaller cuts, less pain, home sooner." },
      { name: "Hysterectomy", desc: "Removal of the uterus for fibroids, heavy bleeding or prolapse, once other treatment has been tried." },
      { name: "Hysteroscopy and D&C", desc: "A short day procedure to look inside the uterus and take a sample when bleeding needs explaining." },
      { name: "IUCD insertion and removal", desc: "Long-acting contraception fitted in the clinic, and taken out whenever you decide to stop." },
    ],
    interests: ["High-risk and diabetic pregnancy", "Vaginal birth after a previous caesarean", "Keyhole gynaecological surgery", "Adolescent and menopausal health"],
    seeIf: [
      "A pregnancy test is positive and you want antenatal care from the beginning",
      "Your periods have become heavy, painful, irregular or have stopped",
      "You have been trying for a pregnancy for a year with no result",
      "There is bleeding, leaking or reduced movement at any stage of a pregnancy",
      "You want contraception, or want to stop it and try for a baby",
      "There is any bleeding after menopause - this one should not wait",
    ],
    education: [
      { award: "MBBS", note: "Bachelor of Medicine and Bachelor of Surgery - the basic medical degree, five and a half years including a year of internship." },
      { award: "MS (Obstetrics & Gynaecology)", note: "Master of Surgery - three years of postgraduate surgical training in obstetrics & gynaecology." },
    ],
    prepare: [
      "Bring every scan and blood report you already have, in date order",
      "Note the first day of your last period before you come in",
      "List the medicines you take, including anything bought over the counter",
      "Come with a bladder that is comfortably full if a scan is expected",
    ],
  },

  {
    id: "Dr. A. Shanthosh",
    name: "Dr. A. Shanthosh",
    specialization: "General Physician",
    designation: "Consultant Physician, Internal Medicine",
    department: "General Medicine",
    qualification: "DNB (General Medicine)",
    experience: 10,
    age: 39,
    fee: 500,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · Ground floor · General medicine",
    image: "/images/doctor-2.avif",
    bio: "Consultant physician managing diabetes, hypertension, infectious diseases and preventive healthcare.",
    about: [
      "This is where most visits to Jeeva start. A general physician's job is to work out what is actually wrong before anyone specialises - which for a fever in Warangal means telling a viral fever from typhoid, dengue and malaria, and doing it fast enough that the answer still changes the treatment.",
      "The other half of the week is the long conditions: diabetes, blood pressure, thyroid and cholesterol. These are managed as a running record rather than a series of unrelated visits - the same numbers, tracked over years, so a dose is changed because a trend moved and not because of one bad reading.",
      "Blood work comes back from the in-house lab in about thirty minutes. In most cases that means the results are read out and explained in the same sitting, and you leave with a plan instead of an appointment to hear one.",
    ],
    languages: "Telugu, English",
    focus: ["Diabetes", "Hypertension", "Fever", "Health Check-ups"],
    treats: [
      "Fever that will not settle",
      "Dengue, typhoid and malaria",
      "Type 2 diabetes",
      "High blood pressure",
      "Thyroid disorders",
      "High cholesterol",
      "Anaemia and low haemoglobin",
      "Chest infection and persistent cough",
      "Stomach upset, acidity and loose motions",
      "Headache and giddiness",
      "Weakness and unexplained weight loss",
      "Annual and pre-employment health checks",
    ],
    procedures: [
      { name: "Same-day fever workup", desc: "Blood counts, dengue and typhoid screening read within the hour, so treatment starts today." },
      { name: "Diabetes review", desc: "HbA1c, sugars, kidney and eye checks, and the medicine changes those numbers ask for." },
      { name: "24-hour blood pressure monitoring", desc: "A cuff worn for a day, so we treat your real blood pressure and not a nervous reading." },
      { name: "ECG", desc: "A five-minute heart trace when chest discomfort or palpitations need ruling out." },
      { name: "Preventive health check", desc: "A structured panel of bloods and scans, with the results explained line by line." },
      { name: "Pre-surgery fitness assessment", desc: "The medical clearance a surgeon or anaesthetist asks for before an operation." },
    ],
    interests: ["Difficult-to-control diabetes", "Tropical and seasonal fevers", "Preventive screening after 40", "Managing several long conditions at once"],
    seeIf: [
      "A fever has lasted more than two days, or keeps coming back",
      "Your sugars or blood pressure readings have stopped behaving",
      "A cough, stomach upset or headache has outstayed a week",
      "You are tired in a way that rest is not fixing",
      "You want a full check-up and someone to actually read the report to you",
      "You are not sure which department you need - start here",
    ],
    education: [
      { award: "DNB (General Medicine)", note: "Diplomate of National Board - the postgraduate qualification of the National Board of Examinations, recognised on a par with an MD or MS." },
    ],
    prepare: [
      "Bring your sugar or BP diary, however roughly it has been kept",
      "Bring the strips or boxes of everything you take, not just the names",
      "Bring previous blood reports, even old ones - the trend matters more than one value",
      "Come fasting if a sugar or cholesterol test is likely",
    ],
  },

  {
    id: "Dr. B. Poornachander",
    name: "Dr. B. Poornachander",
    specialization: "General Surgeon",
    designation: "Consultant General & Laparoscopic Surgeon",
    department: "General Surgery",
    qualification: "MS (General Surgery)",
    experience: 15,
    age: 45,
    fee: 650,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · Ground floor · Surgical OPD",
    image: "/images/doctor-3.avif",
    bio: "General surgeon experienced in abdominal surgeries, laparoscopic procedures and emergency surgical care.",
    about: [
      "A surgical opinion is mostly a decision about whether to operate at all. Plenty of lumps, hernias and gallstones can be watched safely; some cannot, and the difference is worth an examination, a scan and a straight answer. This clinic gives that answer at the first visit wherever the imaging allows it.",
      "Where an operation is the right call, keyhole is the default: gall bladder, appendix, hernia and diagnostic laparoscopy all go through small ports rather than a long cut. That usually means one or two nights in hospital instead of a week, and a return to ordinary work in days.",
      "Emergency surgery runs round the clock. Appendicitis, an obstructed hernia, a perforation or an abscess do not wait for a list, and the theatre and anaesthetic team are staffed so they do not have to.",
    ],
    languages: "Telugu, English",
    focus: ["Laparoscopic Surgery", "Hernia", "Gall Bladder", "Emergency Surgery"],
    treats: [
      "Hernia - groin, umbilical and incisional",
      "Gallstones and gall bladder pain",
      "Appendicitis",
      "Piles, fissure and fistula",
      "Lumps in the breast",
      "Thyroid swelling",
      "Abscesses and infected wounds",
      "Diabetic foot and non-healing ulcers",
      "Appendix and abdominal emergencies",
      "Lipomas, cysts and skin lumps",
      "Intestinal obstruction",
      "Injuries needing surgical repair",
    ],
    procedures: [
      { name: "Laparoscopic gall bladder removal", desc: "Keyhole removal for stones that have started causing pain or jaundice." },
      { name: "Hernia repair", desc: "Open or keyhole mesh repair, chosen by where the hernia is and what you do for a living." },
      { name: "Laparoscopic appendicectomy", desc: "Same-day keyhole removal of an inflamed appendix, through three small ports." },
      { name: "Piles, fissure and fistula surgery", desc: "Day-case treatment for bleeding and pain that ointments have stopped helping." },
      { name: "Breast lump excision and biopsy", desc: "A lump removed and sent for testing, with the report explained by the surgeon who took it." },
      { name: "Abscess drainage and wound care", desc: "Infected collections opened and dressed, with follow-up until the wound closes." },
      { name: "Diagnostic laparoscopy", desc: "A camera look inside the abdomen when scans have not settled the question." },
    ],
    interests: ["Keyhole abdominal surgery", "Day-care hernia repair", "Emergency and trauma surgery", "Diabetic foot salvage"],
    seeIf: [
      "There is a lump or bulge that appears when you cough, lift or stand",
      "Pain in the upper right abdomen comes on after fatty food",
      "Abdominal pain has moved to the lower right and is getting worse - come in, don't book",
      "There is bleeding when you pass stool, or pain that lasts afterwards",
      "A wound or ulcer has not healed in three weeks",
      "Another doctor has said you need surgery and you want a second opinion",
    ],
    education: [
      { award: "MS (General Surgery)", note: "Master of Surgery - three years of postgraduate surgical training in general surgery." },
    ],
    prepare: [
      "Bring every scan - ultrasound, CT, X-ray - including the films, not only the report",
      "Say if you take blood thinners; they change the plan and the timing",
      "Bring sugar and blood pressure readings if you have either condition",
      "Come with someone who can drive you home if a day procedure is likely",
    ],
  },

  {
    id: "Dr. Venkata Ratnam Chesamalla",
    name: "Dr. Venkata Ratnam Chesamalla",
    specialization: "ENT Surgeon",
    designation: "Consultant ENT & Head-Neck Surgeon",
    department: "ENT",
    qualification: "MS (ENT)",
    experience: 18,
    age: 49,
    fee: 600,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · First floor · ENT",
    image: "/images/doctor-4.avif",
    bio: "Specialist in ear, nose and throat disorders with expertise in hearing loss, sinus disease and head & neck conditions.",
    about: [
      "Ear, nose and throat problems get dismissed as minor for years before anyone looks properly. A blocked nose that never clears, a child who says 'what?' too often, a voice that has been hoarse since last winter - each of those has a cause that can be found, and most of them can be found in the consulting room with an endoscope.",
      "The bulk of the clinic is sinus disease, ear discharge and hearing loss, allergy, tonsils and snoring. Examination is done with a rigid endoscope and an otoscope at the first visit rather than at a second one, and hearing is tested on site where it needs measuring rather than guessing.",
      "Surgery, when it comes to it, is mostly endoscopic - sinus surgery, ear drum repair, adenoid and tonsil removal - and much of it is day care. Anything that turns out to be head-and-neck cancer is staged and referred on with the imaging already done.",
    ],
    languages: "Telugu, English",
    focus: ["Sinus Surgery", "Hearing Disorders", "Throat Problems", "Nasal Disorders"],
    treats: [
      "Blocked nose and chronic sinusitis",
      "Nasal allergy and sneezing",
      "Deviated nasal septum",
      "Ear discharge and ear pain",
      "Hearing loss in adults and children",
      "Ringing in the ears (tinnitus)",
      "Giddiness and vertigo",
      "Recurrent tonsillitis",
      "Snoring and sleep apnoea",
      "Hoarse voice and vocal cord problems",
      "Nose bleeds",
      "Neck swellings and lumps",
      "Something stuck in the ear, nose or throat",
    ],
    procedures: [
      { name: "Nasal endoscopy", desc: "A thin camera through the nose in the consulting room - the actual look that a scan only hints at." },
      { name: "Endoscopic sinus surgery (FESS)", desc: "Opening blocked sinus drainage through the nostrils, with no cut on the face." },
      { name: "Septoplasty", desc: "Straightening a deviated septum when one side of the nose has never been clear." },
      { name: "Tonsil and adenoid removal", desc: "For tonsillitis that keeps coming back, or an adenoid that is blocking a child's sleep." },
      { name: "Ear drum repair (tympanoplasty)", desc: "Closing a perforated ear drum to stop the discharge and recover the hearing." },
      { name: "Grommet insertion", desc: "A tiny vent in the ear drum for glue ear - often the reason a child stopped responding." },
      { name: "Microlaryngoscopy", desc: "Examining and treating the vocal cords for a voice that has stayed hoarse." },
      { name: "Hearing assessment", desc: "Audiometry and tympanometry, so hearing loss is measured rather than estimated." },
    ],
    interests: ["Endoscopic sinus and nasal surgery", "Ear surgery and hearing restoration", "Paediatric ENT", "Snoring and sleep-disordered breathing"],
    seeIf: [
      "Your nose has been blocked, or you have lost your sense of smell, for weeks",
      "There is discharge from an ear, or pain that keeps returning",
      "You are turning the volume up, or asking people to repeat themselves",
      "A child is a mouth-breather, snores, or is not responding when called",
      "Your voice has been hoarse for more than three weeks - this needs a look",
      "There is a lump in the neck that has not gone away",
    ],
    education: [
      { award: "MS (ENT)", note: "Master of Surgery - three years of postgraduate surgical training in ent." },
    ],
    prepare: [
      "Bring any previous hearing test or CT scan of the sinuses",
      "Note when the symptom is worst - season, time of day, indoors or out",
      "List the nasal drops and sprays you have used and for how long",
      "For a child, bring the school teacher's observation if there is one",
    ],
  },

  {
    id: "Dr. P. Rajakshi Kumar",
    name: "Dr. P. Rajakshi Kumar",
    specialization: "Plastic Surgeon",
    designation: "Consultant Plastic & Reconstructive Surgeon",
    department: "Plastic Surgery",
    qualification: "MCh Plastic Surgery",
    experience: 14,
    age: 44,
    fee: 900,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · Ground floor · Surgical OPD",
    image: "/images/doctor-5.avif",
    bio: "Plastic and reconstructive surgeon specialising in trauma reconstruction, burns and cosmetic procedures.",
    about: [
      "Most of this work is reconstruction, not cosmetics. Road traffic injuries, machine injuries to the hand, burns, and wounds that will not close are the everyday list - and in each case the question is the same: how do we get skin, blood supply and function back over an area that has lost them.",
      "Timing matters more here than in almost any other speciality. A hand injury seen on the day can often be repaired; the same injury seen after three weeks of dressings has usually stiffened into a different, harder operation. Burns are the same - early, correct dressing decides how much scarring there is to revise later.",
      "Cosmetic work is done, and it is discussed the same way as everything else: what the procedure can realistically change, what it cannot, what the recovery is honestly like, and what it costs before anything is booked.",
    ],
    languages: "Telugu, English",
    focus: ["Reconstructive Surgery", "Burn Care", "Scar Revision", "Cosmetic Procedures"],
    treats: [
      "Burns - fresh injury and later contractures",
      "Hand injuries and tendon cuts",
      "Road traffic and machine injuries",
      "Wounds that will not heal",
      "Diabetic and pressure ulcers",
      "Scars, keloids and contractures",
      "Cleft lip and palate",
      "Skin and soft-tissue tumours",
      "Facial injuries and fractures",
      "Post-mastectomy reconstruction",
      "Gynaecomastia",
      "Cosmetic surgery of the face and body",
    ],
    procedures: [
      { name: "Skin grafting", desc: "Covering a raw area with a thin layer of your own skin so it closes and stays closed." },
      { name: "Flap reconstruction", desc: "Moving skin with its own blood supply to rebuild an area that a graft cannot cover." },
      { name: "Burn dressing and release", desc: "Early management of a burn, and later release of scars that have tightened across a joint." },
      { name: "Hand and tendon repair", desc: "Repairing cut tendons and nerves, with therapy started early so the hand moves again." },
      { name: "Scar revision and keloid treatment", desc: "Reshaping or injecting a scar that is thick, painful or pulling on something." },
      { name: "Cleft lip and palate repair", desc: "Staged repair timed to a child's age, with feeding and speech planned around it." },
      { name: "Liposuction and body contouring", desc: "Removal of localised fat that has not responded to diet and exercise." },
      { name: "Rhinoplasty and facial procedures", desc: "Reshaping after injury or by choice, discussed with photographs before anything is agreed." },
    ],
    interests: ["Hand and upper-limb reconstruction", "Acute burn care", "Post-traumatic facial reconstruction", "Chronic wound and ulcer salvage"],
    seeIf: [
      "A burn is larger than a palm, or is on the face, hands or across a joint",
      "A cut on the hand has left a finger you cannot fully bend or straighten",
      "A wound or ulcer has not healed in a month of dressings",
      "A scar is thickening, tightening or restricting movement",
      "An injury has left tissue loss that ordinary stitching will not close",
      "You are considering a cosmetic procedure and want a surgeon's honest assessment first",
    ],
    education: [
      { award: "MCh (Plastic Surgery)", note: "Magister Chirurgiae - the super-speciality surgical degree in plastic surgery, taken after an MS." },
    ],
    prepare: [
      "Photograph the wound or burn on the day it happened, if you can",
      "Bring the dressing notes or discharge summary from wherever it was first treated",
      "Say plainly what you do for a living - it changes what the repair has to achieve",
      "For cosmetic work, bring reference photographs and a list of your questions",
    ],
  },

  {
    id: "Dr. V. Prashanth",
    name: "Dr. V. Prashanth",
    specialization: "Orthopaedic Surgeon",
    designation: "Consultant Orthopaedic & Joint Replacement Surgeon",
    department: "Orthopaedics",
    qualification: "MS Orthopaedics",
    experience: 13,
    age: 42,
    fee: 650,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · Ground floor · Orthopaedics",
    image: "/images/doctor-6.avif",
    bio: "Orthopaedic consultant treating fractures, arthritis, sports injuries and spine disorders.",
    about: [
      "Two very different queues meet in this clinic. One is trauma - fractures, dislocations and sprains that arrived today and need an X-ray, a decision and a plaster or a theatre slot within the hour. Digital X-ray is in the building, so nobody is sent across town and back for a picture.",
      "The other is wear: knees that ache on stairs, hips that hurt at night, shoulders that will not lift, backs that have been bad for years. Most of that is treated without an operation - the honest sequence is weight, activity, physiotherapy and injections first, and joint replacement only when those have genuinely been tried.",
      "Where surgery is right, it is discussed as a trade: what the joint will do afterwards, how long the recovery really takes, and what the rehabilitation demands of you. Physiotherapy is in the same building, which is the difference between a plan and a leaflet.",
    ],
    languages: "Telugu, English",
    focus: ["Joint Replacement", "Trauma", "Sports Injuries", "Arthroscopy"],
    treats: [
      "Fractures and dislocations",
      "Knee pain and osteoarthritis",
      "Hip pain",
      "Frozen shoulder and rotator cuff pain",
      "Back and neck pain",
      "Slipped disc and sciatica",
      "Ligament and meniscus tears",
      "Ankle sprains",
      "Tennis and golfer's elbow",
      "Heel pain and plantar fasciitis",
      "Osteoporosis and fragility fractures",
      "Sports and overuse injuries",
      "Club foot and children's bone problems",
    ],
    procedures: [
      { name: "Fracture fixation", desc: "Plates, nails or screws to hold a broken bone in the position it must heal in." },
      { name: "Plastering and casting", desc: "New casts, cast changes and removal, with an X-ray to confirm before the plaster comes off." },
      { name: "Total knee replacement", desc: "A worn knee resurfaced, for arthritis that has stopped responding to everything else." },
      { name: "Total hip replacement", desc: "For hips worn by arthritis or damaged by fracture or loss of blood supply." },
      { name: "Arthroscopy", desc: "Keyhole repair of a torn ligament or meniscus, through two small cuts rather than an open joint." },
      { name: "Joint and spine injections", desc: "Targeted steroid or lubricant injections for a joint or nerve root that tablets are not reaching." },
      { name: "Implant removal", desc: "Taking out plates and screws once the bone has fully united and they are no longer earning their place." },
    ],
    interests: ["Primary knee and hip replacement", "Sports injury and arthroscopy", "Complex trauma fixation", "Non-surgical management of arthritis"],
    seeIf: [
      "You have had a fall and cannot bear weight or move the limb normally",
      "A knee or hip has started hurting on stairs, or waking you at night",
      "Pain runs from your back down a leg, or from your neck into an arm",
      "A joint locked, gave way or swelled after a twist",
      "A shoulder will not lift high enough to reach a shelf",
      "You have been told you need a joint replacement and want it properly explained",
    ],
    education: [
      { award: "MS (Orthopaedics)", note: "Master of Surgery - three years of postgraduate surgical training in orthopaedics." },
    ],
    prepare: [
      "Bring every X-ray, MRI and CT film - the actual films, not only the reports",
      "Wear or bring loose clothing so the joint can be examined",
      "Note what makes it worse: stairs, first steps in the morning, night, a specific movement",
      "Bring your current painkillers and how long you have been on them",
    ],
  },

  {
    id: "Dr. B. Laxmi",
    name: "Dr. B. Laxmi",
    specialization: "Urologist",
    designation: "Consultant Urologist & Endourological Surgeon",
    department: "Urology",
    qualification: "MBBS, MS (General Surgery), MCh Urology",
    experience: 12,
    age: 41,
    fee: 800,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · Ground floor · Urology",
    image: "/images/doctor-7.avif",
    bio: "Consultant urologist treating kidney stones, prostate disorders and urinary tract diseases.",
    about: [
      "Kidney stones are the reason most people find this clinic, and in this part of Telangana they are common enough to be seasonal. The first visit sorts the emergency from the manageable: a stone that is obstructing a kidney needs relieving today, a small one that will pass on its own needs fluids, a painkiller and a date to check it has.",
      "The second large group is men over fifty with a prostate that has begun to interfere - a slow stream, getting up several times a night, a sense of never quite emptying. That is investigated properly, because the treatment for an enlarged prostate and the treatment for a cancer start from the same set of symptoms and only a test tells them apart.",
      "Almost all stone and prostate surgery here is endoscopic - through the natural passage or a keyhole in the flank, with no open cut. Ultrasound is done in the room, so a first visit usually ends with the stone measured and located rather than merely suspected.",
    ],
    languages: "Telugu, English",
    focus: ["Kidney Stones", "Prostate", "Urinary Disorders", "Urological Surgery"],
    treats: [
      "Kidney, ureteric and bladder stones",
      "Enlarged prostate",
      "Blood in the urine",
      "Repeated urine infections",
      "Difficulty passing urine or retention",
      "Frequent urination at night",
      "Urinary incontinence",
      "Kidney swelling (hydronephrosis)",
      "Prostate, kidney and bladder cancers",
      "Hydrocele and undescended testis",
      "Male infertility - first assessment",
      "Erectile dysfunction",
      "Stricture of the urethra",
    ],
    procedures: [
      { name: "Ureteroscopy and laser stone removal", desc: "A stone reached through the natural passage and broken with a laser - no cut at all." },
      { name: "PCNL", desc: "Keyhole removal of a large kidney stone through a small track in the flank." },
      { name: "Shockwave lithotripsy", desc: "Stones broken from outside the body, for the sizes and positions where that works." },
      { name: "TURP", desc: "Endoscopic trimming of an enlarged prostate, for a stream that has become a problem." },
      { name: "DJ stenting", desc: "A soft internal stent to relieve a blocked kidney straight away, while the stone is planned for." },
      { name: "Cystoscopy", desc: "A camera look inside the bladder when there is blood in the urine that must be explained." },
      { name: "Hydrocele and hernia repair", desc: "Day-case repair for scrotal swellings and groin hernias." },
      { name: "Prostate biopsy", desc: "Targeted sampling when the PSA or the examination raises a question." },
    ],
    interests: ["Laser and keyhole stone surgery", "Prostate disease in men over 50", "Recurrent stone prevention", "Endoscopic reconstruction"],
    seeIf: [
      "There is severe pain in the side or back that comes in waves, with vomiting",
      "You see blood in your urine, even once, even painlessly",
      "You are up two or more times a night to pass urine",
      "The stream has become slow, or you feel you never fully empty",
      "Urine infections keep coming back after treatment",
      "You have had a stone before - they recur in about half of people",
    ],
    education: [
      { award: "MBBS", note: "Bachelor of Medicine and Bachelor of Surgery - the basic medical degree, five and a half years including a year of internship." },
      { award: "MS (General Surgery)", note: "Master of Surgery - three years of postgraduate surgical training in general surgery." },
      { award: "MCh (Urology)", note: "Magister Chirurgiae - the super-speciality surgical degree in urology, taken after an MS." },
    ],
    prepare: [
      "Bring all ultrasound and CT scans, with the films",
      "Bring previous urine culture reports and any PSA result",
      "Come with a comfortably full bladder if a scan is expected",
      "If you have passed a stone, bring it - the type decides how we stop the next one",
    ],
  },

  {
    id: "Dr. K. Sravan Kumar",
    name: "Dr. K. Sravan Kumar",
    specialization: "Paediatrician",
    designation: "Consultant Paediatrician & Neonatologist",
    department: "Paediatrics",
    qualification: "MBBS, MD Paediatrics",
    experience: 11,
    age: 38,
    fee: 500,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · First floor · Children's care",
    image: "/images/doctor-8.avif",
    bio: "Paediatric consultant providing comprehensive healthcare for newborns, infants, children and adolescents.",
    about: [
      "Half of paediatrics is reassurance and the other half is spotting the child who is genuinely unwell among the twenty who are not. That judgement is what a first visit buys: a proper examination, an honest read on whether this needs an antibiotic, a test, or a night of watching at home with clear instructions on what would change the answer.",
      "The clinic runs the full childhood schedule - newborn checks, weight and height plotted on a chart rather than guessed at, developmental milestones, the national and optional vaccination schedule, and the feeding and sleep questions that no one warns first-time parents about.",
      "Newborn care is looked after alongside the delivery service, so a baby who needs watching after birth is watched here rather than transferred. Sick children are seen at any hour; a child under three months with a fever is never asked to wait for a morning slot.",
    ],
    languages: "Telugu, English",
    focus: ["Newborn Care", "Vaccination", "Childhood Illness", "Growth Monitoring"],
    treats: [
      "Newborn checks and jaundice",
      "Fever in children",
      "Cough, cold and chest infection",
      "Asthma and wheezing",
      "Loose motions and dehydration",
      "Vomiting and feeding difficulty",
      "Poor weight gain and growth concerns",
      "Delayed milestones",
      "Anaemia and nutritional deficiency",
      "Worm infestation",
      "Skin rashes and allergies",
      "Recurrent tonsillitis and ear infection",
      "Adolescent health and puberty concerns",
    ],
    procedures: [
      { name: "Newborn examination", desc: "The head-to-toe check in the first days, including jaundice, feeding and the hip and heart screen." },
      { name: "Vaccination", desc: "The full national schedule plus optional vaccines, recorded in a card you keep." },
      { name: "Growth and development assessment", desc: "Height, weight and head circumference plotted on a chart, with milestones checked against age." },
      { name: "Nebulisation", desc: "Immediate treatment in the clinic for a child who is wheezing or struggling to breathe." },
      { name: "Rehydration therapy", desc: "Oral or intravenous fluids for a child losing more than they can drink." },
      { name: "Jaundice management", desc: "Phototherapy for a newborn whose bilirubin has climbed past the safe line." },
      { name: "Nutritional counselling", desc: "Practical feeding plans for a baby who is not gaining, or a child who eats nothing green." },
    ],
    interests: ["Newborn and premature care", "Childhood asthma and allergy", "Growth and nutrition", "Vaccination and preventive paediatrics"],
    seeIf: [
      "A baby under three months has any fever - come in the same day",
      "A child is breathing fast, pulling in at the ribs, or wheezing",
      "There are fewer wet nappies, no tears, or a child too drowsy to drink",
      "Weight has stalled, or the child has slipped down the growth chart",
      "A milestone - sitting, walking, first words - is not arriving",
      "Vaccinations are due, or a dose has been missed and needs catching up",
    ],
    education: [
      { award: "MBBS", note: "Bachelor of Medicine and Bachelor of Surgery - the basic medical degree, five and a half years including a year of internship." },
      { award: "MD (Paediatrics)", note: "Doctor of Medicine - three years of postgraduate training in paediatrics." },
    ],
    prepare: [
      "Bring the vaccination card every single time, even for an unrelated illness",
      "Bring the birth record and discharge summary for a baby under one",
      "Note the fever pattern: how high, how often, what brings it down",
      "Bring a written list of feeds or symptoms if the visit is about weight or sleep",
    ],
  },

  {
    id: "Dr. Aditya Bala",
    name: "Dr. Aditya Bala",
    specialization: "Neurologist",
    designation: "Consultant Neurologist",
    department: "Neurology",
    qualification: "MBBS, MD (General Medicine), DM Neurology",
    experience: 15,
    age: 44,
    fee: 850,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · First floor · Neurosciences",
    image: "/images/doctor-9.avif",
    bio: "Neurologist managing stroke, epilepsy, headaches, Parkinson's disease and nerve disorders.",
    about: [
      "Neurology is a history speciality. What the symptom did - how fast it came, what it affected, what it spared, what came back - usually names the problem before any scan does, which is why this clinic asks a lot of questions and expects the family to fill in what the patient cannot.",
      "Stroke is the emergency that runs through everything. The treatment window is measured in hours, so a face that has dropped, an arm that has gone weak or speech that has slurred is an emergency call and not an appointment - even if it recovers on its own within minutes, which is a warning rather than an all-clear.",
      "The scheduled work is headache, epilepsy, Parkinson's disease, dizziness and nerve pain, and it is long-term work. Seizure control and Parkinson's medication are adjusted over months against a record kept between visits, so bringing a diary is genuinely more useful here than bringing another scan.",
    ],
    languages: "Telugu, English",
    focus: ["Stroke", "Epilepsy", "Migraine", "Neuromuscular Disorders"],
    treats: [
      "Stroke and mini-stroke (TIA)",
      "Epilepsy, fits and seizures",
      "Migraine and chronic headache",
      "Parkinson's disease and tremor",
      "Giddiness and vertigo",
      "Numbness, tingling and nerve pain",
      "Facial palsy",
      "Memory loss and dementia",
      "Neck and back pain with nerve symptoms",
      "Muscle weakness",
      "Sleep disorders",
      "Multiple sclerosis and related conditions",
    ],
    procedures: [
      { name: "Stroke assessment", desc: "Urgent examination and imaging to decide, within the treatment window, what can still be reversed." },
      { name: "EEG", desc: "A recording of the brain's electrical activity, when the question is whether an event was a seizure." },
      { name: "Nerve conduction study and EMG", desc: "Measuring how nerves and muscles are actually conducting, for weakness and numbness." },
      { name: "Epilepsy management", desc: "Choosing and adjusting anti-seizure medicine against a seizure diary, aiming for full control." },
      { name: "Headache management", desc: "Separating migraine from the headaches that need a scan, then preventing rather than only treating." },
      { name: "Parkinson's care", desc: "Medication timed to the day's fluctuations, with physiotherapy alongside." },
      { name: "Botulinum toxin injection", desc: "For spasticity, dystonia and some chronic migraine, where tablets have not worked." },
    ],
    interests: ["Acute stroke and secondary prevention", "Difficult-to-control epilepsy", "Movement disorders", "Headache medicine"],
    seeIf: [
      "A face has drooped, an arm has gone weak or speech has slurred - call, do not book",
      "There has been a fit, a blackout or an episode nobody can explain",
      "Headaches have changed in pattern, or wake you from sleep",
      "A hand has developed a tremor, or movement has become slow and stiff",
      "There is numbness, tingling or weakness that is spreading",
      "Memory or behaviour has changed in a way the family has noticed",
    ],
    education: [
      { award: "MBBS", note: "Bachelor of Medicine and Bachelor of Surgery - the basic medical degree, five and a half years including a year of internship." },
      { award: "MD (General Medicine)", note: "Doctor of Medicine - three years of postgraduate training in general medicine." },
      { award: "DM (Neurology)", note: "Doctorate of Medicine - the super-speciality degree in neurology, taken after an MD." },
    ],
    prepare: [
      "Bring someone who witnessed the episode - their account matters more than the patient's",
      "Bring a video of a fit or a tremor if anyone managed to record one",
      "Bring all MRI and CT films, plus every previous EEG",
      "Bring a headache or seizure diary: dates, duration, what was happening beforehand",
    ],
  },

  {
    id: "Dr. G. Manjithun",
    name: "Dr. G. Manjithun",
    specialization: "Neurosurgeon",
    designation: "Consultant Neuro & Spine Surgeon",
    department: "Neurosurgery",
    qualification: "MBBS, MCh Neurosurgery",
    experience: 17,
    age: 47,
    fee: 1200,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · First floor · Neurosciences",
    image: "/images/doctor-10.avif",
    bio: "Neurosurgeon treating brain, spine and peripheral nerve disorders using advanced surgical techniques.",
    about: [
      "Head injury is the emergency half of this service. On a national highway corridor that means it arrives at all hours, and what matters is speed: a scan, a decision, and a theatre that is already staffed. A clot pressing on the brain is a different operation at two hours than at eight.",
      "The planned half is mostly spine. Slipped discs, canal narrowing and nerve compression that has stopped responding to physiotherapy and injections - and the honest position on all of them is that most back pain never needs a surgeon. What gets operated is the pain that runs down a limb, the weakness that is progressing, and the bladder or bowel change that must be treated the same day.",
      "Brain tumours, hydrocephalus and congenital spine problems are managed alongside neurology in the same block, so the medical and surgical opinions are formed on the same films rather than sequentially in two buildings.",
    ],
    languages: "Telugu, English",
    focus: ["Brain Surgery", "Spine Surgery", "Head Injury", "Brain Tumours"],
    treats: [
      "Head injury and skull fracture",
      "Bleeding inside the skull",
      "Brain tumours",
      "Slipped disc and sciatica",
      "Spinal canal narrowing (stenosis)",
      "Spine injuries and fractures",
      "Cervical spondylosis with nerve compression",
      "Hydrocephalus",
      "Spinal tumours",
      "Carpal tunnel and nerve entrapment",
      "Trigeminal neuralgia",
      "Congenital spine and brain conditions",
    ],
    procedures: [
      { name: "Emergency craniotomy", desc: "Opening the skull to remove a clot pressing on the brain after injury or bleed." },
      { name: "Brain tumour surgery", desc: "Removal under a microscope, with the aim of taking the tumour and keeping the function." },
      { name: "Microdiscectomy", desc: "Keyhole removal of the disc fragment pressing on a nerve, for leg pain that has not settled." },
      { name: "Spinal decompression and fusion", desc: "Making room for a compressed cord or nerve, and stabilising the segment where needed." },
      { name: "Cervical spine surgery", desc: "For neck disc disease causing arm pain, hand clumsiness or difficulty walking." },
      { name: "VP shunt", desc: "Draining excess fluid from the brain in hydrocephalus, in children and adults." },
      { name: "Peripheral nerve surgery", desc: "Releasing a trapped nerve, such as carpal tunnel at the wrist." },
    ],
    interests: ["Neurotrauma", "Minimally invasive spine surgery", "Brain tumour surgery", "Paediatric neurosurgery"],
    seeIf: [
      "There has been a head injury with vomiting, drowsiness or confusion - come in now",
      "Back or neck pain runs down a limb and physiotherapy has not touched it",
      "A hand or foot has become weak, clumsy, or is dropping things",
      "There is new difficulty controlling the bladder or bowel - same-day emergency",
      "A scan has shown a brain or spine lesion and you need a surgical opinion",
      "Headache is worst in the morning, with vomiting or blurred vision",
    ],
    education: [
      { award: "MBBS", note: "Bachelor of Medicine and Bachelor of Surgery - the basic medical degree, five and a half years including a year of internship." },
      { award: "MCh (Neurosurgery)", note: "Magister Chirurgiae - the super-speciality surgical degree in neurosurgery, taken after an MS." },
    ],
    prepare: [
      "Bring every MRI and CT on a disc as well as in print - the surgeon needs the images, not the summary",
      "Bring the reports in date order so change over time is visible",
      "Note exactly where the pain or weakness runs, and what makes it worse",
      "Bring a family member who can hear the discussion with you",
    ],
  },

  {
    id: "Dr. K. Pooja",
    name: "Dr. K. Pooja",
    specialization: "Anaesthesiologist",
    designation: "Consultant Anaesthesiologist & Intensivist",
    department: "Anaesthesiology",
    qualification: "MBBS, MD Anaesthesiology",
    experience: 9,
    age: 36,
    fee: 0,
    opd: "By Appointment",
    days: "Daily",
    room: "Theatre complex · Pre-anaesthetic clinic",
    image: "/images/doctor-11.avif",
    bio: "Anaesthesiologist providing perioperative care, ICU support and pain management services.",
    about: [
      "Anaesthesia is the speciality patients meet last and think about least, usually the night before an operation. The pre-anaesthetic visit is where the real work happens: your heart, lungs, airway, allergies, sugars and every medicine you take are reviewed, and the anaesthetic plan is built around what that review finds rather than around the operation alone.",
      "There is no walk-in OPD and no consultation fee here. This consultant is booked through the surgical team once an operation is planned, and the pre-anaesthetic assessment is arranged as part of it - which is why the front desk, not the online diary, is the way to reach this clinic.",
      "The other half of the job is the intensive care unit and the recovery room: airway management, ventilation, sedation and pain relief for patients who are critically ill, whichever department admitted them.",
    ],
    languages: "Telugu, English",
    focus: ["General Anaesthesia", "Critical Care", "Pain Management", "ICU Support"],
    treats: [
      "Pre-anaesthetic fitness assessment",
      "General anaesthesia for surgery",
      "Spinal and epidural anaesthesia",
      "Labour analgesia",
      "Post-operative pain",
      "Critical illness needing intensive care",
      "Airway and breathing support",
      "Sedation for procedures and scans",
      "Chronic pain requiring nerve blocks",
    ],
    procedures: [
      { name: "Pre-anaesthetic evaluation", desc: "The assessment before surgery that decides which anaesthetic is safest for you specifically." },
      { name: "General anaesthesia", desc: "Full anaesthesia with the airway secured and monitoring throughout the operation." },
      { name: "Spinal and epidural anaesthesia", desc: "Numbing from the waist down, so you stay awake for surgery that does not need you asleep." },
      { name: "Labour epidural", desc: "Pain relief during labour that leaves you awake and able to push." },
      { name: "Central line and arterial line insertion", desc: "Secure access for drugs and continuous monitoring in a critically ill patient." },
      { name: "Ventilator management", desc: "Breathing support in intensive care, adjusted around the illness rather than the clock." },
      { name: "Nerve blocks for pain", desc: "Targeted injections to control pain after surgery or in a long-standing pain condition." },
    ],
    interests: ["Anaesthesia for high-risk patients", "Obstetric anaesthesia", "Intensive care", "Post-operative pain relief"],
    seeIf: [
      "Surgery has been planned and the surgeon has asked for anaesthetic clearance",
      "You have had a bad reaction to anaesthesia before",
      "You have heart, lung, kidney or thyroid disease and an operation is coming up",
      "You want to discuss an epidural for labour before the day arrives",
      "A family member is in intensive care and you need the plan explained",
    ],
    education: [
      { award: "MBBS", note: "Bachelor of Medicine and Bachelor of Surgery - the basic medical degree, five and a half years including a year of internship." },
      { award: "MD (Anaesthesiology)", note: "Doctor of Medicine - three years of postgraduate training in anaesthesiology." },
    ],
    prepare: [
      "Bring every medicine you take, including blood thinners, inhalers and herbal preparations",
      "Bring recent ECG, chest X-ray and blood reports if you already have them",
      "Say whether anyone in the family has reacted badly to an anaesthetic",
      "Ask about fasting instructions and confirm them - they are not optional",
    ],
  },

  {
    id: "Dr. Athyan G",
    name: "Dr. Athyan G",
    specialization: "Anaesthesiologist",
    designation: "Consultant Anaesthesiologist",
    department: "Anaesthesiology",
    qualification: "MBBS, MD Anaesthesiology",
    experience: 8,
    age: 35,
    fee: 0,
    opd: "By Appointment",
    days: "Daily",
    room: "Theatre complex · Pre-anaesthetic clinic",
    image: "/images/doctor-12.avif",
    bio: "Consultant anaesthesiologist specialising in safe anaesthesia and critical care medicine.",
    about: [
      "This consultant covers the theatre and emergency lists - the operations that were not on a list yesterday. An emergency anaesthetic is the harder version of the same job: the same assessment of heart, lungs and airway, done in minutes, on a patient who may not be able to answer questions.",
      "Regional anaesthesia is the main interest. Spinals, epidurals and nerve blocks let a great deal of surgery happen without a general anaesthetic at all, which for an elderly patient or someone with a chest problem is often the safer and much more comfortable route, and the recovery is quicker.",
      "As with the other anaesthetic clinic, there is no walk-in OPD and no consultation fee. Assessment is arranged through the surgical team once an operation is planned, and through the front desk at any hour when it is an emergency.",
    ],
    languages: "Telugu, English",
    focus: ["Regional Anaesthesia", "Critical Care", "Emergency Anaesthesia", "ICU"],
    treats: [
      "Emergency anaesthesia at any hour",
      "Regional and nerve-block anaesthesia",
      "Pre-anaesthetic assessment",
      "Post-operative pain",
      "Critical care and ventilation",
      "Sedation for endoscopy and imaging",
      "Resuscitation and airway emergencies",
    ],
    procedures: [
      { name: "Emergency anaesthesia", desc: "Rapid assessment and anaesthesia for surgery that cannot wait for a scheduled list." },
      { name: "Ultrasound-guided nerve blocks", desc: "The nerve seen on screen before the injection, so the block works and the dose stays small." },
      { name: "Spinal anaesthesia", desc: "A single injection numbing the lower half, widely used for caesarean and limb surgery." },
      { name: "Rapid sequence intubation", desc: "Securing the airway quickly in a patient who is not fasted or is deteriorating." },
      { name: "Procedural sedation", desc: "Comfortable, monitored sedation for endoscopy, dressings and scans." },
      { name: "Intensive care support", desc: "Ventilation, fluid and drug management for patients admitted to the ICU." },
    ],
    interests: ["Ultrasound-guided regional anaesthesia", "Emergency and trauma anaesthesia", "Anaesthesia for the elderly", "Critical care"],
    seeIf: [
      "Emergency surgery has been advised and the anaesthetic needs planning now",
      "You would rather avoid a general anaesthetic and want to know if a block is possible",
      "You have a chest condition that has made anaesthesia difficult before",
      "A procedure needs sedation and you want to understand what that involves",
    ],
    education: [
      { award: "MBBS", note: "Bachelor of Medicine and Bachelor of Surgery - the basic medical degree, five and a half years including a year of internship." },
      { award: "MD (Anaesthesiology)", note: "Doctor of Medicine - three years of postgraduate training in anaesthesiology." },
    ],
    prepare: [
      "Bring your full medicine list, especially blood thinners and diabetes drugs",
      "Bring any previous anaesthetic record or discharge summary",
      "Note the time of your last food and drink - it decides when surgery can start",
      "Tell us about loose teeth, snoring or sleep apnoea; all three matter to the airway",
    ],
  },

  {
    id: "Dr. B. Ravinder",
    name: "Dr. B. Ravinder",
    specialization: "Pulmonologist",
    designation: "Consultant Pulmonologist & Sleep Physician",
    department: "Pulmonology",
    qualification: "MBBS, MD Pulmonary Medicine",
    experience: 13,
    age: 43,
    fee: 650,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · Ground floor · Chest clinic",
    image: "/images/doctor-13.avif",
    bio: "Pulmonary medicine specialist treating asthma, COPD, pneumonia and chronic respiratory diseases.",
    about: [
      "A cough that has lasted three weeks is the commonest reason people arrive here, and it is worth taking seriously: in this region that list runs from asthma and post-viral irritation to tuberculosis, and the tests that separate them are quick and worth doing early.",
      "Asthma and COPD are the long-term work. Both are managed on lung function measured with a spirometer rather than on how the breathing sounds on the day - and a great deal of the visit is spent on inhaler technique, because a correctly prescribed inhaler taken incorrectly does nothing at all.",
      "Chest X-ray and blood work are in the building and the reports come back the same visit. Breathlessness that turns out to be cardiac rather than respiratory gets walked across to general medicine or cardiology rather than sent away with a letter.",
    ],
    languages: "Telugu, English",
    focus: ["Asthma", "COPD", "Lung Infection", "Sleep Disorders"],
    treats: [
      "Asthma",
      "COPD and smoker's lung",
      "Long-standing cough",
      "Pneumonia and chest infection",
      "Tuberculosis",
      "Breathlessness on exertion",
      "Snoring and sleep apnoea",
      "Allergic rhinitis with chest symptoms",
      "Bronchiectasis",
      "Pleural effusion - fluid around the lung",
      "Occupational and dust-related lung disease",
      "Interstitial lung disease",
    ],
    procedures: [
      { name: "Spirometry", desc: "Lung function measured on a machine, so asthma and COPD are diagnosed rather than assumed." },
      { name: "Nebulisation and acute care", desc: "Immediate treatment for an asthma or COPD attack, with oxygen if it is needed." },
      { name: "Inhaler technique training", desc: "Ten minutes that decide whether the rest of the prescription works at all." },
      { name: "Pleural tap and drainage", desc: "Removing fluid from around the lung, both to relieve breathlessness and to test it." },
      { name: "Tuberculosis workup and treatment", desc: "Sputum testing, chest imaging and the full supervised course of treatment." },
      { name: "Sleep study referral and management", desc: "For snoring with daytime sleepiness, including CPAP setup where it is indicated." },
      { name: "Allergy assessment", desc: "Identifying the trigger, because avoiding it beats treating the attack." },
    ],
    interests: ["Difficult asthma", "COPD rehabilitation", "Tuberculosis", "Sleep-disordered breathing"],
    seeIf: [
      "A cough has lasted more than three weeks",
      "You get breathless doing something that did not use to make you breathless",
      "There is wheezing, or a tight chest at night or early morning",
      "You cough up blood - book the same day",
      "You snore heavily and are sleepy through the day",
      "You smoke, or used to, and want to know what it has done",
    ],
    education: [
      { award: "MBBS", note: "Bachelor of Medicine and Bachelor of Surgery - the basic medical degree, five and a half years including a year of internship." },
      { award: "MD (Pulmonary Medicine)", note: "Doctor of Medicine - three years of postgraduate training in pulmonary medicine." },
    ],
    prepare: [
      "Bring your inhalers and spacers - technique is checked in the room",
      "Bring previous chest X-rays and any sputum reports",
      "Note when the cough is worst: night, morning, at work, in a particular season",
      "Avoid your reliever inhaler for a few hours before a spirometry test, if you safely can",
    ],
  },

  {
    id: "Dr. A. Rakesh Kumar",
    name: "Dr. A. Rakesh Kumar",
    specialization: "Psychiatrist",
    designation: "Consultant Psychiatrist",
    department: "Psychiatry",
    qualification: "MBBS, MD Psychiatry",
    experience: 10,
    age: 40,
    fee: 700,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "OPD Block · First floor · Consulting room 6",
    image: "/images/doctor-14.avif",
    bio: "Psychiatrist providing evidence-based treatment for anxiety, depression, stress-related disorders and other mental health conditions.",
    about: [
      "The hardest part of this clinic is getting through the door, so it is worth saying plainly what happens on the other side of it. The first visit is a conversation, usually forty minutes. Nothing is written on a board, nothing is announced to the waiting room, and what you say stays in your record like any other medical fact.",
      "Most of what is seen here is common and treatable: depression, anxiety and panic, sleep that has broken down, stress that has started showing up as chest pain, headaches or stomach trouble, alcohol and tobacco dependence, and the low mood that follows a bereavement or a diagnosis.",
      "Treatment is not automatically a tablet. Where medication is right it is explained properly - what it does, how long it takes, what the side effects genuinely are and when it can be stopped. Where talking therapy is the better route it is arranged, and the two are often used together.",
    ],
    languages: "Telugu, English",
    focus: ["Depression", "Anxiety", "Stress Disorders", "Mental Wellness"],
    treats: [
      "Depression and persistent low mood",
      "Anxiety and panic attacks",
      "Sleep problems and insomnia",
      "Stress-related physical symptoms",
      "Obsessive compulsive disorder",
      "Bipolar disorder",
      "Schizophrenia and psychosis",
      "Alcohol, tobacco and substance dependence",
      "Grief and adjustment difficulty",
      "Postpartum depression",
      "Adolescent mental health",
      "Memory and behaviour change in older people",
    ],
    procedures: [
      { name: "Psychiatric assessment", desc: "An unhurried first consultation to understand what is happening before anything is prescribed." },
      { name: "Medication management", desc: "Starting, adjusting and eventually stopping medicine, reviewed against how you are actually doing." },
      { name: "Counselling and psychotherapy", desc: "Structured talking therapy, on its own or alongside medication." },
      { name: "De-addiction treatment", desc: "Supervised withdrawal and relapse prevention for alcohol, tobacco and other dependence." },
      { name: "Sleep assessment", desc: "Working out what has broken the sleep, rather than sedating it." },
      { name: "Family counselling", desc: "Bringing the household into the plan, which is often what makes it hold." },
    ],
    interests: ["Depression and anxiety in adults", "De-addiction", "Adolescent and student mental health", "Perinatal mental health"],
    seeIf: [
      "Low mood, loss of interest or hopelessness has lasted more than two weeks",
      "Anxiety or panic is interfering with work, study or sleep",
      "You have been investigated for physical symptoms and nothing was found",
      "Alcohol or tobacco has become difficult to stop",
      "A family member's behaviour, speech or memory has changed",
      "Anyone is having thoughts of harming themselves - come in today, or call the emergency number",
    ],
    education: [
      { award: "MBBS", note: "Bachelor of Medicine and Bachelor of Surgery - the basic medical degree, five and a half years including a year of internship." },
      { award: "MD (Psychiatry)", note: "Doctor of Medicine - three years of postgraduate training in psychiatry." },
    ],
    prepare: [
      "Bring a family member if you would like to, and come alone if you would rather",
      "Bring any medicine you are already taking, including from other doctors",
      "Note roughly when things changed - the timeline matters more than the detail",
      "Nothing needs to be prepared or rehearsed; the first visit is a conversation",
    ],
  },

  {
    id: "Dr. G. Rakesh",
    name: "Dr. G. Rakesh",
    specialization: "Physiotherapist",
    designation: "Consultant Physiotherapist",
    department: "Physiotherapy",
    qualification: "BPT",
    experience: 8,
    age: 34,
    fee: 400,
    opd: "Open 24 Hours",
    days: "Daily",
    room: "Ground floor · Physiotherapy unit",
    image: "/images/doctor-15.avif",
    bio: "Physiotherapist specialising in rehabilitation after surgery, sports injuries, neurological disorders and chronic pain.",
    about: [
      "Physiotherapy is where an operation turns into a working limb. A knee replacement, a repaired tendon or a fixed fracture reaches its final result through what happens in the weeks afterwards, and that is this department's job - starting early, because a joint that is allowed to stiffen is far harder to free than one that never did.",
      "The second stream is neurological rehabilitation: relearning movement, balance and daily tasks after a stroke, a head injury or a spinal problem. Progress there is measured in small, specific things - standing unaided, feeding yourself, walking to the gate - and the programme is rebuilt around them each week.",
      "The third is ordinary long-standing pain: backs, necks, shoulders and knees. Sessions in the unit are only half of it; each one ends with a home programme, because what happens on the other six days is what actually changes the outcome.",
    ],
    languages: "Telugu, English",
    focus: ["Rehabilitation", "Sports Injury", "Back Pain", "Post-operative Recovery"],
    treats: [
      "Recovery after joint replacement",
      "Recovery after fracture and plaster removal",
      "Stroke rehabilitation",
      "Back and neck pain",
      "Frozen shoulder",
      "Knee pain and osteoarthritis",
      "Sports injuries",
      "Sciatica and nerve pain",
      "Postural and desk-work pain",
      "Balance problems and falls in older people",
      "Chest physiotherapy after illness or surgery",
      "Antenatal and postnatal exercise",
    ],
    procedures: [
      { name: "Post-operative rehabilitation", desc: "A staged programme from the day after surgery to the day you are discharged from it." },
      { name: "Manual therapy", desc: "Hands-on mobilisation of a stiff joint or a locked segment of the spine." },
      { name: "Exercise prescription", desc: "A written, specific home programme - sets, repetitions and a date to review it." },
      { name: "Electrotherapy and ultrasound", desc: "Short-term pain relief used to make the exercise possible, not instead of it." },
      { name: "Neurological rehabilitation", desc: "Retraining movement, balance and daily tasks after a stroke or nerve injury." },
      { name: "Gait and balance training", desc: "For anyone who has started to feel unsteady, or has already had a fall." },
      { name: "Chest physiotherapy", desc: "Clearing secretions and rebuilding breathing capacity after chest illness or surgery." },
    ],
    interests: ["Post-surgical rehabilitation", "Stroke and neurological rehab", "Sports injury recovery", "Chronic back and neck pain"],
    seeIf: [
      "You have had surgery on a joint, bone or tendon and rehabilitation was advised",
      "A plaster has come off and the limb is stiff or weak",
      "Back, neck or shoulder pain has lasted more than a few weeks",
      "Movement has not returned fully after a stroke",
      "You have started feeling unsteady, or have had a fall",
      "A sports injury keeps recurring every time you go back to playing",
    ],
    education: [
      { award: "BPT", note: "Bachelor of Physiotherapy - the four-and-a-half year degree, clinical internship included." },
    ],
    prepare: [
      "Bring the operation notes or discharge summary, and any X-ray taken since",
      "Wear or bring clothing you can move and exercise in",
      "Bring any walking aid, brace or support you are currently using",
      "Be honest about how much of the last home programme you actually did",
    ],
  },
];

/** Counted up on scroll. Tabular numerals, no decoration. */
export const STATS = [
  { value: 8, suffix: "", label: "Departments", sub: "under one roof" },
  { value: 12, suffix: "+", label: "Specialists", sub: "consulting daily" },
  { value: 24, suffix: "×7", label: "Emergency", sub: "never closed" },
  { value: 30, suffix: "min", label: "Report turnaround", sub: "for routine bloods" },
];

/**
 * The care model. Replaces the old generic blurbs.
 * Each pillar is a claim we can actually stand behind - because the ERP
 * behind this site genuinely does it.
 */
/**
 * THE CARE MODEL - what this hospital promises, in the order it happens.
 *
 * The first three pillars are about the record, which is the thesis the whole
 * site is built on. The last three are the rest of the promise: who treats you,
 * what it costs, and when the door is open. A care model that only describes
 * the software answers a question no patient asked - the record is how the
 * hospital keeps the promise, not the promise itself.
 *
 * Hours and days interpolate from HOSPITAL so this cannot drift from the FAQ,
 * the visit chapter or the tariff.
 */
export const CARE_MODEL = [
  {
    index: "01",
    title: "One ID, for life",
    text: "You are registered once and given a permanent Jeeva ID. Every visit, every scan, every prescription and every bill attaches to that one number - so nothing is lost between departments, and nothing is asked of you twice.",
  },
  {
    index: "02",
    title: "Your history is already on the screen",
    text: "By the time you sit down, the doctor can see your past visits, your last blood report and what you were prescribed in March. You should not have to be your own medical record.",
  },
  {
    index: "03",
    title: "Diagnostics and pharmacy in the building",
    text: "Tests are ordered straight to our lab, and results land on your record the moment they are ready. Medicines are dispensed from batch-tracked stock against your ID, with a proper GST bill in your hand.",
  },
  {
    index: "04",
    title: "You pick the consultant, not a queue",
    text: "Every doctor here is named, with their qualification, the days they sit and the hours they consult published before you book. There is no pooled list and no 'whoever is free' - the consultant you chose is the one who sees you.",
  },
  {
    index: "05",
    title: "The price is on the website, not at the counter",
    text: "Consultation fees, ward rates and health check prices are all published here, and they are the same figures the hospital bills from. A room rate is locked at admission, so the number you were quoted is the number on the bill.",
  },
  {
    index: "06",
    title: "One door never closes",
    text: `Routine OPD runs ${HOSPITAL.opdHours}, ${HOSPITAL.opdDays}. Emergency is a separate door and is staffed every hour of every day, including Sundays and holidays - because the thing you cannot plan for is the thing a hospital has to be ready for.`,
  },
];

/**
 * A first visit, step by step.
 *
 * `meta` is the expectation somebody needs before they arrive - how long the
 * step takes, or how often they will do it. `why` is the point of the step
 * stated as what it spares the patient, because a list of desks explains the
 * hospital's process and answers none of the questions an anxious first-timer
 * actually has. Every figure here is published elsewhere on this site too, and
 * they must not be allowed to disagree.
 */
export const JOURNEY = [
  {
    step: "01", title: "Register",
    meta: "About 2 minutes · once, ever",
    text: "The front desk issues your permanent Jeeva ID. It takes about two minutes, and you only ever do it once.",
    why: "So no visit after this one ever starts with a form again.",
  },
  {
    step: "02", title: "Consult",
    meta: "Your history, already open",
    text: "You meet your doctor with your full history already open in front of them - no lost files, no repeating yourself.",
    why: "So you are not the one carrying the file, or remembering the dosage.",
  },
  {
    step: "03", title: "Diagnostics",
    meta: "Routine reports in about 30 minutes",
    text: "Any tests advised go straight to our lab. Reports upload to your record the moment they are ready.",
    why: "So most people leave with the result, not a date to come back for it.",
  },
  {
    step: "04", title: "Pharmacy",
    meta: "Batch-tracked · GST bill",
    text: "Prescribed medicines are dispensed against your ID from verified, batch-tracked stock. GST bill in hand.",
    why: "So what you are handed can be traced, and what you paid is on paper.",
  },
];

export const IMAGES = {
  heroBuilding: "/images/hospital_banner1.png",
  equipment: "/images/facility-equipment.jpg",
  ward: "/images/facility-ward.jpg",
  gynaec: "/images/dept-gynocology.avif",
  paediatric: "/images/dept-paediatric.avif",
  general: "/images/dept-general-medicine.avif"
};

/**
 * Rooms & pricing - PUBLISHED, deliberately.
 * Most hospital sites hide rates; families find out at the billing counter on
 * the worst day of their week. These are the same figures the ERP charges from
 * (and locks at admission), so the website and the bill cannot disagree.
 * Room rent above ₹5,000/day attracts 5% GST (non-ICU); ICU is exempt.
 */
export const WARDS = [
  {
    name: "General Ward", beds: 10, price: 1500, gst: 0, floor: "1st floor",
    note: "Shared hall, curtained bays. Nursing round the clock.",
    includes: ["Nursing care", "Doctor's daily round", "Attendant chair"]
  },
  {
    name: "Semi-Private", beds: 6, price: 3000, gst: 0, floor: "2nd floor",
    note: "Two beds to a room. A little quiet, without the private price.",
    includes: ["Everything in General", "Two-bed room", "Attendant bench"]
  },
  {
    name: "Private Room", beds: 4, price: 5500, gst: 5, floor: "2nd floor",
    note: "Your own room, your own bathroom, a proper attendant bed.",
    includes: ["Everything in Semi-Private", "Attached bathroom", "Attendant bed", "AC"]
  },
  {
    name: "ICU", beds: 4, price: 8000, gst: 0, floor: "3rd floor",
    note: "Monitored critical care. One nurse is never far from your person.",
    includes: ["Continuous monitoring", "Critical-care nursing", "Ventilator support"]
  },
] as const;

/**
 * Health check packages - published for the same reason room rates are.
 *
 * ⚠️ PRICES AND CONTENTS ARE PROVISIONAL. They are modelled on the tests this
 * hospital already says it runs in-house (lab, ECG, 2D echo, TMT, digital
 * X-ray) and priced in line with the published consultation fees - but they
 * have NOT been confirmed against Jeeva's actual tariff. Confirm every figure
 * with the lab and billing before this page goes live: a family that arrives
 * expecting ₹1,200 and is billed ₹2,400 loses trust in everything else on the
 * site, including the room rates that ARE accurate.
 */
export interface HealthPackage {
  slug: string;
  name: string;
  price: number;
  /** Who it's actually for, in plain words. */
  forWhom: string;
  /** Roughly how long it takes at the hospital. */
  duration: string;
  fasting: boolean;
  includes: string[];
  /** The one that most people should pick. */
  popular?: boolean;
}

export const HEALTH_PACKAGES: HealthPackage[] = [
  {
    slug: "basic", name: "Basic Health Check", price: 1200,
    forWhom: "A yearly once-over if you're well and under 40.",
    duration: "About 2 hours", fasting: true,
    includes: [
      "Doctor consultation", "Complete blood count", "Blood sugar (fasting)",
      "Urine routine", "Blood pressure & BMI", "Reports explained the same day",
    ],
  },
  {
    slug: "full-body", name: "Full Body Check", price: 2800, popular: true,
    forWhom: "The standard annual check for adults over 40, or anyone with a family history.",
    duration: "About 3 hours", fasting: true,
    includes: [
      "Doctor consultation", "Complete blood count", "Blood sugar (fasting & post-meal)",
      "HbA1c", "Lipid profile", "Liver function", "Kidney function", "Thyroid (TSH)",
      "Urine routine", "ECG", "Chest X-ray", "Reports explained the same day",
    ],
  },
  {
    slug: "heart", name: "Heart Check", price: 3500,
    forWhom: "Chest discomfort, high BP, or a heart problem in the family.",
    duration: "About 3 hours", fasting: true,
    includes: [
      "Cardiologist consultation", "ECG", "2D Echocardiogram", "Treadmill test (TMT)",
      "Lipid profile", "Blood sugar (fasting)", "Blood pressure review",
    ],
  },
  {
    slug: "women", name: "Women's Health Check", price: 3200,
    forWhom: "A yearly check covering the things that get put off.",
    duration: "About 3 hours", fasting: true,
    includes: [
      "Gynaecologist consultation", "Complete blood count", "Blood sugar (fasting)",
      "Thyroid (TSH)", "Haemoglobin & iron", "Vitamin D & B12",
      "Pelvic ultrasound", "Breast examination", "Pap smear",
    ],
  },
  {
    slug: "diabetes", name: "Diabetes Check", price: 1600,
    forWhom: "Living with diabetes, or told you're close to it.",
    duration: "About 2 hours", fasting: true,
    includes: [
      "Physician consultation", "Blood sugar (fasting & post-meal)", "HbA1c",
      "Kidney function", "Lipid profile", "Urine microalbumin", "Foot & eye check advice",
    ],
  },
  {
    slug: "pre-employment", name: "Pre-Employment Check", price: 900,
    forWhom: "Employers and colleges that need a fitness certificate.",
    duration: "About 90 minutes", fasting: false,
    includes: [
      "Physician consultation", "Complete blood count", "Blood sugar (random)",
      "Vision & hearing screen", "Chest X-ray", "Fitness certificate",
    ],
  },
];

/** Questions the front desk answers fifty times a day - answered once, here. */
/**
 * The questions the front desk answers fifty times a day.
 *
 * EVERY ANSWER IS DERIVED FROM DATA IN THIS FILE. Hours come from HOSPITAL,
 * rates from WARDS, fasting from HEALTH_PACKAGES, languages from DOCTORS - the
 * figures are interpolated rather than typed out, so an answer here cannot
 * quietly disagree with the tariff or the booking flow the way hardcoded copy
 * does. Anything the hospital has not published - insurance panels, cashless
 * TPAs, visiting-hour policy - is deliberately absent rather than guessed at.
 */
export const FAQ = [
  {
    q: "What should I bring on my first visit?",
    a: "Just yourself, a phone number, and any old reports or prescriptions you have. Reception registers you in about two minutes and issues your Jeeva ID (it looks like JMH2026OP00123). Every visit after that, the ID is all you need - your history is already with us.",
  },
  {
    q: "Can I choose which doctor I see?",
    a: `Yes. All ${DOCTORS.length} consultants are named on this site with their qualification, the days and hours they consult, and their fee - you pick the one you want and book that slot. There is no pooled queue and no "whoever is on duty": the consultant you booked is the consultant who sees you.`,
  },
  {
    q: "Are you open on Sunday?",
    a: `Routine OPD runs ${HOSPITAL.opdHours}, ${HOSPITAL.opdDays} - so Sunday is the one day there is no routine consulting. Emergency is a separate door and never closes: it is staffed 24×7, every day of the year including Sundays and holidays, on ${HOSPITAL.emergency}.`,
  },
  {
    q: "Do I pay before or after seeing the doctor?",
    a: "The consultation is billed when you book at the desk - you'll get a printed receipt with the fee on it. Medicines and lab tests, if the doctor advises any, are billed separately at the pharmacy and lab counters, so you only ever pay for what you actually take.",
  },
  {
    q: "How do I collect my lab reports?",
    a: "Routine blood work is usually ready in about 30 minutes. You can collect a printout from the lab counter, or sign in to the patient portal with your Jeeva ID and download it from your phone - every report you've ever had here stays in one place.",
  },
  {
    q: "Can my medicines be bought outside?",
    a: "Of course. The doctor's prescription is yours - our in-house pharmacy simply has the medicines the doctors here actually prescribe, checks expiry dates automatically, and bills with proper GST receipts. If we're short-stocked, we'll say so rather than substitute quietly.",
  },
  {
    q: "Can someone stay with an admitted patient?",
    a: "Yes - one attendant per patient, and we record their name and phone at admission so the ward can reach the right person immediately. General ward has attendant chairs; private rooms have a proper attendant bed.",
  },
  {
    q: "What payment methods do you accept?",
    a: "Cash, UPI, and cards at every counter - consultation, pharmacy, lab, and admissions. Every payment gets a printed, GST-compliant receipt with a receipt number, and any past bill can be reprinted at the desk if you lose yours.",
  },
  {
    q: "What will a room cost if I have to be admitted?",
    a: `Every ward rate is on this site rather than quoted to you at admission - from ₹${Math.min(
      ...WARDS.map((w) => w.price),
    ).toLocaleString("en-IN")} a day for the general ward, with what each room includes listed beside the price. Room rent above ₹5,000 a day attracts 5% GST on the non-ICU wards; ICU is exempt. The rate is locked at admission, so the figure you were quoted is the figure you are billed.`,
  },
  {
    q: "Do I need to fast for a health check?",
    a: `Most of the ${HEALTH_PACKAGES.length} packages do - nothing but water for about 10 hours - and each one says so on the health checks page along with how long it takes. No appointment slot is needed; come any morning. Routine bloods come back in about 30 minutes, so a doctor goes through the results with you before you leave rather than posting them on.`,
  },
  {
    q: "Which languages can I be seen in?",
    a: "Telugu and English, across the whole consulting panel. Each doctor's profile lists the languages they consult in, so you can check before you book rather than finding out in the room.",
  },
] as const;

/** Every sign-in the building has. Patients first; staff below. */
export const PORTALS = [
  { key: "portal", label: "Patient portal", sub: "Your visits, reports & prescriptions", staff: false, path: "/portal/login" },
  { key: "reception", label: "Reception", sub: "Front desk · OPD · admissions", staff: true },
  { key: "doctor", label: "Doctors", sub: "Queue, patient files & history", staff: true },
  { key: "labs", label: "Laboratory", sub: "Test queue & report uploads", staff: true },
  { key: "pharmacy", label: "Pharmacy", sub: "Dispensing & stock", staff: true },
  { key: "admin", label: "Administration", sub: "Staff, wards, rates & audit", staff: true },
] as const;
