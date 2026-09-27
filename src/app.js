/* Two-Bay Garage: a 3D model of the garage rebuilt from the owner's photos and
   videos, plus a makeover planner for the walls, shelves and storage.

   World units are feet. x runs west → east (window wall → house-door wall),
   y is up, and z runs from the back wall (z = 0) to the garage doors (z = D). */
(() => {
'use strict';

/* ─── helpers ──────────────────────────────────────────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function ftIn(v) {
  let ft = Math.floor(v + 1e-6), inch = Math.round((v - ft) * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return `${ft}′-${inch}″`;
}
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const nice = n => n < 100 ? Math.round(n / 5) * 5 : n < 1000 ? Math.round(n / 10) * 10 : Math.round(n / 50) * 50;
const priceRange = (lo, hi) => hi <= 0 ? '$0' : `${money(nice(lo))}–${money(nice(hi))}`;
function unitPrice(lo, hi) {
  const f = n => n < 10 ? '$' + n.toFixed(2) : money(n);
  return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ─── paint and finish swatches (Sherwin-Williams names where it's paint) ─ */
const SW = {
  wall: [
    { id: 'pure', name: 'Pure White', code: 'SW 7005', hex: '#EDECE6' },
    { id: 'extra', name: 'Extra White', code: 'SW 7006', hex: '#EEEFEA' },
    { id: 'repose', name: 'Repose Gray', code: 'SW 7015', hex: '#CCC9C0' },
    { id: 'mindful', name: 'Mindful Gray', code: 'SW 7016', hex: '#BCB7AD' },
    { id: 'gauntlet', name: 'Gauntlet Gray', code: 'SW 7019', hex: '#78736E' },
  ],
  band: [
    { id: 'none', name: 'No band', hex: null },
    { id: 'peppercorn', name: 'Peppercorn', code: 'SW 7674', hex: '#585858' },
    { id: 'ironore', name: 'Iron Ore', code: 'SW 7069', hex: '#434341' },
    { id: 'naval', name: 'Naval', code: 'SW 6244', hex: '#2F3D4C' },
    { id: 'gauntlet', name: 'Gauntlet Gray', code: 'SW 7019', hex: '#78736E' },
  ],
  curb: [
    { id: 'bare', name: 'Bare concrete', hex: '#B9B4AA' },
    { id: 'white', name: 'Sealed white', code: 'DRYLOK', hex: '#E9E8E2' },
    { id: 'gray', name: 'Sealed gray', hex: '#9A9EA3' },
    { id: 'charcoal', name: 'Charcoal', hex: '#46494E' },
  ],
  builtin: [
    { id: 'natural', name: 'Natural plywood, clear coat', hex: '#C99A5E' },
    { id: 'ironore', name: 'Iron Ore', code: 'SW 7069', hex: '#434341' },
    { id: 'pure', name: 'Pure White', code: 'SW 7005', hex: '#EDECE6' },
    { id: 'naval', name: 'Naval', code: 'SW 6244', hex: '#2F3D4C' },
  ],
  cab: [
    { id: 'charcoal', name: 'Charcoal', hex: '#33373C' },
    { id: 'slate', name: 'Slate gray', hex: '#5E6873' },
    { id: 'navy', name: 'Navy', hex: '#243A5E' },
    { id: 'red', name: 'Red', hex: '#9E2A26' },
  ],
  slat: [
    { id: 'white', name: 'White', hex: '#EFEFEC' },
    { id: 'gray', name: 'Gray', hex: '#A7ABB0' },
    { id: 'graphite', name: 'Graphite', hex: '#4A4E54' },
  ],
};
const swatch = (key, id) => SW[key].find(s => s.id === id) || SW[key][0];
const swName = (key, id) => { const s = swatch(key, id); return s.code ? `${s.name}, ${s.code}` : s.name; };

/* ─── option groups ────────────────────────────────────────────────────── */
const GROUPS = {
  finish: {
    type: 'choice', title: 'Wall finish',
    choices: [
      { id: 'asis', label: 'As is', sub: 'White paint, as photographed' },
      { id: 'paint', label: 'Paint refresh', sub: 'Scrubbable satin, optional dark band' },
      { id: 'pvc', label: 'PVC wall boards', sub: 'Trusscore, bright white, wipe-clean' },
    ],
    why: {
      asis: 'Leaves the walls white. The peeling spot by the house door still needs fixing either way.',
      paint: 'The cheapest real upgrade. Scuff-resistant satin wipes clean, and a dark band hides tire splash and bin scuffs. The band stops at 40 in., level with the window sill.',
      pvc: 'Waterproof PVC boards screw over the drywall and never need paint. The best pick if damp is a problem, and the white face bounces a lot of light onto the new floor.',
    },
  },
  wall: { type: 'swatch', title: 'Wall color', when: o => o.finish === 'paint' },
  band: { type: 'swatch', title: 'Lower band, up to the sill', when: o => o.finish === 'paint' },
  curb: {
    type: 'swatch', title: 'Concrete curb and back wall',
    why: 'The curb under the window and the back wall are foundation concrete. Seal them with DRYLOK before any color goes on; charcoal picks up the dark chips in the floor.',
  },
  shelves: {
    type: 'choice', title: 'Back-wall shelves',
    choices: [
      { id: 'asis', label: 'Keep the built-ins', sub: 'Plywood cubbies as they are' },
      { id: 'refresh', label: 'Refresh the built-ins', sub: 'Finish, butcher block, clear totes, LEDs' },
      { id: 'racks', label: 'Steel racks + bench', sub: 'Two 4 ft racks, 6 ft bench, metal pegboard' },
      { id: 'cabinets', label: 'Steel cabinet wall', sub: 'Lockers, base and wall cabinets' },
    ],
    why: {
      asis: 'Your plywood cubbies and the tool bay stay as they are.',
      refresh: 'Keeps the layout you know and leaves the EV charger where it is. Finish the plywood, put a butcher-block top on the tool bay, swap in matching clear totes and light the counter.',
      racks: 'The built-ins come out for two 4 ft steel racks, a 6 ft workbench and a metal pegboard. The charger moves onto its own backer between them.',
      cabinets: 'A full steel cabinet run: two tall lockers, base cabinets with worktops, wall cabinets above and a gap for the charger.',
    },
  },
  builtin: { type: 'swatch', title: 'Built-in finish', when: o => o.shelves === 'refresh' },
  cab: { type: 'swatch', title: 'Cabinet color', when: o => o.shelves === 'cabinets' },
  bikes: {
    type: 'choice', title: 'Bike wall (window side)',
    choices: [
      { id: 'asis', label: 'As is', sub: 'Hooks on a wood cleat' },
      { id: 'steadyrack', label: 'Pivot racks', sub: 'Steadyrack; bikes swing flat' },
      { id: 'slatwall', label: 'Slatwall', sub: 'Bikes, yard tools, a basket' },
    ],
    why: {
      asis: 'Two bikes hang flat on a wood cleat with the rake and shovel underneath.',
      steadyrack: 'Pivoting racks hold each bike by the front wheel and swing it toward the wall. That frees about 6 ft of wall for the yard tools on a rail.',
      slatwall: 'A 4 ft slatwall band from the window to the shelves. Hooks move anywhere, so the bikes, yard tools and a basket share one wall.',
    },
  },
  door: {
    type: 'choice', title: 'House-door wall',
    choices: [
      { id: 'asis', label: 'As is', sub: 'Peg rail with helmets and balls' },
      { id: 'slatwall', label: 'Sports slatwall', sub: 'Ball basket, helmet and board hooks' },
      { id: 'dropzone', label: 'Drop zone', sub: 'Bench, hooks and a gear rail' },
    ],
    why: {
      asis: 'The peg rail with the helmets, balls and boards stays.',
      slatwall: 'Slatwall with a ball basket, helmet hooks and a board rack. Everything is off the floor and easy to rehang.',
      dropzone: 'Turns the spot by the house door into a mudroom: a bench with shoe cubbies, hooks and a shelf, a boot tray, then a GearTrack rail for the sports gear.',
    },
  },
  slat: { type: 'swatch', title: 'Slatwall color', when: o => o.bikes === 'slatwall' || o.door === 'slatwall' },
  overhead: {
    type: 'choice', title: 'Overhead storage',
    choices: [
      { id: 'none', label: 'None', sub: 'Kayak and ski racks only' },
      { id: 'two', label: 'Two 4 × 8 racks', sub: 'Between the beam and the shelves' },
    ],
    why: {
      none: 'Only the kayak and ski racks up top.',
      two: 'Two ceiling racks between the beam and the back shelves hold six totes of seasonal gear. Set the drop to clear your tallest vehicle.',
    },
  },
  lights: {
    type: 'choice', title: 'Lighting',
    choices: [
      { id: 'fluorescent', label: 'Fluorescent', sub: 'As is' },
      { id: 'led', label: 'LED shop lights', sub: 'Linkable 4 ft bars' },
      { id: 'hex', label: 'Hex grid', sub: 'Over the parking bays' },
    ],
    why: {
      fluorescent: 'The existing 4 ft fluorescent fixtures.',
      led: 'Linkable LED bars at 5000K. Brighter than the old tubes and instant-on in the cold.',
      hex: 'A hexagon grid over the parking bays that reflects in the new flake floor. LED bars light the back half.',
    },
  },
  column: {
    type: 'choice', title: 'Steel column',
    choices: [
      { id: 'asis', label: 'As is', sub: 'Foam and duct tape' },
      { id: 'rope', label: 'Rope wrap', sub: 'Manila rope bumper' },
      { id: 'guard', label: 'Post guard', sub: 'Yellow HDPE sleeve' },
    ],
    why: {
      asis: 'Foam and duct tape, as photographed.',
      rope: 'Manila rope wrapped from the floor to about 6 ft. Soft on car doors, and nothing gets drilled.',
      guard: 'A yellow HDPE sleeve slides over the column. Easy to see when you back in.',
    },
  },
};
const SECTIONS = { walls: ['finish', 'curb'], storage: ['shelves', 'bikes', 'door'], ceiling: ['overhead', 'lights', 'column'] };

const CURRENT = {
  finish: 'asis', wall: 'pure', band: 'none', curb: 'bare', shelves: 'asis', builtin: 'natural', cab: 'charcoal',
  bikes: 'asis', door: 'asis', slat: 'gray', overhead: 'none', lights: 'fluorescent', column: 'asis',
};
const PLANS = [
  { id: 'current', name: 'As photographed', blurb: 'Today, with the new flake floor.', opts: { ...CURRENT } },
  { id: 'refresh', name: 'Weekend refresh', blurb: 'Paint with a dark band, sealed concrete, refreshed built-ins, LED lights.',
    opts: { ...CURRENT, finish: 'paint', wall: 'repose', band: 'peppercorn', curb: 'gray', shelves: 'refresh', builtin: 'ironore', lights: 'led', column: 'rope' } },
  { id: 'organized', name: 'Organized', blurb: 'Steel racks and a real bench, pivot bike racks, sports slatwall, ceiling racks.',
    opts: { ...CURRENT, finish: 'paint', wall: 'pure', curb: 'charcoal', shelves: 'racks', bikes: 'steadyrack', door: 'slatwall', slat: 'gray', overhead: 'two', lights: 'led', column: 'guard' } },
  { id: 'showroom', name: 'Showroom', blurb: 'PVC walls, a full cabinet run, slatwall, a drop zone and hex lighting.',
    opts: { ...CURRENT, finish: 'pvc', curb: 'charcoal', shelves: 'cabinets', cab: 'charcoal', bikes: 'slatwall', door: 'dropzone', slat: 'graphite', overhead: 'two', lights: 'hex', column: 'guard' } },
];

/* ─── products (approximate 2025–26 US retail; links go to a store search) ─ */
const hd = q => 'https://www.homedepot.com/s/' + encodeURIComponent(q);
const lw = q => 'https://www.lowes.com/search?searchTerm=' + encodeURIComponent(q);
const az = q => 'https://www.amazon.com/s?k=' + encodeURIComponent(q);
const P = {
  patch: { name: 'Drywall repair supplies', detail: 'Cut out the peeling bottom 4–6 in. by the house door, fit a new strip, tape and set.', unit: 'lot', lo: 30, hi: 55, store: 'Home Depot', url: hd('drywall repair setting compound mesh tape') },
  gardz: { name: 'Zinsser GARDZ problem-surface sealer', detail: 'Locks down torn drywall paper so the patch and paint stick.', unit: 'qt', lo: 18, hi: 28, store: 'Home Depot', url: hd('Zinsser Gardz problem surface sealer') },
  cove: { name: '4 in. vinyl cove base', detail: 'Along the drywall walls; shrugs off snowmelt and mop water.', unit: 'ft', lo: 1.3, hi: 2.6, store: "Lowe's", url: lw('4 in vinyl cove base') },
  coveGlue: { name: 'Cove base adhesive', detail: 'About one tube per 30 ft.', unit: 'tube', lo: 7, hi: 12, store: "Lowe's", url: lw('cove base adhesive') },
  paintWall: { name: 'Behr Ultra Scuff Defense, satin', detail: 'Scrubbable paint and primer; have it tinted to the swatch.', unit: 'gal', lo: 45, hi: 58, store: 'Home Depot', url: hd('Behr Ultra Scuff Defense interior satin') },
  paintBand: { name: 'Behr Ultra Scuff Defense, satin (band)', detail: 'The lower 40 in., up to the window sill.', unit: 'gal', lo: 45, hi: 58, store: 'Home Depot', url: hd('Behr Ultra Scuff Defense interior satin') },
  paintKit: { name: 'Roller kit, FrogTape and drop cloths', detail: 'Two 9 in. frames, 3/8 in. covers, tray liners, 1.41 in. tape.', unit: 'kit', lo: 45, hi: 75, store: 'Home Depot', url: hd('paint roller kit') },
  trusscore: { name: 'Trusscore Wall&CeilingBoard, 16 in. × 12 ft', detail: 'Bright-white PVC boards; waterproof, wipe-clean, screw straight to the studs.', unit: 'board', lo: 48, hi: 70, store: 'Trusscore dealers', url: 'https://www.trusscore.com/' },
  trussTrim: { name: 'Trusscore trims and screws', detail: 'J-trim, inside and outside corners, #8 pan-head screws.', unit: 'lot', lo: 140, hi: 240, store: 'Trusscore dealers', url: 'https://www.trusscore.com/' },
  drylok: { name: 'DRYLOK Extreme masonry waterproofer', detail: 'Two coats on the curb and the foundation wall.', unit: 'gal', lo: 45, hi: 60, store: 'Home Depot', url: hd('DRYLOK Extreme masonry waterproofer') },
  masonry: { name: 'Behr Premium masonry, stucco & brick paint', detail: 'Tinted topcoat over the DRYLOK.', unit: 'gal', lo: 40, hi: 55, store: 'Home Depot', url: hd('Behr Premium masonry stucco brick paint') },
  masonPrep: { name: 'Masonry cleaner and a stiff brush', detail: 'Scrub off dust and efflorescence so the sealer bonds.', unit: 'lot', lo: 20, hi: 35, store: 'Home Depot', url: hd('concrete masonry cleaner') },
  advance: { name: 'Benjamin Moore ADVANCE, satin', detail: 'Hard-curing enamel for the plywood; prime with a bonding primer first.', unit: 'gal', lo: 70, hi: 95, store: 'Benjamin Moore dealers', url: 'https://www.benjaminmoore.com/' },
  polycrylic: { name: 'Minwax Polycrylic, satin', detail: 'Clear water-based coat that keeps the plywood look.', unit: 'gal', lo: 48, hi: 68, store: 'Home Depot', url: hd('Minwax Polycrylic satin gallon') },
  butcher: { name: 'Birch butcher-block top, 6 ft', detail: 'New work surface for the tool bay; finish it with mineral oil.', unit: 'each', lo: 170, hi: 260, store: 'Home Depot', url: hd('birch butcher block countertop 6 ft') },
  totesClear: { name: 'Sterilite 66 qt clear latching totes', detail: 'Matching see-through bins sized for the cubbies.', unit: 'each', lo: 11, hi: 17, store: 'Amazon', url: az('Sterilite 66 qt clear latching storage box') },
  ledT5: { name: 'Barrina T5 LED bars, 4 ft (6-pack)', detail: 'Linkable plug-in bars for under the shelf or cabinets.', unit: 'pack', lo: 45, hi: 70, store: 'Amazon', url: az('Barrina T5 LED 4ft 6 pack') },
  wallCtrl: { name: 'Wall Control steel pegboard, 32 in. (2-pack)', detail: 'Galvanized metal pegboard; takes standard pegboard hooks.', unit: 'pack', lo: 55, hi: 80, store: 'Amazon', url: az('Wall Control galvanized steel pegboard 32 in 2 pack') },
  wallHooks: { name: 'Wall Control hook and bin kit', detail: 'Hooks, a shelf and small bins for hand tools.', unit: 'kit', lo: 30, hi: 55, store: 'Amazon', url: az('Wall Control pegboard hook accessory kit') },
  labeler: { name: 'Brother P-touch label maker', detail: 'Label every tote front.', unit: 'each', lo: 25, hi: 45, store: 'Amazon', url: az('Brother P-touch label maker') },
  husky: { name: 'Husky 5-tier steel shelving, 48 × 24 × 78 in.', detail: 'Heavy-duty rack; strap it to the wall.', unit: 'each', lo: 140, hi: 210, store: 'Home Depot', url: hd('Husky 5-tier steel garage shelving 48 in W 78 in H 24 in D') },
  hdxTote: { name: 'HDX 27 gal Tough Storage Tote', detail: 'Black with a yellow lid; fits a 24 in. deep shelf.', unit: 'each', lo: 10, hi: 15, store: 'Home Depot', url: hd('HDX 27 gal tough storage tote') },
  bench: { name: 'Husky 6 ft adjustable-height workbench', detail: 'Solid wood top; replaces the plywood counter.', unit: 'each', lo: 250, hi: 420, store: 'Home Depot', url: hd('Husky 6 ft adjustable height workbench wood top') },
  anchors: { name: 'Tapcon screws and anti-tip straps', detail: 'The back wall is poured concrete; you need a hammer drill.', unit: 'lot', lo: 18, hi: 35, store: 'Home Depot', url: hd('Tapcon concrete screws') },
  evBacker: { name: 'Plywood backer for the charger', detail: '3/4 in. plywood, painted, anchored to the wall.', unit: 'each', lo: 20, hi: 35, store: 'Home Depot', url: hd('3/4 in plywood project panel 2 ft x 2 ft') },
  evMove: { name: 'Electrician: remount the EV charger', detail: 'It hangs on the built-in now and needs its own backer once that comes out.', unit: 'job', lo: 150, hi: 350, store: 'Local electrician', url: '' },
  newage: { name: 'NewAge Bold 3.0 steel cabinets, ~14 ft run', detail: 'Two tall lockers, four base and four wall cabinets, worktops.', unit: 'set', lo: 2800, hi: 4500, store: 'NewAge Products', url: 'https://www.newageproducts.com/' },
  steadyrack: { name: 'Steadyrack Classic bike rack', detail: 'Holds the bike by the front wheel and swings it flat. Get the MTB model for tires over 2.5 in.', unit: 'each', lo: 85, hi: 115, store: 'Steadyrack', url: 'https://www.steadyrack.com/' },
  fastTrack: { name: 'Rubbermaid FastTrack rail and tool hooks', detail: 'For the rake, shovel and push broom.', unit: 'kit', lo: 40, hi: 75, store: 'Home Depot', url: hd('Rubbermaid FastTrack rail tool hooks') },
  proslat: { name: 'Proslat PVC slatwall, 4 × 8 ft panel', detail: 'Rigid PVC with 3 in. slots; often sold in 2- or 4-packs.', unit: 'panel', lo: 110, hi: 165, store: 'Proslat', url: 'https://www.proslat.com/' },
  slatBike: { name: 'Proslat bike hooks', detail: 'One horizontal pair per bike.', unit: 'pair', lo: 25, hi: 45, store: 'Proslat', url: 'https://www.proslat.com/' },
  slatKit: { name: 'Proslat hook kit, 20 pieces', detail: 'Assorted hooks plus a basket and a shelf.', unit: 'kit', lo: 80, hi: 140, store: 'Proslat', url: 'https://www.proslat.com/' },
  slatTrim: { name: 'Slatwall J-trim and end caps', detail: 'Finishes the panel edges.', unit: 'lot', lo: 30, hi: 55, store: 'Proslat', url: 'https://www.proslat.com/' },
  slatSports: { name: 'Proslat sports kit', detail: 'Ball basket, helmet hooks and a skateboard rack.', unit: 'kit', lo: 70, hi: 130, store: 'Proslat', url: 'https://www.proslat.com/' },
  dzBench: { name: 'Entryway bench with shoe cubbies, ~42 in.', detail: 'A seat for boots, shoes underneath.', unit: 'each', lo: 120, hi: 230, store: 'Amazon', url: az('entryway storage bench shoe cubbies 42 inch') },
  dzHooks: { name: 'Wall coat rack with shelf, 36–42 in.', detail: 'Hooks for bags and jackets, a shelf for gloves and keys.', unit: 'each', lo: 40, hi: 85, store: 'Amazon', url: az('wall mounted coat rack with shelf 42 inch') },
  bootTray: { name: 'Rubber boot tray', detail: 'Catches snowmelt next to the bench.', unit: 'each', lo: 20, hi: 45, store: 'Amazon', url: az('large rubber boot tray') },
  gearTrack: { name: 'Gladiator GearTrack channels, 4 ft (2-pack)', detail: 'Low-profile rail for the sports gear.', unit: 'pack', lo: 35, hi: 60, store: "Lowe's", url: lw('Gladiator GearTrack channel') },
  gearAcc: { name: 'Gladiator ball caddy and helmet hooks', detail: 'Basketballs, footballs and three helmets.', unit: 'kit', lo: 45, hi: 85, store: "Lowe's", url: lw('Gladiator ball caddy') },
  flexi: { name: 'FLEXIMOUNTS 4 × 8 ft overhead rack', detail: 'Bolts into the ceiling joists; set the drop to clear your tallest vehicle.', unit: 'each', lo: 170, hi: 260, store: 'Amazon', url: az('FLEXIMOUNTS 4x8 overhead garage storage rack') },
  ledShop: { name: 'Barrina T8 LED shop lights, 4 ft (6-pack)', detail: 'Linkable, 5000K; replaces the fluorescent fixtures.', unit: 'pack', lo: 55, hi: 90, store: 'Amazon', url: az('Barrina T8 LED shop light 4ft 6 pack linkable') },
  hexKit: { name: 'Hexagon LED garage light, 14-grid kit', detail: 'About 8 × 14 ft over the parking bays.', unit: 'kit', lo: 150, hi: 290, store: 'Amazon', url: az('hexagon LED garage light 14 grid') },
  electric: { name: 'Electrician: hardwire the hex grid', detail: 'Skip it if the kit plugs into a ceiling outlet.', unit: 'job', lo: 150, hi: 350, store: 'Local electrician', url: '' },
  rope: { name: 'Manila rope, 1 in. × 100 ft', detail: 'Wrap it tight from the floor to about 6 ft.', unit: 'coil', lo: 45, hi: 85, store: 'Home Depot', url: hd('1 in x 100 ft manila rope') },
  ropeFix: { name: 'Construction adhesive and hose clamps', detail: 'Holds the rope ends; nothing is drilled into the column.', unit: 'lot', lo: 12, hi: 22, store: 'Home Depot', url: hd('construction adhesive') },
  guard: { name: 'Yellow HDPE post protector', detail: 'Slides over a 4–5 in. column; measure yours first.', unit: 'each', lo: 60, hi: 130, store: 'Amazon', url: az('HDPE post protector sleeve yellow 4 inch column') },
};

/* ─── state ────────────────────────────────────────────────────────────── */
const STORE = 'two-bay-garage-planner-v1';
const DEFAULT_DIMS = { W: 19, D: 22, H: 97 / 12 }; // ceiling measured by the owner: 97 in.
let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { saved = null; }
const validOpt = (k, v) => GROUPS[k] && (GROUPS[k].type === 'choice' ? GROUPS[k].choices.some(c => c.id === v) : SW[k].some(s => s.id === v));
const S = {
  dims: { ...DEFAULT_DIMS },
  opts: { ...CURRENT },
  notes: true,
  dimsOn: false,
  compare: 'plan',
};
if (saved && typeof saved === 'object') {
  if (saved.dims && ['W', 'D', 'H'].every(k => typeof saved.dims[k] === 'number')) {
    S.dims = { W: clamp(saved.dims.W, 18, 26), D: clamp(saved.dims.D, 18, 30), H: clamp(saved.dims.H, 7.75, 10) };
    if (Math.abs(S.dims.H - (8 + 4 / 12)) < 1e-6) S.dims.H = DEFAULT_DIMS.H; // replace the old photo estimate
  }
  if (saved.opts) for (const k of Object.keys(CURRENT)) if (validOpt(k, saved.opts[k])) S.opts[k] = saved.opts[k];
  if (typeof saved.notes === 'boolean') S.notes = saved.notes;
  if (typeof saved.dimsOn === 'boolean') S.dimsOn = saved.dimsOn;
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ dims: S.dims, opts: S.opts, notes: S.notes, dimsOn: S.dimsOn })); } catch (e) { /* storage unavailable */ }
}
function norm(o) {
  const n = { ...o };
  if (n.finish !== 'paint') { n.wall = CURRENT.wall; n.band = CURRENT.band; }
  if (n.shelves !== 'refresh') n.builtin = CURRENT.builtin;
  if (n.shelves !== 'cabinets') n.cab = CURRENT.cab;
  if (n.bikes !== 'slatwall' && n.door !== 'slatwall') n.slat = CURRENT.slat;
  return n;
}
const sameOpts = (a, b) => { const x = norm(a), y = norm(b); return Object.keys(CURRENT).every(k => x[k] === y[k]); };

/* ─── layout: every position the model and the estimate share ──────────── */
function layout(d) {
  const W = d.W, D = d.D, H = d.H;
  const L = { W, D, H, T: 0.45, curbH: 1.7, curbT: 0.22, backH: 3.15, bandH: 3.35, bw: 3.0, bd: 4.5, doorW: 8, doorH: 7, beamY: H - 0.79 };
  const ret = Math.max(0.3, (W - 2 * L.doorW - 1.5) / 2);
  L.doors = [[ret, ret + L.doorW], [W - ret - L.doorW, W - ret]];
  L.beamZ = D - 12 * (D / 22);
  L.colX = W * (8 / 19);
  L.win = { s0: 2.9, s1: 6.7, y0: 3.45, y1: Math.min(7.05, H - 0.7) };
  L.hd = { z0: L.bd + 0.1, z1: L.bd + 3.35, top: 6.72 };
  L.X1 = W - L.bw;
  return L;
}
function areas(L) {
  const winA = (L.win.s1 - L.win.s0) * (L.win.y1 - L.win.y0);
  const hdW = L.hd.z1 - L.hd.z0;
  const west = L.D * (L.H - L.curbH) - winA;
  const east = (L.D - L.bd) * L.H - hdW * L.hd.top;
  const bump = (L.bd + L.bw) * L.H;
  const front = L.W * (L.H - L.doorH) + (L.W - 2 * L.doorW) * L.doorH;
  const back = L.X1 * (L.H - L.backH);
  const band = L.D * (L.bandH - L.curbH) + (L.D - L.bd - hdW) * L.bandH + (L.bd + L.bw) * L.bandH;
  return {
    dry: west + east + bump + front + back,
    band,
    masonry: L.D * L.curbH + L.X1 * L.backH,
    base: (L.D - L.bd - hdW) + L.bd + L.bw,
  };
}
const slatRun = (wall, L) => wall === 'west' ? (L.D - 1.9) - 7.4 : (L.D - 1.1) - 9.0;

/* ─── cost model ───────────────────────────────────────────────────────── */
function lineItems(o, L) {
  const A = areas(L), out = [];
  const add = (grp, sec, key, qty, note) => { if (qty > 0) out.push({ ...P[key], grp, sec, key, qty, note: note || '' }); };
  const gal = a => Math.max(1, Math.ceil(a * 2 / 375));
  const W1 = 'Walls', S2 = 'Shelves and storage', S3 = 'Ceiling, lights and column';
  if (o.finish !== 'asis') {
    add('finish', W1, 'patch', 1); add('finish', W1, 'gardz', 1);
    add('finish', W1, 'cove', Math.ceil(A.base)); add('finish', W1, 'coveGlue', Math.max(1, Math.ceil(A.base / 30)));
  }
  if (o.finish === 'paint') {
    const band = o.band !== 'none';
    add('finish', W1, 'paintWall', gal(A.dry - (band ? A.band : 0)), swName('wall', o.wall));
    if (band) add('finish', W1, 'paintBand', gal(A.band), swName('band', o.band));
    add('finish', W1, 'paintKit', 1);
  }
  if (o.finish === 'pvc') { add('finish', W1, 'trusscore', Math.ceil(A.dry * 1.12 / 16)); add('finish', W1, 'trussTrim', 1); }
  if (o.curb !== 'bare') {
    add('curb', W1, 'drylok', Math.max(1, Math.ceil(A.masonry * 2 / 90)));
    add('curb', W1, 'masonPrep', 1);
    if (o.curb !== 'white') add('curb', W1, 'masonry', Math.max(1, Math.ceil(A.masonry / 250)), swName('curb', o.curb));
  }
  if (o.shelves === 'refresh') {
    if (o.builtin === 'natural') add('shelves', S2, 'polycrylic', 2); else add('shelves', S2, 'advance', 2, swName('builtin', o.builtin));
    add('shelves', S2, 'butcher', 1); add('shelves', S2, 'totesClear', 12); add('shelves', S2, 'ledT5', 1);
    add('shelves', S2, 'wallCtrl', 1); add('shelves', S2, 'wallHooks', 1); add('shelves', S2, 'labeler', 1);
  }
  if (o.shelves === 'racks') {
    add('shelves', S2, 'husky', 2); add('shelves', S2, 'hdxTote', 10); add('shelves', S2, 'bench', 1);
    add('shelves', S2, 'wallCtrl', 1); add('shelves', S2, 'wallHooks', 1); add('shelves', S2, 'anchors', 1);
    add('shelves', S2, 'evBacker', 1); add('shelves', S2, 'evMove', 1);
  }
  if (o.shelves === 'cabinets') {
    add('shelves', S2, 'newage', 1, swName('cab', o.cab)); add('shelves', S2, 'ledT5', 1); add('shelves', S2, 'wallCtrl', 1);
    add('shelves', S2, 'anchors', 1); add('shelves', S2, 'evBacker', 1); add('shelves', S2, 'evMove', 1);
  }
  if (o.bikes === 'steadyrack') { add('bikes', S2, 'steadyrack', 2); add('bikes', S2, 'fastTrack', 1); }
  if (o.bikes === 'slatwall') {
    add('bikes', S2, 'proslat', Math.ceil(slatRun('west', L) / 8), swName('slat', o.slat));
    add('bikes', S2, 'slatBike', 2); add('bikes', S2, 'slatKit', 1); add('bikes', S2, 'slatTrim', 1);
  }
  if (o.door === 'slatwall') {
    add('door', S2, 'proslat', Math.ceil(slatRun('east', L) / 8), swName('slat', o.slat));
    add('door', S2, 'slatSports', 1); add('door', S2, 'slatTrim', 1);
  }
  if (o.door === 'dropzone') {
    add('door', S2, 'dzBench', 1); add('door', S2, 'dzHooks', 1); add('door', S2, 'bootTray', 1);
    add('door', S2, 'gearTrack', 1); add('door', S2, 'gearAcc', 1);
  }
  if (o.overhead === 'two') { add('overhead', S3, 'flexi', 2); add('overhead', S3, 'hdxTote', 6); }
  if (o.lights === 'led') add('lights', S3, 'ledShop', 1);
  if (o.lights === 'hex') { add('lights', S3, 'hexKit', 1); add('lights', S3, 'ledShop', 1); add('lights', S3, 'electric', 1); }
  if (o.column === 'rope') { add('column', S3, 'rope', 1); add('column', S3, 'ropeFix', 1); }
  if (o.column === 'guard') add('column', S3, 'guard', 1);
  return out;
}
const total = items => items.reduce((a, i) => ({ lo: a.lo + i.lo * i.qty, hi: a.hi + i.hi * i.qty }), { lo: 0, hi: 0 });
const costOf = o => total(lineItems(o, layout(S.dims)));
const groupCost = (key, val, o) => total(lineItems({ ...o, [key]: val }, layout(S.dims)).filter(i => i.grp === key));

/* ─── 3D ───────────────────────────────────────────────────────────────── */
const host = $('#gl');
let HAS3D = !!(window.THREE && THREE.OrbitControls);
let renderer, scene, camera, controls, sun, hemi, maxAniso = 4;
const pts = [];
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
let L = layout(S.dims);
let root = null;
let G = {};
let dirty = true;
let evPos = null;
let taskSpots = [];

function init3D() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.rotateSpeed = 0.7;
  controls.minDistance = 1.5;
  controls.maxDistance = 80;
  controls.maxPolarAngle = Math.PI * 0.497;
  controls.screenSpacePanning = true;
  controls.addEventListener('start', () => { tween = null; markView(null); });
  controls.addEventListener('change', () => { dirty = true; });

  if (THREE.RoomEnvironment) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  hemi = new THREE.HemisphereLight(0xffffff, 0xc9ccd1, 0.34);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  for (let i = 0; i < 8; i++) { const p = new THREE.PointLight(0xffffff, 0, 20, 1.6); scene.add(p); pts.push(p); }
}

/* ─── procedural textures ──────────────────────────────────────────────── */
const T = {};
function canvasTex(w, h, draw, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = maxAniso;
  return t;
}
function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Full-broadcast chip floor, colors sampled from the photos. One tile = 3 ft.
function flakeTex() {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#707479'; g.fillRect(0, 0, w, h);
    const r = mulberry32(20260927);
    const pal = [['#ecece9', .22], ['#c3c5c8', .22], ['#9a9da1', .20], ['#585d63', .20], ['#232629', .12], ['#7a8696', .04]];
    const pick = () => { let x = r(), a = 0; for (const [c, p] of pal) { a += p; if (x < a) return c; } return pal[0][0]; };
    for (let i = 0; i < 34000; i++) {
      const x = r() * w, y = r() * h, s = 1.8 + r() * 5.0, rot = r() * 6.283, k = 3 + ((r() * 3) | 0);
      const pts2 = [];
      for (let j = 0; j < k; j++) { const a = rot + (j / k) * 6.283 + (r() - .5) * .7, rr = s * (.5 + r() * .7); pts2.push(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.fillStyle = pick();
      const ox = [0], oy = [0];
      if (x < 12) ox.push(w); if (x > w - 12) ox.push(-w);
      if (y < 12) oy.push(h); if (y > h - 12) oy.push(-h);
      for (const dx of ox) for (const dy of oy) {
        g.beginPath();
        for (let j = 0; j < pts2.length; j += 2) { const px = x + dx + pts2[j], py = y + dy + pts2[j + 1]; j ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.closePath(); g.fill();
      }
    }
  });
}
function concreteTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#bab5ab'; g.fillRect(0, 0, w, h);
    const r = mulberry32(99);
    const blob = (x, y, rad, col) => {
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
        const cx = x + dx, cy = y + dy;
        if (cx + rad < 0 || cx - rad > w || cy + rad < 0 || cy - rad > h) continue;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
        gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
    };
    for (let i = 0; i < 220; i++) blob(r() * w, r() * h, 12 + r() * 70, r() < .55 ? `rgba(92,86,77,${.05 + r() * .09})` : `rgba(255,253,246,${.05 + r() * .08})`);
    for (let i = 0; i < 2200; i++) { g.fillStyle = `rgba(55,50,45,${.12 + r() * .3})`; const s = .8 + r() * 1.8; g.fillRect(r() * w, r() * h, s, s); }
    g.fillStyle = 'rgba(80,75,68,.35)'; g.fillRect(0, 0, 2, h);
    g.fillStyle = 'rgba(80,75,68,.12)'; g.fillRect(0, h * .62, w, 1.5);
  });
}
function plyTex(seed = 5) {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#c99a5e'; g.fillRect(0, 0, w, h);
    const r = mulberry32(seed);
    for (let i = 0; i < 110; i++) {
      const y0 = r() * h, amp = 3 + r() * 16, f = 1 + ((r() * 3) | 0), ph = r() * 6.28;
      g.strokeStyle = r() < .62 ? `rgba(135,85,40,${.10 + r() * .22})` : `rgba(240,205,150,${.08 + r() * .16})`;
      g.lineWidth = .8 + r() * 3;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) { const y = y0 + Math.sin((x / w) * 6.283 * f + ph) * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
  });
}
function butcherTex() {
  return canvasTex(512, 256, (g, w, h) => {
    const r = mulberry32(8);
    let y = 0;
    while (y < h) {
      const s = 16 + r() * 14;
      g.fillStyle = `hsl(${30 + r() * 7}, ${38 + r() * 14}%, ${60 + r() * 13}%)`; g.fillRect(0, y, w, s);
      g.fillStyle = 'rgba(90,60,30,.2)'; g.fillRect(0, y, w, 1);
      y += s;
    }
    for (let i = 0; i < 160; i++) {
      g.strokeStyle = `rgba(120,80,40,${.05 + r() * .08})`; g.lineWidth = 1;
      const yy = r() * h; g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy + (r() - .5) * 6); g.stroke();
    }
  });
}
function garageDoorTex() {
  return canvasTex(512, 448, (g, w, h) => {
    g.fillStyle = '#f2f2ef'; g.fillRect(0, 0, w, h);
    const r = mulberry32(3);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${r() * .025})`; g.fillRect(r() * w, r() * h, 2, 2); }
    for (let j = 1; j < 4; j++) {
      const y = h * j / 4;
      g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(0, y - 9, w, 7);
      g.fillStyle = 'rgba(40,40,40,.55)'; g.fillRect(0, y - 1.5, w, 3);
      g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(0, y + 1.5, w, 1.5);
    }
    const gr = g.createLinearGradient(0, h - 34, 0, h);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(60,55,50,.2)');
    g.fillStyle = gr; g.fillRect(0, h - 34, w, 34);
  }, { repeat: false });
}
function pvcTex() {
  return canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(0, 0, w, 2);
    g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(0, 2, w, 6);
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, h / 2, w, 1.2);
  });
}
function slatTex() {
  return canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const y = i * 64;
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, y, w, 7);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y + 7, w, 4);
      g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(0, y + 11, w, 2);
    }
  });
}
// Hand tools drawn at roughly 200 px per foot, flowing into rows.
function drawTools(g, w, h, seed) {
  const r = mulberry32(seed), k = 200;
  const pal = ['#d0342c', '#f2c230', '#1f1f22', '#2a62c9', '#e8751a'];
  const stamps = {
    level(x, y) { g.fillStyle = '#f2c230'; rrect(g, x, y + 10, 2.0 * k, 0.16 * k, 5); g.fill(); g.fillStyle = '#7fd35b'; g.fillRect(x + 0.9 * k, y + 16, 0.2 * k, 0.08 * k); g.fillRect(x + 0.2 * k, y + 16, 0.12 * k, 0.08 * k); return 2.0 * k; },
    saw(x, y) { g.fillStyle = '#b8bcc0'; g.beginPath(); g.moveTo(x + 0.35 * k, y + 14); g.lineTo(x + 1.35 * k, y + 0.12 * k); g.lineTo(x + 1.35 * k, y + 0.3 * k); g.lineTo(x + 0.35 * k, y + 0.48 * k); g.closePath(); g.fill(); g.fillStyle = '#d0342c'; rrect(g, x, y + 10, 0.4 * k, 0.45 * k, 12); g.fill(); return 1.4 * k; },
    wrenches(x, y) { for (let i = 0; i < 7; i++) { const L2 = (0.9 - i * 0.07) * k, xx = x + i * 0.12 * k; g.fillStyle = '#b9bdc2'; rrect(g, xx, y + 14, 0.05 * k, L2, 5); g.fill(); g.beginPath(); g.arc(xx + 0.025 * k, y + 14 + L2, 0.045 * k, 0, 6.283); g.fill(); } return 0.95 * k; },
    drivers(x, y) { for (let i = 0; i < 6; i++) { const xx = x + i * 0.13 * k; g.fillStyle = pal[i % pal.length]; rrect(g, xx, y + 14, 0.08 * k, 0.3 * k, 6); g.fill(); g.fillStyle = '#a9adb2'; g.fillRect(xx + 0.03 * k, y + 14 + 0.3 * k, 0.02 * k, (0.3 + (i % 3) * 0.08) * k); } return 0.85 * k; },
    pliers(x, y) { g.strokeStyle = '#3a3d41'; g.lineWidth = 0.04 * k; g.beginPath(); g.moveTo(x + 0.2 * k, y + 16); g.lineTo(x + 0.1 * k, y + 0.7 * k); g.moveTo(x + 0.2 * k, y + 16); g.lineTo(x + 0.32 * k, y + 0.7 * k); g.stroke(); g.fillStyle = '#d0342c'; g.fillRect(x + 0.06 * k, y + 0.4 * k, 0.07 * k, 0.3 * k); g.fillRect(x + 0.28 * k, y + 0.4 * k, 0.07 * k, 0.3 * k); return 0.5 * k; },
    hammer(x, y) { g.fillStyle = '#c69a5a'; rrect(g, x + 0.17 * k, y + 0.14 * k, 0.08 * k, 0.9 * k, 6); g.fill(); g.fillStyle = '#34373c'; rrect(g, x, y + 12, 0.42 * k, 0.13 * k, 4); g.fill(); return 0.5 * k; },
    tape(x, y) { g.fillStyle = '#f2c230'; rrect(g, x, y + 16, 0.32 * k, 0.32 * k, 14); g.fill(); g.fillStyle = '#1f1f22'; g.beginPath(); g.arc(x + 0.16 * k, y + 16 + 0.16 * k, 0.07 * k, 0, 6.283); g.fill(); return 0.4 * k; },
    clamps(x, y) { for (let i = 0; i < 2; i++) { const xx = x + i * 0.3 * k; g.fillStyle = '#a9adb2'; g.fillRect(xx + 0.05 * k, y + 14, 0.035 * k, 0.85 * k); g.fillStyle = '#e8751a'; rrect(g, xx, y + 14, 0.22 * k, 0.1 * k, 4); g.fill(); rrect(g, xx, y + 0.55 * k, 0.22 * k, 0.28 * k, 6); g.fill(); } return 0.62 * k; },
    drill(x, y) { g.fillStyle = '#e8751a'; rrect(g, x, y + 16, 0.62 * k, 0.24 * k, 10); g.fill(); g.fillStyle = '#1f1f22'; rrect(g, x + 0.3 * k, y + 16 + 0.2 * k, 0.16 * k, 0.4 * k, 8); g.fill(); g.fillStyle = '#34373c'; g.fillRect(x + 0.24 * k, y + 16 + 0.58 * k, 0.3 * k, 0.14 * k); g.fillStyle = '#a9adb2'; g.fillRect(x - 0.12 * k, y + 16 + 0.1 * k, 0.12 * k, 0.04 * k); return 0.75 * k; },
    cord(x, y) { g.strokeStyle = '#e8751a'; g.lineWidth = 0.05 * k; for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(x + 0.34 * k, y + 0.42 * k, (0.3 - i * 0.03) * k, (0.34 - i * 0.02) * k, 0, 0, 6.283); g.stroke(); } return 0.72 * k; },
    cans(x, y) { g.fillStyle = '#6b4a2d'; g.fillRect(x, y + 0.7 * k, 1.1 * k, 0.05 * k); for (let i = 0; i < 5; i++) { g.fillStyle = pal[(i + 2) % pal.length]; rrect(g, x + 0.05 * k + i * 0.21 * k, y + (0.25 + (i % 2) * 0.08) * k, 0.16 * k, (0.45 - (i % 2) * 0.08) * k, 4); g.fill(); } return 1.15 * k; },
  };
  const order = ['level', 'saw', 'wrenches', 'drivers', 'pliers', 'hammer', 'tape', 'clamps', 'drill', 'cord', 'cans'];
  g.save();
  g.shadowColor = 'rgba(0,0,0,.38)'; g.shadowBlur = 5; g.shadowOffsetX = 2; g.shadowOffsetY = 3;
  let idx = Math.floor(r() * 3), y = 0.14 * k;
  while (y + 0.8 * k < h) {
    let x = 0.12 * k + r() * 0.1 * k;
    while (x < w - 0.5 * k) {
      const name = order[idx % order.length]; idx++;
      const used = stamps[name](x, y);
      if (x + used > w + 0.2 * k) break;
      x += used + (0.14 + r() * 0.12) * k;
    }
    y += 1.12 * k;
  }
  g.restore();
}
function pegboardTex(kind, seed, w = 512, h = 720) {
  return canvasTex(w, h, (g) => {
    if (kind === 'wood') {
      g.fillStyle = '#b48a5c'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(60,40,20,.55)';
      for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { g.beginPath(); g.arc(x, y, 2.4, 0, 6.283); g.fill(); }
    } else {
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, '#b9bdc2'); gr.addColorStop(1, '#9fa4aa');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(28,30,33,.62)';
      for (let y = 9; y < h; y += 18) for (let x = 9; x < w; x += 18) {
        if (((x / 18) | 0) % 3 === 1 && ((y / 18) | 0) % 2 === 0) { rrect(g, x - 2, y - 6, 4, 12, 2); g.fill(); }
        else { g.beginPath(); g.arc(x, y, 2.2, 0, 6.283); g.fill(); }
      }
    }
    drawTools(g, w, h, seed);
  }, { repeat: false });
}
function wireTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 3, h);
    for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 4);
  });
}
function spokesTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#ffffff'; g.lineWidth = 1.6;
    for (let i = 0; i < 28; i++) {
      const a = i / 28 * 6.283, a2 = a + (i % 2 ? .35 : -.35);
      g.beginPath(); g.moveTo(128 + Math.cos(a) * 12, 128 + Math.sin(a) * 12); g.lineTo(128 + Math.cos(a2) * 124, 128 + Math.sin(a2) * 124); g.stroke();
    }
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(128, 128, 14, 0, 6.283); g.fill();
  }, { repeat: false });
}
function ballTex(base) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const r = mulberry32(17);
    for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(0,0,0,${r() * .08})`; g.fillRect(r() * w, r() * h, 2, 2); }
    g.strokeStyle = '#1c1c1c'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    for (const x of [w / 4, 3 * w / 4]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (const c of [0, w / 2]) {
      g.beginPath();
      for (let y = 0; y <= h; y += 4) { const x = c + Math.sin((y / h) * Math.PI) * w * .17; y ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
  });
}
function floralTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#1c3e8e'; g.fillRect(0, 0, w, h);
    const r = mulberry32(44);
    for (let i = 0; i < 36; i++) {
      const x = r() * w, y = r() * h, s = 7 + r() * 9;
      g.fillStyle = '#3f8a4a';
      g.beginPath(); g.ellipse(x + s, y + s * .6, s * .9, s * .35, r() * 3, 0, 6.283); g.fill();
      g.fillStyle = r() < .7 ? '#f2c230' : '#f4f1e8';
      for (let p = 0; p < 5; p++) { const a = p / 5 * 6.283; g.beginPath(); g.ellipse(x + Math.cos(a) * s * .6, y + Math.sin(a) * s * .6, s * .45, s * .28, a, 0, 6.283); g.fill(); }
      g.fillStyle = '#e8751a'; g.beginPath(); g.arc(x, y, s * .25, 0, 6.283); g.fill();
    }
  });
}
function stripesTex() {
  return canvasTex(64, 64, (g, w, h) => {
    for (let y = 0; y < h; y += 16) { g.fillStyle = '#2d5da8'; g.fillRect(0, y, w, 8); g.fillStyle = '#eceef2'; g.fillRect(0, y + 8, w, 8); }
  });
}
function damageTex() {
  return canvasTex(512, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = mulberry32(61);
    const top = [];
    for (let x = 0; x <= w; x += 16) top.push([x, h - 40 - r() * 70 * Math.sin((x / w) * Math.PI)]);
    const grad = g.createLinearGradient(0, h - 110, 0, h);
    grad.addColorStop(0, 'rgba(170,140,90,.35)'); grad.addColorStop(1, 'rgba(120,92,55,.7)');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(0, h); top.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(w, h); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(110,80,45,.7)'; g.lineWidth = 2;
    g.beginPath(); top.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
    for (let i = 0; i < 9; i++) {
      const x = 30 + r() * (w - 60), y = h - 12 - r() * 45, s = 8 + r() * 22;
      g.fillStyle = 'rgba(236,229,210,.9)'; g.beginPath(); g.ellipse(x, y, s, s * .55, r(), 0, 6.283); g.fill();
      g.strokeStyle = 'rgba(95,70,40,.6)'; g.lineWidth = 1.5; g.stroke();
    }
  }, { repeat: false });
}
function ropeTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#b79a68'; g.fillRect(0, 0, w, h);
    for (let i = -16; i < 32; i++) {
      const x = i * 8;
      g.strokeStyle = i % 2 ? 'rgba(90,65,30,.45)' : 'rgba(240,220,170,.35)';
      g.lineWidth = i % 2 ? 2 : 3;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke();
    }
    g.fillStyle = 'rgba(60,40,20,.5)';
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 2);
  });
}
function foamTex() {
  return canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#6f665c'; g.fillRect(0, 0, w, h);
    const r = mulberry32(2);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${r() * .06})`; g.fillRect(r() * w, r() * h, 2, 2); }
    for (const [a, b] of [[.06, .18], [.4, .47], [.7, .84]]) {
      g.fillStyle = '#b4b7ba'; g.fillRect(0, a * h, w, (b - a) * h);
      g.fillStyle = 'rgba(0,0,0,.12)'; for (let x = 0; x < w; x += 9) g.fillRect(x, a * h, 1, (b - a) * h);
    }
  });
}
function coilTex() {
  return canvasTex(32, 64, (g, w, h) => {
    g.fillStyle = '#34373b'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(200,205,210,.55)';
    for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 2);
  });
}

function makeTextures() {
  T.flake = flakeTex();
  T.concrete = concreteTex();
  T.ply = plyTex();
  T.butcher = butcherTex();
  T.gdoor = garageDoorTex();
  T.pvc = pvcTex();
  T.slat = slatTex();
  T.peg = pegboardTex('wood', 11, 512, 720);
  T.pegWide = pegboardTex('metal', 12, 1024, 512);
  T.pegTall = pegboardTex('metal', 14, 512, 720);
  T.pegStrip = pegboardTex('metal', 13, 1024, 400);
  T.wire = wireTex();
  T.spokes = spokesTex();
  T.ball = ballTex('#d46a2c');
  T.ballOld = ballTex('#7b4526');
  T.floral = floralTex();
  T.stripes = stripesTex();
  T.damage = damageTex();
  T.rope = ropeTex(); T.rope.repeat.set(5, 22);
  T.foam = foamTex();
  T.coil = coilTex(); T.coil.repeat.set(1, 18);
  const loader = new THREE.TextureLoader();
  const img = src => { const t = loader.load(src, () => { dirty = true; }); t.encoding = THREE.sRGBEncoding; t.anisotropy = maxAniso; return t; };
  T.view = img('%%ASSET:window-view.jpg%%');
  T.board = img('%%ASSET:door-board.jpg%%');
}

/* ─── materials ────────────────────────────────────────────────────────── */
const M = {};
const matCache = new Map();
const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
const ENV_K = 0.55; // RoomEnvironment is bright; scale its contribution everywhere
function std(hex, rough = 0.7, metal = 0, env = 0.5) {
  const k = `${hex}|${rough}|${metal}|${env}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: lin(hex), roughness: rough, metalness: metal, envMapIntensity: env * ENV_K }));
  return matCache.get(k);
}
function texMat(map, { color = '#ffffff', rough = 0.8, metal = 0, env = 0.5, tile = 0, alphaTest = 0, side = THREE.FrontSide, transparent = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ map, color: lin(color), roughness: rough, metalness: metal, envMapIntensity: env * ENV_K, alphaTest, side, transparent });
  m.userData.tile = tile;
  return m;
}
function glow(hex, intensity) {
  return new THREE.MeshStandardMaterial({ color: lin('#ffffff'), emissive: lin(hex), emissiveIntensity: intensity, roughness: 0.4, envMapIntensity: 0.3 * ENV_K });
}
function makeMaterials() {
  M.floor = new THREE.MeshPhysicalMaterial({ map: T.flake, roughness: 0.55, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.28, envMapIntensity: 0.5 * ENV_K });
  M.floor.userData.tile = 3;
  M.slab = texMat(T.concrete, { color: '#d9d4c9', rough: 0.95, tile: 4, env: 0.3 });
  M.concrete = texMat(T.concrete, { rough: 0.95, tile: 4, env: 0.35 });
  M.concreteBack = texMat(T.concrete, { color: '#a7a197', rough: 0.95, tile: 4, env: 0.35 });
  M.dry = new THREE.MeshStandardMaterial({ color: lin('#F1F0EB'), roughness: 0.92, envMapIntensity: 0.45 * ENV_K });
  M.pvc = texMat(T.pvc, { color: '#FBFBF8', rough: 0.42, env: 0.7, tile: 4 / 3 });
  M.band = new THREE.MeshStandardMaterial({ color: lin('#585858'), roughness: 0.78, envMapIntensity: 0.45 * ENV_K });
  M.curbPaint = new THREE.MeshStandardMaterial({ color: lin('#9A9EA3'), roughness: 0.85, envMapIntensity: 0.45 * ENV_K });
  M.ceiling = std('#EFEEE9', 0.95, 0, 0.35);
  M.cap = std('#2A2E33', 0.9, 0, 0.2);
  M.trim = std('#F4F3EF', 0.55);
  M.casing = std('#E9E4D8', 0.6);
  M.gdoor = texMat(T.gdoor, { rough: 0.55 });
  M.galv = std('#A9AEB3', 0.42, 0.65, 0.8);
  M.steelDark = std('#34373C', 0.5, 0.45, 0.6);
  M.black = std('#1D1F22', 0.6, 0, 0.4);
  M.rubber = std('#141517', 0.85, 0, 0.2);
  M.column = std('#8C9196', 0.5, 0.35, 0.6);
  M.chrome = std('#CFD3D7', 0.25, 0.9, 1.0);
  M.ply = texMat(T.ply, { rough: 0.78, tile: 2 });
  M.plyCoat = texMat(T.ply, { color: '#f3dcc0', rough: 0.42, env: 0.6, tile: 2 });
  M.butcher = texMat(T.butcher, { rough: 0.5, tile: 2 });
  M.cleat = texMat(T.ply, { color: '#a4764f', rough: 0.7, tile: 2 });
  M.pier = texMat(T.ply, { color: '#7a4a2a', rough: 0.65, tile: 2 });
  M.lightWood = texMat(T.ply, { color: '#ecd8b8', rough: 0.7, tile: 2 });
  M.lens = glow('#f1f5ff', 1.0);
  M.ledBar = glow('#ffffff', 1.6);
  M.hex = glow('#ffffff', 2.0);
  M.ledGreen = glow('#3ddc6a', 2.0);
  M.screen = glow('#4b8df0', 1.2);
  M.glass = new THREE.MeshBasicMaterial({ map: T.view, toneMapped: false });
  M.board = texMat(T.board, { rough: 0.8 });
  M.steelDoor = std('#7E858B', 0.5, 0.2);
  M.slat = texMat(T.slat, { color: '#A7ABB0', rough: 0.55, env: 0.6, tile: 1 });
  M.peg = texMat(T.peg, { rough: 0.85 });
  M.pegWide = texMat(T.pegWide, { rough: 0.5, metal: 0.25, env: 0.7 });
  M.pegTall = texMat(T.pegTall, { rough: 0.5, metal: 0.25, env: 0.7 });
  M.pegStrip = texMat(T.pegStrip, { rough: 0.5, metal: 0.25, env: 0.7 });
  M.wireWhite = texMat(T.wire, { color: '#f2f2f0', rough: 0.5, alphaTest: 0.45, side: THREE.DoubleSide, tile: 0.5 });
  M.wireBlack = texMat(T.wire, { color: '#26282b', rough: 0.5, alphaTest: 0.45, side: THREE.DoubleSide, tile: 0.5 });
  M.wireDeck = texMat(T.wire, { color: '#3a3d42', rough: 0.5, metal: 0.3, alphaTest: 0.45, side: THREE.DoubleSide, tile: 0.6 });
  M.spokes = texMat(T.spokes, { color: '#c8ccd0', rough: 0.4, metal: 0.5, alphaTest: 0.45, side: THREE.DoubleSide });
  M.ball = texMat(T.ball, { rough: 0.75 });
  M.ballOld = texMat(T.ballOld, { rough: 0.75 });
  M.football = std('#6E3A1E', 0.7);
  M.floral = texMat(T.floral, { rough: 0.85 });
  M.stripes = texMat(T.stripes, { rough: 0.85 });
  M.damage = new THREE.MeshStandardMaterial({ map: T.damage, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  M.rope = texMat(T.rope, { rough: 0.95 });
  M.foam = texMat(T.foam, { rough: 0.8 });
  M.spring = texMat(T.coil, { rough: 0.45, metal: 0.5 });
  M.clearTote = new THREE.MeshStandardMaterial({ color: lin('#e3eaee'), roughness: 0.22, transparent: true, opacity: 0.5, envMapIntensity: 0.9 * ENV_K, depthWrite: false });
  M.tote = std('#1e2023', 0.6);
  M.toteLid = std('#E9BE3C', 0.5);
  M.label = std('#f7f7f4', 0.8);
  M.red = std('#C8262B', 0.5);
  M.cove = std('#3a3d41', 0.6);
}

/* ─── geometry helpers ─────────────────────────────────────────────────── */
function scaleUV(geo, w, h, d, t, x0, y0, z0) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i), v = uv.getY(i);
    const f = Math.floor(i / 4);
    if (f < 2) { u = (u * d + z0) / t; v = (v * h + y0) / t; }
    else if (f < 4) { u = (u * w + x0) / t; v = (v * d + z0) / t; }
    else { u = (u * w + x0) / t; v = (v * h + y0) / t; }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}
function boxAt(x0, x1, y0, y1, z0, z1, mat, o = {}) {
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
  const geo = new THREE.BoxGeometry(Math.max(w, 1e-3), Math.max(h, 1e-3), Math.max(d, 1e-3));
  const tile = o.tile !== undefined ? o.tile : (Array.isArray(mat) ? 0 : (mat.userData.tile || 0));
  if (tile) scaleUV(geo, w, h, d, tile, Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
  const m = new THREE.Mesh(geo, mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = o.cast !== undefined ? o.cast : true;
  m.receiveShadow = o.recv !== undefined ? o.recv : true;
  return m;
}
function cyl(x, z, y0, y1, r, mat, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, y1 - y0, seg), mat);
  m.position.set(x, (y0 + y1) / 2, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cylX(x0, x1, y, z, r, mat, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, x1 - x0, seg), mat);
  m.rotation.z = Math.PI / 2; m.position.set((x0 + x1) / 2, y, z); m.castShadow = true;
  return m;
}
function cylZ(x, y, z0, z1, r, mat, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, z1 - z0, seg), mat);
  m.rotation.x = Math.PI / 2; m.position.set(x, y, (z0 + z1) / 2); m.castShadow = true;
  return m;
}
const UP = new THREE.Vector3(0, 1, 0);
function tube(a, b, r, mat, seg = 8) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  m.castShadow = true;
  return m;
}
function sphere(x, y, z, r, mat, seg = 16) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.6 | 0)), mat);
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
function roundedShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function board(w, h, t, r, mat) {
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedShape(w, h, r), { depth: t, bevelEnabled: false, curveSegments: 6 }), mat);
  m.castShadow = true;
  return m;
}
// A group that puts children in wall-local coordinates: x along the wall
// (left to right as you face it), y up, z out from the wall into the room.
function wallGroup(name) {
  const g = new THREE.Group();
  if (name === 'west') { g.position.set(0, 0, L.D); g.rotation.y = Math.PI / 2; }
  else if (name === 'east') { g.position.set(L.W, 0, 0); g.rotation.y = -Math.PI / 2; }
  else if (name === 'bumpW') { g.position.set(L.W - L.bw, 0, 0); g.rotation.y = -Math.PI / 2; }
  return g;
}
function disposeTree(obj) {
  obj.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}

/* ─── props ────────────────────────────────────────────────────────────── */
function bike({ frame = '#1F4FA3', accent = '#E9E9E6', rack = false, mtb = false } = {}) {
  const g = new THREE.Group();
  const R = 1.1, wb = 3.45;
  const mF = std(frame, 0.35, 0.3, 0.7), mA = std(accent, 0.4, 0.2, 0.6);
  for (const x of [0, wb]) {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(R - 0.07, mtb ? 0.085 : 0.06, 8, 40), M.rubber);
    tire.position.x = x; tire.castShadow = true; g.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.16, 0.028, 6, 36), M.galv);
    rim.position.x = x; g.add(rim);
    const sp = new THREE.Mesh(new THREE.CircleGeometry(R - 0.17, 28), M.spokes);
    sp.position.x = x; g.add(sp);
    g.add(cylZ(x, 0, -0.1, 0.1, 0.05, M.galv, 10));
  }
  const P2 = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  const BB = P2(1.35, -0.05), ST = P2(1.05, 1.5), HT = P2(2.85, 1.35), HB = P2(2.98, 0.9);
  g.add(tube(BB, ST, 0.055, mF), tube(ST, HT, 0.05, mF), tube(BB, HB, 0.062, mF));
  g.add(tube(BB, P2(0, 0, 0.06), 0.03, mF), tube(BB, P2(0, 0, -0.06), 0.03, mF));
  g.add(tube(P2(1.1, 1.3, 0.04), P2(0, 0, 0.06), 0.028, mF), tube(P2(1.1, 1.3, -0.04), P2(0, 0, -0.06), 0.028, mF));
  g.add(tube(HB, HT, 0.07, mF));
  g.add(tube(HB, P2(wb, 0, 0.07), mtb ? 0.055 : 0.035, mA), tube(HB, P2(wb, 0, -0.07), mtb ? 0.055 : 0.035, mA));
  const SP = P2(0.98, 1.95);
  g.add(tube(ST, SP, 0.035, M.galv));
  g.add(boxAt(0.62, 1.3, 1.95, 2.08, -0.13, 0.13, M.black));
  const SB = P2(2.75, 1.85);
  g.add(tube(HT, SB, 0.04, M.black));
  const pivot = new THREE.Group();
  pivot.position.copy(SB);
  pivot.add(cylZ(0, 0, -1.05, 1.05, 0.035, M.black, 8));
  pivot.add(cylZ(0, 0, 0.75, 1.05, 0.05, M.rubber, 8), cylZ(0, 0, -1.05, -0.75, 0.05, M.rubber, 8));
  g.add(pivot);
  g.userData.bars = pivot;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 6, 24), M.galv);
  ring.position.set(BB.x, BB.y, 0.13); g.add(ring);
  g.add(tube(P2(BB.x, BB.y, 0.16), P2(BB.x + 0.25, BB.y - 0.5, 0.16), 0.03, M.black));
  g.add(tube(P2(BB.x, BB.y, -0.16), P2(BB.x - 0.25, BB.y + 0.5, -0.16), 0.03, M.black));
  if (rack) {
    g.add(tube(P2(-0.25, 1.1, 0.12), P2(0.95, 1.2, 0.12), 0.022, M.black), tube(P2(-0.25, 1.1, -0.12), P2(0.95, 1.2, -0.12), 0.022, M.black));
    g.add(tube(P2(0, 0, 0.12), P2(-0.2, 1.1, 0.12), 0.02, M.black), tube(P2(0, 0, -0.12), P2(-0.2, 1.1, -0.12), 0.02, M.black));
  }
  return g;
}
function helmet(g, x, y, z, hex) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(hex, 0.35, 0.1, 0.8));
  m.scale.set(1, 0.85, 1.15); m.position.set(x, y, z); m.castShadow = true;
  g.add(m);
  return m;
}
function ball(g, x, y, z, mat, r = 0.39) { g.add(sphere(x, y, z, r, mat, 20)); }
function football(g, x, y, z) {
  const m = sphere(x, y, z, 0.28, M.football, 18); m.scale.set(1.55, 1, 1); g.add(m);
}
function claw(g, x, y) {
  g.add(boxAt(x - 0.08, x + 0.08, y - 0.1, y + 0.1, 0, 0.12, M.black));
  g.add(tube(V3(x, y, 0.1), V3(x - 0.28, y + 0.12, 0.42), 0.025, M.black), tube(V3(x, y, 0.1), V3(x + 0.28, y + 0.12, 0.42), 0.025, M.black));
}
function skateboard(g, x, yc, len = 2.65, mat = M.black) {
  const b = board(0.7, len, 0.05, 0.34, mat); b.position.set(x, yc, 0.1); g.add(b);
  for (const dy of [-len * 0.32, len * 0.32]) for (const dx of [-0.22, 0.22]) g.add(cylZ(x + dx, yc + dy, 0.02, 0.1, 0.1, std('#d9d4c4', 0.5), 10));
}
function lacrosse(g, x, y0, y1, z = 0.12) {
  g.add(tube(V3(x, y0, z), V3(x + 0.05, y1 - 0.5, z), 0.035, M.black));
  const head = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 6, 18), std('#e9e9e6', 0.5));
  head.scale.set(0.7, 1.25, 1); head.position.set(x + 0.05, y1 - 0.2, z); g.add(head);
}
function bag(g, x, y, z, hex = '#1D1F22', s = 1) {
  const m = sphere(x, y, z, 0.45 * s, std(hex, 0.8), 14); m.scale.set(0.9, 1.25, 0.45); g.add(m);
}
function rake(g, s, d, yTop = 5.55) {
  g.add(tube(V3(s, yTop, d), V3(s, 2.75, d), 0.035, std('#c9a15f', 0.6)));
  const red = std('#C8262B', 0.5);
  for (let i = 0; i < 13; i++) { const a = -0.65 + i * (1.3 / 12); g.add(tube(V3(s, 2.75, d), V3(s + Math.sin(a) * 0.95, 2.75 - Math.cos(a) * 0.95, d), 0.018, red, 5)); }
  g.add(tube(V3(s - 0.45, 2.3, d), V3(s + 0.45, 2.3, d), 0.02, red, 5));
}
function shovel(g, s, d, yTop = 5.45) {
  g.add(tube(V3(s, yTop, d), V3(s, 2.6, d), 0.035, std('#c9a15f', 0.6)));
  g.add(boxAt(s - 0.18, s + 0.18, yTop - 0.02, yTop + 0.08, d - 0.03, d + 0.03, M.black));
  const blade = board(0.7, 0.95, 0.03, 0.25, std('#6f757b', 0.45, 0.6)); blade.position.set(s, 2.15, d - 0.015); g.add(blade);
}
function pushBroom(g, s, d, yTop) {
  g.add(tube(V3(s, yTop, d), V3(s, 2.3, d), 0.035, std('#c9a15f', 0.6)));
  g.add(boxAt(s - 0.95, s + 0.95, 2.05, 2.3, d - 0.12, d + 0.12, M.black));
}
function tote(g, x0, x1, y0, y1, z0, z1, lidHex = '#2b2e33') {
  g.add(boxAt(x0, x1, y0, y1 - 0.08, z0, z1, M.clearTote, { cast: false }));
  g.add(boxAt(x0 - 0.02, x1 + 0.02, y1 - 0.08, y1, z0 - 0.02, z1 + 0.02, std(lidHex, 0.5)));
  const r = (x1 - x0) * 0.22;
  g.add(boxAt(x0 + 0.12, x1 - 0.12, y0 + 0.02, y0 + (y1 - y0) * 0.55, z0 + 0.12, z1 - 0.12, std(['#5b6f86', '#a0773f', '#6c7a53', '#8a4b4b'][Math.floor((x0 * 7 + y0 * 3) % 4)], 0.8), { cast: false }));
  g.add(boxAt((x0 + x1) / 2 - r, (x0 + x1) / 2 + r, y1 - 0.34, y1 - 0.2, z1, z1 + 0.01, M.label, { cast: false }));
}
function hdx(g, x0, x1, y0, z0, z1) {
  g.add(boxAt(x0, x1, y0, y0 + 1.05, z0, z1, M.tote));
  g.add(boxAt(x0 - 0.03, x1 + 0.03, y0 + 1.05, y0 + 1.16, z0 - 0.03, z1 + 0.03, M.toteLid));
}
function evCharger(g, x, y, z) {
  g.add(boxAt(x - 0.36, x + 0.36, y, y + 0.98, z, z + 0.3, std('#F4F4F1', 0.35)));
  g.add(boxAt(x - 0.3, x + 0.3, y + 0.1, y + 0.88, z + 0.3, z + 0.315, std('#E4E6E3', 0.2, 0, 0.9)));
  g.add(sphere(x, y + 0.72, z + 0.32, 0.03, M.ledGreen, 8));
  const curve = new THREE.CatmullRomCurve3([V3(x, y, z + 0.15), V3(x + 0.05, y - 0.7, z + 0.3), V3(x + 0.25, y - 1.45, z + 0.36), V3(x + 0.48, y - 1.75, z + 0.3), V3(x + 0.6, y - 1.15, z + 0.2), V3(x + 0.5, y - 0.2, z + 0.12)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.035, 6), std('#2B2D30', 0.6)));
  g.add(boxAt(x + 0.42, x + 0.6, y - 0.28, y - 0.08, z - 0.02, z + 0.1, M.black));
  evPos = V3(x, y + 0.55, z + 0.35);
}

/* ─── builders ─────────────────────────────────────────────────────────── */
function build() {
  if (!HAS3D) return;
  if (root) { disposeTree(root); scene.remove(root); }
  root = new THREE.Group();
  scene.add(root);
  G = {};
  for (const k of ['free', 'front', 'back', 'west', 'east', 'bump', 'ceil', 'mech', 'ceilPlane', 'dims']) { G[k] = new THREE.Group(); root.add(G[k]); }
  const o = S.compare === 'now' ? CURRENT : S.opts;
  L = layout(S.dims);
  taskSpots = [];
  applyFinish(o);
  buildShell(o);
  buildFront(o);
  const spots = buildCeiling(o);
  buildWest(o);
  buildBack(o);
  buildBump(o);
  buildEast(o);
  buildColumn(o);
  setLights(o.lights, spots);
  buildDims();
  G.dims.visible = S.dimsOn;
  placeLabels();
  dirty = true;
}

function applyFinish(o) {
  M.dry.color.copy(lin(o.finish === 'paint' ? swatch('wall', o.wall).hex : '#F1F0EB'));
  M.dry.roughness = o.finish === 'paint' ? 0.78 : 0.92;
  M.wall = o.finish === 'pvc' ? M.pvc : M.dry;
  M.pierMat = o.finish === 'asis' ? M.pier : o.finish === 'pvc' ? M.trim : M.dry;
  if (o.band !== 'none') M.band.color.copy(lin(swatch('band', o.band).hex));
  if (o.curb !== 'bare') M.curbPaint.color.copy(lin(swatch('curb', o.curb).hex));
  M.curb = o.curb === 'bare' ? M.concrete : M.curbPaint;
  M.back = o.curb === 'bare' ? M.concreteBack : M.curbPaint;
  M.slat.color.copy(lin(swatch('slat', o.slat).hex));
}

function buildShell(o) {
  const { W, D, H, T, X1, bd, bw } = L;
  const wm = M.wall, nc = { cast: false };
  const band = o.finish === 'paint' && o.band !== 'none';
  const fixed = o.finish !== 'asis';
  G.free.add(boxAt(0, W, -0.25, 0, 0, D, M.floor, nc));
  G.free.add(boxAt(-T - 0.6, W + T + 0.6, -0.9, -0.03, -T - 0.6, D + T + 3.2, M.slab, nc));

  // west wall: window opening, proud concrete curb, drip edge
  const w = L.win, zA = D - w.s1, zB = D - w.s0, gw = G.west;
  gw.add(boxAt(-T, 0, L.curbH, H, -T, zA, wm, nc), boxAt(-T, 0, L.curbH, H, zB, D + T, wm, nc));
  gw.add(boxAt(-T, 0, L.curbH, w.y0, zA, zB, wm, nc), boxAt(-T, 0, w.y1, H, zA, zB, wm, nc));
  gw.add(boxAt(-T, L.curbT, -0.25, L.curbH, 0, D, M.curb, nc));
  gw.add(boxAt(0, L.curbT + 0.03, L.curbH - 0.02, L.curbH + 0.03, 0, D, M.galv, nc));
  gw.add(boxAt(-T, 0, H, H + 0.06, -T, D + T, M.cap, nc));
  if (band) gw.add(boxAt(0, 0.012, L.curbH + 0.03, L.bandH, 0, D, M.band, nc));
  buildWindow(gw);

  // back wall: foundation concrete below, framed wall above
  const gb = G.back;
  gb.add(boxAt(0, X1, -0.25, L.backH, -T, 0, M.back, nc));
  gb.add(boxAt(0, X1, L.backH, H, -T, 0, wm, nc));
  gb.add(boxAt(-T, X1, H, H + 0.06, -T, 0, M.cap, nc));

  // bump-out in the northeast corner
  const gbump = G.bump;
  gbump.add(boxAt(X1, W + T, -0.25, H, -T, bd, wm, nc));
  gbump.add(boxAt(X1, W + T, H, H + 0.06, -T, bd, M.cap, nc));
  if (band) { gbump.add(boxAt(X1 - 0.012, X1, 0, L.bandH, 0, bd, M.band, nc), boxAt(X1, W, 0, L.bandH, bd, bd + 0.012, M.band, nc)); }
  if (fixed) { gbump.add(boxAt(X1 - 0.03, X1, 0, 0.33, 0, bd, M.cove, nc), boxAt(X1, W, 0, 0.33, bd, bd + 0.03, M.cove, nc)); }
  gbump.add(boxAt(X1 - 0.06, X1, 1.4, 4.3, bd - 0.28, bd + 0.06, M.lightWood), boxAt(X1, X1 + 0.28, 1.4, 4.3, bd, bd + 0.06, M.lightWood));

  // east wall with the house door
  const ge = G.east, hdz = L.hd, l0 = hdz.z0 + 0.3, l1 = hdz.z1 - 0.3;
  ge.add(boxAt(W, W + T, -0.25, H, bd, l0, wm, nc), boxAt(W, W + T, -0.25, H, l1, D + T, wm, nc));
  ge.add(boxAt(W, W + T, hdz.top, H, l0, l1, wm, nc));
  ge.add(boxAt(W, W + T, H, H + 0.06, bd, D + T, M.cap, nc));
  if (band) { ge.add(boxAt(W - 0.012, W, 0, L.bandH, bd, hdz.z0, M.band, nc), boxAt(W - 0.012, W, 0, L.bandH, hdz.z1, D, M.band, nc)); }
  if (fixed) { ge.add(boxAt(W - 0.03, W, 0, 0.33, bd, hdz.z0, M.cove, nc), boxAt(W - 0.03, W, 0, 0.33, hdz.z1, D - 1.2, M.cove, nc)); }
  const leafMats = [M.steelDoor, M.board, M.steelDoor, M.steelDoor, M.steelDoor, M.steelDoor];
  ge.add(boxAt(W + 0.04, W + 0.2, 0.04, hdz.top - 0.02, l0, l1, leafMats, nc));
  ge.add(boxAt(W - 0.06, W, 0, hdz.top + 0.28, hdz.z0, l0, M.casing, nc), boxAt(W - 0.06, W, 0, hdz.top + 0.28, l1, hdz.z1, M.casing, nc));
  ge.add(boxAt(W - 0.06, W, hdz.top, hdz.top + 0.28, hdz.z0, hdz.z1, M.casing, nc));
  ge.add(boxAt(W, W + 0.04, 0, hdz.top, l0, l0 + 0.04, M.casing, nc), boxAt(W, W + 0.04, 0, hdz.top, l1 - 0.04, l1, M.casing, nc));
  ge.add(boxAt(W - 0.1, W + 0.22, 0, 0.05, l0, l1, M.galv, nc));
  ge.add(sphere(W - 0.07, 3.0, l0 + 0.3, 0.09, M.chrome, 12), cylX(W - 0.02, W + 0.04, 3.0, l0 + 0.3, 0.12, M.chrome));
  ge.add(boxAt(W - 0.7, W, -0.25, 1.05, D - 1.2, D, M.curb, nc));
}

function buildWindow(g) {
  const { D, T } = L, w = L.win, zA = D - w.s1, zB = D - w.s0, c = 0.28, nc = { cast: false };
  g.add(boxAt(-T, 0, w.y0, w.y0 + 0.04, zA, zB, M.trim, nc), boxAt(-T, 0, w.y1 - 0.04, w.y1, zA, zB, M.trim, nc));
  g.add(boxAt(-T, 0, w.y0, w.y1, zA, zA + 0.04, M.trim, nc), boxAt(-T, 0, w.y0, w.y1, zB - 0.04, zB, M.trim, nc));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(zB - zA - 0.1, w.y1 - w.y0 - 0.1), M.glass);
  glass.rotation.y = Math.PI / 2; glass.position.set(-0.3, (w.y0 + w.y1) / 2, (zA + zB) / 2);
  g.add(glass);
  const f0 = -0.29, f1 = -0.17, ym = (w.y0 + w.y1) / 2;
  g.add(boxAt(f0, f1, w.y0, w.y0 + 0.2, zA, zB, M.trim, nc), boxAt(f0, f1, w.y1 - 0.16, w.y1, zA, zB, M.trim, nc));
  g.add(boxAt(f0, f1 + 0.04, ym - 0.07, ym + 0.07, zA, zB, M.trim, nc));
  g.add(boxAt(f0, f1, w.y0, w.y1, zA, zA + 0.15, M.trim, nc), boxAt(f0, f1, w.y0, w.y1, zB - 0.15, zB, M.trim, nc));
  g.add(boxAt(0, 0.05, w.y0, w.y1 + c, zA - c, zA, M.trim, nc), boxAt(0, 0.05, w.y0, w.y1 + c, zB, zB + c, M.trim, nc));
  g.add(boxAt(0, 0.05, w.y1, w.y1 + c, zA - c, zB + c, M.trim, nc));
  g.add(boxAt(0, 0.2, w.y0 - 0.07, w.y0, zA - c - 0.08, zB + c + 0.08, M.trim, nc));
  g.add(boxAt(0, 0.04, w.y0 - 0.34, w.y0 - 0.07, zA - c, zB + c, M.trim, nc));
}

function garageDoor(g, x0, x1) {
  const { D } = L, h = L.doorH, zf = D - 0.04, cx = (x0 + x1) / 2;
  g.add(boxAt(x0 - 0.08, x1 + 0.08, 0, h + 0.05, zf - 0.13, zf, M.gdoor, { cast: false }));
  const dia = new THREE.BoxGeometry(0.26, 0.26, 0.03);
  for (let j = 1; j <= 3; j++) {
    for (const xx of [x0 + 0.16, cx, x1 - 0.16]) {
      const m = new THREE.Mesh(dia, M.galv); m.rotation.z = Math.PI / 4; m.position.set(xx, h * j / 4, zf - 0.15); g.add(m);
    }
  }
  g.add(boxAt(x0 + 0.1, x1 - 0.1, h - 0.55, h - 0.43, zf - 0.2, zf - 0.13, M.galv, { cast: false }));
  g.add(boxAt(x0 - 0.08, x1 + 0.08, 0, 0.06, zf - 0.15, zf + 0.02, M.rubber, { cast: false }));
  for (const [xx, sg] of [[x0 - 0.13, -1], [x1 + 0.13, 1]]) {
    g.add(boxAt(xx - 0.05, xx + 0.05, 0, h + 0.1, zf - 0.34, zf - 0.14, M.galv, { cast: false }));
    g.add(boxAt(xx - 0.05 + sg * 0.09, xx + 0.05 + sg * 0.09, 0.05, h + 0.05, zf - 0.14, zf - 0.02, M.galv, { cast: false }));
    const curve = new THREE.QuadraticBezierCurve3(V3(xx, h + 0.1, zf - 0.24), V3(xx, h + 0.55, zf - 0.24), V3(xx, h + 0.55, zf - 0.85));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.06, 6), M.galv));
  }
  const ys = h + 0.72, zs = zf - 0.3;
  g.add(cylX(x0 - 0.25, x1 + 0.25, ys, zs, 0.035, M.steelDark));
  for (const sx of [cx - 1.05, cx + 1.05]) g.add(cylX(sx - 0.9, sx + 0.9, ys, zs, 0.1, M.spring));
  for (const dx of [x0 - 0.13, x1 + 0.13]) g.add(cylX(dx - 0.09, dx + 0.09, ys, zs, 0.17, M.galv));
  g.add(boxAt(cx - 0.12, cx + 0.12, ys - 0.3, ys + 0.2, zf - 0.1, zf - 0.02, M.galv, { cast: false }));
}

function buildFront() {
  const { W, D, H, T } = L, g = G.front, nc = { cast: false };
  const [d1, d2] = L.doors;
  g.add(boxAt(-T, d1[0], -0.25, H, D, D + T, M.wall, nc), boxAt(d2[1], W + T, -0.25, H, D, D + T, M.wall, nc));
  g.add(boxAt(d1[1], d2[0], -0.25, L.doorH, D, D + T, M.pierMat, nc));
  g.add(boxAt(-T, W + T, L.doorH, H, D, D + T, M.wall, nc));
  g.add(boxAt(-T, W + T, H, H + 0.06, D, D + T, M.cap, nc));
  garageDoor(g, d1[0], d1[1]);
  garageDoor(g, d2[0], d2[1]);
}

function opener(g, cx) {
  const { D, H } = L, nc = { cast: false }, body = std('#EDEDEA', 0.5);
  g.add(boxAt(cx - 0.06, cx + 0.06, 7.5, 7.64, D - 10.1, D - 0.35, M.galv, nc));
  g.add(boxAt(cx - 0.58, cx + 0.58, 7.36, 7.92, D - 11.55, D - 10.1, body, nc));
  g.add(boxAt(cx - 0.6, cx + 0.6, 7.92, 8.0, D - 11.57, D - 10.08, std('#3A3D41', 0.5), nc));
  g.add(boxAt(cx - 0.42, cx + 0.42, 7.33, 7.37, D - 11.3, D - 10.4, M.lens, nc));
  for (const dx of [-0.62, 0.56]) g.add(boxAt(cx + dx, cx + dx + 0.06, 7.96, H, D - 10.9, D - 10.8, M.galv, nc));
  g.add(boxAt(cx - 0.12, cx + 0.12, 7.42, 7.52, D - 1.55, D - 1.1, M.galv, nc));
  g.add(tube(V3(cx, 7.45, D - 1.3), V3(cx, 6.88, D - 0.22), 0.035, M.galv));
  g.add(tube(V3(cx, 7.42, D - 1.3), V3(cx, 6.1, D - 1.3), 0.01, M.red, 4));
  g.add(boxAt(cx - 0.05, cx + 0.05, 5.92, 6.12, D - 1.35, D - 1.25, M.red, nc));
  g.add(boxAt(cx - 0.12, cx + 0.12, 7.3, 7.7, D - 0.12, D, M.galv, nc));
}

function fixture(g, x, zc, len, kind) {
  const { H } = L, nc = { cast: false };
  if (kind === 'fluor') {
    g.add(boxAt(x - 0.3, x + 0.3, H - 0.26, H, zc - len / 2, zc + len / 2, M.trim, nc));
    g.add(boxAt(x - 0.26, x + 0.26, H - 0.3, H - 0.25, zc - len / 2 + 0.05, zc + len / 2 - 0.05, M.lens, nc));
  } else {
    g.add(boxAt(x - 0.13, x + 0.13, H - 0.12, H, zc - len / 2, zc + len / 2, M.trim, nc));
    g.add(boxAt(x - 0.1, x + 0.1, H - 0.14, H - 0.11, zc - len / 2 + 0.05, zc + len / 2 - 0.05, M.ledBar, nc));
  }
}

function hexGrid(g, x0, x1, z0, z1) {
  const R = 1.35, hw = Math.sqrt(3) * R, y = L.H - 0.07;
  const cols = Math.max(2, Math.floor((x1 - x0) / hw)), rows = Math.max(1, Math.floor((z1 - z0 - 2 * R) / (1.5 * R)) + 1);
  const ox = x0 + (x1 - x0 - cols * hw) / 2 + hw / 2, oz = z0 + (z1 - z0 - (rows - 1) * 1.5 * R - 2 * R) / 2 + R;
  const edges = new Map(), key = p => p.x.toFixed(2) + ',' + p.z.toFixed(2);
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r % 2 && c === cols - 1) continue;
      const cx = ox + c * hw + (r % 2 ? hw / 2 : 0), cz = oz + r * 1.5 * R;
      const v = [];
      for (let k = 0; k < 6; k++) { const a = (60 * k - 30) * Math.PI / 180; v.push(new THREE.Vector3(cx + R * Math.cos(a), y, cz + R * Math.sin(a))); }
      for (let k = 0; k < 6; k++) {
        const a = v[k], b = v[(k + 1) % 6], kk = [key(a), key(b)].sort().join('|');
        if (!edges.has(kk)) edges.set(kk, [a, b]);
        bx0 = Math.min(bx0, a.x); bx1 = Math.max(bx1, a.x); bz0 = Math.min(bz0, a.z); bz1 = Math.max(bz1, a.z);
      }
    }
  }
  const pad = 0.35;
  const frame = [[V3(bx0 - pad, y, bz0 - pad), V3(bx1 + pad, y, bz0 - pad)], [V3(bx1 + pad, y, bz0 - pad), V3(bx1 + pad, y, bz1 + pad)], [V3(bx1 + pad, y, bz1 + pad), V3(bx0 - pad, y, bz1 + pad)], [V3(bx0 - pad, y, bz1 + pad), V3(bx0 - pad, y, bz0 - pad)]];
  const all = [...edges.values(), ...frame];
  const geo = new THREE.BoxGeometry(1, 0.06, 0.12);
  const inst = new THREE.InstancedMesh(geo, M.hex, all.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  all.forEach(([a, b], i) => {
    const len = a.distanceTo(b);
    pos.copy(a).add(b).multiplyScalar(0.5);
    q.setFromAxisAngle(UP, -Math.atan2(b.z - a.z, b.x - a.x));
    sc.set(len + 0.1, 1, 1);
    m4.compose(pos, q, sc);
    inst.setMatrixAt(i, m4);
  });
  inst.instanceMatrix.needsUpdate = true;
  g.add(inst);
  return [(bx0 + bx1) / 2, (bz0 + bz1) / 2];
}

function kayakRack(g) {
  const { H } = L, z0 = 0.7, z1 = L.beamZ - 0.7, zc = (z0 + z1) / 2, nc = { cast: false };
  const kayak = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14), std('#F2C230', 0.35, 0, 0.7));
  kayak.scale.set(1.05, 0.3, (z1 - z0) / 2); kayak.position.set(1.45, 7.52, zc); g.add(kayak);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 20), M.black);
  rim.rotation.x = Math.PI / 2; rim.scale.set(1, 1.7, 1); rim.position.set(1.45, 7.8, zc + 0.6); g.add(rim);
  const sled = board(1.0, 3.0, 0.08, 0.4, std('#E8751A', 0.45)); sled.rotation.x = -Math.PI / 2; sled.position.set(1.45, 7.84, zc - 1.2); g.add(sled);
  for (const z of [z0 + 1.4, z1 - 1.4]) {
    g.add(boxAt(0.3, 0.38, 7.1, H, z - 0.05, z + 0.05, M.black, nc), boxAt(2.52, 2.6, 7.1, H, z - 0.05, z + 0.05, M.black, nc));
    g.add(boxAt(0.3, 2.6, 7.1, 7.18, z - 0.06, z + 0.06, M.black, nc));
  }
  const skiCols = ['#C8262B', '#1D1F22', '#2A62C9'];
  for (let i = 0; i < 3; i++) {
    const x = 2.85 + i * 0.22;
    for (const dx of [-0.06, 0.06]) g.add(boxAt(x + dx - 0.05, x + dx + 0.05, 7.72 - i * 0.02, 7.76 - i * 0.02, zc - 2.7, zc + 2.7, std(skiCols[i], 0.4), nc));
  }
  for (const z of [zc - 1.6, zc + 1.6]) {
    g.add(boxAt(2.7, 3.55, 7.66, 7.7, z - 0.06, z + 0.06, M.black, nc));
    g.add(boxAt(2.72, 2.78, 7.7, H, z - 0.03, z + 0.03, M.black, nc), boxAt(3.47, 3.53, 7.7, H, z - 0.03, z + 0.03, M.black, nc));
  }
}

function overheadRacks(g) {
  const { W, H } = L, z0 = 2.35, z1 = L.beamZ - 0.5, nc = { cast: false }, deck = 6.82;
  for (const [x0, x1] of [[W * 0.25, W * 0.25 + 4], [W * 0.54, W * 0.54 + 4]]) {
    g.add(boxAt(x0, x1, deck - 0.02, deck + 0.02, z0, z1, M.wireDeck, nc));
    g.add(boxAt(x0, x1, deck, deck + 0.12, z0, z0 + 0.08, M.steelDark, nc), boxAt(x0, x1, deck, deck + 0.12, z1 - 0.08, z1, M.steelDark, nc));
    g.add(boxAt(x0, x0 + 0.08, deck, deck + 0.12, z0, z1, M.steelDark, nc), boxAt(x1 - 0.08, x1, deck, deck + 0.12, z0, z1, M.steelDark, nc));
    for (const x of [x0, x1 - 0.08]) for (const z of [z0, (z0 + z1) / 2, z1 - 0.08]) g.add(boxAt(x, x + 0.08, deck, H, z, z + 0.08, M.steelDark, nc));
    const n = 3, span = (z1 - z0 - 0.3) / n;
    for (let i = 0; i < n; i++) { const a = z0 + 0.15 + i * span; hdx(g, x0 + 1.1, x1 - 1.1, deck + 0.02, a + 0.1, a + span - 0.1); }
  }
}

function buildCeiling(o) {
  const { W, D, H } = L, g = G.ceil, nc = { cast: false };
  G.ceilPlane.add(boxAt(0, W, H, H + 0.2, 0, D, M.ceiling, nc));
  g.add(boxAt(0, W, L.beamY, H, L.beamZ - 0.36, L.beamZ + 0.36, M.ceiling, nc));
  for (const [x0, x1] of L.doors) {
    for (const x of [x0 - 0.13, x1 + 0.13]) {
      G.mech.add(boxAt(x - 0.05, x + 0.05, 7.5, 7.62, D - 9.9, D - 0.85, M.galv, nc));
      G.mech.add(boxAt(x - 0.04, x + 0.04, 7.62, H, D - 9.75, D - 9.65, M.galv, nc));
    }
    opener(G.mech, (x0 + x1) / 2);
  }
  g.add(boxAt(W * 0.15, W * 0.85, H - 0.07, H - 0.01, 3.2, 3.27, M.galv, nc));
  kayakRack(g);
  if (o.overhead === 'two') overheadRacks(g);
  const zN = (1.9 + L.beamZ - 0.6) / 2, xs = [W * 0.2, W * 0.5, W * 0.8], spots = [];
  if (o.lights === 'fluorescent') {
    for (const x of xs) { fixture(g, x, zN, 4, 'fluor'); spots.push([x, zN]); }
    fixture(g, W * 0.5, D - 6.5, 4, 'fluor'); spots.push([W * 0.5, D - 6.5]);
  } else {
    for (const x of xs) { fixture(g, x, zN, 4, 'led'); spots.push([x, zN]); }
    if (o.lights === 'led') {
      for (const x of [W * 0.125, W * 0.5, W * 0.875]) { fixture(g, x, D - 6.2, 4, 'led'); spots.push([x, D - 6.2]); }
    } else {
      hexGrid(g, 3.0, W - 3.0, L.beamZ + 2.2, D - 1.3);
      spots.push([W * 0.3, D - 4.8], [W * 0.7, D - 4.8], [W * 0.5, L.beamZ + 4]);
    }
  }
  return spots;
}

function setLights(kind, spots) {
  const lv = { fluorescent: { hemi: 0.34, sun: 0.2, pt: 0.17, exp: 1.0 }, led: { hemi: 0.4, sun: 0.24, pt: 0.2, exp: 1.05 }, hex: { hemi: 0.44, sun: 0.26, pt: 0.24, exp: 1.1 } }[kind];
  hemi.intensity = lv.hemi;
  sun.intensity = lv.sun;
  renderer.toneMappingExposure = lv.exp;
  sun.position.set(L.W * 0.62, 26, L.D * 0.62);
  sun.target.position.set(L.W * 0.45, 0, L.D * 0.42);
  const s = Math.max(L.W, L.D) / 2 + 4, sc = sun.shadow.camera;
  sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = 1; sc.far = 70; sc.updateProjectionMatrix();
  pts.forEach((p, i) => {
    if (i < 6 && spots[i]) { p.position.set(spots[i][0], L.H - 0.8, spots[i][1]); p.intensity = lv.pt; p.distance = 20; }
    else if (i >= 6 && taskSpots[i - 6]) { p.position.copy(taskSpots[i - 6]); p.intensity = 0.18; p.distance = 7; }
    else p.intensity = 0;
  });
}

function buildWest(o) {
  const g = wallGroup('west'), D = L.D;
  G.west.add(g);
  // tool board by the garage door: leaf blower, cord reel, snow shovel
  g.add(boxAt(0.35, 2.85, 6.0, 6.42, 0, 0.07, M.cleat));
  g.add(boxAt(0.45, 1.95, 6.42, 6.46, 0.02, 0.7, M.wireWhite, { cast: false }));
  g.add(tube(V3(0.95, 3.85, 0.3), V3(1.9, 5.7, 0.3), 0.09, M.black));
  g.add(boxAt(1.7, 2.15, 5.4, 5.95, 0.12, 0.52, std('#B3261E', 0.5)));
  g.add(cylZ(2.4, 5.15, 0.08, 0.42, 0.42, std('#EF7D1A', 0.5)));
  g.add(cylZ(2.4, 5.15, 0.42, 0.46, 0.2, std('#2c2e31', 0.6)));
  g.add(tube(V3(0.8, 6.2, 0.12), V3(0.8, 2.5, 0.3), 0.045, std('#1D4FA8', 0.4)));
  g.add(boxAt(0.35, 1.25, 1.74, 2.55, 0.26, 0.34, M.black));
  // small white box with a status light, conduit down to an outlet
  g.add(boxAt(10.6, 11.0, 4.2, 4.65, 0, 0.12, M.trim));
  g.add(sphere(10.8, 4.5, 0.125, 0.025, M.ledGreen, 8));
  g.add(boxAt(10.77, 10.83, 2.35, 4.2, 0, 0.05, M.galv), boxAt(10.65, 10.95, 1.95, 2.35, 0, 0.1, M.trim));

  const specs = [{ frame: '#1F4FA3', accent: '#E9E9E6', rack: true, mtb: true }, { frame: '#C9CCD0', accent: '#9AA0A6' }];
  const hangFlat = (spec, rear, y, d) => {
    const b = bike(spec); b.rotation.y = Math.PI; b.position.set(rear, y, d); b.userData.bars.rotation.y = 1.25; g.add(b);
    for (const s of [rear - 1.25, rear - 2.45]) g.add(boxAt(s - 0.04, s + 0.04, 5.7, 5.8, 0.05, d + 0.15, M.black));
  };
  if (o.bikes === 'asis') {
    g.add(boxAt(7.55, 9.05, 5.95, 6.12, 0, 0.1, M.trim));
    for (let i = 0; i < 4; i++) g.add(boxAt(7.75 + i * 0.36, 7.88 + i * 0.36, 5.9, 6.1, 0.1, 0.2, M.black));
    g.add(tube(V3(9.02, 6.5, 0.1), V3(9.3, 1.97, 0.37), 0.035, std('#c9a15f', 0.6)));
    g.add(boxAt(8.65, 9.95, 1.73, 1.98, 0.24, 0.5, M.black));
    g.add(boxAt(10.9, D - 0.35, 5.55, 5.95, 0, 0.07, M.cleat));
    hangFlat(specs[0], D - 6.45, 4.45, 0.36);
    hangFlat(specs[1], D - 2.95, 3.95, 0.66);
    rake(g, D - 7.4, 0.24); shovel(g, D - 5.1, 0.26);
  } else if (o.bikes === 'steadyrack') {
    g.add(boxAt(7.3, 11.4, 5.2, 5.38, 0, 0.09, std('#B9BEC4', 0.4, 0.5)));
    rake(g, 7.9, 0.26, 5.25); shovel(g, 9.05, 0.28, 5.2); pushBroom(g, 10.45, 0.3, 5.25);
    const basis = new THREE.Matrix4().makeBasis(V3(0, 1, 0), V3(0, 0, 1), V3(1, 0, 0));
    [[D - 7.6, specs[0]], [D - 5.4, specs[1]]].forEach(([s, spec]) => {
      g.add(boxAt(s - 0.22, s + 0.22, 6.2, 7.05, 0, 0.08, M.black), boxAt(s - 0.18, s + 0.18, 2.2, 2.6, 0, 0.1, M.black));
      const pv = new THREE.Group(); pv.position.set(s, 0, 0.08); pv.rotation.y = 0.62; g.add(pv);
      for (const dx of [-0.12, 0.12]) pv.add(boxAt(dx - 0.03, dx + 0.03, 6.72, 6.8, 0, 1.6, M.black));
      pv.add(boxAt(-0.15, 0.15, 6.6, 6.72, 1.45, 1.6, M.black));
      const b = bike(spec); b.quaternion.setFromRotationMatrix(basis); b.position.set(0, 2.45, 1.2); pv.add(b);
    });
  } else {
    const s0 = 7.4, s1 = D - 1.9, trim = std('#2f3236', 0.5);
    g.add(boxAt(s0, s1, 2.05, 6.05, 0, 0.06, M.slat, { cast: false }));
    g.add(boxAt(s0 - 0.06, s0, 2.0, 6.1, 0, 0.08, trim), boxAt(s1, s1 + 0.06, 2.0, 6.1, 0, 0.08, trim));
    g.add(boxAt(s0, s1, 6.05, 6.1, 0, 0.08, trim), boxAt(s0, s1, 2.0, 2.05, 0, 0.08, trim));
    hangFlat(specs[0], D - 6.45, 4.45, 0.36);
    hangFlat(specs[1], D - 2.95, 3.95, 0.66);
    rake(g, 7.95, 0.24, 5.6); shovel(g, 8.95, 0.26, 5.5); pushBroom(g, 10.05, 0.3, 5.6);
    g.add(boxAt(11.0, 12.5, 2.2, 3.1, 0.06, 1.0, M.wireBlack, { cast: false }));
    ball(g, 11.45, 2.62, 0.55, M.ballOld, 0.36); helmet(g, 12.05, 2.55, 0.55, '#C8262B');
  }
}

function buildBack(o) {
  const g = G.back;
  evPos = null;
  if (o.shelves === 'asis' || o.shelves === 'refresh') builtIns(g, o);
  else if (o.shelves === 'racks') steelRacks(g);
  else cabinets(g, o);
}

const PALETTE = ['#B3261E', '#1C1D20', '#B89668', '#2F5FA8', '#E7E5DF', '#6B7078', '#3F6B3A', '#C9A54A', '#8B8F95', '#B89668'];
function clutter(g, x0, x1, y0, y1, depth, r) {
  let x = x0 + 0.05;
  while (x < x1 - 0.3) {
    const w = Math.min(x1 - 0.05 - x, 0.45 + r() * 1.05), h = Math.min(y1 - y0 - 0.06, 0.3 + r() * 0.8), d = Math.min(depth - 0.1, 0.55 + r() * 1.0);
    if (r() < 0.2) {
      const n = 2 + ((r() * 3) | 0), cr = 0.13;
      for (let i = 0; i < n && x + (i + 1) * 0.3 < x1; i++) g.add(cyl(x + 0.15 + i * 0.3, 0.4 + r() * 0.5, y0, y0 + 0.35 + r() * 0.2, cr, std(PALETTE[(r() * PALETTE.length) | 0], 0.5), 10));
      x += n * 0.3 + 0.1;
    } else {
      g.add(boxAt(x, x + w, y0, y0 + h, 0.06, 0.06 + d, std(PALETTE[(r() * PALETTE.length) | 0], 0.7)));
      x += w + 0.04 + r() * 0.15;
    }
  }
}
function builtIns(g, o) {
  const fresh = o.shelves === 'refresh';
  const Pm = !fresh ? M.ply : o.builtin === 'natural' ? M.plyCoat : std(swatch('builtin', o.builtin).hex, 0.5, 0, 0.5);
  const t = 0.06, x0 = 0.24, xT = 4.3, xE = L.X1 - 0.04, dT = 1.75, dU = 1.5, dC = 1.85;
  const sx = x => xT + (x - 4.3) * (xE - xT) / (15.96 - 4.3);
  const xDiv = [6.55, 8.05, 8.95, 10.9, 13.35].map(sx), xLeg = [8.5, 10.9, 13.35].map(sx), xPeg = xDiv[4];
  const r = mulberry32(31);
  g.add(boxAt(x0, x0 + t, 0, 6.72, 0, dT, Pm), boxAt(xT - t, xT, 0, 6.72, 0, dT, Pm));
  const ys = [0.32, 1.27, 2.22, 3.14, 4.3, 5.5, 6.72];
  for (let i = 0; i < ys.length - 1; i++) g.add(boxAt(x0 + t, xT - t, ys[i] - t, ys[i], 0, dT - 0.04, Pm));
  if (fresh) {
    g.add(boxAt(xT, xDiv[3], 3.02, 3.14, 0, dC, Pm));
    g.add(boxAt(xDiv[3], xE, 2.99, 3.17, 0, dC + 0.1, M.butcher));
  } else g.add(boxAt(xT, xE, 3.02, 3.14, 0, dC, Pm));
  for (const y of [4.3, 5.5]) g.add(boxAt(xT, xPeg, y - t, y, 0, dU, Pm));
  for (const x of xDiv) g.add(boxAt(x - t / 2, x + t / 2, 3.14, 6.72, 0, dU, Pm));
  g.add(boxAt(xE - t, xE, 3.14, 6.72, 0, dU, Pm));
  for (const x of [...xLeg, xE - t / 2]) g.add(boxAt(x - t / 2, x + t / 2, 0, 3.02, 0.04, dC, Pm));
  g.add(boxAt(x0, xE, 6.72, 6.84, 0, 1.95, Pm), boxAt(x0, xE, 6.56, 6.72, 1.89, 1.95, Pm));
  g.add(boxAt(xDiv[1], xDiv[2], 3.14, 6.72, dU - 0.02, dU + 0.03, Pm));
  evCharger(g, (xDiv[1] + xDiv[2]) / 2, 4.55, dU + 0.03);
  g.add(boxAt(xPeg + t / 2, xE - t, 3.14, 6.72, 0, 0.04, fresh ? M.pegTall : M.peg, { cast: false }));
  // contents
  const cubbies = [];
  for (let i = 0; i < ys.length - 1; i++) cubbies.push([x0 + t, xT - t, ys[i], ys[i + 1] - t, dT]);
  const upper = [[xT, xDiv[0]], [xDiv[0], xDiv[1]], [xDiv[2], xDiv[3]], [xDiv[3], xPeg]];
  for (const [a, b] of upper) for (const [y0, y1] of [[3.14, 4.24], [4.3, 5.44], [5.5, 6.66]]) cubbies.push([a + t / 2, b - t / 2, y0, y1, dU]);
  for (const [a, b, y0, y1, dep] of cubbies) {
    if (fresh) {
      const w = 1.25, n = Math.max(1, Math.floor((b - a - 0.08) / (w + 0.1))), gap = (b - a - n * w) / (n + 1), h = Math.min(0.95, y1 - y0 - 0.1);
      for (let i = 0; i < n; i++) { const xa = a + gap + i * (w + gap); tote(g, xa, xa + w, y0, y0 + h, 0.12, dep - 0.1); }
    } else clutter(g, a, b, y0, y1, dep, r);
  }
  // counter, top shelf
  if (fresh) {
    g.add(boxAt(xE - 1.7, xE - 0.3, 3.17, 3.62, 0.3, 1.0, std('#C8262B', 0.45, 0.2)));
    for (let i = 0; i < 4; i++) tote(g, x0 + 0.3 + i * 2.35, x0 + 2.3 + i * 2.35, 6.84, 7.7, 0.15, 1.75, '#2b2e33');
    for (let i = 0; i < 2; i++) tote(g, x0 + 9.8 + i * 2.35, x0 + 11.8 + i * 2.35, 6.84, 7.7, 0.15, 1.75, '#2b2e33');
    g.add(boxAt(x0 + 0.2, xE - 0.2, 6.52, 6.56, 1.6, 1.78, M.ledBar, { cast: false }));
    taskSpots = [V3(xT + 2, 5.9, 2.2), V3(xE - 3, 5.9, 2.2)];
  } else {
    g.add(boxAt(xE - 1.7, xE - 0.3, 3.14, 3.6, 0.3, 1.0, std('#C8262B', 0.45, 0.2)));
    g.add(cylX(1.3, 4.6, 7.27, 0.9, 0.42, std('#3D5A36', 0.8)));
    g.add(boxAt(4.8, 7.9, 6.84, 7.4, 0.2, 1.6, std('#B89668', 0.85)));
    g.add(cylZ(8.5, 7.2, 0.3, 1.7, 0.34, M.black));
    g.add(boxAt(9.1, 10.5, 6.84, 7.55, 0.2, 1.5, M.clearTote, { cast: false }));
    g.add(boxAt(10.8, 11.9, 6.84, 7.7, 0.2, 1.2, M.wireWhite, { cast: false }));
    g.add(boxAt(12.1, 13.5, 6.84, 7.45, 0.2, 1.5, std('#B89668', 0.85)));
    g.add(cylX(13.9, 15.5, 7.14, 0.8, 0.3, std('#2C62B8', 0.6)));
    g.add(boxAt(5.1, 5.3, 0.5, 3.0, 0, 0.12, M.cleat), boxAt(5.17, 5.23, 0.6, 2.9, 0.12, 0.14, M.galv));
    g.add(boxAt(xE - 0.95, xE - 0.12, 1.35, 2.05, 1.0, 1.75, M.wireBlack, { cast: false }));
  }
}

function steelRacks(g) {
  const X1 = L.X1, nc = { cast: false };
  const rack = x0 => {
    for (const x of [x0, x0 + 3.92]) for (const z of [0.05, 1.97]) g.add(boxAt(x, x + 0.08, 0, 6.5, z, z + 0.08, M.steelDark));
    [0.3, 1.8, 3.3, 4.8, 6.3].forEach((y, i) => {
      g.add(boxAt(x0, x0 + 4, y - 0.08, y, 0.05, 2.05, M.steelDark));
      if (i < 4) { hdx(g, x0 + 0.2, x0 + 2.7, y, 0.2, 1.9); g.add(boxAt(x0 + 2.85, x0 + 3.8, y, y + 0.7, 0.3, 1.6, std(i % 2 ? '#2F5FA8' : '#B89668', 0.8))); }
      else g.add(boxAt(x0 + 0.3, x0 + 3.2, y, y + 0.7, 0.2, 1.8, std('#B89668', 0.85)));
    });
  };
  rack(0.3); rack(4.45);
  const bx0 = X1 - 6.1, bx1 = X1 - 0.1, evX = (8.45 + bx0) / 2;
  g.add(boxAt(evX - 0.55, evX + 0.55, 3.9, 5.75, 0, 0.06, std('#D9D6CF', 0.7)));
  evCharger(g, evX, 4.35, 0.06);
  g.add(boxAt(bx0, bx1, 2.95, 3.1, 0.05, 2.05, M.butcher));
  for (const x of [bx0 + 0.1, bx1 - 0.18]) for (const z of [0.12, 1.9]) g.add(boxAt(x, x + 0.08, 0, 2.95, z, z + 0.08, M.steelDark));
  g.add(boxAt(bx0 + 0.1, bx1 - 0.1, 0.45, 0.52, 0.2, 1.9, M.steelDark));
  hdx(g, bx0 + 0.4, bx0 + 2.9, 0.52, 0.3, 1.8); hdx(g, bx0 + 3.2, bx0 + 5.7, 0.52, 0.3, 1.8);
  const px0 = bx0 + 0.35, px1 = px0 + 5.33;
  g.add(boxAt(px0, px1, 3.55, 6.22, 0, 0.05, M.pegWide, nc));
  g.add(boxAt(px0, px1, 6.45, 6.52, 0, 0.95, M.steelDark));
  for (let i = 0; i < 5; i++) g.add(boxAt(px0 + 0.2 + i * 1.02, px0 + 0.95 + i * 1.02, 6.52, 6.95, 0.15, 0.8, std(['#C8262B', '#2F5FA8', '#1D1F22', '#C9A54A', '#3F6B3A'][i], 0.6)));
  g.add(boxAt(px0 + 0.1, px1 - 0.1, 6.4, 6.44, 0.5, 0.85, M.ledBar, nc));
  g.add(boxAt(bx1 - 1.6, bx1 - 0.3, 3.1, 3.55, 0.3, 1.0, std('#C8262B', 0.45, 0.2)));
  taskSpots = [V3((px0 + px1) / 2, 5.9, 2.2)];
}

function cabinets(g, o) {
  const X1 = L.X1, f = (X1 - 0.05) / 15.95, sx = x => x * f, nc = { cast: false };
  const hex = swatch('cab', o.cab).hex, body = std(hex, 0.45, 0.35, 0.7);
  const c = new THREE.Color(hex).offsetHSL(0, 0, 0.06), door = std('#' + c.getHexString(), 0.32, 0.45, 0.9);
  const top = std('#C9CDD1', 0.25, 0.9, 1.0);
  const handle = (x, y0, y1, z) => g.add(boxAt(x - 0.025, x + 0.025, y0, y1, z, z + 0.06, M.chrome));
  const locker = (a, b) => {
    g.add(boxAt(a + 0.08, b - 0.08, 0, 0.25, 0.1, 1.45, M.black));
    g.add(boxAt(a, b, 0.25, 6.75, 0.05, 1.55, body));
    g.add(boxAt(a + 0.03, b - 0.03, 0.3, 6.7, 1.55, 1.6, door));
    handle(b - 0.18, 3.1, 4.3, 1.6);
  };
  const base = (a, b) => {
    g.add(boxAt(a + 0.08, b - 0.08, 0, 0.25, 0.1, 1.45, M.black));
    g.add(boxAt(a, b, 0.25, 2.95, 0.05, 1.55, body));
    g.add(boxAt(a + 0.03, b - 0.03, 2.35, 2.9, 1.55, 1.6, door));
    const m = (a + b) / 2;
    g.add(boxAt(a + 0.03, m - 0.015, 0.3, 2.3, 1.55, 1.6, door), boxAt(m + 0.015, b - 0.03, 0.3, 2.3, 1.55, 1.6, door));
    g.add(boxAt(m - 0.3, m + 0.3, 2.6, 2.65, 1.6, 1.66, M.chrome));
    handle(m - 0.12, 1.7, 2.2, 1.6); handle(m + 0.12, 1.7, 2.2, 1.6);
  };
  const wall = (a, b) => {
    g.add(boxAt(a, b, 5.25, 7.6, 0.05, 1.15, body));
    const m = (a + b) / 2;
    g.add(boxAt(a + 0.03, m - 0.015, 5.3, 7.55, 1.15, 1.2, door), boxAt(m + 0.015, b - 0.03, 5.3, 7.55, 1.15, 1.2, door));
    handle(m - 0.12, 5.4, 5.9, 1.2); handle(m + 0.12, 5.4, 5.9, 1.2);
    g.add(boxAt(a + 0.1, b - 0.1, 5.2, 5.24, 0.6, 1.0, M.ledBar, nc));
  };
  locker(sx(0.3), sx(2.3)); locker(sx(2.35), sx(4.35));
  base(sx(4.45), sx(6.45)); base(sx(6.5), sx(8.5));
  base(sx(11.0), sx(13.45)); base(sx(13.5), sx(15.95));
  g.add(boxAt(sx(4.45), sx(8.5), 2.95, 3.08, 0.05, 1.75, top), boxAt(sx(11.0), sx(15.95), 2.95, 3.08, 0.05, 1.75, top));
  wall(sx(4.45), sx(6.45)); wall(sx(6.5), sx(8.5)); wall(sx(11.0), sx(13.45)); wall(sx(13.5), sx(15.95));
  g.add(boxAt(sx(11.05), sx(15.9), 3.3, 5.1, 0, 0.04, M.pegStrip, nc));
  const evX = sx(9.75);
  g.add(boxAt(evX - 0.55, evX + 0.55, 3.9, 5.75, 0, 0.06, std('#D9D6CF', 0.7)));
  evCharger(g, evX, 4.35, 0.06);
  taskSpots = [V3(sx(6.5), 4.6, 2.3), V3(sx(13.5), 4.6, 2.3)];
}

function chair(g, x0, x1, y0, y1, z) {
  const frame = std('#b9bdc2', 0.35, 0.8, 0.9);
  g.add(boxAt(x0, x0 + 0.06, y0, y1, z, z + 0.08, frame), boxAt(x1 - 0.06, x1, y0, y1, z, z + 0.08, frame));
  g.add(boxAt(x0, x1, y1 - 0.06, y1, z, z + 0.08, frame), boxAt(x0, x1, y0, y0 + 0.06, z, z + 0.08, frame));
  g.add(boxAt(x0 + 0.06, x1 - 0.06, y0 + 0.4, y1 - 0.1, z + 0.02, z + 0.06, M.stripes));
}
function buildBump(o) {
  const g = wallGroup('bumpW'), bd = L.bd;
  G.bump.add(g);
  g.add(boxAt(0.2, bd - 0.25, 6.5, 6.53, 0, 1.0, M.wireWhite, { cast: false }));
  g.add(cylX(0.2, bd - 0.25, 6.53, 1.0, 0.02, M.trim));
  for (const s of [0.55, bd - 0.6]) g.add(tube(V3(s, 6.5, 0.98), V3(s, 5.95, 0.02), 0.02, M.trim, 5));
  g.add(boxAt(0.35, bd - 0.35, 6.05, 6.15, 0, 0.06, M.trim));
  for (let i = 0; i < 3; i++) chair(g, 0.45 + i * 0.1, 1.95 + i * 0.1, 3.1 + i * 0.05, 6.0, 0.08 + i * 0.18);
  g.add(boxAt(0.95, 1.95, 3.9, 5.65, 0.72, 1.32, M.floral));
  g.add(boxAt(0.9, 2.0, 5.55, 5.72, 0.9, 1.1, std('#b9bdc2', 0.35, 0.8, 0.9)));
  g.add(boxAt(1.2, 1.7, 3.55, 3.9, 0.9, 1.25, std('#F2C230', 0.5)));
  g.add(cylX(0.5, 2.6, 6.83, 0.5, 0.3, std('#2C62B8', 0.6)));
  helmet(g, 3.25, 6.53, 0.45, '#1D1F22');
  const sb = board(4.1, 0.95, 0.04, 0.46, std('#E9E9E6', 0.4)); sb.rotation.x = -Math.PI / 2; sb.position.set(bd / 2, 6.56, 0.55); g.add(sb);
  if (o.finish === 'asis') {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.62), M.damage);
    d.position.set(bd - 0.9, 0.31, 0.008);
    g.add(d);
  }
}

function buildEast(o) {
  const g = wallGroup('east'), D = L.D, hz = L.hd;
  G.east.add(g);
  for (const x of [hz.z1 + 0.35, hz.z1 + 0.68]) { g.add(boxAt(x - 0.12, x + 0.12, 4.45, 4.8, 0, 0.05, M.black)); g.add(boxAt(x - 0.08, x + 0.08, 4.62, 4.72, 0.05, 0.056, M.screen, { cast: false })); }
  if (o.door === 'asis') {
    g.add(boxAt(9.0, 13.6, 5.45, 5.7, 0, 0.07, M.lightWood));
    ['#C8262B', '#2A62C9', '#3F8A4A', '#F2C230', '#E8751A', '#C8262B', '#2A62C9', '#3F8A4A'].forEach((c, i) => g.add(cylZ(9.3 + i * 0.55, 5.57, 0.07, 0.3, 0.05, std(c, 0.5), 8)));
    g.add(boxAt(12.6, D - 1.2, 5.65, 5.95, 0, 0.07, M.lightWood));
    g.add(boxAt(14.2, D - 1.4, 5.62, 5.72, 0.07, 0.1, M.black));
    for (let x = 14.4; x < D - 1.5; x += 0.45) g.add(boxAt(x - 0.02, x + 0.02, 5.45, 5.65, 0.08, 0.2, M.black));
    helmet(g, 9.55, 4.8, 0.48, '#1D1F22'); helmet(g, 10.35, 4.8, 0.48, '#D4E23A');
    claw(g, 9.45, 4.05); ball(g, 9.45, 4.1, 0.46, M.ball);
    claw(g, 9.45, 3.3); football(g, 9.45, 3.32, 0.4);
    skateboard(g, 10.5, 3.75, 2.65); claw(g, 11.3, 4.15);
    for (let i = 0; i < 4; i++) g.add(boxAt(11.05 + i * 0.16, 11.13 + i * 0.16, 3.45, 3.62, 0, 0.18, M.black));
    claw(g, 12.2, 4.2); ball(g, 12.2, 4.25, 0.46, M.ballOld); skateboard(g, 12.95, 3.65, 3.0, std('#2b2e33', 0.6));
    helmet(g, 14.6, 5.05, 0.48, '#2b2e33'); bag(g, 15.45, 4.8, 0.3); helmet(g, 16.3, 5.25, 0.48, '#C8262B');
    g.add(boxAt(16.8, 17.35, 4.95, 5.5, 0.05, 0.12, std('#2A62C9', 0.5)));
    lacrosse(g, D - 1.55, 2.4, 6.35); lacrosse(g, D - 1.35, 2.6, 6.2);
  } else if (o.door === 'slatwall') {
    const s0 = 9.0, s1 = D - 1.1, trim = std('#2f3236', 0.5);
    g.add(boxAt(s0, s1, 2.0, 6.0, 0, 0.06, M.slat, { cast: false }));
    g.add(boxAt(s0 - 0.06, s0, 1.95, 6.05, 0, 0.08, trim), boxAt(s1, s1 + 0.06, 1.95, 6.05, 0, 0.08, trim));
    g.add(boxAt(s0, s1, 6.0, 6.05, 0, 0.08, trim), boxAt(s0, s1, 1.95, 2.0, 0, 0.08, trim));
    g.add(boxAt(9.4, 11.2, 2.25, 3.65, 0.06, 1.15, M.wireBlack, { cast: false }));
    ball(g, 9.9, 2.66, 0.6, M.ball); ball(g, 10.7, 2.66, 0.62, M.ballOld); football(g, 10.3, 3.18, 0.55);
    ['#1D1F22', '#D4E23A', '#2b2e33', '#C8262B'].forEach((c, i) => { const x = 11.8 + i * 0.85; g.add(boxAt(x - 0.03, x + 0.03, 5.3, 5.4, 0.06, 0.3, M.black)); helmet(g, x, 4.85, 0.5, c); });
    g.add(boxAt(15.2, 16.8, 3.2, 3.3, 0.06, 0.55, M.black));
    for (const [x, len] of [[15.55, 2.65], [16.45, 3.0]]) { const b = board(0.7, len, 0.05, 0.34, M.black); b.rotation.x = -Math.PI / 2 + 0.25; b.rotation.z = Math.PI / 2; b.position.set(16.0, 3.3 + (x - 15.55) * 0.15, 0.3 + (x - 15.55) * 0.3); }
    skateboard(g, 15.6, 4.0, 2.65); skateboard(g, 16.45, 3.95, 3.0, std('#2b2e33', 0.6));
    g.add(boxAt(17.4, 19.2, 5.3, 5.36, 0.06, 0.9, M.steelDark));
    g.add(boxAt(17.5, 18.3, 5.36, 5.85, 0.2, 0.8, std('#2F5FA8', 0.6)), boxAt(18.4, 19.1, 5.36, 5.75, 0.2, 0.8, std('#C9A54A', 0.6)));
    bag(g, 18.3, 4.35, 0.35); g.add(boxAt(19.1, 19.6, 4.8, 5.3, 0.06, 0.12, std('#2A62C9', 0.5)));
    lacrosse(g, s1 - 0.5, 2.4, 6.35, 0.2); lacrosse(g, s1 - 0.28, 2.6, 6.2, 0.2);
  } else {
    const b0 = 8.6, b1 = 12.1, wood = M.lightWood, fab = std('#6B7078', 0.9);
    g.add(boxAt(b0, b1, 1.4, 1.55, 0, 1.3, wood), boxAt(b0 + 0.05, b1 - 0.05, 1.55, 1.7, 0.05, 1.25, fab));
    for (const x of [b0, (b0 * 2 + b1) / 3, (b0 + b1 * 2) / 3, b1 - 0.07]) g.add(boxAt(x, x + 0.07, 0, 1.4, 0, 1.3, wood));
    g.add(boxAt(b0, b1, 0.1, 0.16, 0, 1.3, wood));
    for (let i = 0; i < 3; i++) { const a = b0 + 0.25 + i * 1.15; g.add(boxAt(a, a + 0.8, 0.16, 0.5, 0.25, 1.1, std(['#1D1F22', '#8B5A3C', '#2F5FA8'][i], 0.8))); }
    g.add(boxAt(b0, b1, 5.0, 5.3, 0, 0.07, wood), boxAt(b0, b1, 5.75, 5.82, 0, 0.85, wood));
    for (let i = 0; i < 5; i++) g.add(cylZ(b0 + 0.35 + i * 0.7, 5.15, 0.07, 0.3, 0.04, M.black, 8));
    bag(g, b0 + 1.05, 4.4, 0.35, '#2F5FA8'); bag(g, b0 + 2.45, 4.35, 0.35, '#3F6B3A', 1.1);
    g.add(boxAt(b0 + 0.3, b0 + 1.1, 5.82, 6.3, 0.15, 0.75, std('#B89668', 0.8)), boxAt(b0 + 1.3, b0 + 2.1, 5.82, 6.3, 0.15, 0.75, std('#B89668', 0.8)));
    g.add(boxAt(12.3, 14.4, 0, 0.05, 0.05, 1.3, M.rubber));
    g.add(boxAt(12.5, 13.1, 0.05, 0.4, 0.2, 1.0, std('#3A2C22', 0.8)), boxAt(13.3, 13.9, 0.05, 0.36, 0.25, 1.05, std('#1D1F22', 0.8)));
    g.add(boxAt(14.8, D - 1.3, 4.9, 5.05, 0, 0.06, M.galv));
    g.add(boxAt(15.0, 16.3, 2.1, 4.8, 0.06, 0.95, M.wireBlack, { cast: false }));
    ball(g, 15.65, 4.2, 0.5, M.ball); ball(g, 15.65, 3.35, 0.5, M.ballOld); football(g, 15.65, 2.55, 0.5);
    ['#1D1F22', '#D4E23A', '#C8262B'].forEach((c, i) => helmet(g, 16.9 + i * 0.75, 4.4, 0.48, c));
    skateboard(g, 19.1, 3.45, 2.65); skateboard(g, 19.9, 3.35, 3.0, std('#2b2e33', 0.6));
    lacrosse(g, D - 1.5, 2.4, 6.35); lacrosse(g, D - 1.3, 2.6, 6.2);
  }
}

function buildColumn(o) {
  const g = G.free, x = L.colX, z = L.beamZ, top = L.beamY;
  g.add(cyl(x, z, 0, top, 0.146, M.column));
  g.add(cyl(x, z, 0, 0.05, 0.32, M.steelDark), cyl(x, z, top - 0.06, top, 0.3, M.steelDark));
  if (o.column === 'asis') g.add(cyl(x, z, 1.2, 4.45, 0.2, M.foam));
  else if (o.column === 'rope') g.add(cyl(x, z, 0.12, 5.9, 0.215, M.rope));
  else { g.add(cyl(x, z, 0, 4.0, 0.34, std('#F2C230', 0.4, 0, 0.5)), cyl(x, z, 4.0, 4.06, 0.345, M.black)); }
}

/* ─── dimensions and notes overlays ────────────────────────────────────── */
let dimDefs = [];
let lineMat = null;
function buildDims() {
  const { W, D, H, T } = L, y = 0.03, off = T + 1.0, seg = [];
  const line = (a, b) => seg.push(a, b);
  line(V3(0, y, D + off), V3(W, y, D + off));
  line(V3(0, y, D + off - 0.35), V3(0, y, D + off + 0.35)); line(V3(W, y, D + off - 0.35), V3(W, y, D + off + 0.35));
  line(V3(-off, y, 0), V3(-off, y, D));
  line(V3(-off - 0.35, y, 0), V3(-off + 0.35, y, 0)); line(V3(-off - 0.35, y, D), V3(-off + 0.35, y, D));
  line(V3(W + off, 0, D + off), V3(W + off, H, D + off));
  line(V3(W + off - 0.3, H, D + off), V3(W + off + 0.3, H, D + off));
  if (!lineMat) lineMat = new THREE.LineBasicMaterial({ color: 0x5f666e, toneMapped: false });
  G.dims.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), lineMat));
  dimDefs = [
    { text: ftIn(W), pos: V3(W / 2, y, D + off) },
    { text: ftIn(D), pos: V3(-off, y, D / 2) },
    { text: ftIn(H) + ' ceiling', pos: V3(W + off, H / 2, D + off) },
  ];
}
function notes() {
  const { W, D, bw, bd } = L;
  return [
    { grp: 'back', kind: 'info', title: 'EV charger', pos: evPos ? evPos.clone() : V3(8.5, 5, 1.8),
      text: 'It hangs on the plywood built-in. Keep about 3 ft clear in front of it; if the built-ins come out, an electrician has to remount it on the wall.' },
    { grp: 'bump', kind: 'warn', title: 'Water damage at the base', pos: V3(W - bw - 0.05, 0.55, bd - 0.8),
      text: 'The drywall is peeling where it meets the floor next to the house door. Cut out the bottom 4–6 in., let it dry, patch it, and add vinyl cove base before any paint or panels.' },
    { grp: 'back', kind: 'info', title: 'Poured-concrete walls', pos: V3(6.1, 1.7, 0.08),
      text: 'The back wall and the curb under the window are foundation concrete. Seal them with DRYLOK first, and use Tapcon screws for anything you mount there.' },
    { grp: 'mech', kind: 'info', title: 'Door tracks and openers', pos: V3(L.doors[0][1] + 0.05, 7.55, D - 5.5),
      text: 'The open doors ride up here at about 7 ft 6 in. Keep ceiling storage north of the beam and clear of the tracks and opener rails.' },
    { grp: 'free', kind: 'info', title: 'Steel column', pos: V3(L.colX, 6.3, L.beamZ),
      text: 'It holds up the beam and the house above. Wrap it or guard it, but never cut, drill or weld it.' },
    { grp: 'west', kind: 'info', title: 'Window', pos: V3(0.1, 5.4, D - (L.win.s0 + L.win.s1) / 2),
      text: 'The only daylight in the garage. The sill is about 3 ft 5 in. up, so a 40 in. paint band lines up with it.' },
  ];
}
const overlay = $('#overlay');
let labels = [];
let tipEl = null;
let openTipIdx = -1;
function placeLabels() {
  overlay.textContent = '';
  labels = [];
  tipEl = null;
  if (S.notes) {
    notes().forEach((nt, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pin' + (nt.kind === 'warn' ? ' warn' : '');
      b.textContent = String(i + 1);
      b.setAttribute('aria-label', `Note ${i + 1}: ${nt.title}`);
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', e => { e.stopPropagation(); toggleTip(i); });
      overlay.appendChild(b);
      labels.push({ el: b, pos: nt.pos, grp: nt.grp, note: nt, i });
    });
    tipEl = document.createElement('div');
    tipEl.className = 'card tip';
    tipEl.hidden = true;
    tipEl.setAttribute('role', 'note');
    overlay.appendChild(tipEl);
    if (openTipIdx >= 0 && openTipIdx < labels.length) showTip(openTipIdx); else openTipIdx = -1;
  }
  if (S.dimsOn) {
    for (const d of dimDefs) {
      const el = document.createElement('div');
      el.className = 'dim-label';
      el.textContent = d.text;
      overlay.appendChild(el);
      labels.push({ el, pos: d.pos, grp: 'dims', dim: true });
    }
  }
  dirty = true;
}
function showTip(i) {
  openTipIdx = i;
  const lb = labels.find(l => l.i === i);
  if (!lb || !tipEl) return;
  tipEl.innerHTML = `<b>${esc(lb.note.title)}</b>${esc(lb.note.text)}`;
  tipEl.hidden = false;
  labels.forEach(l => l.note && l.el.setAttribute('aria-expanded', String(l.i === i)));
  dirty = true;
}
function hideTip() {
  openTipIdx = -1;
  if (tipEl) tipEl.hidden = true;
  labels.forEach(l => l.note && l.el.setAttribute('aria-expanded', 'false'));
}
function toggleTip(i) { if (openTipIdx === i) hideTip(); else showTip(i); }
document.addEventListener('click', e => { if (openTipIdx >= 0 && !e.target.closest('.tip') && !e.target.closest('.pin')) hideTip(); });

const _v = { x: 0, y: 0 };
let _p = null;
function updateOverlay() {
  if (!labels.length) return;
  const w = host.clientWidth, h = host.clientHeight;
  if (!_p) _p = new THREE.Vector3();
  for (const lb of labels) {
    _p.copy(lb.pos).project(camera);
    const grpVisible = lb.grp === 'dims' ? S.dimsOn : (G[lb.grp] ? G[lb.grp].visible : true);
    const vis = grpVisible && _p.z > -1 && _p.z < 1 && Math.abs(_p.x) < 1.02 && Math.abs(_p.y) < 1.02;
    lb.el.style.display = vis ? '' : 'none';
    lb.vis = vis;
    if (!vis) continue;
    _v.x = (_p.x + 1) / 2 * w; _v.y = (1 - _p.y) / 2 * h;
    lb.sx = _v.x; lb.sy = _v.y;
    lb.el.style.transform = lb.dim ? `translate(${_v.x.toFixed(1)}px, ${_v.y.toFixed(1)}px) translate(-50%, -50%)` : `translate(${_v.x.toFixed(1)}px, ${_v.y.toFixed(1)}px)`;
  }
  if (tipEl && openTipIdx >= 0) {
    const lb = labels.find(l => l.i === openTipIdx);
    if (!lb || !lb.vis) { tipEl.hidden = true; return; }
    tipEl.hidden = false;
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x = lb.sx + 18, y = lb.sy - th / 2;
    if (x + tw > w - 16) x = lb.sx - 18 - tw;
    x = clamp(x, 16, Math.max(16, w - tw - 16));
    y = clamp(y, 16, Math.max(16, h - th - 16));
    tipEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}

/* ─── camera ───────────────────────────────────────────────────────────── */
const PHOTOS = [
  { id: 'doors', src: '%%ASSET:ref-doors.jpg%%', label: 'From the doors', pose: () => ({ p: [10.6, 5.1, L.D - 1.7], t: [10.1, 2.7, L.D - 11.7], fov: 57 }) },
  { id: 'back', src: '%%ASSET:ref-back.jpg%%', label: 'Back wall', pose: () => ({ p: [3.4, 4.8, L.D - 5.5], t: [6.7, 4.8, L.D - 14.9], fov: 53 }) },
  { id: 'bikes', src: '%%ASSET:ref-bikes.jpg%%', label: 'Bike corner', pose: () => ({ p: [L.W - 3.7, 4.9, 6.0], t: [L.W - 12.6, 4.2, 1.5], fov: 53 }) },
  { id: 'entry', src: '%%ASSET:ref-entry.jpg%%', label: 'House door', pose: () => ({ p: [13.5, 5.0, 7.5], t: [17.9, 4.6, 9.8], fov: 57 }) },
];
const VIEWS = {
  overview: () => {
    const k = clamp(1.3 / (camera ? camera.aspect : 1.4), 1, 2);
    const t = [L.W * 0.41, 2.0, L.D * 0.45];
    return { p: [t[0] + (L.W * 0.59 + 10.5) * k, t[1] + 18.5 * k, t[2] + (L.D * 0.55 + 14) * k], t, fov: 40 };
  },
  doors: () => PHOTOS[0].pose(),
  back: () => ({ p: [L.W * 0.5, 5.3, L.D - 3.4], t: [L.W * 0.46, 4.1, 2.0], fov: 58 }),
  bikes: () => ({ p: [L.W - 2.6, 5.4, L.D * 0.48], t: [1.0, 4.0, L.D * 0.3], fov: 58 }),
  entry: () => ({ p: [3.2, 5.4, L.D * 0.5], t: [L.W - 1, 4.0, L.D * 0.55], fov: 58 }),
  plan: () => ({ p: [L.W / 2, 44, L.D / 2 + 0.05], t: [L.W / 2, 0, L.D / 2], fov: 40 }),
};
let tween = null;
function setView(v) {
  camera.position.set(...v.p);
  controls.target.set(...v.t);
  camera.fov = v.fov;
  camera.updateProjectionMatrix();
  controls.update();
  dirty = true;
}
function flyTo(v, dur = 1100) {
  if (!HAS3D) return;
  if (REDUCED) { tween = null; setView(v); return; }
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), f0: camera.fov, p1: V3(...v.p), t1: V3(...v.t), f1: v.fov, start: performance.now(), dur };
}
function cutaway() {
  const c = camera.position, { W, D, H } = L;
  G.front.visible = c.z <= D;
  G.back.visible = c.z >= 0;
  G.west.visible = c.x >= 0;
  G.east.visible = c.x <= W;
  G.bump.visible = c.x <= W && c.z >= 0;
  G.ceilPlane.visible = c.y <= H;
  G.mech.visible = c.y <= H + 0.3;
}
function loop(now) {
  requestAnimationFrame(loop);
  if (tween) {
    const k = clamp((now - tween.start) / tween.dur, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, e);
    controls.target.lerpVectors(tween.t0, tween.t1, e);
    camera.fov = tween.f0 + (tween.f1 - tween.f0) * e;
    camera.updateProjectionMatrix();
    dirty = true;
    if (k >= 1) tween = null;
  }
  if (controls.update()) dirty = true;
  if (dirty) {
    dirty = false;
    cutaway();
    renderer.render(scene, camera);
    updateOverlay();
  }
}
function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dirty = true;
}

/* ─── planner UI ───────────────────────────────────────────────────────── */
const openProds = new Set();
function prodLi(i) {
  const name = i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.name)}</a>` : `<span class="pname">${esc(i.name)}</span>`;
  const qty = i.unit === 'each' ? `${i.qty} × ${unitPrice(i.lo, i.hi)}` : `${i.qty} ${i.unit} × ${unitPrice(i.lo, i.hi)}`;
  const note = i.note ? ` Color: ${esc(i.note)}.` : '';
  return `<li>${name}<span class="p-meta">${qty} = ${priceRange(i.lo * i.qty, i.hi * i.qty)} · ${esc(i.store)}</span><span class="p-detail">${esc(i.detail)}${note}</span></li>`;
}
function renderGroup(el, key, o) {
  const def = GROUPS[key];
  const show = !def.when || def.when(o);
  el.hidden = !show;
  if (!show) { el.innerHTML = ''; return; }
  let html = '';
  if (def.type === 'choice') {
    const cur = o[key];
    html += `<div class="grp-head"><h4 id="g-${key}">${esc(def.title)}</h4></div>`;
    html += `<div class="choices" role="radiogroup" aria-labelledby="g-${key}">` + def.choices.map(c => {
      const cost = groupCost(key, c.id, o), on = c.id === cur;
      return `<button type="button" class="choice" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-key="${key}" data-val="${c.id}"><span class="c-label">${esc(c.label)}</span><span class="c-sub">${esc(c.sub)}</span><span class="c-price">${priceRange(cost.lo, cost.hi)}</span></button>`;
    }).join('') + '</div>';
    if (def.why && def.why[cur]) html += `<p class="why">${esc(def.why[cur])}</p>`;
  } else {
    const cur = swatch(key, o[key]);
    const cost = key === 'curb' ? groupCost('curb', o.curb, o) : null;
    html += `<div class="grp-head"><h4 id="g-${key}">${esc(def.title)}</h4><span class="note">${esc(cur.name)}${cur.code ? ' · ' + esc(cur.code) : ''}${cost && cost.hi > 0 ? ' · ' + priceRange(cost.lo, cost.hi) : ''}</span></div>`;
    html += `<div class="swatches" role="radiogroup" aria-labelledby="g-${key}">` + SW[key].map(s => {
      const on = s.id === cur.id, label = s.name + (s.code ? ' ' + s.code : '');
      return `<button type="button" class="sw${s.hex ? '' : ' none'}" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-key="${key}" data-val="${s.id}" style="--c:${s.hex || 'transparent'}" aria-label="${esc(label)}" title="${esc(label)}"></button>`;
    }).join('') + '</div>';
    if (typeof def.why === 'string') html += `<p class="why">${esc(def.why)}</p>`;
  }
  const items = lineItems(o, layout(S.dims)).filter(i => i.grp === key);
  if (items.length) {
    const s = total(items);
    html += `<details class="prods" data-prods="${key}"${openProds.has(key) ? ' open' : ''}><summary>${items.length} product${items.length > 1 ? 's' : ''} · ${priceRange(s.lo, s.hi)}</summary><ul class="prod-list">${items.map(prodLi).join('')}</ul></details>`;
  }
  el.innerHTML = html;
}
function renderPanel() {
  const o = S.opts;
  const active = PLANS.find(p => sameOpts(p.opts, o));
  $('#planCards').innerHTML = PLANS.map(p => {
    const c = costOf(p.opts), on = !!active && active.id === p.id;
    return `<button type="button" class="plan" role="radio" aria-checked="${on}" tabindex="${on || (!active && p.id === 'current') ? 0 : -1}" data-plan="${p.id}"><span class="plan-name">${esc(p.name)}</span><span class="plan-blurb">${esc(p.blurb)}</span><span class="plan-price mono">${priceRange(c.lo, c.hi)}</span></button>`;
  }).join('');
  $('#customNote').hidden = !!active;
  for (const el of $$('[data-group]')) renderGroup(el, el.dataset.group, o);
  const items = lineItems(o, layout(S.dims));
  for (const [sec, keys] of Object.entries(SECTIONS)) {
    const s = total(items.filter(i => keys.includes(i.grp)));
    $(`[data-sec-cost="${sec}"]`).textContent = s.hi > 0 ? priceRange(s.lo, s.hi) : '';
  }
  const t = total(items);
  $('#totalRange').textContent = priceRange(t.lo, t.hi);
  $('#listCount').textContent = String(items.length);
  $('#cmpNow').setAttribute('aria-pressed', String(S.compare === 'now'));
  $('#cmpPlan').setAttribute('aria-pressed', String(S.compare === 'plan'));
  $('#nowBanner').hidden = S.compare !== 'now';
}
function updateSizeText() {
  const { W, D, H } = S.dims;
  $('#sizeText').textContent = `${ftIn(W)} × ${ftIn(D)} × ${ftIn(H)}`;
  $('#hudDims').textContent = `${ftIn(W)} × ${ftIn(D)} · ${ftIn(H)} ceiling`;
}
function refocus(sel) { const el = $(sel); if (el) el.focus({ preventScroll: true }); }
function changed(focusSel) {
  save();
  build();
  renderPanel();
  if (focusSel) refocus(focusSel);
}
function setOpt(key, val) {
  if (S.opts[key] === val && S.compare === 'plan') return;
  S.opts[key] = val;
  S.compare = 'plan';
  changed(`[data-key="${key}"][data-val="${val}"]`);
}
function applyPlan(id) {
  const p = PLANS.find(x => x.id === id);
  if (!p) return;
  S.opts = { ...p.opts };
  S.compare = 'plan';
  changed(`[data-plan="${id}"]`);
}

$('#panel').addEventListener('click', e => {
  const b = e.target.closest('button[data-key]');
  if (b) { setOpt(b.dataset.key, b.dataset.val); return; }
  const p = e.target.closest('button[data-plan]');
  if (p) applyPlan(p.dataset.plan);
});
$('#panel').addEventListener('toggle', e => {
  const d = e.target;
  if (d.matches && d.matches('details[data-prods]')) { if (d.open) openProds.add(d.dataset.prods); else openProds.delete(d.dataset.prods); }
}, true);
$('#panel').addEventListener('keydown', e => {
  if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
  const b = e.target.closest('[role="radio"]');
  if (!b) return;
  const group = $$('[role="radio"]', b.parentElement);
  const i = group.indexOf(b), n = group.length;
  const next = group[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : n - 1)) % n];
  e.preventDefault();
  next.click();
});

$('#cmpNow').addEventListener('click', () => { if (S.compare === 'now') return; S.compare = 'now'; build(); renderPanel(); });
$('#cmpPlan').addEventListener('click', () => { if (S.compare === 'plan') return; S.compare = 'plan'; build(); renderPanel(); });

function markView(name) { $$('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name))); }
$$('[data-view]').forEach(b => b.addEventListener('click', () => { flyTo(VIEWS[b.dataset.view]()); markView(b.dataset.view); closeInset(); }));
function syncToggles() {
  $('#tglNotes').setAttribute('aria-pressed', String(S.notes));
  $('#tglDims').setAttribute('aria-pressed', String(S.dimsOn));
}
$('#tglNotes').addEventListener('click', () => { S.notes = !S.notes; if (!S.notes) hideTip(); syncToggles(); save(); if (HAS3D) placeLabels(); });
$('#tglDims').addEventListener('click', () => { S.dimsOn = !S.dimsOn; syncToggles(); save(); if (HAS3D) { G.dims.visible = S.dimsOn; placeLabels(); } });

// reference photos
function renderPhotos() {
  const html = PHOTOS.map(p => `<button type="button" class="thumb" data-photo="${p.id}" aria-pressed="false" aria-label="Compare with your photo: ${esc(p.label)}"><img src="${p.src}" alt="" loading="lazy"><span>${esc(p.label)}</span></button>`).join('');
  $('#hudPhotos').innerHTML = html;
  $('#panelPhotos').innerHTML = html;
}
function closeInset() {
  $('#inset').hidden = true;
  $$('[data-photo]').forEach(b => b.setAttribute('aria-pressed', 'false'));
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-photo]');
  if (!b) return;
  const p = PHOTOS.find(x => x.id === b.dataset.photo);
  $('#insetImg').src = p.src;
  $('#insetImg').alt = `Your photo: ${p.label}`;
  $('#insetCap').textContent = `Your photo · ${p.label}`;
  $('#inset').hidden = false;
  $$('[data-photo]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.photo === p.id)));
  markView(null);
  if (HAS3D) flyTo(p.pose(), 1300);
  if (window.matchMedia('(max-width: 899px)').matches) $('#stage').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
});
$('#insetClose').addEventListener('click', closeInset);

// size editor
const dimsForm = $('#dimsForm');
function fillDims() {
  const put = (id, v) => { const ft = Math.floor(v + 1e-6), inch = Math.round((v - ft) * 12); $('#' + id).value = inch === 12 ? ft + 1 : ft; $('#' + id + 'in').value = inch === 12 ? 0 : inch; };
  put('dimW', S.dims.W); put('dimD', S.dims.D); put('dimH', S.dims.H);
}
$('#editSize').addEventListener('click', () => {
  const open = dimsForm.hidden;
  dimsForm.hidden = !open;
  $('#editSize').setAttribute('aria-expanded', String(open));
  $('#dimsErr').hidden = true;
  if (open) { fillDims(); $('#dimW').focus(); }
});
dimsForm.addEventListener('submit', e => {
  e.preventDefault();
  const read = id => { const ft = parseFloat($('#' + id).value), inch = parseFloat($('#' + id + 'in').value || '0'); return Number.isFinite(ft) && Number.isFinite(inch) ? ft + inch / 12 : NaN; };
  const W = read('dimW'), D = read('dimD'), H = read('dimH');
  const err = $('#dimsErr');
  let msg = '';
  if (!(W >= 18 && W <= 26)) msg = 'Width needs to be between 18 and 26 ft; two 8 ft doors need at least 18 ft.';
  else if (!(D >= 18 && D <= 30)) msg = 'Depth needs to be between 18 and 30 ft.';
  else if (!(H >= 7.75 && H <= 10)) msg = 'Ceiling height needs to be between 7 ft 9 in. and 10 ft.';
  if (msg) { err.textContent = msg; err.hidden = false; return; }
  err.hidden = true;
  S.dims = { W, D, H };
  updateSizeText();
  changed();
  dimsForm.hidden = true;
  $('#editSize').setAttribute('aria-expanded', 'false');
  $('#editSize').focus();
});
$('#dimsReset').addEventListener('click', () => { S.dims = { ...DEFAULT_DIMS }; fillDims(); updateSizeText(); changed(); });

// shopping list
function listText() {
  const items = lineItems(S.opts, layout(S.dims)), t = total(items);
  const lines = ['Two-Bay Garage makeover: shopping list', ''];
  for (const sec of [...new Set(items.map(i => i.sec))]) {
    lines.push(sec.toUpperCase());
    for (const i of items.filter(x => x.sec === sec)) {
      lines.push(`- ${i.name}: ${i.qty} ${i.unit} at ${unitPrice(i.lo, i.hi)} = ${priceRange(i.lo * i.qty, i.hi * i.qty)} (${i.store})${i.note ? ', color ' + i.note : ''}`);
      if (i.url) lines.push(`  ${i.url}`);
    }
    lines.push('');
  }
  lines.push(`Materials estimate: ${priceRange(t.lo, t.hi)} (DIY prices, before tax and delivery)`);
  return lines.join('\n');
}
function renderList() {
  const items = lineItems(S.opts, layout(S.dims)), t = total(items);
  const body = $('#sheetBody');
  if (!items.length) {
    body.innerHTML = '<p class="empty">Nothing to buy yet: the plan matches the garage as photographed. Pick a plan or change an option to build a list.</p>';
  } else {
    body.innerHTML = '<p class="fine" style="margin-top:14px">Typical US prices for each item, not quotes. Quantities come from the model’s wall areas, so check them against your own measurements. Links open a store search.</p>' + [...new Set(items.map(i => i.sec))].map(sec => {
      const its = items.filter(i => i.sec === sec), s = total(its);
      return `<h3>${esc(sec)}<span>${priceRange(s.lo, s.hi)}</span></h3><ul class="prod-list">${its.map(prodLi).join('')}</ul>`;
    }).join('');
  }
  $('#sheetTotal').textContent = priceRange(t.lo, t.hi);
  $('#copyList').hidden = !items.length;
}
let lastFocus = null;
$('#openList').addEventListener('click', () => { lastFocus = document.activeElement; renderList(); $('#sheet').hidden = false; $('#closeList').focus(); });
function closeList() { $('#sheet').hidden = true; if (lastFocus) lastFocus.focus(); }
$('#closeList').addEventListener('click', closeList);
$('#sheet').addEventListener('click', e => { if (e.target === $('#sheet')) closeList(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#sheet').hidden) closeList();
  else if (openTipIdx >= 0) hideTip();
});
$('#copyList').addEventListener('click', () => {
  const text = listText(), btn = $('#copyList');
  const fallback = () => {
    let ta = $('.copy-fallback');
    if (!ta) { ta = document.createElement('textarea'); ta.className = 'copy-fallback'; ta.readOnly = true; ta.setAttribute('aria-label', 'Shopping list text'); $('#sheetBody').appendChild(ta); }
    ta.value = text; ta.focus(); ta.select();
    btn.textContent = 'Select all and copy';
  };
  try {
    navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy list'; }, 1800); }, fallback);
  } catch (err) { fallback(); }
});

/* ─── boot ─────────────────────────────────────────────────────────────── */
function boot() {
  renderPhotos();
  updateSizeText();
  syncToggles();
  renderPanel();
  if (HAS3D) {
    try { init3D(); } catch (err) { HAS3D = false; }
  }
  if (!HAS3D) {
    $('#loading').textContent = 'The 3D view needs WebGL and the three.js library, and one of them did not load. The planner and shopping list still work.';
    return;
  }
  makeTextures();
  makeMaterials();
  build();
  setView(VIEWS.doors());
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize);
  $('#loading').hidden = true;
  requestAnimationFrame(loop);
  if (REDUCED) setView(VIEWS.overview());
  else setTimeout(() => { if (!tween) { flyTo(VIEWS.overview(), 2600); markView('overview'); } }, 900);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 30));
else setTimeout(boot, 30);
})();
