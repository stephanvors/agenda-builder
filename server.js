import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { exec } from 'child_process';
import util from 'util';
import os from 'os';
import XLSX from 'xlsx';
import pg from 'pg';
import multer from 'multer';
import mammoth from 'mammoth';
import { parseRawText, buildFormattedDocx, convertDocxToPdf, generatePrintableHtml } from './formatterEngine.js';
import { checkDocText } from './spellcheckerEngine.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const execPromise = util.promisify(exec);

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const PRESETS_FILE = path.join(DATA_DIR, 'formatter-presets.json');
const DOCS_FILE = path.join(DATA_DIR, 'formatter-documents.json');
const EXCEL_FILE = path.join(__dirname, 'users', 'UserDetails.xlsx');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fsSync.existsSync(UPLOADS_DIR)) {
  fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const DEFAULT_CATEGORIES = [
  'Finances > Fee Collection & Debt Recovery',
  'Finances > Budget & Financial Management',
  'Finances > Fundraising & Alternative Revenue',
  'Infrastructure & Maintenance',
  'Curriculum & Academic Performance',
  'Human Resources & Staffing',
  'Parent & Community Engagement',
  'Governance & Policy',
  'Learner Welfare & Support',
  'Communication & Administration',
  'General'
];

const DEFAULT_DOCUMENT_TAGS = [
  'Meeting Documents', 'Policies', 'Presentations',
  'Finances', 'Financial & Budget Reports',
  'Curriculum', 'Infrastructure', 'General', 'Media',
  'Reports', 'Term 1', 'Term 2', 'Term 3', 'Term 4'
];

// Helper to check if a member has Admin privileges
function isAdminMember(member) {
  if (!member) return false;
  const name = (member.name || '').toLowerCase().trim();
  const role = (member.role || '').toLowerCase().trim();
  return name.includes('vorster') || role.includes('admin') || role.includes('principal') || role.includes('chairperson') || role.includes('smt') || role.includes('treasurer') || role.includes('finance') || role.includes('officer') || role.includes('sgb') || role.includes('deputy');
}

// Video formats allowed up to 500MB
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.3gp']);

function isVideoFile(mimetype, filename) {
  if (mimetype && mimetype.startsWith('video/')) return true;
  const ext = path.extname(filename || '').toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

// Multer disk storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\.]/g, '_').substring(0, 50);
    const uniqueName = `${Date.now()}-${uuidv4().substring(0, 8)}-${safeName}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500 MB hard limit (fine-grained 100MB check in handler)
  },
  fileFilter: (req, file, cb) => {
    const blockedExts = ['.exe', '.bat', '.cmd', '.sh', '.msi', '.vbs', '.js', '.mjs', '.ps1'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blockedExts.includes(ext)) {
      return cb(new Error('Executable file types are blocked for security'));
    }
    cb(null, true);
  }
});

// ── PIN Generation ──
function generatePin(existingPins) {
  let pin;
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000));
  } while (existingPins.has(pin));
  existingPins.add(pin);
  return pin;
}

// Fixed PIN mapping so members keep consistent PINs across restarts
const FIXED_PINS = {
  "Bennie Bekker": "3491",
  "Sakhile Belle": "8710",
  "Marcelle Botha": "6970",
  "Tersia Cock": "3531",
  "Hanlie Du Preez": "8671",
  "Kwezi Dyasi": "5836",
  "Anthony Engelbrecht": "6569",
  "Andile Gushmani": "4498",
  "Viljoen Mathee": "8395",
  "Marquin Scharneck": "4330",
  "Sylvia Swart": "1985",
  "Nellie Von Solms": "2727",
  "Stephen Vorster": "9079",
  "Charlene Vorster": "7791",
  "Noncedo Williams": "9830"
};

// ── Read members from Excel ──
function readMembersFromExcel() {
  const workbook = XLSX.readFile(EXCEL_FILE);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  let headerIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row && row.some(cell => String(cell).toLowerCase() === 'surname')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error('Could not find header row in Excel file');
  }

  const headers = rows[headerIndex].map(h => String(h).toLowerCase().trim());
  const surnameIdx = headers.indexOf('surname');
  const nameIdx = headers.indexOf('name');
  const titleIdx = headers.indexOf('title');
  const roleIdx = headers.indexOf('role');
  const contactIdx = headers.indexOf('contact');
  const emailIdx = headers.indexOf('e-mail');

  const members = [];
  const usedPins = new Set(Object.values(FIXED_PINS));

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[surnameIdx]) continue;

    const surname = String(row[surnameIdx] || '').trim();
    const name = String(row[nameIdx] || '').trim();
    const title = String(row[titleIdx] || '').trim();
    const role = String(row[roleIdx] || '').trim();
    const contact = String(row[contactIdx] || '').trim();
    const email = String(row[emailIdx] || '').trim();

    if (!surname || !name) continue;

    const fullName = `${name} ${surname}`;
    const pin = FIXED_PINS[fullName] || generatePin(usedPins);

    members.push({
      id: uuidv4(),
      name: fullName,
      title,
      role,
      contact,
      email,
      pin,
      registeredAt: new Date().toISOString()
    });
  }

  return members;
}

// ── Sync members from Excel into the store ──
async function syncMembersFromExcel() {
  try {
    const freshMembers = readMembersFromExcel();
    const store = await storeHelper.read();

    let added = 0, updated = 0;

    for (const fresh of freshMembers) {
      const existing = store.members.find(m => m.name === fresh.name);
      if (existing) {
        // Update mutable fields but keep id, pin (already deterministic), registeredAt
        existing.title   = fresh.title;
        existing.role    = fresh.role;
        existing.contact = fresh.contact;
        existing.email   = fresh.email;
        updated++;
      } else {
        store.members.push(fresh);
        added++;
      }
    }

    // Remove members no longer in the Excel (optional — comment out to keep them)
    const freshNames = new Set(freshMembers.map(m => m.name));
    const before = store.members.length;
    store.members = store.members.filter(m => freshNames.has(m.name));
    const removed = before - store.members.length;

    // Ensure meetingInfo has the current date
    store.meetingInfo = {
      title: 'SGB/SMT Strategy Meeting',
      date: '2026-08-27',
      school: 'LGAA',
      ...(store.meetingInfo || {}),
      date: '2026-08-27'
    };

    await storeHelper.write(store);
    console.log(`🔄 Members synced from Excel: +${added} added, ~${updated} updated, -${removed} removed. Total: ${store.members.length}`);
    return { added, updated, removed, total: store.members.length };
  } catch (err) {
    console.error('❌ Failed to sync members from Excel:', err.message);
    throw err;
  }
}

// ── Watch UserDetails.xlsx for changes (local dev) ──
function startExcelWatcher() {
  if (!fsSync.existsSync(EXCEL_FILE)) {
    console.warn(`⚠️  Excel file not found at ${EXCEL_FILE} — watcher not started`);
    return;
  }

  let debounceTimer = null;
  fsSync.watch(EXCEL_FILE, (eventType) => {
    if (eventType !== 'change') return;
    // Debounce: Excel writes the file multiple times on save
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      console.log(`📂 UserDetails.xlsx changed — syncing members...`);
      try {
        await syncMembersFromExcel();
      } catch (e) {
        console.error('Watcher sync failed:', e.message);
      }
    }, 800);
  });

  console.log(`👁️  Watching ${EXCEL_FILE} for changes...`);
}

// ── Dual Database Layer (PostgreSQL when DATABASE_URL is set, else JSON File) ──
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('🐘 PostgreSQL connected — persistent cloud database active');
}

function migrateFinanceCategories(store) {
  if (!store) return false;
  let changed = false;

  const agendaMap = {
    'fee collection & debt recovery': 'Finances > Fee Collection & Debt Recovery',
    'budget & financial management': 'Finances > Budget & Financial Management',
    'fundraising & alternative revenue': 'Finances > Fundraising & Alternative Revenue',
    'finance': 'Finances',
    'finances': 'Finances'
  };

  const docMap = {
    'financial & budget reports': 'Finances > Financial & Budget Reports',
    'finance': 'Finances',
    'finances': 'Finances'
  };

  // Migrate Agenda categories
  if (Array.isArray(store.categories)) {
    const updated = [];
    store.categories.forEach(cat => {
      const lower = (cat || '').toLowerCase().trim();
      const mapped = agendaMap[lower] || cat;
      if (mapped !== cat) changed = true;
      if (!updated.includes(mapped)) {
        updated.push(mapped);
      }
    });
    if (changed || updated.length !== store.categories.length) {
      store.categories = updated;
      changed = true;
    }
  }

  // Migrate Agenda items
  if (Array.isArray(store.agendaItems)) {
    store.agendaItems.forEach(item => {
      const lower = (item.category || '').toLowerCase().trim();
      if (agendaMap[lower] && item.category !== agendaMap[lower]) {
        item.category = agendaMap[lower];
        changed = true;
      }
    });
  }

  // Migrate Document categories -> tags
  if (Array.isArray(store.documentCategories) && !store.documentTags) {
    // Flatten each hierarchical category entry by splitting on ' > ', deduplicate
    const tagSet = new Set();
    store.documentCategories.forEach(cat => {
      cat.split(/\s*>\s*/).map(p => p.trim()).filter(Boolean).forEach(p => tagSet.add(p));
    });
    store.documentTags = [...tagSet];
    delete store.documentCategories;
    changed = true;
  }

  if (!Array.isArray(store.documentTags)) {
    store.documentTags = [...DEFAULT_DOCUMENT_TAGS];
    changed = true;
  }

  // Migrate Documents: doc.category -> doc.tags and ensure uploader name is in tags
  if (Array.isArray(store.documents)) {
    store.documents.forEach(doc => {
      if (doc.category && !doc.tags) {
        doc.tags = doc.category.split(/\s*>\s*/).map(p => p.trim()).filter(Boolean);
        delete doc.category;
        changed = true;
      }
      if (!Array.isArray(doc.tags)) {
        doc.tags = [];
        changed = true;
      }
      const uploaderName = (doc.uploadedBy?.memberName || '').trim();
      if (uploaderName && !doc.tags.some(t => t.toLowerCase() === uploaderName.toLowerCase())) {
        doc.tags.push(uploaderName);
        changed = true;
      }
      if (uploaderName && !store.documentTags.some(t => t.toLowerCase() === uploaderName.toLowerCase())) {
        store.documentTags.push(uploaderName);
        changed = true;
      }
    });
  }

  return changed;
}

const storeHelper = {
  async init() {
    if (pool) {
      // Initialize PostgreSQL tables
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_store (
          id VARCHAR(50) PRIMARY KEY,
          data JSONB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_files (
          id VARCHAR(100) PRIMARY KEY,
          filename TEXT,
          mimetype TEXT,
          file_data BYTEA,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      
      const res = await pool.query('SELECT data FROM app_store WHERE id = $1', ['main_store']);
      if (res.rows.length === 0) {
        console.log('📊 Seeding initial data into PostgreSQL...');
        const members = readMembersFromExcel();
        const initialStore = {
          members,
          sessions: [],
          agendaItems: [],
          documents: [],
          categories: [...DEFAULT_CATEGORIES],
          documentTags: [...DEFAULT_DOCUMENT_TAGS],
          meetingInfo: {
            title: 'SGB/SMT Strategy Meeting',
            date: '2026-08-27',
            school: 'LGAA'
          }
        };
        migrateFinanceCategories(initialStore);
        await pool.query('INSERT INTO app_store (id, data) VALUES ($1, $2)', ['main_store', JSON.stringify(initialStore)]);
        console.log(`✅ ${members.length} members initialized in PostgreSQL`);
        console.log('✅ Persistent store loaded — syncing member details from Excel...');
        // Always sync titles/roles/contacts from Excel so spreadsheet changes apply on redeploy
        await syncMembersFromExcel();

        // Clean up orphan document records in PostgreSQL that have no corresponding file data in app_files and not on disk
        try {
          const fileRows = await pool.query('SELECT id FROM app_files');
          const validIds = new Set(fileRows.rows.map(r => r.id));
          const currentStore = JSON.parse(res.rows[0].data);
          if (Array.isArray(currentStore.documents) && currentStore.documents.length > 0) {
            const beforeCount = currentStore.documents.length;
            currentStore.documents = currentStore.documents.filter(d => {
              const inDb = validIds.has(d.id);
              const onDisk = Boolean(d.storedName && fsSync.existsSync(path.join(UPLOADS_DIR, d.storedName)));
              return inDb || onDisk;
            });
            if (currentStore.documents.length !== beforeCount) {
              await pool.query('UPDATE app_store SET data = $1 WHERE id = $2', [JSON.stringify(currentStore), 'main_store']);
              console.log(`🧹 Cleaned up ${beforeCount - currentStore.documents.length} orphan/missing document records from PostgreSQL store`);
            }
          }
        } catch (cleanErr) {
          console.error('Error cleaning orphan document records on startup:', cleanErr.message);
        }
      }
      return;
    }

    // JSON file fallback
    try {
      await fs.access(DATA_DIR);
    } catch {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }

    try {
      await fs.access(STORE_FILE);
      const data = await fs.readFile(STORE_FILE, 'utf-8');
      const store = JSON.parse(data);
      if (store.members && store.members.length > 0 && store.members[0].pin) {
        if (migrateFinanceCategories(store)) {
          await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2));
        }
        return;
      }
    } catch { /* create fresh */ }

    const members = readMembersFromExcel();
    const store = {
      members,
      sessions: [],
      agendaItems: [],
      documents: [],
      categories: [...DEFAULT_CATEGORIES],
      documentTags: [...DEFAULT_DOCUMENT_TAGS],
      meetingInfo: {
        title: 'SGB/SMT Strategy Meeting',
        date: '2026-08-27',
        school: 'LGAA'
      }
    };
    migrateFinanceCategories(store);
    await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2));
  },

  async read() {
    let store = null;
    if (pool) {
      const res = await pool.query('SELECT data FROM app_store WHERE id = $1', ['main_store']);
      if (res.rows.length > 0) {
        store = res.rows[0].data;
      }
    }
    if (!store) {
      const data = await fs.readFile(STORE_FILE, 'utf-8');
      store = JSON.parse(data);
    }
    if (!Array.isArray(store.documents)) {
      store.documents = [];
    }
    if (!Array.isArray(store.categories) || store.categories.length === 0) {
      store.categories = [...DEFAULT_CATEGORIES];
    }
    if (!Array.isArray(store.documentTags) || store.documentTags.length === 0) {
      store.documentTags = [...DEFAULT_DOCUMENT_TAGS];
    }

    // Ensure every document has a tags array (backward compat for docs with old category field)
    store.documents.forEach(d => {
      if (!Array.isArray(d.tags)) {
        d.tags = d.category ? d.category.split(/\s*>\s*/).map(p => p.trim()).filter(Boolean) : [];
      }
    });

    if (migrateFinanceCategories(store)) {
      await this.write(store);
    }

    return store;
  },

  async write(data) {
    if (pool) {
      await pool.query(
        'INSERT INTO app_store (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2',
        ['main_store', JSON.stringify(data)]
      );
      return;
    }
    await fs.writeFile(STORE_FILE, JSON.stringify(data, null, 2));
  }
};

// ── Status Logic ──
function determineStatus(voteCount) {
  if (voteCount >= 5) return 'endorsed';
  if (voteCount >= 2) return 'seconded';
  return 'proposed';
}

// ── Express App ──
const app = express();
app.use(express.json());
// ── Direct Zero-Cache Route for Doc Formatter ──
app.get(['/doc-formatter', '/doc-formatter.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'doc-formatter.html'));
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

app.use((req, res, next) => {
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// ── Auth Middleware ──
async function requireAuth(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const store = await storeHelper.read();
  const session = store.sessions.find(s => s.token === token);

  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  const member = store.members.find(m => m.id === session.memberId);
  if (!member) {
    return res.status(401).json({ error: 'Member not found. Please log in again.' });
  }

  req.member = member;
  req.store = store;
  next();
}

// ── Public Endpoints ──

const APP_VERSION = '20260821-40';

app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

// Login with name + PIN
app.post('/api/login', async (req, res) => {
  try {
    const { memberId, pin } = req.body;

    if (!memberId || !pin) {
      return res.status(400).json({ error: 'Please select your name and enter your PIN' });
    }

    const store = await storeHelper.read();
    const member = store.members.find(m => m.id === memberId);

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    if (member.pin !== String(pin).trim()) {
      return res.status(401).json({ error: 'Incorrect PIN. Please try again.' });
    }

    // Keep session active / update
    store.sessions = store.sessions.filter(s => s.memberId !== member.id);
    const token = uuidv4();
    store.sessions.push({
      token,
      memberId: member.id,
      createdAt: new Date().toISOString()
    });

    await storeHelper.write(store);

    res.json({
      token,
      member: {
        id: member.id,
        name: member.name,
        title: member.title,
        role: member.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Member list (no PINs, for dropdown)
app.get('/api/members/list', async (req, res) => {
  try {
    const store = await storeHelper.read();
    const list = store.members.map(m => ({
      id: m.id,
      name: m.name,
      title: m.title,
      role: m.role
    }));
    res.json(list);
  } catch (error) {
    console.error('Error fetching member list:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify session
app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    id: req.member.id,
    name: req.member.name,
    title: req.member.title,
    role: req.member.role
  });
});

// Logout
app.post('/api/logout', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    store.sessions = store.sessions.filter(s => s.memberId !== req.member.id);
    await storeHelper.write(store);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Protected Endpoints ──

// Get all members (authenticated)
app.get('/api/members', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const list = store.members.map(m => ({
      id: m.id,
      name: m.name,
      title: m.title,
      role: m.role,
      contact: m.contact,
      email: m.email
    }));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get items
app.get('/api/items', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const sortedItems = [...store.agendaItems].map(i => ({
      ...i,
      votes: Array.isArray(i.votes) ? i.votes : [],
      comments: Array.isArray(i.comments) ? i.comments : [],
      isResolved: Boolean(i.isResolved),
      resolution: i.resolution || null
    })).sort((a, b) => (b.votes ? b.votes.length : 0) - (a.votes ? a.votes.length : 0));
    res.json(sortedItems);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create item
app.post('/api/items', requireAuth, async (req, res) => {
  try {
    const { title, description, category } = req.body;
    const member = req.member;

    if (!title || !description || !category) {
      return res.status(400).json({ error: 'Title, description, and category are required' });
    }

    const store = req.store;
    const availableCategories = store.categories || DEFAULT_CATEGORIES;
    if (!availableCategories.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Must be one of: ${availableCategories.join(', ')}` });
    }

    const now = new Date().toISOString();

    const newItem = {
      id: uuidv4(),
      title: title.trim(),
      description: description.trim(),
      category,
      proposedBy: {
        memberId: member.id,
        memberName: member.name,
        memberRole: member.role
      },
      proposedAt: now,
      votes: [{
        memberId: member.id,
        memberName: member.name,
        votedAt: now
      }],
      status: determineStatus(1),
      isResolved: false,
      resolution: null,
      comments: []
    };

    store.agendaItems.push(newItem);
    await storeHelper.write(store);

    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error creating item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Vote
app.post('/api/items/:id/vote', requireAuth, async (req, res) => {
  try {
    const member = req.member;
    const store = req.store;
    const item = store.agendaItems.find(i => i.id === req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Agenda item not found' });
    }

    if (!Array.isArray(item.votes)) {
      item.votes = [];
    }

    const memberName = (member.name || '').toLowerCase().trim();
    if (item.votes.some(v => v.memberId === member.id || (v.memberName && v.memberName.toLowerCase().trim() === memberName))) {
      return res.status(409).json({ error: 'You have already voted for this item' });
    }

    item.votes.push({
      memberId: member.id,
      memberName: member.name,
      votedAt: new Date().toISOString()
    });

    item.status = determineStatus(item.votes.length);
    await storeHelper.write(store);

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove vote
app.delete('/api/items/:id/vote', requireAuth, async (req, res) => {
  try {
    const member = req.member;
    const store = req.store;
    const item = store.agendaItems.find(i => i.id === req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Agenda item not found' });
    }

    if (!Array.isArray(item.votes)) {
      item.votes = [];
    }

    const memberName = (member.name || '').toLowerCase().trim();
    const voteIndex = item.votes.findIndex(v => v.memberId === member.id || (v.memberName && v.memberName.toLowerCase().trim() === memberName));
    if (voteIndex === -1) {
      return res.status(404).json({ error: 'You have not voted for this item' });
    }

    item.votes.splice(voteIndex, 1);
    item.status = determineStatus(item.votes.length);
    await storeHelper.write(store);

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete item
app.delete('/api/items/:id', requireAuth, async (req, res) => {
  try {
    const member = req.member;
    const store = req.store;
    const itemIndex = store.agendaItems.findIndex(i => i.id === req.params.id);

    if (itemIndex === -1) {
      return res.status(404).json({ error: 'Agenda item not found' });
    }

    const item = store.agendaItems[itemIndex];
    if (item.proposedBy.memberId !== member.id) {
      return res.status(403).json({ error: 'Only the proposer can withdraw this item' });
    }

    store.agendaItems.splice(itemIndex, 1);
    await storeHelper.write(store);

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Comments & Brainstorming Endpoints ──

// Add comment to an item
app.post('/api/items/:id/comments', requireAuth, async (req, res) => {
  try {
    const { content, type } = req.body;
    const member = req.member;
    const store = req.store;
    const item = store.agendaItems.find(i => i.id === req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Agenda item not found' });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content cannot be empty' });
    }

    const validTypes = ['comment', 'idea', 'action', 'question'];
    const commentType = validTypes.includes(type) ? type : 'comment';

    if (!Array.isArray(item.comments)) {
      item.comments = [];
    }

    const newComment = {
      id: uuidv4(),
      memberId: member.id,
      memberName: member.name,
      memberRole: member.role,
      content: content.trim(),
      type: commentType,
      isSolution: false,
      createdAt: new Date().toISOString()
    };

    item.comments.push(newComment);
    await storeHelper.write(store);

    res.status(201).json(item);
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit a comment (only author can edit)
app.patch('/api/items/:itemId/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const { content, type } = req.body;
    const member = req.member;
    const store = req.store;
    const item = store.agendaItems.find(i => i.id === req.params.itemId);

    if (!item) {
      return res.status(404).json({ error: 'Agenda item not found' });
    }

    if (!Array.isArray(item.comments)) {
      item.comments = [];
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = item.comments.find(c => c.id === req.params.commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Only the comment's author can edit their own comment
    if (comment.memberId !== member.id) {
      return res.status(403).json({ error: 'You can only edit your own comments' });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content cannot be empty' });
    }

    const validTypes = ['comment', 'idea', 'action', 'question'];
    if (type && validTypes.includes(type)) {
      comment.type = type;
    }

    comment.content = content.trim();
    comment.editedAt = new Date().toISOString();

    // If this comment is the marked resolution, update resolution text too
    if (item.resolution && item.resolution.commentId === comment.id) {
      item.resolution.text = comment.content;
    }

    await storeHelper.write(store);

    res.json(item);
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a comment
app.delete('/api/items/:itemId/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const member = req.member;
    const store = req.store;
    const item = store.agendaItems.find(i => i.id === req.params.itemId);

    if (!item) {
      return res.status(404).json({ error: 'Agenda item not found' });
    }

    if (!Array.isArray(item.comments)) {
      item.comments = [];
      return res.status(404).json({ error: 'Comment not found' });
    }

    const commentIndex = item.comments.findIndex(c => c.id === req.params.commentId);
    if (commentIndex === -1) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = item.comments[commentIndex];
    const isCommentAuthor = comment.memberId === member.id;
    const isItemProposer = item.proposedBy.memberId === member.id;

    if (!isCommentAuthor && !isItemProposer) {
      return res.status(403).json({ error: 'You can only delete your own comments' });
    }

    // If this comment was the marked resolution, clear the resolution flag
    if (comment.isSolution || (item.resolution && item.resolution.commentId === comment.id)) {
      item.isResolved = false;
      item.resolution = null;
    }

    item.comments.splice(commentIndex, 1);
    await storeHelper.write(store);

    res.json(item);
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark an item as resolved (with solution text and optional commentId)
app.post('/api/items/:id/resolve', requireAuth, async (req, res) => {
  try {
    const { solutionText, commentId } = req.body;
    const member = req.member;
    const store = req.store;
    const item = store.agendaItems.find(i => i.id === req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Agenda item not found' });
    }

    if (!solutionText || !solutionText.trim()) {
      return res.status(400).json({ error: 'Resolution or solution text is required' });
    }

    item.isResolved = true;
    item.resolution = {
      solutionText: solutionText.trim(),
      commentId: commentId || null,
      resolvedBy: {
        memberId: member.id,
        memberName: member.name,
        memberRole: member.role
      },
      resolvedAt: new Date().toISOString()
    };

    if (Array.isArray(item.comments)) {
      item.comments.forEach(c => {
        c.isSolution = (commentId && c.id === commentId);
      });
    }

    await storeHelper.write(store);
    res.json(item);
  } catch (error) {
    console.error('Error resolving item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reopen / clear resolution on an item
app.delete('/api/items/:id/resolve', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const item = store.agendaItems.find(i => i.id === req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Agenda item not found' });
    }

    item.isResolved = false;
    item.resolution = null;

    if (Array.isArray(item.comments)) {
      item.comments.forEach(c => {
        c.isSolution = false;
      });
    }

    await storeHelper.write(store);
    res.json(item);
  } catch (error) {
    console.error('Error clearing resolution:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
}

function normalizeCategoryPath(name, parent) {
  let full = (parent ? `${parent.trim()} > ` : '') + (name ? name.trim() : '');
  const segments = full
    .split(/\s*>\s*|\s*\/\s*/)
    .map(s => s.trim())
    .filter(Boolean);
  
  if (segments.length === 0) return '';
  if (segments.length > 3) {
    throw new Error('Categories support a maximum of 3 levels of nesting (Main Category > Subcategory > Topic)');
  }
  return segments.join(' > ');
}

function sendDocumentErrorResponse(res, req, doc, message) {
  const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
  if (acceptsHtml) {
    const docTitle = doc ? (doc.title || doc.originalName || 'Document') : 'Document';
    const docName = doc ? (doc.originalName || '') : '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document Not Found - LGAA Agenda</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0B132B;
      color: #F8FAFC;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .error-card {
      background: #1C2541;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 18px;
      padding: 36px 28px;
      max-width: 500px;
      width: 100%;
      text-align: center;
      box-shadow: 0 24px 48px rgba(0,0,0,0.5);
    }
    .error-icon {
      font-size: 54px;
      margin-bottom: 16px;
      line-height: 1;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 12px;
      color: #FFFFFF;
    }
    p {
      font-size: 14px;
      color: #94A3B8;
      line-height: 1.6;
      margin-bottom: 20px;
    }
    .highlight-box {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px;
      text-align: left;
      font-size: 13px;
      color: #FECACA;
    }
    .highlight-title {
      font-weight: 700;
      color: #FFFFFF;
      font-size: 14px;
      margin-bottom: 4px;
      word-break: break-word;
    }
    .highlight-desc {
      color: #FCA5A5;
      font-size: 12.5px;
      line-height: 1.5;
    }
    .btn-group {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 22px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #3B82F6, #1D4ED8);
      color: #FFFFFF;
    }
    .btn-primary:hover {
      opacity: 0.95;
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: #334155;
      color: #CBD5E1;
    }
    .btn-secondary:hover {
      background: #475569;
      color: #FFFFFF;
    }
  </style>
</head>
<body>
  <div class="error-card">
    <div class="error-icon">📁⚠️</div>
    <h1>Document Not Available</h1>
    <div class="highlight-box">
      <div class="highlight-title">${escapeHtml(docTitle)}</div>
      ${docName ? `<div style="font-size:11px;color:#94A3B8;font-family:monospace;margin-bottom:6px;">${escapeHtml(docName)}</div>` : ''}
      <div class="highlight-desc">This physical file is not found on the server. If this file was uploaded before database persistence was active, please remove this item and re-upload the document.</div>
    </div>
    <p>You can return to the Document Vault to upload or manage files.</p>
    <div class="btn-group">
      <a href="/" class="btn btn-primary">Return to Document Vault</a>
      <button onclick="window.close()" class="btn btn-secondary">Close Tab</button>
    </div>
  </div>
</body>
</html>`);
  }
  return res.status(404).json({ error: message || 'File not found on server. Please re-upload this document.' });
}

// ── Shared Documents & Files Endpoints ──

// List all documents
app.get('/api/documents', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    if (!Array.isArray(store.documents)) {
      store.documents = [];
    }

    let existingFileIds = new Set();
    if (pool) {
      try {
        const fileRows = await pool.query('SELECT id FROM app_files');
        fileRows.rows.forEach(r => existingFileIds.add(r.id));
      } catch (e) {
        console.error('Error checking existing file IDs in DB:', e.message);
      }
    }

    const validDocs = [];
    let needPrune = false;
    for (const d of store.documents) {
      const existsOnDisk = Boolean(d.storedName && fsSync.existsSync(path.join(UPLOADS_DIR, d.storedName)));
      const existsInDb = existingFileIds.has(d.id);
      const isAvailable = (pool ? existsInDb : existsOnDisk) || existsInDb || existsOnDisk;
      if (isAvailable) {
        validDocs.push({
          ...d,
          isAvailable: true
        });
      } else {
        needPrune = true;
      }
    }

    if (needPrune) {
      store.documents = validDocs;
      storeHelper.write(store).catch(err => console.error('Error auto-pruning missing documents:', err.message));
    }

    // Return newest first
    const sorted = [...validDocs].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json({
      documents: sorted,
      tags: store.documentTags || DEFAULT_DOCUMENT_TAGS
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload a document (100MB general / 500MB video)
app.post('/api/documents/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File exceeds maximum upload limit (500 MB for video / 100 MB for documents)' });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Please choose a file to upload' });
      }

      const { title, tags: tagsRaw, description } = req.body;
      const member = req.member;
      const store = req.store;

      const isVideo = isVideoFile(req.file.mimetype, req.file.originalname);
      const maxAllowedBytes = isVideo ? 500 * 1024 * 1024 : 100 * 1024 * 1024;

      if (req.file.size > maxAllowedBytes) {
        try { await fs.unlink(req.file.path); } catch { /* ignore */ }
        return res.status(400).json({
          error: `File exceeds maximum allowed size of ${isVideo ? '500MB' : '100MB'} for this file type`
        });
      }

      let parsedTags = [];
      try { parsedTags = JSON.parse(tagsRaw || '[]'); } catch { parsedTags = []; }
      parsedTags = parsedTags.filter(t => t && t.trim());

      const memberName = (member.name || '').trim();
      if (memberName && !parsedTags.some(t => t.toLowerCase() === memberName.toLowerCase())) {
        parsedTags.push(memberName);
      }

      if (!Array.isArray(store.documentTags)) {
        store.documentTags = [...DEFAULT_DOCUMENT_TAGS];
      }
      if (memberName && !store.documentTags.some(t => t.toLowerCase() === memberName.toLowerCase())) {
        store.documentTags.push(memberName);
      }

      const finalTitle = (title && title.trim()) ? title.trim() : req.file.originalname;

      const newDoc = {
        id: uuidv4(),
        title: finalTitle,
        description: (description || '').trim(),
        tags: parsedTags,
        originalName: req.file.originalname,
        storedName: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype,
        extension: path.extname(req.file.originalname).toLowerCase().replace(/^\./, ''),
        isVideo,
        uploadedBy: {
          memberId: member.id,
          memberName: member.name,
          memberRole: member.role
        },
        uploadedAt: new Date().toISOString()
      };

      if (!Array.isArray(store.documents)) {
        store.documents = [];
      }

      // Persist binary file data in PostgreSQL
      if (pool) {
        try {
          const fileBuffer = await fs.readFile(req.file.path);
          await pool.query(
            'INSERT INTO app_files (id, filename, mimetype, file_data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET filename = $2, mimetype = $3, file_data = $4',
            [newDoc.id, req.file.originalname, req.file.mimetype, fileBuffer]
          );
        } catch (dbErr) {
          console.error('Failed to store file binary in PostgreSQL:', dbErr);
          if (req.file && req.file.path) {
            try { await fs.unlink(req.file.path); } catch { /* ignore */ }
          }
          return res.status(500).json({ error: 'Failed to persist document binary into database. ' + (dbErr.message || '') });
        }
      }

      store.documents.push(newDoc);
      await storeHelper.write(store);

      res.status(201).json({ ...newDoc, isAvailable: true });
    } catch (error) {
      console.error('Error saving uploaded document:', error);
      if (req.file && req.file.path) {
        try { await fs.unlink(req.file.path); } catch { /* ignore */ }
      }
      res.status(500).json({ error: 'Failed to save document' });
    }
  });
});

// Download a document
app.get('/api/documents/:id/download', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    if (!Array.isArray(store.documents)) return sendDocumentErrorResponse(res, req, null, 'Document not found');

    const doc = store.documents.find(d => d.id === req.params.id);
    if (!doc) return sendDocumentErrorResponse(res, req, null, 'Document not found');

    let fileBuffer = null;
    let mimeType = doc.mimeType || 'application/octet-stream';

    // 1. Try PostgreSQL database storage
    if (pool) {
      try {
        const dbRes = await pool.query('SELECT file_data, mimetype FROM app_files WHERE id = $1', [doc.id]);
        if (dbRes.rows.length > 0 && dbRes.rows[0].file_data) {
          fileBuffer = dbRes.rows[0].file_data;
          if (dbRes.rows[0].mimetype) mimeType = dbRes.rows[0].mimetype;
        }
      } catch (e) {
        console.error('Error reading file from DB:', e.message);
      }
    }

    // 2. Try disk storage fallback
    if (!fileBuffer) {
      const filePath = path.join(UPLOADS_DIR, doc.storedName);
      if (fsSync.existsSync(filePath)) {
        fileBuffer = await fs.readFile(filePath);
      }
    }

    if (!fileBuffer) {
      return sendDocumentErrorResponse(res, req, doc, 'File not found on server. Please re-upload this document.');
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.originalName)}"`);
    res.end(fileBuffer);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Inline view / stream a document (supports HTTP Range for video)
app.get('/api/documents/:id/view', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    if (!Array.isArray(store.documents)) return sendDocumentErrorResponse(res, req, null, 'Document not found');

    const doc = store.documents.find(d => d.id === req.params.id);
    if (!doc) return sendDocumentErrorResponse(res, req, null, 'Document not found');

    let fileBuffer = null;
    let mimeType = doc.mimeType || 'application/octet-stream';

    // 1. Try PostgreSQL database storage
    if (pool) {
      try {
        const dbRes = await pool.query('SELECT file_data, mimetype FROM app_files WHERE id = $1', [doc.id]);
        if (dbRes.rows.length > 0 && dbRes.rows[0].file_data) {
          fileBuffer = dbRes.rows[0].file_data;
          if (dbRes.rows[0].mimetype) mimeType = dbRes.rows[0].mimetype;
        }
      } catch (e) {
        console.error('Error reading file from DB:', e.message);
      }
    }

    // 2. Try disk storage fallback
    if (!fileBuffer) {
      const filePath = path.join(UPLOADS_DIR, doc.storedName);
      if (fsSync.existsSync(filePath)) {
        fileBuffer = await fs.readFile(filePath);
      }
    }

    if (!fileBuffer) {
      return sendDocumentErrorResponse(res, req, doc, 'File not found on server. Please re-upload this document.');
    }

    const fileSize = fileBuffer.length;
    const range = req.headers.range;

    if (range && doc.isVideo) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const chunk = fileBuffer.subarray(start, end + 1);
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType || 'video/mp4',
      });
      res.end(chunk);
    } else {
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalName)}"`);
      res.end(fileBuffer);
    }
  } catch (error) {
    console.error('Error streaming/viewing file:', error);
    res.status(500).json({ error: 'Failed to stream/view file' });
  }
});

// Edit / Update a document
app.put('/api/documents/:id', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File exceeds maximum upload size (100MB)' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const member = req.member;
    const store = req.store;
    if (!Array.isArray(store.documents)) return res.status(404).json({ error: 'Document not found' });

    const doc = store.documents.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const isUploader = doc.uploadedBy?.memberId === member.id;
    const isPrivileged = isAdminMember(member);

    if (!isUploader && !isPrivileged) {
      return res.status(403).json({ error: 'You can only edit documents you uploaded' });
    }

    const { title, tags: tagsRaw, description } = req.body;

    if (title && title.trim()) {
      doc.title = title.trim();
    }

    if (description !== undefined) {
      doc.description = (description || '').trim();
    }

    if (tagsRaw !== undefined) {
      let parsedTags = [];
      try { parsedTags = typeof tagsRaw === 'string' ? JSON.parse(tagsRaw) : tagsRaw; } catch { parsedTags = []; }
      if (Array.isArray(parsedTags)) {
        parsedTags = parsedTags.filter(t => t && t.trim());
        // Ensure uploader name is always preserved as a tag
        const uploaderName = (doc.uploadedBy?.memberName || member.name || '').trim();
        if (uploaderName && !parsedTags.some(t => t.toLowerCase() === uploaderName.toLowerCase())) {
          parsedTags.push(uploaderName);
        }
        doc.tags = parsedTags;

        // Register any new tags in store.documentTags
        if (!Array.isArray(store.documentTags)) store.documentTags = [...DEFAULT_DOCUMENT_TAGS];
        parsedTags.forEach(t => {
          if (!store.documentTags.some(dt => dt.toLowerCase() === t.toLowerCase())) {
            store.documentTags.push(t);
          }
        });
      }
    }

    // If a replacement file was uploaded
    if (req.file) {
      const isVideo = isVideoFile(req.file.mimetype, req.file.originalname);
      const maxAllowedBytes = isVideo ? 500 * 1024 * 1024 : 100 * 1024 * 1024;
      if (req.file.size > maxAllowedBytes) {
        try { await fs.unlink(req.file.path); } catch { /* ignore */ }
        return res.status(400).json({
          error: `File exceeds maximum allowed size of ${isVideo ? '500MB' : '100MB'} for this file type`
        });
      }

      // Delete old disk file if present
      if (doc.storedName) {
        const oldFilePath = path.join(UPLOADS_DIR, doc.storedName);
        try {
          if (fsSync.existsSync(oldFilePath)) await fs.unlink(oldFilePath);
        } catch (e) { /* ignore */ }
      }

      doc.originalName = req.file.originalname;
      doc.storedName = req.file.filename;
      doc.size = req.file.size;
      doc.mimeType = req.file.mimetype;
      doc.extension = path.extname(req.file.originalname).toLowerCase().replace(/^\./, '');
      doc.isVideo = isVideo;

      // Update binary in PostgreSQL
      if (pool) {
        try {
          const fileBuffer = await fs.readFile(req.file.path);
          await pool.query(
            'INSERT INTO app_files (id, filename, mimetype, file_data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET filename = $2, mimetype = $3, file_data = $4',
            [doc.id, req.file.originalname, req.file.mimetype, fileBuffer]
          );
        } catch (dbErr) {
          console.error('Error updating replaced file in PostgreSQL:', dbErr.message);
        }
      }
    }

    doc.updatedAt = new Date().toISOString();
    doc.updatedBy = {
      memberId: member.id,
      memberName: member.name,
      memberRole: member.role
    };

    await storeHelper.write(store);

    res.json({ message: 'Document updated successfully', document: doc });
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({ error: error.message || 'Failed to update document' });
  }
});

// Delete a document
app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const member = req.member;
    const store = req.store;
    if (!Array.isArray(store.documents)) return res.status(404).json({ error: 'Document not found' });

    const index = store.documents.findIndex(d => d.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Document not found' });

    const doc = store.documents[index];
    const isUploader = doc.uploadedBy?.memberId === member.id;
    const isPrivileged = isAdminMember(member);

    if (!isUploader && !isPrivileged) {
      return res.status(403).json({ error: 'You can only delete documents you uploaded' });
    }

    // Delete from PostgreSQL
    if (pool) {
      try {
        await pool.query('DELETE FROM app_files WHERE id = $1', [doc.id]);
      } catch (e) {
        console.error('Error deleting file from DB:', e.message);
      }
    }

    // Delete from disk
    const filePath = path.join(UPLOADS_DIR, doc.storedName);
    try {
      if (fsSync.existsSync(filePath)) {
        await fs.unlink(filePath);
      }
    } catch (e) {
      console.warn('Could not delete file from disk:', e.message);
    }

    store.documents.splice(index, 1);
    await storeHelper.write(store);

    res.json({ message: 'Document deleted successfully', id: doc.id });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Category Management Endpoints (Admin Only) ──

// Get all categories
app.get('/api/categories', requireAuth, (req, res) => {
  const store = req.store;
  res.json({
    categories: store.categories || DEFAULT_CATEGORIES,
    documentTags: store.documentTags || DEFAULT_DOCUMENT_TAGS
  });
});

// Add an Agenda Category (Admin only) - supports 3-level nesting
app.post('/api/categories/agenda', requireAuth, async (req, res) => {
  try {
    if (!isAdminMember(req.member)) {
      return res.status(403).json({ error: 'Only administrators can add agenda categories' });
    }

    const { name, parent } = req.body;
    let fullPath;
    try {
      fullPath = normalizeCategoryPath(name, parent);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!fullPath) {
      return res.status(400).json({ error: 'Category name cannot be empty' });
    }

    const store = req.store;
    if (!Array.isArray(store.categories)) {
      store.categories = [...DEFAULT_CATEGORIES];
    }

    const exists = store.categories.some(c => c.toLowerCase() === fullPath.toLowerCase());
    if (exists) {
      return res.status(400).json({ error: 'An agenda category with this name already exists' });
    }

    store.categories.push(fullPath);
    await storeHelper.write(store);

    res.status(201).json({
      message: 'Agenda category added successfully',
      category: fullPath,
      categories: store.categories
    });
  } catch (error) {
    console.error('Error adding agenda category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete an Agenda Category (Admin only) - cascades to children
app.delete('/api/categories/agenda/:name', requireAuth, async (req, res) => {
  try {
    if (!isAdminMember(req.member)) {
      return res.status(403).json({ error: 'Only administrators can delete agenda categories' });
    }

    const name = decodeURIComponent(req.params.name).trim();
    const store = req.store;
    if (!Array.isArray(store.categories)) {
      store.categories = [...DEFAULT_CATEGORIES];
    }

    const lower = name.toLowerCase();
    const beforeCount = store.categories.length;
    store.categories = store.categories.filter(c => {
      const cLower = c.toLowerCase();
      return cLower !== lower && !cLower.startsWith(lower + ' > ');
    });

    if (store.categories.length === beforeCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await storeHelper.write(store);

    res.json({
      message: 'Category deleted successfully',
      categories: store.categories
    });
  } catch (error) {
    console.error('Error deleting agenda category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a Document Tag (Admin only) - flat tag, no hierarchy
app.post('/api/categories/documents', requireAuth, async (req, res) => {
  try {
    if (!isAdminMember(req.member)) {
      return res.status(403).json({ error: 'Only administrators can add document tags' });
    }

    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Tag name is required' });
    const tagName = name.trim();
    const store = req.store;
    if (!Array.isArray(store.documentTags)) store.documentTags = [...DEFAULT_DOCUMENT_TAGS];
    if (store.documentTags.some(t => t.toLowerCase() === tagName.toLowerCase())) {
      return res.status(400).json({ error: 'This tag already exists' });
    }
    store.documentTags.push(tagName);
    await storeHelper.write(store);
    res.status(201).json({ message: 'Tag added', tag: tagName, documentTags: store.documentTags });
  } catch (error) {
    console.error('Error adding document tag:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a Document Tag (Admin only)
app.delete('/api/categories/documents/:name', requireAuth, async (req, res) => {
  try {
    if (!isAdminMember(req.member)) {
      return res.status(403).json({ error: 'Only administrators can delete document tags' });
    }

    const tagName = decodeURIComponent(req.params.name).trim();
    const store = req.store;

    // Disallow deleting contributor/uploader tags
    const isContributorTag = (Array.isArray(store.members) && store.members.some(m => m.name && m.name.trim().toLowerCase() === tagName.toLowerCase()))
      || (Array.isArray(store.documents) && store.documents.some(d => d.uploadedBy?.memberName && d.uploadedBy.memberName.trim().toLowerCase() === tagName.toLowerCase()));

    if (isContributorTag) {
      return res.status(400).json({ error: 'Contributor/uploader tags are permanent and cannot be deleted' });
    }

    if (!Array.isArray(store.documentTags)) {
      store.documentTags = [...DEFAULT_DOCUMENT_TAGS];
    }

    const beforeCount = store.documentTags.length;
    store.documentTags = store.documentTags.filter(t => t.toLowerCase() !== tagName.toLowerCase());

    if (store.documentTags.length === beforeCount) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    await storeHelper.write(store);

    res.json({
      message: 'Tag deleted successfully',
      documentTags: store.documentTags
    });
  } catch (error) {
    console.error('Error deleting document tag:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Move / Drag-and-Drop a category to nest or re-parent (Admin only)
app.post('/api/categories/move', requireAuth, async (req, res) => {
  try {
    if (!isAdminMember(req.member)) {
      return res.status(403).json({ error: 'Only administrators can move or nest categories' });
    }

    const { type, sourcePath, targetParentPath } = req.body;
    if (type !== 'agenda') {
      return res.status(400).json({ error: 'Move is only supported for agenda categories' });
    }
    if (!sourcePath || typeof sourcePath !== 'string') {
      return res.status(400).json({ error: 'Source category path is required' });
    }

    const store = req.store;
    const catList = store.categories || [];

    const src = sourcePath.trim();
    const tgt = targetParentPath ? targetParentPath.trim() : null;

    const srcLower = src.toLowerCase();
    const exists = catList.some(c => c.toLowerCase() === srcLower || c.toLowerCase().startsWith(srcLower + ' > '));
    if (!exists) {
      return res.status(404).json({ error: 'Source category not found' });
    }

    const srcParts = src.split(/\s*>\s*|\s*\/\s*/).map(p => p.trim()).filter(Boolean);
    const leafName = srcParts[srcParts.length - 1];

    let newBasePath = '';
    if (!tgt) {
      // Move to top-level (Level 1)
      newBasePath = leafName;
    } else {
      const tgtLower = tgt.toLowerCase();
      if (tgtLower === srcLower || tgtLower.startsWith(srcLower + ' > ')) {
        return res.status(400).json({ error: 'Cannot nest a category inside itself or its own subcategory' });
      }

      const tgtParts = tgt.split(/\s*>\s*|\s*\/\s*/).map(p => p.trim()).filter(Boolean);
      if (tgtParts.length >= 3) {
        return res.status(400).json({ error: 'Cannot nest further: Maximum 3 levels of category nesting reached' });
      }

      newBasePath = `${tgt} > ${leafName}`;
    }

    // Check if source has child subcategories and ensure they won't exceed 3 levels
    const childBranches = catList.filter(c => c.toLowerCase().startsWith(srcLower + ' > '));
    const newBasePartsCount = newBasePath.split(/\s*>\s*/).length;

    for (const child of childBranches) {
      const childSubPath = child.substring(src.length).replace(/^\s*>\s*/, '');
      const childSubPartsCount = childSubPath.split(/\s*>\s*/).length;
      if (newBasePartsCount + childSubPartsCount > 3) {
        return res.status(400).json({
          error: `Cannot move "${leafName}": Its subcategory "${childSubPath}" would exceed the 3-level limit`
        });
      }
    }

    // Build replacement map for category list and items
    const replacementMap = new Map();
    replacementMap.set(srcLower, newBasePath);

    childBranches.forEach(child => {
      const childSubPath = child.substring(src.length).replace(/^\s*>\s*/, '');
      const childNewPath = `${newBasePath} > ${childSubPath}`;
      replacementMap.set(child.toLowerCase(), childNewPath);
    });

    // Update categories list
    const updatedCatList = [];
    catList.forEach(c => {
      const cLower = c.toLowerCase();
      if (replacementMap.has(cLower)) {
        const repl = replacementMap.get(cLower);
        if (!updatedCatList.includes(repl)) {
          updatedCatList.push(repl);
        }
      } else {
        if (!updatedCatList.includes(c)) {
          updatedCatList.push(c);
        }
      }
    });

    if (!updatedCatList.includes(newBasePath)) {
      updatedCatList.push(newBasePath);
    }

    store.categories = updatedCatList;
    if (Array.isArray(store.agendaItems)) {
      store.agendaItems.forEach(item => {
        const itemCatLower = (item.category || '').toLowerCase();
        if (replacementMap.has(itemCatLower)) {
          item.category = replacementMap.get(itemCatLower);
        }
      });
    }

    await storeHelper.write(store);

    res.json({
      message: `Category "${leafName}" moved successfully`,
      newPath: newBasePath,
      categories: store.categories
    });
  } catch (error) {
    console.error('Error moving category:', error);
    res.status(500).json({ error: error.message || 'Failed to move category' });
  }
});

// Stats
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const store = req.store;

    const itemsByCategory = store.agendaItems.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {});

    const itemsByStatus = store.agendaItems.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});

    const topItems = [...store.agendaItems]
      .sort((a, b) => b.votes.length - a.votes.length)
      .slice(0, 5)
      .map(i => ({ id: i.id, title: i.title, votes: i.votes.length }));

    res.json({
      totalMembers: store.members.length,
      totalItems: store.agendaItems.length,
      totalDocuments: Array.isArray(store.documents) ? store.documents.length : 0,
      categories: store.categories || DEFAULT_CATEGORIES,
      documentTags: store.documentTags || DEFAULT_DOCUMENT_TAGS,
      itemsByCategory,
      itemsByStatus,
      topItems
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export
app.get('/api/export', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const categoriesList = store.categories || DEFAULT_CATEGORIES;

    const groupedItems = categoriesList.map(category => {
      const items = store.agendaItems
        .filter(item => item.category === category)
        .sort((a, b) => b.votes.length - a.votes.length);
      return { category, items };
    }).filter(group => group.items.length > 0);

    res.json({
      meetingInfo: store.meetingInfo,
      members: store.members.map(m => ({ name: m.name, title: m.title, role: m.role })),
      generatedAt: new Date().toISOString(),
      agenda: groupedItems
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Admin Legal Document Formatter Studio API ──

// GET /api/doc-formatter/presets: retrieve all available presets
app.get('/api/doc-formatter/presets', async (req, res) => {
  try {
    if (fsSync.existsSync(PRESETS_FILE)) {
      const data = await fs.readFile(PRESETS_FILE, 'utf8');
      return res.json(JSON.parse(data));
    }
    res.json({ presets: [] });
  } catch (error) {
    console.error('Error fetching presets:', error);
    res.status(500).json({ error: 'Failed to load presets' });
  }
});

// POST /api/doc-formatter/presets: save or update a preset
app.post('/api/doc-formatter/presets', async (req, res) => {
  try {
    const { preset } = req.body;
    if (!preset || !preset.name) {
      return res.status(400).json({ error: 'Invalid preset data: name is required' });
    }

    let presetsData = { presets: [] };
    if (fsSync.existsSync(PRESETS_FILE)) {
      const raw = await fs.readFile(PRESETS_FILE, 'utf8');
      try { presetsData = JSON.parse(raw); } catch (e) {}
    }

    if (!preset.id) {
      preset.id = 'preset_' + Date.now();
    }

    const existingIdx = presetsData.presets.findIndex(p => p.id === preset.id || p.name === preset.name);
    if (existingIdx >= 0) {
      presetsData.presets[existingIdx] = preset;
    } else {
      presetsData.presets.push(preset);
    }

    await fs.writeFile(PRESETS_FILE, JSON.stringify(presetsData, null, 2), 'utf8');
    res.json({ message: 'Preset saved successfully', preset, presets: presetsData.presets });
  } catch (error) {
    console.error('Error saving preset:', error);
    res.status(500).json({ error: error.message || 'Failed to save preset' });
  }
});

// ── Document Project Sessions API (Save / Load Documents) ──

// GET /api/doc-formatter/documents: retrieve all saved document projects
app.get('/api/doc-formatter/documents', async (req, res) => {
  try {
    let docsData = { documents: [] };
    if (fsSync.existsSync(DOCS_FILE)) {
      const raw = await fs.readFile(DOCS_FILE, 'utf8');
      try { docsData = JSON.parse(raw); } catch (e) {}
    }
    // Return summaries sorted by latest updated
    const summaries = (docsData.documents || []).map(d => ({
      id: d.id,
      title: d.title || 'Untitled Document',
      subtitle: d.subtitle || '',
      updatedAt: d.updatedAt || d.createdAt,
      createdAt: d.createdAt,
      clauseCount: d.clauseCount || 0,
      previewSnippet: d.previewSnippet || '',
    })).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

    res.json({ documents: summaries });
  } catch (error) {
    console.error('Error fetching document projects:', error);
    res.status(500).json({ error: 'Failed to load document projects' });
  }
});

// GET /api/doc-formatter/documents/:id: retrieve a single document project session
app.get('/api/doc-formatter/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!fsSync.existsSync(DOCS_FILE)) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const raw = await fs.readFile(DOCS_FILE, 'utf8');
    const docsData = JSON.parse(raw);
    const doc = (docsData.documents || []).find(d => d.id === id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json({ document: doc });
  } catch (error) {
    console.error('Error fetching document project:', error);
    res.status(500).json({ error: 'Failed to load document project' });
  }
});

// POST /api/doc-formatter/documents: save or update document project session
app.post('/api/doc-formatter/documents', async (req, res) => {
  try {
    const { document: docPayload } = req.body;
    if (!docPayload || !docPayload.title) {
      return res.status(400).json({ error: 'Document title is required' });
    }

    let docsData = { documents: [] };
    if (fsSync.existsSync(DOCS_FILE)) {
      const raw = await fs.readFile(DOCS_FILE, 'utf8');
      try { docsData = JSON.parse(raw); } catch (e) {}
    }

    const titleNormalized = docPayload.title.trim().toLowerCase();

    // Check if an existing document exists with the same ID OR the same title
    let existingIdx = -1;
    if (docPayload.id) {
      existingIdx = docsData.documents.findIndex(d => d.id === docPayload.id);
    }
    if (existingIdx === -1) {
      existingIdx = docsData.documents.findIndex(d => d.title && d.title.trim().toLowerCase() === titleNormalized);
    }

    const now = new Date().toISOString();
    const docId = existingIdx >= 0 ? docsData.documents[existingIdx].id : (docPayload.id || 'doc_' + Date.now());
    const createdAt = existingIdx >= 0 ? (docsData.documents[existingIdx].createdAt || now) : (docPayload.createdAt || now);

    const fullDoc = {
      id: docId,
      title: docPayload.title.trim(),
      subtitle: docPayload.subtitle || '',
      rawText: docPayload.rawText || '',
      config: docPayload.config || {},
      clauseCount: docPayload.clauseCount || 0,
      previewSnippet: docPayload.rawText ? docPayload.rawText.slice(0, 140).replace(/[\r\n]+/g, ' ') : '',
      createdAt: createdAt,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      // Overwrite the existing document in place
      docsData.documents[existingIdx] = fullDoc;
    } else {
      docsData.documents.push(fullDoc);
    }

    // Deduplicate any other documents with the same normalized title (keeping the most recently updated)
    const seenTitles = new Set();
    // Sort so newest updated is kept if duplicates exist
    docsData.documents.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    docsData.documents = docsData.documents.filter(d => {
      const t = (d.title || '').trim().toLowerCase();
      if (!t) return true;
      if (seenTitles.has(t)) return false;
      seenTitles.add(t);
      return true;
    });

    await fs.writeFile(DOCS_FILE, JSON.stringify(docsData, null, 2), 'utf8');
    res.json({ message: 'Document project saved successfully', document: fullDoc });
  } catch (error) {
    console.error('Error saving document project:', error);
    res.status(500).json({ error: error.message || 'Failed to save document project' });
  }
});

// DELETE /api/doc-formatter/documents/:id: delete document project session
app.delete('/api/doc-formatter/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!fsSync.existsSync(DOCS_FILE)) {
      return res.json({ message: 'Document removed' });
    }
    const raw = await fs.readFile(DOCS_FILE, 'utf8');
    const docsData = JSON.parse(raw);
    docsData.documents = (docsData.documents || []).filter(d => d.id !== id);
    await fs.writeFile(DOCS_FILE, JSON.stringify(docsData, null, 2), 'utf8');
    res.json({ message: 'Document deleted successfully', id });
  } catch (error) {
    console.error('Error deleting document project:', error);
    res.status(500).json({ error: 'Failed to delete document project' });
  }
});

// ── OOXML numbering-aware DOCX text extractor ──
// Reads document.xml + numbering.xml from the DOCX zip and reconstructs
// list number prefixes (e.g. "3.", "3.1", "3.1.1") for all numbered paragraphs.
async function extractDocxWithNumbering(docxBuf) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(docxBuf);

  // Parse numbering.xml to build abstractNum → level format map
  const numXmlEntry = zip.getEntry('word/numbering.xml');
  const docXmlEntry = zip.getEntry('word/document.xml');
  if (!docXmlEntry) throw new Error('No document.xml found');

  // ── Parse numbering definitions ──
  const abstractNums = {};   // abstractNumId → { lvl: { numFmt, lvlText, start } }
  const numIdMap = {};       // numId → abstractNumId

  if (numXmlEntry) {
    const numXml = numXmlEntry.getData().toString('utf8');
    // abstractNum blocks
    const abstractBlocks = [...numXml.matchAll(/<w:abstractNum\s+[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)];
    for (const [, id, body] of abstractBlocks) {
      abstractNums[id] = {};
      const lvlBlocks = [...body.matchAll(/<w:lvl\s+[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)];
      for (const [, ilvl, lvlBody] of lvlBlocks) {
        const fmtM = lvlBody.match(/<w:numFmt\s+[^>]*w:val="([^"]+)"/);
        const txtM = lvlBody.match(/<w:lvlText\s+[^>]*w:val="([^"]*?)"/);
        const startM = lvlBody.match(/<w:start\s+[^>]*w:val="(\d+)"/);
        abstractNums[id][ilvl] = {
          numFmt: fmtM ? fmtM[1] : 'decimal',
          lvlText: txtM ? txtM[1] : `%${Number(ilvl)+1}.`,
          start: startM ? parseInt(startM[1]) : 1
        };
      }
    }
    // num blocks (numId → abstractNumId)
    const numBlocks = [...numXml.matchAll(/<w:num\s+[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)];
    for (const [, nid, nbody] of numBlocks) {
      const abM = nbody.match(/<w:abstractNumId\s+[^>]*w:val="(\d+)"/);
      if (abM) numIdMap[nid] = abM[1];
    }
  }

  // ── Parse document.xml paragraphs ──
  const docXml = docXmlEntry.getData().toString('utf8');
  const paragraphs = [...docXml.matchAll(/<w:p[\s>]([\s\S]*?)<\/w:p>/g)];

  // Track current count per numId+ilvl
  const counters = {};  // `${numId}_${ilvl}` → current value

  const lines = [];
  for (const [, pBody] of paragraphs) {
    // Preserve XML tabs and breaks as whitespace/newlines
    const cleanBody = pBody.replace(/<w:tab\s*\/?>/g, ' ').replace(/<w:br\s*\/?>/g, '\n');
    const runs = [...cleanBody.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
    const text = runs.map(r => r[1]).join('').replace(/\u0007/g, '').replace(/[\t ]+/g, ' ').trim();

    // Extract numPr
    const numIdM = pBody.match(/<w:numId\s+[^>]*w:val="(\d+)"/);
    const ilvlM = pBody.match(/<w:ilvl\s+[^>]*w:val="(\d+)"/);

    if (numIdM && ilvlM && numIdM[1] !== '0') {
      const numId = numIdM[1];
      const ilvl = ilvlM[1];
      const absId = numIdMap[numId];
      const lvlDef = absId && abstractNums[absId] && abstractNums[absId][ilvl];

      if (lvlDef) {
        const key = `${numId}_${ilvl}`;
        if (counters[key] === undefined) counters[key] = lvlDef.start;
        else counters[key]++;

        // Reset deeper levels when a shallower level increments
        const ilvlInt = parseInt(ilvl);
        for (const k of Object.keys(counters)) {
          const [kNumId, kIlvl] = k.split('_');
          if (kNumId === numId && parseInt(kIlvl) > ilvlInt) {
            const deeperDef = abstractNums[numIdMap[numId]]?.[kIlvl];
            counters[k] = deeperDef ? deeperDef.start - 1 : 0;
          }
        }

        // Build the numeric prefix from lvlText pattern (e.g. "%1.%2.%3")
        let prefix = lvlDef.lvlText;
        prefix = prefix.replace(/%(\d+)/g, (_, n) => {
          const lKey = `${numId}_${parseInt(n)-1}`;
          return counters[lKey] !== undefined ? counters[lKey] : n;
        });

        if (text) lines.push(`${prefix} ${text}`);
        else lines.push(prefix);
      } else {
        if (text) lines.push(text);
      }
    } else {
      if (text) lines.push(text);
    }
  }

  return lines.join('\n');
}

// Helper function to extract clean plain text from .docx, .doc, .pdf, .txt, .md
async function extractTextFromDocument(filePath, originalFilename) {
  const ext = path.extname(originalFilename || filePath).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return await fs.readFile(filePath, 'utf8');
  }

  if (ext === '.docx' || ext === '.doc') {
    // 1. Try Word COM via a temp PowerShell script file (avoids all inline escaping issues)
    try {
      const psScript = `
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open('${filePath.replace(/\\/g, '\\\\')}', $false, $true)
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($p in $doc.Paragraphs) {
    $raw = $p.Range.Text
    if ($raw) { $raw = $raw.TrimEnd([char]13, [char]10, [char]7, [char]12) }
    $listStr = ''
    try { $listStr = $p.Range.ListFormat.ListString } catch {}
    if ($listStr -and $listStr.Trim()) {
      $line = ($listStr.Trim() + ' ' + $raw).Trim()
    } else {
      $line = if ($raw) { $raw.Trim() } else { '' }
    }
    if ($line) { $lines.Add($line) }
  }
  $doc.Close([ref]0)
  $lines -join [System.Environment]::NewLine
} finally {
  try { $word.Quit([ref]0) } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
`;
      const tmpScript = path.join(os.tmpdir(), `docx_extract_${Date.now()}.ps1`);
      await fs.writeFile(tmpScript, psScript, 'utf8');
      try {
        const { stdout } = await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpScript}"`);
        if (stdout && stdout.trim()) {
          return stdout.trim();
        }
      } finally {
        try { await fs.unlink(tmpScript); } catch {}
      }
    } catch (wordComErr) {
      console.warn('Word COM extraction failed, falling back to OOXML+mammoth:', wordComErr.message);
    }

    // 2. OOXML numbering-aware extraction (reads document.xml + numbering.xml from the zip)
    try {
      const docxBuf = await fs.readFile(filePath);
      const text = await extractDocxWithNumbering(docxBuf);
      if (text && text.trim()) return text.trim();
    } catch (ooxmlErr) {
      console.warn('OOXML numbering extraction failed, falling back to bare mammoth:', ooxmlErr.message);
    }

    // 3. Last-resort: bare mammoth (no numbering)
    try {
      const docxBuf = await fs.readFile(filePath);
      const res = await mammoth.extractRawText({ buffer: docxBuf });
      if (res && res.value && res.value.trim()) {
        return res.value.trim();
      }
    } catch (docxErr) {
      console.warn('Mammoth docx parse failed, falling back to raw:', docxErr.message);
    }
  }

  if (ext === '.pdf') {
    try {
      const p = new pdfParse.PDFParse({ url: filePath, verbosity: 0 });
      await p.load();
      const res = await p.getText();
      if (res && res.pages && Array.isArray(res.pages)) {
        const fullText = res.pages.map(p => p.text || '').join('\n\n').trim();
        if (fullText) return fullText;
      }
    } catch (pdfErr) {
      console.warn('PDF text parse failed:', pdfErr.message);
    }
  }

  return await fs.readFile(filePath, 'utf8');
}

// POST /api/doc-formatter/parse-raw: extract text from uploaded raw document or parse text
app.post('/api/doc-formatter/parse-raw', upload.single('rawFile'), async (req, res) => {
  try {
    let rawText = req.body.rawText || '';

    if (req.file) {
      const filePath = req.file.path;
      rawText = await extractTextFromDocument(filePath, req.file.originalname);
      try { await fs.unlink(filePath); } catch (e) {}
    }

    const blocks = parseRawText(rawText);
    res.json({ rawText, blocks });
  } catch (error) {
    console.error('Error parsing raw document:', error);
    res.status(500).json({ error: error.message || 'Failed to parse raw document' });
  }
});

// POST /api/doc-formatter/spellcheck: perform English (South Africa) spell & grammar inspection
app.post('/api/doc-formatter/spellcheck', async (req, res) => {
  try {
    const { text = '', language = 'en-ZA' } = req.body;
    const result = checkDocText(text);
    res.json({
      language: 'en-ZA',
      ...result
    });
  } catch (error) {
    console.error('Error during spellcheck:', error);
    res.status(500).json({ error: error.message || 'Spellcheck failed' });
  }
});

// ── SGB Functionality Audit Directory Resolution & Helper ──
const SGB_AUDIT_BASE_DIR = path.join(__dirname, 'SGB_Functionality_Audit_2026');

const SGB_AUDIT_FOLDER_MAP = [
  { id: '01_SGB_Constitution', name: '01. SGB Constitution', keywords: ['constitution'] },
  { id: '02_School_Mission_Statement', name: '02. School Mission Statement', keywords: ['mission', 'vision', 'motto', 'creed', 'strategic plan'] },
  { id: '03_Admission_Policy', name: '03. Admission Policy', keywords: ['admission', 'admissions', 'enrolment', 'enrollment'] },
  { id: '04_Language_Policy', name: '04. Language Policy', keywords: ['language', 'medium of instruction', 'afrikaans', 'isixhosa', 'english'] },
  { id: '05_Religious_Observances_Policy', name: '05. Religious Observances Policy', keywords: ['religious', 'religion', 'observance', 'observances', 'faith'] },
  { id: '06_Code_of_Conduct_for_Learners', name: '06. Code of Conduct for Learners', keywords: ['code of conduct', 'conduct', 'discipline', 'learner discipline', 'school rules'] },
  { id: '07_SGB_Correctly_Constituted', name: '07. SGB Correctly Constituted', keywords: ['correctly constituted', 'composition', 'component roster', 'sgb election', 'electoral', 'vacancy', 'vacancies'] },
  { id: '08_Office_Bearers_Elections_and_Portfolios', name: '08. Office-Bearers Elections & Portfolios', keywords: ['office-bearer', 'office bearer', 'office-bearers', 'handover', 'portfolio', 'election of chairperson'] },
  { id: '09_SGB_Meetings_Schedule_and_Records', name: '09. SGB Meetings Schedule & Records', keywords: ['schedule', 'meeting schedule', 'ordinary meeting', 'special meeting', 'minutes', 'agenda', 'attendance register', 'notice'] },
  { id: '10_Finance_Policy', name: '10. Finance Policy', keywords: ['finance policy', 'financial policy', 'procurement', 'petty cash', 'cheque', 'banking'] },
  { id: '11_Finance_Committee_FinCom', name: '11. Finance Committee (FinCom)', keywords: ['fincom', 'finance committee', 'terms of reference', 'treasurer charter'] },
  { id: '12_School_Budget_and_AGM_Approval', name: '12. School Budget & AGM Approval', keywords: ['budget', 'agm', 'annual general meeting', 'parent budget', 'budget presentation', '14 days notice'] },
  { id: '13_Financial_Records_and_Audit', name: '13. Financial Records & Audit', keywords: ['financial records', 'audit', 'afs', 'audited', 'financial statements', 'auditor report'] },
  { id: '14_Learner_Support_Material_LSM', name: '14. Learner Support Material (LSM)', keywords: ['lsm', 'learner support', 'textbook', 'textbooks', 'stationery', 'requisition', 'inventory'] },
  { id: '15_School_Property_Buildings_and_Grounds', name: '15. School Property, Buildings & Grounds', keywords: ['property', 'building', 'grounds', 'infrastructure', 'maintenance plan', 'asset register', 'facilities'] },
  { id: '16_Safety_Policy_and_Emergency_Protocols', name: '16. Safety Policy & Emergency Protocols', keywords: ['safety', 'emergency', 'disaster', 'security', 'evacuation', 'first aid', 'fire drill'] }
];

function resolveAuditFolder(selectedFolder, title, rawText) {
  if (selectedFolder && selectedFolder !== 'auto') {
    const found = SGB_AUDIT_FOLDER_MAP.find(f => f.id === selectedFolder);
    if (found) return found.id;
  }
  const fullText = `${title || ''} ${(rawText || '').substring(0, 1500)}`.toLowerCase();
  for (const item of SGB_AUDIT_FOLDER_MAP) {
    if (item.keywords.some(kw => fullText.includes(kw.toLowerCase()))) {
      return item.id;
    }
  }
  return '01_SGB_Constitution';
}

// POST /api/doc-formatter/generate: generate formatted DOCX/PDF, stream or save to audit folder / vault
app.post('/api/doc-formatter/generate', async (req, res) => {
  try {
    const {
      config = {},
      rawText = '',
      outputFormat = 'docx',
      saveTarget = 'audit_folder',
      saveTargets: rawSaveTargets,
      auditFolder = 'auto',
      auditFolders: rawAuditFolders,
      serverPath = '',
      vaultCategory = 'Governance & Policy',
      vaultTag = 'Policies',
      clientPdfBase64 = ''
    } = req.body;

    // Normalize saveTargets to Array
    let saveTargets = [];
    if (Array.isArray(rawSaveTargets) && rawSaveTargets.length > 0) {
      saveTargets = rawSaveTargets;
    } else if (saveTarget) {
      saveTargets = [saveTarget];
    } else {
      saveTargets = ['audit_folder'];
    }

    // Normalize auditFolders to Array
    let targetFolderIds = [];
    if (Array.isArray(rawAuditFolders) && rawAuditFolders.length > 0) {
      targetFolderIds = rawAuditFolders.map(f => resolveAuditFolder(f, config.documentTitle, rawText));
    } else {
      targetFolderIds = [resolveAuditFolder(auditFolder, config.documentTitle, rawText)];
    }
    targetFolderIds = Array.from(new Set(targetFolderIds.filter(Boolean)));
    if (targetFolderIds.length === 0) targetFolderIds = ['01_SGB_Constitution'];

    const parsedBlocks = parseRawText(rawText);
    const docxBuffer = await buildFormattedDocx(config, parsedBlocks);

    const baseTitle = (config.documentTitle || 'Formatted Document')
      .replace(/[^a-zA-Z0-9_\-\s]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .substring(0, 80) || 'LGAA Document';

    const timestamp = Date.now();
    const docxFilename = `${baseTitle}_${timestamp}.docx`;
    const docxFilePath = path.join(UPLOADS_DIR, docxFilename);

    await fs.writeFile(docxFilePath, docxBuffer);

    let pdfFilename = `${baseTitle}_${timestamp}.pdf`;
    let pdfFilePath = path.join(UPLOADS_DIR, pdfFilename);
    let pdfBuffer = null;

    if (clientPdfBase64 && typeof clientPdfBase64 === 'string') {
      try {
        const cleanBase64 = clientPdfBase64.replace(/^data:application\/pdf;base64,/, '');
        pdfBuffer = Buffer.from(cleanBase64, 'base64');
        await fs.writeFile(pdfFilePath, pdfBuffer);
      } catch (clientPdfErr) {
        console.error('Error saving client-provided PDF buffer:', clientPdfErr.message);
      }
    }

    if (!pdfBuffer) {
      try {
        await convertDocxToPdf(docxFilePath, pdfFilePath, config, parsedBlocks);
        if (fsSync.existsSync(pdfFilePath)) {
          pdfBuffer = await fs.readFile(pdfFilePath);
        }
      } catch (pdfErr) {
        console.warn('Server PDF conversion notice:', pdfErr.message);
      }
    }

    const cleanDocxName = `${baseTitle}.docx`;
    const cleanPdfName = `${baseTitle}.pdf`;

    const savedFolders = [];

    // 1. Save to all selected SGB Audit Folders
    if (saveTargets.includes('audit_folder')) {
      for (const fId of targetFolderIds) {
        const auditFolderPath = path.join(SGB_AUDIT_BASE_DIR, fId);
        await fs.mkdir(auditFolderPath, { recursive: true });

        const auditDocxPath = path.join(auditFolderPath, cleanDocxName);
        await fs.writeFile(auditDocxPath, docxBuffer);

        if (pdfBuffer) {
          const auditPdfPath = path.join(auditFolderPath, cleanPdfName);
          await fs.writeFile(auditPdfPath, pdfBuffer);
        }

        savedFolders.push({
          id: fId,
          path: `SGB_Functionality_Audit_2026/${fId}`,
          docxName: cleanDocxName,
          pdfName: cleanPdfName,
          docxUrl: `/api/doc-formatter/download-audit?folder=${encodeURIComponent(fId)}&file=${encodeURIComponent(cleanDocxName)}`,
          pdfUrl: pdfBuffer ? `/api/doc-formatter/download-audit?folder=${encodeURIComponent(fId)}&file=${encodeURIComponent(cleanPdfName)}` : null
        });
      }
    }

    // 2. Save to Document Vault (PDF only)
    let vaultSaved = false;
    let vaultDocId = null;
    if (saveTargets.includes('vault')) {
      const store = await storeHelper.read();
      if (!Array.isArray(store.documents)) store.documents = [];
      const member = req.member || { id: 'admin', name: 'Stephen Vorster', role: 'SGB Admin' };

      if (pdfBuffer && pdfFilename) {
        const pdfDocRecord = {
          id: uuidv4(),
          title: config.documentTitle || 'Formatted Legal Document',
          filename: pdfFilename,
          storedName: pdfFilename,
          originalName: cleanPdfName,
          category: vaultCategory,
          tags: [vaultTag, 'PDF', 'Formatted', member.name, ...targetFolderIds].filter(Boolean),
          description: `Formatted hierarchical document saved across ${targetFolderIds.join(', ')}.`,
          mimetype: 'application/pdf',
          size: pdfBuffer.length,
          uploadedBy: { memberId: member.id, memberName: member.name },
          uploadedAt: new Date().toISOString()
        };
        store.documents.unshift(pdfDocRecord);
        vaultDocId = pdfDocRecord.id;
      } else {
        // Fallback to DOCX if PDF conversion failed
        const docRecord = {
          id: uuidv4(),
          title: config.documentTitle || 'Formatted Legal Document',
          filename: docxFilename,
          storedName: docxFilename,
          originalName: cleanDocxName,
          category: vaultCategory,
          tags: [vaultTag, 'Formatted', member.name, ...targetFolderIds].filter(Boolean),
          description: `Formatted hierarchical document saved across ${targetFolderIds.join(', ')}.`,
          mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: docxBuffer.length,
          uploadedBy: { memberId: member.id, memberName: member.name },
          uploadedAt: new Date().toISOString()
        };
        store.documents.unshift(docRecord);
        vaultDocId = docRecord.id;
      }
      await storeHelper.write(store);
      vaultSaved = true;

      // In PostgreSQL mode, also persist file binary into app_files table
      if (pool && vaultDocId) {
        const fileBuffer = (pdfBuffer && pdfFilename) ? pdfBuffer : docxBuffer;
        const fileMime = (pdfBuffer && pdfFilename) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const fileName = (pdfBuffer && pdfFilename) ? cleanPdfName : cleanDocxName;
        try {
          await pool.query(
            'INSERT INTO app_files (id, filename, mimetype, file_data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET filename = $2, mimetype = $3, file_data = $4',
            [vaultDocId, fileName, fileMime, fileBuffer]
          );
        } catch (dbErr) {
          console.error('Error inserting document into app_files:', dbErr.message);
        }
      }
    }

    // 3. Custom Server Path
    let serverPathSaved = null;
    if (saveTargets.includes('server_path') && serverPath) {
      if (fsSync.existsSync(serverPath)) {
        await fs.writeFile(path.join(serverPath, cleanDocxName), docxBuffer);
        if (pdfBuffer) {
          await fs.writeFile(path.join(serverPath, cleanPdfName), pdfBuffer);
        }
        serverPathSaved = serverPath;
      }
    }

    // Build friendly summary message
    const msgParts = [];
    if (savedFolders.length > 0) {
      msgParts.push(`${savedFolders.length} SGB Audit Folder${savedFolders.length === 1 ? '' : 's'}`);
    }
    if (vaultSaved) {
      msgParts.push('Document Vault');
    }
    if (serverPathSaved) {
      msgParts.push('Custom Server Location');
    }
    if (saveTargets.includes('download')) {
      msgParts.push('Direct Download');
    }

    const docWord = (savedFolders.length > 1 || saveTargets.length > 1) ? 'Documents' : 'Document';
    const message = `Saved Formatted ${docWord} into ${msgParts.join(' + ') || 'selected destination'}.`;

    return res.json({
      success: true,
      message,
      docTitle: config.documentTitle || 'Formatted Document',
      savedFolders,
      vaultSaved,
      vaultDocId,
      serverPathSaved,
      autoDownload: saveTargets.includes('download'),
      docxFilename: cleanDocxName,
      pdfFilename: cleanPdfName,
      docxBase64: docxBuffer.toString('base64'),
      pdfBase64: pdfBuffer ? pdfBuffer.toString('base64') : null,
      printableHtml: generatePrintableHtml(config, parsedBlocks),
      primaryFolder: savedFolders[0]?.id || targetFolderIds[0] || '01_SGB_Constitution'
    });
  } catch (error) {
    console.error('Document generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate document' });
  }
});

// GET /api/doc-formatter/download-audit: download a generated file directly from SGB_Functionality_Audit_2026
app.get('/api/doc-formatter/download-audit', async (req, res) => {
  try {
    const { folder, file } = req.query;
    if (!folder || !file) return res.status(400).send('Missing folder or file parameter');
    const safeFolder = path.basename(folder);
    const safeFile = path.basename(file);
    const filePath = path.join(SGB_AUDIT_BASE_DIR, safeFolder, safeFile);
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).send('File not found in audit directory');
    }
    res.download(filePath, safeFile);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// POST /api/doc-formatter/open-folder: open target folder in Windows File Explorer
app.post('/api/doc-formatter/open-folder', async (req, res) => {
  try {
    const { folder = '01_SGB_Constitution' } = req.body;
    const safeFolder = path.basename(folder);
    const targetPath = path.join(SGB_AUDIT_BASE_DIR, safeFolder);
    if (!fsSync.existsSync(targetPath)) {
      await fs.mkdir(targetPath, { recursive: true });
    }
    exec(`explorer.exe "${targetPath}"`);
    res.json({ success: true, message: `Opened folder: ${targetPath}` });
  } catch (err) {
    console.error('Failed to open folder:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: manually trigger member sync from Excel
app.post('/api/admin/sync-members', async (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const isLocal = clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1';

  if (!isLocal) {
    return res.status(403).json({ error: 'This endpoint is only accessible from the server machine' });
  }

  try {
    const result = await syncMembersFromExcel();
    res.json({ message: 'Members synced successfully', ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin PINs (local only)
app.get('/api/admin/pins', async (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const isLocal = clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1';

  if (!isLocal) {
    return res.status(403).json({ error: 'This endpoint is only accessible from the server machine' });
  }

  try {
    const store = await storeHelper.read();
    const pinList = store.members.map(m => ({
      name: m.name,
      title: m.title,
      role: m.role,
      contact: m.contact,
      pin: m.pin
    }));
    res.json(pinList);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Start Server ──
const PORT = process.env.PORT || 3000;

storeHelper.init().then(() => {
  // Start file watcher for local development
  startExcelWatcher();

  app.listen(PORT, () => {
    console.log(`🚀 SGB/SMT Agenda Builder running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
