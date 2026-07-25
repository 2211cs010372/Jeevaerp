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
  phone: "+91 87 6543 2100",
  emergency: "+91 87 6543 2100",
  opdHours: "8:00 AM – 8:00 PM",
  opdDays: "Monday to Saturday",
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
  /** How they describe their practice. Mirrors Doctor.bio in the ERP. */
  bio: string;
  /** Which languages you can be seen in - the first thing many families check. */
  languages: string;
  /** The conditions they actually spend their week on. */
  focus: string[];
}

/**
 * The consulting panel. `bio`, `languages` and `focus` describe the PRACTICE -
 * what a doctor treats, in which languages, on what equipment. They are
 * deliberately not personal history: anything about where someone grew up or
 * trained has to come from the doctor, not from us.
 */
export const DOCTORS: Doctor[] = [
  {
    id: "d1",
    name: "Dr. Shireesha M",
    specialization: "Obstetrician & Gynaecologist",
    department: "Gynaecology",
    qualification: "MBBS, MS",
    experience: 12,
    age: 40,
    fee: 600,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-1.avif",
    bio: "Experienced consultant in women's health providing antenatal care, pregnancy management, gynaecological surgery and preventive women's healthcare.",
    languages: "Telugu, English",
    focus: ["High-risk pregnancy", "Normal delivery", "Caesarean section", "Women's health"],
  },

  {
    id: "d2",
    name: "Dr. A. Shanthosh",
    specialization: "General Physician",
    department: "General Medicine",
    qualification: "DNB (General Medicine)",
    experience: 10,
    age: 39,
    fee: 500,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-2.avif",
    bio: "Consultant physician managing diabetes, hypertension, infectious diseases and preventive healthcare.",
    languages: "Telugu, English",
    focus: ["Diabetes", "Hypertension", "Fever", "Health Check-ups"],
  },

  {
    id: "d3",
    name: "Dr. B. Poornachander",
    specialization: "General Surgeon",
    department: "General Surgery",
    qualification: "MS (General Surgery)",
    experience: 15,
    age: 45,
    fee: 650,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-3.avif",
    bio: "General surgeon experienced in abdominal surgeries, laparoscopic procedures and emergency surgical care.",
    languages: "Telugu, English",
    focus: ["Laparoscopic Surgery", "Hernia", "Gall Bladder", "Emergency Surgery"],
  },

  {
    id: "d4",
    name: "Dr. Venkata Ratnam Chesamalla",
    specialization: "ENT Surgeon",
    department: "ENT",
    qualification: "MS (ENT)",
    experience: 18,
    age: 49,
    fee: 600,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-4.avif",
    bio: "Specialist in ear, nose and throat disorders with expertise in hearing loss, sinus disease and head & neck conditions.",
    languages: "Telugu, English",
    focus: ["Sinus Surgery", "Hearing Disorders", "Throat Problems", "Nasal Disorders"],
  },

  {
    id: "d5",
    name: "Dr. P. Rajakshi Kumar",
    specialization: "Plastic Surgeon",
    department: "Plastic Surgery",
    qualification: "MCh Plastic Surgery",
    experience: 14,
    age: 44,
    fee: 900,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-5.avif",
    bio: "Plastic and reconstructive surgeon specialising in trauma reconstruction, burns and cosmetic procedures.",
    languages: "Telugu, English",
    focus: ["Reconstructive Surgery", "Burn Care", "Scar Revision", "Cosmetic Procedures"],
  },

  {
    id: "d6",
    name: "Dr. V. Prashanth",
    specialization: "Orthopaedic Surgeon",
    department: "Orthopaedics",
    qualification: "MS Orthopaedics",
    experience: 13,
    age: 42,
    fee: 650,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-6.avif",
    bio: "Orthopaedic consultant treating fractures, arthritis, sports injuries and spine disorders.",
    languages: "Telugu, English",
    focus: ["Joint Replacement", "Trauma", "Sports Injuries", "Arthroscopy"],
  },

  {
    id: "d7",
    name: "Dr. B. Laxmi",
    specialization: "Urologist",
    department: "Urology",
    qualification: "MBBS, MS (General Surgery), MCh Urology",
    experience: 12,
    age: 41,
    fee: 800,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-7.avif",
    bio: "Consultant urologist treating kidney stones, prostate disorders and urinary tract diseases.",
    languages: "Telugu, English",
    focus: ["Kidney Stones", "Prostate", "Urinary Disorders", "Urological Surgery"],
  },

  {
    id: "d8",
    name: "Dr. K. Sravan Kumar",
    specialization: "Paediatrician",
    department: "Paediatrics",
    qualification: "MBBS, MD Paediatrics",
    experience: 11,
    age: 38,
    fee: 500,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-8.avif",
    bio: "Paediatric consultant providing comprehensive healthcare for newborns, infants, children and adolescents.",
    languages: "Telugu, English",
    focus: ["Newborn Care", "Vaccination", "Childhood Illness", "Growth Monitoring"],
  },

  {
    id: "d9",
    name: "Dr. Aditya Bala",
    specialization: "Neurologist",
    department: "Neurology",
    qualification: "MBBS, MD (General Medicine), DM Neurology",
    experience: 15,
    age: 44,
    fee: 850,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-9.avif",
    bio: "Neurologist managing stroke, epilepsy, headaches, Parkinson's disease and nerve disorders.",
    languages: "Telugu, English",
    focus: ["Stroke", "Epilepsy", "Migraine", "Neuromuscular Disorders"],
  },

  {
    id: "d10",
    name: "Dr. G. Manjithun",
    specialization: "Neurosurgeon",
    department: "Neurosurgery",
    qualification: "MBBS, MCh Neurosurgery",
    experience: 17,
    age: 47,
    fee: 1200,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-10.avif",
    bio: "Neurosurgeon treating brain, spine and peripheral nerve disorders using advanced surgical techniques.",
    languages: "Telugu, English",
    focus: ["Brain Surgery", "Spine Surgery", "Head Injury", "Brain Tumours"],
  },

  {
    id: "d11",
    name: "Dr. K. Pooja",
    specialization: "Anaesthesiologist",
    department: "Anaesthesiology",
    qualification: "MBBS, MD Anaesthesiology",
    experience: 9,
    age: 36,
    fee: 0,
    opd: "By Appointment",
    days: "Daily",
    image: "/images/doctor-11.avif",
    bio: "Anaesthesiologist providing perioperative care, ICU support and pain management services.",
    languages: "Telugu, English",
    focus: ["General Anaesthesia", "Critical Care", "Pain Management", "ICU Support"],
  },

  {
    id: "d12",
    name: "Dr. Athyan G",
    specialization: "Anaesthesiologist",
    department: "Anaesthesiology",
    qualification: "MBBS, MD Anaesthesiology",
    experience: 8,
    age: 35,
    fee: 0,
    opd: "By Appointment",
    days: "Daily",
    image: "/images/doctor-12.avif",
    bio: "Consultant anaesthesiologist specialising in safe anaesthesia and critical care medicine.",
    languages: "Telugu, English",
    focus: ["Regional Anaesthesia", "Critical Care", "Emergency Anaesthesia", "ICU"],
  },

  {
    id: "d13",
    name: "Dr. B. Ravinder",
    specialization: "Pulmonologist",
    department: "Pulmonology",
    qualification: "MBBS, MD Pulmonary Medicine",
    experience: 13,
    age: 43,
    fee: 650,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-13.avif",
    bio: "Pulmonary medicine specialist treating asthma, COPD, pneumonia and chronic respiratory diseases.",
    languages: "Telugu, English",
    focus: ["Asthma", "COPD", "Lung Infection", "Sleep Disorders"],
  },

  {
    id: "d14",
    name: "Dr. A. Rakesh Kumar",
    specialization: "Psychiatrist",
    department: "Psychiatry",
    qualification: "MBBS, MD Psychiatry",
    experience: 10,
    age: 40,
    fee: 700,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-14.avif",
    bio: "Psychiatrist providing evidence-based treatment for anxiety, depression, stress-related disorders and other mental health conditions.",
    languages: "Telugu, English",
    focus: ["Depression", "Anxiety", "Stress Disorders", "Mental Wellness"],
  },

  {
    id: "d15",
    name: "Dr. G. Rakesh",
    specialization: "Physiotherapist",
    department: "Physiotherapy",
    qualification: "BPT",
    experience: 8,
    age: 34,
    fee: 400,
    opd: "Open 24 Hours",
    days: "Daily",
    image: "/images/doctor-15.avif",
    bio: "Physiotherapist specialising in rehabilitation after surgery, sports injuries, neurological disorders and chronic pain.",
    languages: "Telugu, English",
    focus: ["Rehabilitation", "Sports Injury", "Back Pain", "Post-operative Recovery"],
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
];

export const JOURNEY = [
  { step: "01", title: "Register", text: "The front desk issues your permanent Jeeva ID. It takes about two minutes, and you only ever do it once." },
  { step: "02", title: "Consult", text: "You meet your doctor with your full history already open in front of them - no lost files, no repeating yourself." },
  { step: "03", title: "Diagnostics", text: "Any tests advised go straight to our lab. Reports upload to your record the moment they are ready." },
  { step: "04", title: "Pharmacy", text: "Prescribed medicines are dispensed against your ID from verified, batch-tracked stock. GST bill in hand." },
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
export const FAQ = [
  {
    q: "What should I bring on my first visit?",
    a: "Just yourself, a phone number, and any old reports or prescriptions you have. Reception registers you in about two minutes and issues your Jeeva ID (it looks like JMH2026OP00123). Every visit after that, the ID is all you need - your history is already with us.",
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
