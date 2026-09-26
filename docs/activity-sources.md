# Atlanta activity catalog v1 — source review

## Coverage

- Exactly **100** evergreen activity suggestions across **63** named venues or places.
- **90 public** suggestions; **10 Georgia Tech community** suggestions. Public eligibility describes ordinary public visiting arrangements, not guaranteed admission at any time.
- **41 indoor / 59 outdoor** suggestions. Cost classifications: **52 free, 32 paid, 16 unknown**.
- Source pages were observed using public web search and page extraction on **2026-09-26**. The primary-source review checkpoint is **2026-09-26T15:15:00Z**, recorded in the initial rows; supporting cost-policy checks followed during the same session. Fernbank sources were rechecked later in the session when normalizing the shared venue name.
- General review date: **2026-12-25**. Northside Trail and Oakland receive a seven-day review because of access changes; King park and the Municipal Market receive a thirty-day review.

## Interpretation and maintenance

Each title and summary is an original suggested outing. Conversation prompts, drawing ideas, suggested routes, and durations are editorial suggestions, not advertised programs or source promises. `duration_minutes` is planning time, excluding travel. No named current exhibition, exact price, opening hour, showtime, available ticket, accessible route, wildlife sighting, or blooming plant is guaranteed.

All records use `kind: evergreen` with null start/end times. There are **no scraped dated events** in this seed. A future event ingestion source must provide a verified future detail page and actual times; do not turn these ideas into scheduled events.

Cost means the core activity: free public walking/browsing still can involve transport, parking, food, materials, or rentals. Public park/campus walks with no admission gate are classified free as an editorial access assessment; where facility or parking charges were unclear, the record is unknown. Paid state and national park rows account for vehicle parking passes. Do not present unknown as free. Student concessions appear in notes and must be verified with the venue.

The source link is for the place or supported activity; supporting admission and visitor-policy links below qualify it. Source checks are remote page reviews, not field inspections. An active record is eligible for consideration, not a claim that its venue is open now. Respect `review_after`, current weather, visitor restrictions, reservations, renovation notices, and official opening information. Campus indoor recreation/craft/library-lounge access is conservatively tagged `gt_community`; the catalog does not infer a user's membership. Museums on college campuses remain public only where the official site explicitly welcomes public visitors.

Regional suggestions (Kennesaw, Stonecrest, Stockbridge and Lithia Springs) are labeled in `area`; they are not walkable Georgia Tech outings. The catalog includes no Atlanta beach claim. Sweetwater Creek's reservoir explicitly prohibits swimming and has no beach. Panola summit access and the inside of Sweetwater's mill are not included in self-guided suggestions.

## Primary source ledger

These compact notes record the supporting facts read. Linked institutions/operators are primary sources; parks conservancies and PATH are the organizations describing the relevant places. Repeated records at a venue describe different supported activities. No source descriptions or images were copied.

| Source | What was checked / limitation |
| --- | --- |
| [Georgia Tech Student and Campus Event Centers](https://studentcenter.gatech.edu/tech-rec) | Bowling, billiards, board games, shuffleboard and patio games; campus-oriented access and listed fees. |
| [Georgia Tech Paper & Clay](https://studentcenter.gatech.edu/paper-clay) | Ceramics, pottery and free craft materials; firing takes additional visits. |
| [Georgia Tech Arts](https://arts.gatech.edu/public-art) | Outdoor collection, Three Pioneers and Pathway of Progress; visitors invited. |
| [Georgia Tech Sustainability](https://recycle.gatech.edu/ecocommons) | EcoCommons paths, picnic spaces and landscape; no indoor building access assumed. |
| [Georgia Tech Library](https://library.gatech.edu/exhibits-gallery) | Price Gilbert exhibition gallery; public visitor restrictions checked separately. |
| [Georgia Tech Library](https://www.library.gatech.edu/spaces-technology) | Science fiction lounge; conservative campus-community eligibility. |
| [Robert C. Williams Museum of Papermaking](https://paper.gatech.edu/visit-0) | Free public self-guided museum; Georgia Tech holiday closures. |
| [Atlanta Beltline](https://beltline.org/parks-trails/eastside-trail/) | Walking, cycling, art and neighborhood connections; public trail etiquette. |
| [Atlanta Beltline](https://beltline.org/parks-trails/westside-trail/) | Westside walking/cycling trail and public art. |
| [Atlanta Beltline](https://beltline.org/parks-trails/northside-trail/) | Wooded trail; Reserve access closure and construction detours require recheck. |
| [Atlanta Beltline](https://beltline.org/parks-trails/) | Arboretum along trail corridor; trees, grasses and pollinator habitat. |
| [Atlanta Beltline](https://beltline.org/blog/10-must-visit-photo-spots-on-the-beltline/) | Fourth Ward Park pond and amphitheater; personal photo suggestions. |
| [Atlanta Beltline](https://beltline.org/parks-trails/shirley-clarke-franklin-park/) | Reservoir overlook, trails and fitness equipment; future bike facilities excluded. |
| [Atlanta Beltline](https://beltline.org/parks-trails/perkerson-park/) | Disc golf and tennis facilities; equipment availability and fees unconfirmed. |
| [Piedmont Park Conservancy](https://piedmontpark.org/things-to-do/more-activities/) | Bike paths and Lake Clara Meer; no swimming or fishing recommendation. |
| [Piedmont Park Conservancy](https://piedmontpark.org/faq/) | Bird habitat; no particular wildlife sighting guaranteed. |
| [Piedmont Park Conservancy](https://piedmontpark.org/food-beverage/) | Bring-your-own picnics; reserved areas must be respected. |
| [Freedom Park Conservancy](https://www.freedompark.org/freedom-is-your-park) | Public art, cycling paths and Nobel Peace Trail. |
| [Chastain Park Conservancy](https://chastainparkconservancy.org/elementor-page-2363/) | Walking paths and bocce court; equipment/access details unconfirmed. |
| [Georgia World Congress Center Authority](https://www.gwcca.org/visiting-the-park/) | Fountain of Rings and public park; event closures and park conduct rules. |
| [Historic Oakland Foundation](https://www.oaklandcemetery.com/plan-your-visit) | Free grounds, gardens, digital guide; special-event closures in September–November. |
| [Grant Park Conservancy](https://www.gpconservancy.org/) | Public green space and tree conservation; restoration areas may be restricted. |
| [Cascade Springs Nature Conservancy](https://cascadespringsnature.org/) | Forest preserve and springhouse boardwalk. |
| [City of Atlanta Parks and Recreation](https://www.atlantaga.gov/government/departments/department-parks-recreation/office-of-parks/list-of-parks-alphabetical) | Morningside Nature Preserve listing and location. |
| [DeKalb County](https://dekalbcountyga.gov/visitors/parks) | Constitution Lakes, Briarlake, Dearborn, Frazier-Rowe, Mason Mill and Zonolite descriptions; fees unconfirmed. |
| [Blue Heron Nature Preserve](https://bhnp.org/) | Blueway Trail through preserve habitats; fees unconfirmed. |
| [Emory University Government and Community Affairs](https://gca.emory.edu/campus/public.html) | Lullwater listed among campus places open to everyone. |
| [PATH Foundation](https://www.pathfoundation.org/south-peachtree-creek-trail) | Boardwalks and greenway connecting Medlock, Mason Mill and Emory. |
| [Chattahoochee National Park Conservancy](https://www.chattahoocheeparks.org/units) | Cochran Shoals fitness loop and Sope Creek mill-ruins trails. |
| [National Park Service](https://www.nps.gov/thingstodo/exploring-palisades-east.htm) | East Palisades hikes and overlooks; terrain varies and vehicle park pass required. |
| [Georgia State Parks](https://gastateparks.org/SweetwaterCreek) | Mill exterior trails and reservoir picnicking; no beach or swimming, mill interior restricted. |
| [Georgia State Parks](https://gastateparks.org/PanolaMountain) | Forest trails; mountain summit requires guided access and is excluded here. |
| [Arabia Mountain Heritage Area Alliance](https://arabiaalliance.org/trail-maps/davidson-arabia-mountain-nature-preserve-trails/) | Granite trails; protect solution pits and plants by staying on bare rock/trails. |
| [Arabia Mountain Heritage Area Alliance](https://arabiaalliance.org/get-directions/) | Free preserve access/parking and paved PATH trail; check trail map. |
| [High Museum of Art](https://www.high.org/faq) | Art collections, including photography; no particular work/display promised. |
| [Museum of Design Atlanta](https://www.museumofdesign.org/visit-us) | Paid public design exhibitions; changing exhibitions and opening days. |
| [Michael C. Carlos Museum](https://carlos.emory.edu/visit) | Public museum admission; free college/university admission with valid student ID listed. |
| [Spelman College Museum of Fine Art](https://www.spelman.edu/museum-of-fine-art/about/plan-your-visit.html) | Free public galleries; academic breaks and some appointment-only Saturdays. |
| [SCAD FASH Museum of Fashion + Film](https://www.scadfash.org/visit) | Public fashion museum; general admission paid, college students with ID free. |
| [Kennesaw State University](https://campus.kennesaw.edu/colleges-departments/arts/academics/visual-arts/zuckerman/) | Free Zuckerman Museum; installation/academic-break closures; regional Kennesaw outing. |
| [Fernbank Museum](https://www.fernbankmuseum.org/experiences/exhibits/indoor-exhibits/giants-of-the-mesozoic/) | Dinosaur skeletal casts; originals are not displayed. |
| [Fernbank Museum](https://fernbankmuseum.org/experiences/exhibits/outdoor-exhibits/wildwoods-1/) | Outdoor WildWoods paths and elevated features; weather closures possible. |
| [Fernbank Museum](https://fernbankmuseum.org/visit/get-tickets/) | Paid daytime admission includes a giant-screen film; check current selection and times. |
| [Atlanta Botanical Garden](https://atlantabg.org/plan-your-visit/indoor-collections/) | Indoor conservatory and orchid collections; blooms/displays vary. |
| [Atlanta Botanical Garden](https://atlantabg.org/plan-your-visit/atlanta-garden-map/) | Storza Woods boardwalks, gardens and overlooks; no bloom guarantee. |
| [Atlanta History Center](https://www.atlantahistorycenter.com/visit/) | Buckhead exhibitions, cyclorama and gardens; separate Midtown Margaret Mitchell House listed. |
| [National Center for Civil and Human Rights](https://www.civilandhumanrights.org/visitorfaqs/) | Paid public exhibition visit; opening/access details may change. |
| [National Park Service](https://www.nps.gov/malu/planyourvisit/index.htm) | Historic district; temporary visitor center at Historic Fire Station No. 6 during renovations. |
| [Center for Puppetry Arts](https://www.puppet.org/about-the-collections/) | Museum ticket covers Global and Jim Henson collections; performances are separate. |
| [Georgia Aquarium](https://www.georgiaaquarium.org/tickets/) | Paid gallery admission; presentations and encounters have separate reservation rules. |
| [Zoo Atlanta](https://zooatlanta.org/visit/) | Public zoo visit planning; animal visibility and activities vary. |
| [A Cappella Books](https://www.acappellabooks.com/) | In-store new/used/rare book browsing in Inman Park. |
| [Charis Books & More](https://charisbooksandmore.com/location-directions-hours) | Public bookshop in Decatur; check current hours. |
| [Atlanta Vintage Books](https://www.atlantavintagebooks.com/) | Bookshop on Clairmont Road with used/new/collectible titles. |
| [Wax 'N' Facts](https://www.waxnfacts.com/) | Little Five Points record shop; no listening station or inventory guarantee assumed. |
| [Fulton County Library System](https://www.fulcolibrary.org/locations/central/) | Central Library public branch; hours and closure notices. |
| [Fulton County Library System](https://www.fulcolibrary.org/central-library/) | Central Library art exhibition information; displays rotate. |
| [Fulton County Library System](https://www.fulcolibrary.org/aarl/) | Reference collections and galleries; archive requests may need advance arrangements. |
| [The Krog District](https://www.thekrogdistrict.com/about) | Krog Street Market food and retail vendors. |
| [Ponce City Market](https://poncecitymarket.com/) | Public food hall; individual merchant hours vary, roof excluded. |
| [The Municipal Market](https://municipalmarketatl.com/) | Sweet Auburn food market; hours changing and vendor schedules vary. |
| [Central Rock Gym Midtown Atlanta](https://centralrockgym.com/midtown/) | Public indoor climbing gym/day passes; waiver and orientation requirements. |

## Supporting policy and admission sources

- [Georgia Tech Library visitor policy](https://www.library.gatech.edu/about/visitors): public research/educational visitors have restricted visiting hours; borrowing access is separate.
- [Georgia Tech Library collections](https://library.gatech.edu/archives/archives-collections): science-fiction collection context; not unrestricted borrowing permission.
- [Beltline walking](https://beltline.org/things-to-do/walking/): free trail walking.
- [Emory Lullwater outing information](https://news.emory.edu/stories/2024/05/things-do-around-emory-june): lake and trail context, daylight visiting; paired with current public-campus access page.
- [Chattahoochee River parking](https://www.nps.gov/chat/planyourvisit/parking.htm): vehicle parking passes for the NPS units.
- [Georgia State Parks ParkPass](https://gastateparks.org/ParkPass): current vehicle parking fees; no old fee amounts copied into the catalog.
- [High Museum tickets](https://www.high.org/tickets): paid general admission; some experiences may have separate tickets.
- [Atlanta Botanical Garden tickets](https://atlantabg.org/tickets/): daytime admission; special events are separate.
- [Zoo Atlanta tickets](https://zooatlanta.org/tickets/): paid daytime admission with date-dependent pricing.
- [Fernbank tickets](https://fernbankmuseum.org/visit/get-tickets/): daytime indoor/outdoor admission and film inclusion; check renovation notices.

## Access and source exclusions

- [Atlanta Contemporary](https://atlantacontemporary.org/visit) reported closure beginning May 18, 2026: excluded.
- Northside Trail's Reserve access is closed during construction: retain only with its access note and early review.
- Oakland lists special-event closures, including September 27 and dates in October/November: always consult the visit page.
- King park's visitor center is undergoing renovation; the source directs visitors to Historic Fire Station No. 6.
- The Municipal Market announces changing hours; merchant schedules also differ.
- Criminal Records could not be reviewed through the available public-page tool due to its access challenge: excluded without bypassing it.
- Bars, alcohol-centered outings, and venues with unclear age restrictions were excluded from this initial catalog. Future entries need structured age eligibility before automatic recommendation.

## Collection method and source terms

This was a bounded, manually reviewed set of public pages retrieved through web search/page extraction. No authenticated pages, personal data, bulk crawl, copied images, product inventories, bookings, or subscriptions were collected. This seed does not install a recurring scraper or assert permission to crawl these sites automatically.

- [Georgia Tech privacy and legal notice](https://www.gatech.edu/privacy) was read. It describes informational website content and copyright reporting; an express bulk-reuse/crawling license was not found in the reviewed notice.
- [NPS disclaimer](https://www.nps.gov/aboutus/disclaimer.htm) was read. Official government-created material is generally public domain, with exceptions for third-party material and protected marks. Only brief attributed factual paraphrases are used; **no protection is claimed in original U.S. Government works**.
- Beltline and DeKalb pages displayed copyright/all-rights-reserved notices. Beltline's linked legal/privacy page was not retrievable by the web tool; no reuse license is assumed.
- Other source pages' reuse/crawling terms were not established by this limited review. Absence of a terms finding is not permission for bulk reuse. Before building automated refresh jobs, inspect each chosen provider's current terms, robots rules, and any feed/API options.

The catalog uses small factual paraphrases and independently authored outing ideas. It does not reproduce articles, promotional descriptions, schedules, maps, or media. Retain source attribution when showing suggestions and when updating records.
