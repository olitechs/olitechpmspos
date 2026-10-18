// Seed / mock data for the OliTechs POS prototype.
// Configuration (zones, tables, staff) is owner-editable via the admin
// screens and lives in AppStore; the values here are the seed defaults.

export const VAT_RATE = 0.16;

// Table display label — the Restaurant Room zone uses an R-prefix (R1, R2 …);
// every other zone keeps the T-prefix. Numbering stays independent per zone,
// and the convention applies automatically to tables added to Restaurant Room.
export const tablePrefix = (zoneId) => (zoneId === 'room' ? 'R' : 'T');
export const tableLabel = (table, zoneId) => `${tablePrefix(zoneId ?? table?.zoneId)}${table?.number ?? ''}`;

// Production center per menu category — used to route fired orders to the
// matching order printer (Kitchen / Bar / Dessert).
export const CATEGORY_CENTER = {
  Antipasti: 'Kitchen', Secondi: 'Kitchen', Pesce: 'Kitchen', Pizze: 'Kitchen', Contorni: 'Kitchen',
  Bibite: 'Bar', Dolci: 'Kitchen',
};
export const CENTERS = ['Kitchen', 'Bar'];

export const CATEGORIES = [
  'Antipasti', 'Secondi', 'Pesce', 'Pizze', 'Contorni', 'Bibite', 'Dolci',
];

export const MENU_ITEMS = {
  Antipasti: [
    { id: 'a1', name: 'Bruschetta al Pomodoro', price: 650 },
    { id: 'a2', name: 'Antipasto Misto', price: 1200 },
    { id: 'a3', name: 'Caprese Fresca', price: 950 },
    { id: 'a4', name: 'Zuppa di Pesce', price: 1100 },
    { id: 'a5', name: 'Carpaccio di Tonno', price: 1350 },
    { id: 'a6', name: 'Polpo alla Griglia', price: 1450 },
  ],
  Secondi: [
    { id: 's1', name: 'Filetto di Manzo', price: 2800 },
    { id: 's2', name: 'Pollo alla Griglia', price: 1800 },
    { id: 's3', name: 'Agnello al Forno', price: 2400 },
    { id: 's4', name: 'Costolette di Maiale', price: 2100 },
    { id: 's5', name: 'Vitello Saltimbocca', price: 2600 },
  ],
  Pesce: [
    { id: 'p1', name: 'Branzino alla Griglia', price: 2400 },
    { id: 'p2', name: 'Gamberi al Burro', price: 2200 },
    { id: 'p3', name: 'Calamari Fritti', price: 1600 },
    { id: 'p4', name: 'Aragosta del Giorno', price: 4500 },
    { id: 'p5', name: 'Salmone in Crosta', price: 2800 },
    { id: 'p6', name: 'Tilapia del Lago', price: 1900 },
  ],
  Pizze: [
    { id: 'z1', name: 'Margherita', price: 1100 },
    { id: 'z2', name: 'Diavola', price: 1300 },
    { id: 'z3', name: 'Quattro Stagioni', price: 1400 },
    { id: 'z4', name: 'Frutti di Mare', price: 1650 },
    { id: 'z5', name: 'Prosciutto e Funghi', price: 1350 },
    { id: 'z6', name: 'Bufala e Rucola', price: 1500 },
  ],
  Contorni: [
    { id: 'c1', name: 'Insalata Mista', price: 500 },
    { id: 'c2', name: 'Patate al Forno', price: 550 },
    { id: 'c3', name: 'Verdure Grigliate', price: 600 },
    { id: 'c4', name: 'Spinaci Saltati', price: 500 },
    { id: 'c5', name: 'Ugali wa Mahindi', price: 400 },
  ],
  Bibite: [
    { id: 'b1', name: 'Acqua Minerale 0.5L', price: 200 },
    { id: 'b2', name: 'Acqua Frizzante 0.5L', price: 200 },
    { id: 'b3', name: "Succo d'Arancia", price: 350 },
    { id: 'b4', name: 'Tusker Lager', price: 450 },
    { id: 'b5', name: 'Vino della Casa (calice)', price: 700 },
    { id: 'b6', name: 'Coca-Cola', price: 250 },
    { id: 'b7', name: 'Fanta', price: 250 },
    { id: 'b8', name: 'Cocktail del Tramonto', price: 900 },
  ],
  Dolci: [
    { id: 'd1', name: 'Tiramisù', price: 850 },
    { id: 'd2', name: 'Panna Cotta al Mango', price: 750 },
    { id: 'd3', name: 'Gelato Artigianale', price: 650 },
    { id: 'd4', name: 'Torta al Cioccolato', price: 800 },
    { id: 'd5', name: 'Frutta Fresca di Stagione', price: 600 },
  ],
};

export const RESERVATIONS_TONIGHT = 6;

// Floor-plan geometry used by Floor Plan + Floor Setup
export const TABLE_CARD = { w: 86, h: 64, pad: 16, stepX: 100, stepY: 82 };

function seedPos(n) {
  const col = (n - 1) % 5;
  const row = Math.floor((n - 1) / 5);
  return { x: TABLE_CARD.pad + col * TABLE_CARD.stepX, y: TABLE_CARD.pad + row * TABLE_CARD.stepY };
}
function makeTable(zoneId, n) {
  const p = seedPos(n);
  return { id: `${zoneId}-${n}`, number: n, seats: 4, x: p.x, y: p.y, w: TABLE_CARD.w, h: TABLE_CARD.h };
}
function makeZone(id, name, start, count) {
  return { id, name, tables: Array.from({ length: count }, (_, i) => makeTable(id, start + i)) };
}

// Default zones — numbering is independent per zone (Restaurant Room #5
// and Bar #5 are different tables). Owners can rename / add / remove.
export const INITIAL_ZONES = [
  makeZone('bar', 'Bar', 1, 20),
  makeZone('pool', 'Pool', 21, 20),
  makeZone('room', 'Restaurant Room', 1, 20),
];

export const INITIAL_STAFF = [
  { id: 's1', name: 'Amina Kariuki' },
  { id: 's2', name: 'John Mwangi' },
  { id: 's3', name: 'Grace Wanjiru' },
  { id: 's4', name: 'Peter Otieno' },
  { id: 's5', name: 'David Lumumba' },
];