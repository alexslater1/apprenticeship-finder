// Builds config/uk-places.json from a curated list of UK cities/towns, resolving each
// against postcodes.io /places (OS Open Names). Run: node scripts/build-gazetteer.mjs
import { writeFileSync } from 'node:fs';

const UA =
  'apprenticeship-finder/0.1 (+https://github.com/alexslater1/apprenticeship-finder; personal non-commercial)';
const E = 'England',
  S = 'Scotland',
  W = 'Wales',
  N = 'Northern Ireland';

// name[|country][|alias;alias]
const PLACES = `
London|E|City of London;Canary Wharf;Westminster;Central London;Greater London
Birmingham|E
Manchester|E|Greater Manchester
Leeds|E
Liverpool|E
Sheffield|E
Bristol|E|Bristol City
Newcastle upon Tyne|E|Newcastle;Newcastle-upon-Tyne
Nottingham|E
Leicester|E
Coventry|E
Kingston upon Hull|E|Hull
Bradford|E
Stoke-on-Trent|E|Stoke;Stoke on Trent
Wolverhampton|E
Plymouth|E
Southampton|E
Portsmouth|E
Derby|E
Reading|E
Brighton|E|Brighton and Hove;Brighton & Hove
Hove|E
Milton Keynes|E|MK
Northampton|E
Luton|E
Norwich|E
Oxford|E
Cambridge|E
York|E
Exeter|E
Gloucester|E
Cheltenham|E
Swindon|E
Bath|E
Peterborough|E
Ipswich|E
Colchester|E
Chelmsford|E
Southend-on-Sea|E|Southend
Basildon|E
Sunderland|E
Durham|E
Middlesbrough|E
Darlington|E
Hartlepool|E
Stockton-on-Tees|E|Stockton
Gateshead|E
South Shields|E
North Shields|E
Whitley Bay|E
Blyth|E
Ashington|E
Morpeth|E
Hexham|E
Cramlington|E
Washington|E
Chester-le-Street|E
Bishop Auckland|E
Newton Aycliffe|E
Peterlee|E
Consett|E
Billingham|E
Redcar|E
Guisborough|E
Wakefield|E
Huddersfield|E
Halifax|E
Harrogate|E
Doncaster|E
Rotherham|E
Barnsley|E
Scarborough|E
Beverley|E
Bridlington|E
Grimsby|E
Scunthorpe|E
Cleethorpes|E
Castleford|E
Pontefract|E
Dewsbury|E
Batley|E
Keighley|E
Ilkley|E
Otley|E
Wetherby|E
Selby|E
Goole|E
Skipton|E
Northallerton|E
Ripon|E
Whitby|E
Brighouse|E
Morley|E
Pudsey|E
Brough|E
Salford|E
Stockport|E
Bolton|E
Bury|E
Rochdale|E
Oldham|E
Wigan|E
Warrington|E
Preston|E
Blackburn|E
Blackpool|E
Burnley|E
Lancaster|E
Morecambe|E
Carlisle|E
Kendal|E
Penrith|E
Barrow-in-Furness|E|Barrow
Whitehaven|E
Workington|E
Chester|E
Crewe|E
Macclesfield|E
Northwich|E
Winsford|E
Middlewich|E
Sandbach|E
Congleton|E
Knutsford|E
Wilmslow|E
Altrincham|E
Sale|E
Stretford|E
Ashton-under-Lyne|E
Leigh|E
Chorley|E
Leyland|E
Accrington|E
Darwen|E
Nelson|E
Fleetwood|E
Lytham St Anne's|E|Lytham St Annes;Lytham;St Annes
Ormskirk|E
Skelmersdale|E
Southport|E
St Helens|E
Birkenhead|E
Wallasey|E
Bootle|E
Kirkby|E
Widnes|E
Runcorn|E
Ellesmere Port|E
Warton|E
Samlesbury|E
Glossop|E
Sellafield|E
Walsall|E
Dudley|E
West Bromwich|E
Solihull|E
Royal Sutton Coldfield|E|Sutton Coldfield
Halesowen|E
Stourbridge|E
Kidderminster|E
Redditch|E
Bromsgrove|E
Worcester|E
Great Malvern|E|Malvern
Evesham|E
Droitwich Spa|E|Droitwich
Hereford|E
Ross-on-Wye|E
Shrewsbury|E
Telford|E
Stafford|E
Cannock|E
Lichfield|E
Tamworth|E
Burton upon Trent|E|Burton;Burton-on-Trent
Leek|E
Nuneaton|E
Rugby|E
Warwick|E
Royal Leamington Spa|E|Leamington Spa;Leamington
Stratford-upon-Avon|E|Stratford upon Avon
Loughborough|E
Hinckley|E
Coalville|E
Market Harborough|E
Melton Mowbray|E
Lincoln|E
Grantham|E
Boston|E
Spalding|E
Sleaford|E
Stamford|E
Newark-on-Trent|E|Newark
Mansfield|E
Worksop|E
Retford|E
Chesterfield|E
Matlock|E
Ilkeston|E
Long Eaton|E
Swadlincote|E
Beeston|E
Kettering|E
Corby|E
Wellingborough|E
Daventry|E
Rushden|E
Bedford|E
Dunstable|E
Leighton Buzzard|E
Biggleswade|E
Stevenage|E
Watford|E
St Albans|E|St. Albans
Hemel Hempstead|E
Hatfield|E
Welwyn Garden City|E|Welwyn
Harpenden|E
Letchworth|E|Letchworth Garden City
Hitchin|E
Hertford|E
Ware|E
Bishop's Stortford|E|Bishops Stortford
Tring|E
Harlow|E
Brentwood|E
Braintree|E
Witham|E
Billericay|E
Grays|E
Clacton-on-Sea|E|Clacton
Harwich|E
Saffron Walden|E
Stansted Mountfitchet|E|Stansted
Bury St Edmunds|E
Lowestoft|E
Great Yarmouth|E
King's Lynn|E|Kings Lynn
Thetford|E
Huntingdon|E
St Neots|E
Ely|E
Wisbech|E
Haverhill|E
Newmarket|E
Sudbury|E
Felixstowe|E
Stowmarket|E
Crawley|E
Horsham|E
Worthing|E
Chichester|E
Bognor Regis|E
Eastbourne|E
Hastings|E
Lewes|E
Haywards Heath|E
Burgess Hill|E
East Grinstead|E
Shoreham-by-Sea|E|Shoreham
Guildford|E
Woking|E
Epsom|E
Reigate|E
Redhill|E
Leatherhead|E
Farnham|E
Camberley|E
Frimley|E
Staines-upon-Thames|E|Staines
Weybridge|E
Egham|E
Godalming|E
Dorking|E
Slough|E
Maidenhead|E
Windsor|E
Bracknell|E
Wokingham|E
Newbury|E
Ascot|E
Sandhurst|E
Banbury|E
Bicester|E
Witney|E
Abingdon-on-Thames|E|Abingdon
Didcot|E
Harwell|E
Culham|E
Wantage|E
Wallingford|E
Thame|E
Kidlington|E
Aylesbury|E
High Wycombe|E
Marlow|E
Amersham|E
Beaconsfield|E
Bletchley|E
Basingstoke|E
Winchester|E
Andover|E
Eastleigh|E
Fareham|E
Gosport|E
Havant|E
Petersfield|E
Farnborough|E
Aldershot|E
Fleet|E
Romsey|E
Alton|E
Hedge End|E
Ryde|E
Cowes|E
Maidstone|E
Canterbury|E
Ashford|E
Folkestone|E
Dover|E
Margate|E
Ramsgate|E
Royal Tunbridge Wells|E|Tunbridge Wells
Tonbridge|E
Sevenoaks|E
Dartford|E
Gravesend|E
Chatham|E
Rochester|E
Gillingham|E
Sittingbourne|E
Faversham|E
Whitstable|E
Herne Bay|E
Deal|E
West Malling|E|Kings Hill
Stroud|E
Cirencester|E
Tewkesbury|E
Torquay|E
Paignton|E
Newton Abbot|E
Barnstaple|E
Exmouth|E
Tiverton|E
Totnes|E
Okehampton|E
Taunton|E
Yeovil|E
Bridgwater|E
Weston-super-Mare|E|Weston super Mare
Frome|E
Wells|E
Shepton Mallet|E
Templecombe|E
Salisbury|E
Chippenham|E
Trowbridge|E
Devizes|E
Warminster|E
Corsham|E
Bournemouth|E
Poole|E
Christchurch|E
Dorchester|E
Weymouth|E
Wimborne Minster|E|Wimborne
Sherborne|E
Truro|E
Falmouth|E
Penzance|E
St Austell|E
Bodmin|E
Newquay|E
Redruth|E
Camborne|E
Yate|E
Filton|E
Bradley Stoke|E
Glasgow|S
Edinburgh|S
Aberdeen|S
Dundee|S
Inverness|S
Perth|S
Stirling|S
Dunfermline|S
Paisley|S
East Kilbride|S
Livingston|S
Hamilton|S
Cumbernauld|S
Kirkcaldy|S
Ayr|S
Kilmarnock|S
Greenock|S
Coatbridge|S
Glenrothes|S
Airdrie|S
Falkirk|S
Motherwell|S
Irvine|S
Dumfries|S
Wishaw|S
Clydebank|S
Bearsden|S
Arbroath|S
Elgin|S
St Andrews|S
Musselburgh|S
Bathgate|S
Alloa|S
Peterhead|S
Fort William|S
Oban|S
Galashiels|S
Rosyth|S
Cardiff|W
Swansea|W
Newport|W
Wrexham|W
St Asaph|W
Bangor|W
Barry|W
Bridgend|W
Cwmbrân|W|Cwmbran
Llanelli|W
Neath|W
Port Talbot|W
Merthyr Tydfil|W
Caerphilly|W
Pontypridd|W
Aberystwyth|W
Carmarthen|W
Rhyl|W
Colwyn Bay|W
Llandudno|W
Haverfordwest|W
Pembroke Dock|W
Newtown|W
Mold|W
Abergavenny|W
Ebbw Vale|W
Broughton|W
Belfast|N||BT1
Londonderry|N|Derry;Derry~Londonderry|BT48
Lisburn|N||BT28
Newry|N||BT34
Armagh|N||BT61
Craigavon|N||BT65
Newtownabbey|N||BT36
Ballymena|N||BT43
Coleraine|N||BT52
Omagh|N||BT78
Enniskillen|N||BT74
Larne|N||BT40
Antrim|N||BT41
Carrickfergus|N||BT38
Newtownards|N||BT23
Portadown|N||BT62
Lurgan|N||BT66
Dungannon|N||BT71
Cookstown|N||BT80
Downpatrick|N||BT30
Banbridge|N||BT32
Holywood|N||BT18
`
  .trim()
  .split('\n');

const AREAS = [
  // Regions and nations: no point coordinates (distance unknown), but region/nation filters work.
  ['North East', E, 'North East England'],
  ['North West', E, 'North West England'],
  ['Yorkshire and the Humber', E, 'Yorkshire;Yorkshire & Humber'],
  ['East Midlands', E],
  ['West Midlands', E],
  ['East of England', E, 'East Anglia'],
  ['South East', E, 'South East England'],
  ['South West', E, 'South West England'],
  ['England', E],
  ['Scotland', S],
  ['Wales', W],
  ['Northern Ireland', N],
  ['Kent', E, '', 'South East'],
  ['Surrey', E, '', 'South East'],
  ['Sussex', E, 'West Sussex;East Sussex', 'South East'],
  ['Hampshire', E, '', 'South East'],
  ['Berkshire', E, '', 'South East'],
  ['Buckinghamshire', E, '', 'South East'],
  ['Oxfordshire', E, '', 'South East'],
  ['Essex', E, '', 'East of England'],
  ['Hertfordshire', E, '', 'East of England'],
  ['Cambridgeshire', E, '', 'East of England'],
  ['Norfolk', E, '', 'East of England'],
  ['Suffolk', E, '', 'East of England'],
  ['Bedfordshire', E, '', 'East of England'],
  ['Lancashire', E, '', 'North West'],
  ['Cheshire', E, '', 'North West'],
  ['Cumbria', E, '', 'North West'],
  ['Merseyside', E, '', 'North West'],
  ['West Yorkshire', E, '', 'Yorkshire and the Humber'],
  ['South Yorkshire', E, '', 'Yorkshire and the Humber'],
  ['North Yorkshire', E, '', 'Yorkshire and the Humber'],
  ['Northumberland', E, '', 'North East'],
  ['County Durham', E, 'Co Durham', 'North East'],
  ['Tyne and Wear', E, '', 'North East'],
  ['Derbyshire', E, '', 'East Midlands'],
  ['Nottinghamshire', E, '', 'East Midlands'],
  ['Leicestershire', E, '', 'East Midlands'],
  ['Lincolnshire', E, '', 'East Midlands'],
  ['Northamptonshire', E, '', 'East Midlands'],
  ['Staffordshire', E, '', 'West Midlands'],
  ['Warwickshire', E, '', 'West Midlands'],
  ['Worcestershire', E, '', 'West Midlands'],
  ['Shropshire', E, '', 'West Midlands'],
  ['Herefordshire', E, '', 'West Midlands'],
  ['Gloucestershire', E, '', 'South West'],
  ['Somerset', E, '', 'South West'],
  ['Devon', E, '', 'South West'],
  ['Cornwall', E, '', 'South West'],
  ['Dorset', E, '', 'South West'],
  ['Wiltshire', E, '', 'South West'],
];

const TYPE_RANK = ['City', 'Town', 'Other Settlement', 'Suburban Area', 'Village', 'Hamlet'];
const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[-\s]+/g, ' ')
    .trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = [];
const failed = [];
for (const line of PLACES) {
  const [name, c, aliases, outcode] = line.split('|');
  const nation = { E, S, W, N }[c];
  if (outcode) {
    // OS Open Names is GB-only; use the postcode district centroid for NI towns.
    const r = await fetch(`https://api.postcodes.io/outcodes/${outcode}`, {
      headers: { 'User-Agent': UA },
    });
    const o = (await r.json()).result;
    if (!o) {
      failed.push(name);
      continue;
    }
    out.push({
      name,
      aliases: aliases ? aliases.split(';') : [],
      lat: Math.round(o.latitude * 1e5) / 1e5,
      lon: Math.round(o.longitude * 1e5) / 1e5,
      region: N,
      nation: N,
      county: o.admin_district?.[0] ?? null,
      kind:
        name === 'Belfast' ||
        name === 'Londonderry' ||
        name === 'Armagh' ||
        name === 'Lisburn' ||
        name === 'Newry'
          ? 'city'
          : 'town',
    });
    await sleep(120);
    continue;
  }
  const res = await fetch(
    `https://api.postcodes.io/places?q=${encodeURIComponent(name)}&limit=50`,
    { headers: { 'User-Agent': UA } },
  );
  const j = await res.json();
  const cands = (j.result ?? [])
    .filter((p) => norm(p.name_1) === norm(name) || (p.name_2 && norm(p.name_2) === norm(name)))
    .filter((p) => !nation || p.country === nation)
    .filter((p) => TYPE_RANK.includes(p.local_type))
    .sort((a, b) => TYPE_RANK.indexOf(a.local_type) - TYPE_RANK.indexOf(b.local_type));
  const p = cands[0];
  if (!p) {
    failed.push(name);
    continue;
  }
  out.push({
    name,
    aliases: aliases ? aliases.split(';') : [],
    lat: Math.round(p.latitude * 1e5) / 1e5,
    lon: Math.round(p.longitude * 1e5) / 1e5,
    region: p.country === E ? p.region : p.country,
    nation: p.country,
    county: p.county_unitary ?? p.district_borough ?? null,
    kind: p.local_type === 'City' ? 'city' : 'town',
  });
  await sleep(120);
}
for (const [name, nation, aliases = '', region] of AREAS) {
  out.push({
    name,
    aliases: aliases ? aliases.split(';') : [],
    lat: null,
    lon: null,
    region: nation === E ? (region ?? (name === 'England' ? null : name)) : nation,
    nation,
    county: null,
    kind: ['England', 'Scotland', 'Wales', 'Northern Ireland'].includes(name)
      ? 'nation'
      : region
        ? 'county'
        : 'region',
  });
}
out.push({
  name: 'Remote',
  aliases: ['Home based', 'Home-based', 'Work from home', 'Fully remote'],
  lat: null,
  lon: null,
  region: null,
  nation: 'Remote',
  county: null,
  kind: 'remote',
});
out.push({
  name: 'Nationwide',
  aliases: [
    'UK wide',
    'UK-wide',
    'Various locations',
    'Multiple locations',
    'United Kingdom',
    'UK',
  ],
  lat: null,
  lon: null,
  region: null,
  nation: 'UK-wide',
  county: null,
  kind: 'national',
});

writeFileSync(
  new URL('../config/uk-places.json', import.meta.url),
  JSON.stringify(
    {
      $comment:
        'Generated by scripts/build-gazetteer.mjs from postcodes.io /places (OS Open Names, OGL). Areas have no point coordinates on purpose.',
      places: out,
    },
    null,
    0,
  ).replace(/\},\{/g, '},\n{') + '\n',
);
console.log('places', out.length, 'failed', failed.length, failed.join(', '));
