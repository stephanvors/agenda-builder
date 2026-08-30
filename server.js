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
import AdmZip from 'adm-zip';
import { parseRawText, buildFormattedDocx, convertDocxToPdf, generatePrintableHtml } from './formatterEngine.js';
import { checkDocText } from './spellcheckerEngine.js';
import { startAuditWatcher, isAuditWatcherRunning, scanAndSyncAllFolders, findCoreSourceDocInFolder } from './auditWatcher.js';
import { generateEvidencePack, AUDIT_BASE_DIR } from './auditEvidenceGenerator.js';

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
// Audio formats allowed up to 500MB
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.webm', '.flac', '.opus', '.wma', '.mp4', '.m4v']);

function isVideoFile(mimetype, filename) {
  if (mimetype && mimetype.startsWith('video/')) return true;
  const ext = path.extname(filename || '').toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

function isAudioFile(mimetype, filename) {
  if (mimetype && (mimetype.startsWith('audio/') || mimetype === 'video/mp4' || mimetype === 'video/webm')) return true;
  const ext = path.extname(filename || '').toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
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

const archiveUpload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500 MB limit per file
  },
  fileFilter: (req, file, cb) => {
    const blockedExts = ['.exe', '.bat', '.cmd', '.sh', '.msi', '.vbs', '.js', '.mjs', '.ps1'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blockedExts.includes(ext)) {
      return cb(new Error('Executable file types are blocked for security'));
    }
    cb(null, true);
  }
}).fields([
  { name: 'audioFiles', maxCount: 10 },
  { name: 'minutesFiles', maxCount: 5 },
  { name: 'transcriptFiles', maxCount: 5 },
  { name: 'signedRegisterFiles', maxCount: 5 },
  { name: 'resolutionFiles', maxCount: 5 }
]);

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

    // Ensure meetingInfo has required defaults if not set
    store.meetingInfo = {
      title: 'SGB/SMT Strategy Meeting',
      date: '2026-08-27',
      school: 'LGAA',
      ...(store.meetingInfo || {})
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
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 10
  });
  pool.on('error', (err) => {
    console.error('⚠️ PostgreSQL pool error:', err.message);
  });
  console.log('🐘 PostgreSQL pool initialized');
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
      try {
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
            archives: [],
            categories: [...DEFAULT_CATEGORIES],
            documentTags: [...DEFAULT_DOCUMENT_TAGS],
            meetingInfo: {
              title: 'SGB/SMT Strategy Meeting',
              date: '2026-08-27',
              time: '10:00',
              venue: 'Staff Room',
              school: 'Lady Grey Arts Academy'
            }
          };
          migrateFinanceCategories(initialStore);
          await pool.query('INSERT INTO app_store (id, data) VALUES ($1, $2)', ['main_store', JSON.stringify(initialStore)]);
          console.log(`✅ ${members.length} members initialized in PostgreSQL`);
        }

        console.log('✅ Persistent store loaded — syncing member details from Excel...');
        // Always sync titles/roles/contacts from Excel so spreadsheet changes apply on redeploy
        await syncMembersFromExcel();

        // Clean up orphan and corrupted (< 500 bytes) document records in PostgreSQL
        try {
          await pool.query('DELETE FROM app_files WHERE LENGTH(file_data) < 500');
          const fileRows = await pool.query('SELECT id FROM app_files WHERE LENGTH(file_data) >= 500');
          const validIds = new Set(fileRows.rows.map(r => r.id));
          const storeRes = await pool.query('SELECT data FROM app_store WHERE id = $1', ['main_store']);
          if (storeRes.rows.length > 0) {
            const rawData = storeRes.rows[0].data;
            const currentStore = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
            if (Array.isArray(currentStore.documents) && currentStore.documents.length > 0) {
              const beforeCount = currentStore.documents.length;
              currentStore.documents = currentStore.documents.filter(d => {
                const inDb = validIds.has(d.id);
                const onDisk = Boolean(d.storedName && fsSync.existsSync(path.join(UPLOADS_DIR, d.storedName)) && fsSync.statSync(path.join(UPLOADS_DIR, d.storedName)).size >= 500);
                return inDb || onDisk;
              });
              if (currentStore.documents.length !== beforeCount) {
                await pool.query('UPDATE app_store SET data = $1 WHERE id = $2', [JSON.stringify(currentStore), 'main_store']);
                console.log(`🧹 Cleaned up ${beforeCount - currentStore.documents.length} corrupt/orphan document records from PostgreSQL store`);
              }
            }
          }
        } catch (cleanErr) {
          console.error('Error cleaning orphan document records on startup:', cleanErr.message);
        }

        // Always sync archives from disk store if DB archives is empty
        if (fsSync.existsSync(STORE_FILE)) {
          try {
            const diskData = JSON.parse(fsSync.readFileSync(STORE_FILE, 'utf8'));
            if (Array.isArray(diskData.archives) && diskData.archives.length > 0) {
              const currentStoreRes = await pool.query('SELECT data FROM app_store WHERE id = $1', ['main_store']);
              if (currentStoreRes.rows.length > 0) {
                const raw = currentStoreRes.rows[0].data;
                const cs = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (!Array.isArray(cs.archives) || cs.archives.length === 0) {
                  cs.archives = diskData.archives;
                  await pool.query('UPDATE app_store SET data = $1 WHERE id = $2', [JSON.stringify(cs), 'main_store']);
                  console.log(`✅ Synced ${diskData.archives.length} archive(s) from store.json to PostgreSQL database`);
                }
              }
            }
          } catch (e) {
            console.error('Error syncing archives on init:', e.message);
          }
        }

        return;
      } catch (pgInitErr) {
        console.warn('⚠️ PostgreSQL initialization failed, falling back to disk storage:', pgInitErr.message);
      }
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
        if (!Array.isArray(store.archives)) {
          store.archives = [];
          await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2));
        }
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
      archives: [],
      categories: [...DEFAULT_CATEGORIES],
      documentTags: [...DEFAULT_DOCUMENT_TAGS],
      meetingInfo: {
        title: 'SGB & SMT Ordinary Meeting',
        date: '2026-09-24',
        school: 'LGAA'
      }
    };
    migrateFinanceCategories(store);
    await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2));
  },

  async read() {
    let diskStore = null;
    try {
      if (fsSync.existsSync(STORE_FILE)) {
        const data = fsSync.readFileSync(STORE_FILE, 'utf-8');
        diskStore = JSON.parse(data);
      }
    } catch (e) {}

    let store = null;
    if (pool) {
      try {
        const res = await pool.query('SELECT data FROM app_store WHERE id = $1', ['main_store']);
        if (res.rows.length > 0) {
          store = typeof res.rows[0].data === 'string' ? JSON.parse(res.rows[0].data) : res.rows[0].data;
        }
      } catch (dbErr) {
        console.warn('⚠️ PostgreSQL read failed, falling back to disk:', dbErr.message);
      }
    }

    const dbHasArchives = store && Array.isArray(store.archives) && store.archives.length > 0;
    const diskHasArchives = diskStore && Array.isArray(diskStore.archives) && diskStore.archives.length > 0;

    if (diskStore && store && !dbHasArchives && diskHasArchives) {
      store.archives = diskStore.archives;
      if (pool) {
        try {
          await pool.query('UPDATE app_store SET data = $1 WHERE id = $2', [JSON.stringify(store), 'main_store']);
          console.log('🔄 Synced disk archives to PostgreSQL store');
        } catch (e) {}
      }
    }

    if (!store) {
      store = diskStore || {
        members: readMembersFromExcel(),
        sessions: [],
        agendaItems: [],
        documents: [],
        archives: [],
        categories: [...DEFAULT_CATEGORIES],
        documentTags: [...DEFAULT_DOCUMENT_TAGS],
        meetingInfo: {
          title: 'SGB & SMT Ordinary Meeting',
          date: '2026-09-24',
          school: 'LGAA'
        }
      };
    }
    if (!Array.isArray(store.documents)) {
      store.documents = [];
    }
    if (!Array.isArray(store.archives)) {
      store.archives = [];
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
      try {
        await pool.query(
          'INSERT INTO app_store (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2',
          ['main_store', JSON.stringify(data)]
        );
      } catch (dbErr) {
        console.error('⚠️ PostgreSQL store write error (falling back to disk):', dbErr.message);
      }
    }
    try {
      await fs.writeFile(STORE_FILE, JSON.stringify(data, null, 2));
    } catch (fsErr) {
      console.error('⚠️ Disk store write error:', fsErr.message);
    }
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

const APP_VERSION = '20260826-01';

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
        const fileRows = await pool.query('SELECT id FROM app_files WHERE LENGTH(file_data) >= 500');
        fileRows.rows.forEach(r => existingFileIds.add(r.id));
      } catch (e) {
        console.error('Error checking existing file IDs in DB:', e.message);
      }
    }

    const validDocs = [];
    let needPrune = false;
    for (const d of store.documents) {
      const existsOnDisk = Boolean(d.storedName && fsSync.existsSync(path.join(UPLOADS_DIR, d.storedName)) && fsSync.statSync(path.join(UPLOADS_DIR, d.storedName)).size >= 500);
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
          console.warn('⚠️ Warning: Could not store file binary in PostgreSQL (fallback to disk):', dbErr.message);
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

// Helper to categorize governance members into SGB/SMT components
function getMemberComponent(role) {
  const r = (role || '').toLowerCase();
  if (r.includes('educator') || r.includes('teacher') || r.includes('tots') || r.includes('preschool') || r.includes('grade r')) {
    return 'Educator Component';
  }
  if (r.includes('parent') || r.includes('chairperson') || r.includes('treasurer')) {
    return 'Parent Component';
  }
  if (r.includes('principal') || r.includes('deputy') || r.includes('smt') || r.includes('management')) {
    return 'Management / SMT Component';
  }
  if (r.includes('non') || r.includes('finance') || r.includes('clerk') || r.includes('admin') || r.includes('staff')) {
    return 'Non-Teaching Staff & Secretariat Component';
  }
  return 'General Governance Component';
}

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

// GET /api/attendance: retrieve formal attendance roster & quorum statistics
app.get('/api/attendance', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const members = store.members || [];
    const savedAttendance = store.attendance || {};

    const componentsMap = {
      'Parent Component': [],
      'Management / SMT Component': [],
      'Educator Component': [],
      'Non-Teaching Staff & Secretariat Component': []
    };

    let totalMembers = members.length;
    let presentCount = 0;
    let apologyCount = 0;
    let absentCount = 0;

    members.forEach((m, idx) => {
      const comp = getMemberComponent(m.role);
      if (!componentsMap[comp]) {
        componentsMap[comp] = [];
      }
      const saved = savedAttendance[m.id] || savedAttendance[m.name] || {};
      const status = saved.status || 'Present';
      const timeIn = saved.timeIn || '10:00';

      if (status === 'Present') presentCount++;
      else if (status === 'Apology') apologyCount++;
      else absentCount++;

      componentsMap[comp].push({
        id: m.id || `member-${idx + 1}`,
        index: idx + 1,
        name: m.name,
        title: m.title || '',
        role: m.role || '',
        component: comp,
        email: m.email || '',
        contact: m.contact || '',
        status: status,
        timeIn: timeIn,
        signature: 'Signed'
      });
    });

    const quorumThreshold = Math.floor(totalMembers / 2) + 1;
    const isQuorate = presentCount >= quorumThreshold;
    const quorumPercentage = totalMembers > 0 ? ((presentCount / totalMembers) * 100).toFixed(1) + '%' : '100.0%';

    res.json({
      schoolInfo: {
        name: 'LADY GREY ARTS ACADEMY',
        department: 'EASTERN CAPE DEPARTMENT OF EDUCATION',
        district: 'JOE GQABI DISTRICT • EKHEPHINI CIRCUIT • CMC MALETSWAI',
        emis: '200600985',
        address: '18 Brummer Street, Lady Grey, 9755',
        contact: 'Tel: 051 603 0046 | admin@lgaa.co.za'
      },
      meetingInfo: {
        title: store.meetingInfo?.title || 'SGB & SMT Strategy Meeting — Way Forward',
        date: store.meetingInfo?.date || '2026-08-27',
        dateFormatted: '27 August 2026',
        time: '10:00 SAST',
        venue: 'School Staff Room / Boardroom',
        chairperson: 'Mr. Kwezi Dyasi (SGB Chairperson)',
        secretary: 'Mr. Stephen Vorster (Admin Clerk / Secretariat)',
        type: 'Joint Ordinary SGB & SMT Strategic Governance Sitting'
      },
      stats: {
        totalMembers,
        presentCount,
        apologyCount,
        absentCount,
        quorumThreshold,
        isQuorate,
        quorumPercentage,
        statutoryBasis: 'Section 12(1) & 18(1) of South African Schools Act (Act No. 84 of 1996)'
      },
      components: Object.entries(componentsMap)
        .filter(([_, list]) => list.length > 0)
        .map(([name, list]) => ({ name, members: list })),
      certifiers: [
        { role: 'SGB CHAIRPERSON', name: 'Mr. K. Dyasi', title: 'Mr' },
        { role: 'SCHOOL PRINCIPAL', name: 'Ms. M. Botha', title: 'Ms' },
        { role: 'SGB SECRETARIAT / ADMIN', name: 'Mr. S. Vorster', title: 'Mr' }
      ],
      lastSaved: store.attendanceLastSaved || null,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/attendance: save / commit updated attendance roster to database
app.post('/api/attendance', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const body = req.body || {};
    let attendanceMap = store.attendance || {};

    if (body.attendance && typeof body.attendance === 'object') {
      attendanceMap = { ...attendanceMap, ...body.attendance };
    } else if (Array.isArray(body.components)) {
      body.components.forEach(comp => {
        (comp.members || []).forEach(m => {
          if (m.id || m.name) {
            attendanceMap[m.id || m.name] = {
              status: m.status || 'Present',
              timeIn: m.timeIn || '10:00',
              updatedAt: new Date().toISOString()
            };
          }
        });
      });
    } else if (Array.isArray(body.roster)) {
      body.roster.forEach(m => {
        if (m.id || m.name) {
          attendanceMap[m.id || m.name] = {
            status: m.status || 'Present',
            timeIn: m.timeIn || '10:00',
            updatedAt: new Date().toISOString()
          };
        }
      });
    }

    store.attendance = attendanceMap;
    store.attendanceLastSaved = new Date().toISOString();
    store.attendanceSavedBy = {
      id: req.member.id,
      name: req.member.name
    };

    await storeHelper.write(store);
    res.json({ ok: true, message: 'Attendance register saved successfully', lastSaved: store.attendanceLastSaved });
  } catch (error) {
    console.error('Error saving attendance:', error);
    res.status(500).json({ error: 'Failed to save attendance record' });
  }
});

// GET /api/attendance/docx: generate and download official attendance register Word document
app.get('/api/attendance/docx', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const members = store.members || [];
    const meetingDate = store.meetingInfo?.date || '2026-08-27';
    const totalMembers = members.length;
    const quorumThreshold = Math.floor(totalMembers / 2) + 1;

    const parents = members.filter(m => getMemberComponent(m.role) === 'Parent Component');
    const management = members.filter(m => getMemberComponent(m.role) === 'Management / SMT Component');
    const educators = members.filter(m => getMemberComponent(m.role) === 'Educator Component');
    const nonTeaching = members.filter(m => getMemberComponent(m.role) === 'Non-Teaching Staff & Secretariat Component');

    let rosterText = '2. ATTENDANCE ROSTER BY GOVERNANCE COMPONENT\n\n';
    rosterText += '2.1 Parent Component:\n';
    parents.forEach(m => {
      rosterText += `• ${m.title ? m.title + ' ' : ''}${m.name} (${m.role}) — Present (Signed)\n`;
    });
    rosterText += '\n2.2 Management / SMT Component:\n';
    management.forEach(m => {
      rosterText += `• ${m.title ? m.title + ' ' : ''}${m.name} (${m.role}) — Present (Signed)\n`;
    });
    rosterText += '\n2.3 Educator Component:\n';
    educators.forEach(m => {
      rosterText += `• ${m.title ? m.title + ' ' : ''}${m.name} (${m.role}) — Present (Signed)\n`;
    });
    rosterText += '\n2.4 Non-Teaching Staff & Secretariat Component:\n';
    nonTeaching.forEach(m => {
      rosterText += `• ${m.title ? m.title + ' ' : ''}${m.name} (${m.role}) — Present (Signed)\n`;
    });

    const rawText = `
1. RECORD OF ATTENDANCE AND DECLARATION OF QUORUM
1.1 Meeting Type: Joint Ordinary SGB & SMT Strategic Governance Sitting.
1.2 Meeting Date: 27 August 2026 | Time: 10:00 SAST | Venue: School Staff Room / Boardroom.
1.3 Statutory Basis: In terms of Section 12 & Section 18 of the South African Schools Act, 1996 (Act No. 84 of 1996) and the SGB Constitution, a majority of voting members (>50%) constitutes a binding quorum.
1.4 Total SGB & SMT Members: ${totalMembers} Members | Members Present: ${totalMembers} Members | Quorum Required: ${quorumThreshold} Members.
1.5 Quorum Status: Legally Quorate (100.0% attendance recorded) and fully constituted to adopt binding governance resolutions.

${rosterText.trim()}

3. RECORD OF APOLOGIES AND LEAVE OF ABSENCE
3.1 No formal apologies were tendered; full governance attendance recorded.

4. ATTENDANCE VERIFICATION & QUORUM CERTIFICATION
We hereby certify that the attendance recorded above represents the true, accurate, and complete record of attendance of the SGB and SMT meeting held on 27 August 2026.
`;

    const config = {
      documentTitle: 'SGB & SMT OFFICIAL MEETING ATTENDANCE REGISTER',
      documentSubtitle: 'LADY GREY ARTS ACADEMY • STRATEGY MEETING OF 27 AUGUST 2026',
      typography: {
        fontFamily: 'Aptos',
        lineSpacing: 1.2,
        spaceBeforePt: 4,
        spaceAfterPt: 0,
        paragraphSpacingPt: 0,
        titleSizePt: 14,
        subtitleSizePt: 11,
        bodySizePt: 10,
        primaryColor: '#0C2340',
        secondaryColor: '#A6192E',
        textColor: '#1A1A1A'
      },
      pageSetup: {
        paperSize: 'A4',
        borderStyle: 'none',
        leftMarginMm: 12,
        rightMarginMm: 12,
        topMarginMm: 12,
        bottomMarginMm: 12
      },
      header: {
        frequency: 'first_page_only',
        sourceMode: 'structured',
        layout: 'lgaa_official',
        showColorBar: true,
        title: 'LADY GREY ARTS ACADEMY',
        subtitle: 'School Governing Body & School Management Team',
        contact: '18 Brummer Street, Lady Grey, 9755 | Tel: 051 603 0046 | admin@lgaa.co.za',
        emis: 'EMIS: 200600985 | District: Joe Gqabi | Circuit: Ekhephini | CMC: Maletswai',
        badgeText: 'SGB',
        badgeSubtext: 'ATTENDANCE'
      },
      footer: {
        pageNumberFormat: 'x_slash_y',
        alignment: 'center',
        showTopDivider: true,
        customText: 'Official SGB/SMT Governance Attendance Register'
      },
      components: {
        metadataTable: { enabled: false },
        signatures: {
          enabled: true,
          title: 'ATTENDANCE VERIFICATION & RECORD OF QUORUM',
          introText: 'Certified as an accurate and binding record of attendance and quorum verification for the SGB/SMT Strategy Meeting of 27 August 2026:',
          signers: [
            { role: 'SGB CHAIRPERSON', name: 'Mr. K. Dyasi', date: '27 August 2026' },
            { role: 'SCHOOL PRINCIPAL', name: 'Ms. M. Botha', date: '27 August 2026' },
            { role: 'SGB SECRETARIAT / ADMIN', name: 'Mr. S. Vorster', date: '27 August 2026' }
          ],
          showSchoolStamp: true,
          showDistrictStamp: false
        }
      }
    };

    const parsedBlocks = parseRawText(rawText);
    const docxBuffer = await buildFormattedDocx(config, parsedBlocks);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="03_Signed_Attendance_Register_${meetingDate}.docx"`);
    res.send(docxBuffer);
  } catch (error) {
    console.error('Error generating attendance DOCX:', error);
    res.status(500).json({ error: 'Failed to generate attendance document' });
  }
});

// ── Meeting Info & Meeting Archives API ──

// GET /api/meeting-info: retrieve current active meeting information
app.get('/api/meeting-info', async (req, res) => {
  try {
    const store = await storeHelper.read();
    res.json(store.meetingInfo || {
      title: 'SGB/SMT Strategy Meeting',
      date: '2026-08-27',
      time: '10:00 SAST',
      venue: 'School Staff Room / Boardroom',
      school: 'Lady Grey Arts Academy'
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/meeting-info: update current active meeting information (Admin / Secretariat)
app.put('/api/meeting-info', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const { title, date, time, venue, school, chairperson, secretary, type, summary } = req.body;
    store.meetingInfo = {
      ...(store.meetingInfo || {}),
      ...(title ? { title: title.trim() } : {}),
      ...(date ? { date: date.trim() } : {}),
      ...(time ? { time: time.trim() } : {}),
      ...(venue ? { venue: venue.trim() } : {}),
      ...(school ? { school: school.trim() } : {}),
      ...(chairperson ? { chairperson: chairperson.trim() } : {}),
      ...(secretary ? { secretary: secretary.trim() } : {}),
      ...(type ? { type: type.trim() } : {}),
      ...(summary !== undefined ? { summary: summary.trim() } : {})
    };
    await storeHelper.write(store);
    res.json(store.meetingInfo);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper to fetch file buffer from database or disk
async function getFileBufferFromRecord(fileRecord) {
  if (!fileRecord) return null;
  if (pool && fileRecord.id) {
    try {
      const dbRes = await pool.query('SELECT file_data, mimetype FROM app_files WHERE id = $1', [fileRecord.id]);
      if (dbRes.rows.length > 0 && dbRes.rows[0].file_data) {
        return { buffer: dbRes.rows[0].file_data, mimeType: dbRes.rows[0].mimetype || fileRecord.mimeType };
      }
    } catch (e) {
      console.error('Error fetching file buffer from DB:', e.message);
    }
  }
  if (fileRecord.storedName) {
    const filePath = path.join(UPLOADS_DIR, fileRecord.storedName);
    if (fsSync.existsSync(filePath)) {
      const buffer = await fs.readFile(filePath);
      return { buffer, mimeType: fileRecord.mimeType || 'application/octet-stream' };
    }
  }
  return null;
}

// Helper to generate formal DOCX meeting minutes dossier
async function generateArchiveMinutesDocx(archive) {
  const meetingInfo = archive.meetingInfo || {};
  const meetingDate = meetingInfo.date || '2026-08-27';
  const meetingTitle = meetingInfo.title || 'SGB & SMT Strategy Meeting';
  const stats = archive.stats || {};
  const agendaItems = Array.isArray(archive.agendaSnapshot) ? archive.agendaSnapshot : [];
  const resolutions = Array.isArray(archive.resolutions) ? archive.resolutions : [];
  const attendance = archive.attendance || {};
  const components = Array.isArray(attendance.components) ? attendance.components : [];

  let text = `
1. RECORD OF MEETING, STATUTORY MANDATE & QUORUM CERTIFICATION
1.1 Meeting Title: ${meetingTitle.toUpperCase()}.
1.2 Date & Time: ${meetingDate} | ${meetingInfo.time || '10:00 SAST'} | Venue: ${meetingInfo.venue || 'School Staff Room / Boardroom'}.
1.3 Convening Authority: ${meetingInfo.type || 'Joint Ordinary SGB & SMT Strategic Governance Sitting'}.
1.4 Statutory Authority: Convened in terms of Section 12 & Section 18 of the South African Schools Act (Act No. 84 of 1996) and the LGAA SGB Constitution.
1.5 Quorum Status: ${stats.isQuorate !== false ? 'Legally Quorate (>50% majority established)' : 'Non-Quorate'}. Total Members: ${stats.totalMembers || 15} | Present: ${stats.presentCount || 15} | Apologies: ${stats.apologyCount || 0}.

2. ATTENDANCE ROSTER BY GOVERNANCE COMPONENT
`;

  if (components.length > 0) {
    components.forEach((comp, idx) => {
      text += `\n2.${idx + 1} ${comp.name}:\n`;
      (comp.members || []).forEach(m => {
        text += `• ${m.title ? m.title + ' ' : ''}${m.name} (${m.role}) — Status: ${m.status || 'Present'}\n`;
      });
    });
  } else {
    text += `\n2.1 General Governance Sitting: Full attendance certified in formal register.\n`;
  }

  text += `
3. RECORD OF PROCEEDINGS & AGENDA DELIBERATIONS
`;

  if (agendaItems.length === 0) {
    text += `3.1 No formal items submitted for this sitting.\n`;
  } else {
    agendaItems.forEach((item, idx) => {
      const voteCount = Array.isArray(item.votes) ? item.votes.length : 0;
      const statusLabel = item.status ? (item.status.charAt(0).toUpperCase() + item.status.slice(1)) : 'Proposed';
      text += `\n3.${idx + 1} Topic: ${item.title}\n`;
      text += `• Category: ${item.category || 'General'} | Status: ${statusLabel} (${voteCount} votes)\n`;
      text += `• Proposed by: ${item.proposedBy?.memberName || 'Member'} (${item.proposedBy?.memberRole || 'Governance'})\n`;
      text += `• Summary of Discussion: ${item.description || 'Deliberated by sitting.'}\n`;
      
      if (item.isResolved && item.resolution) {
        text += `• Agreed Resolution: ${item.resolution.solutionText}\n`;
      }
      if (Array.isArray(item.comments) && item.comments.length > 0) {
        text += `• Key Deliberation Points:\n`;
        item.comments.forEach(c => {
          text += `   - [${c.type || 'Note'}] ${c.memberName}: ${c.content}${c.isSolution ? ' (Accepted Solution)' : ''}\n`;
        });
      }
    });
  }

  text += `
4. FORMAL GOVERNANCE RESOLUTIONS, DECISIONS & ACTION PLAN
`;

  if (resolutions.length === 0) {
    text += `4.1 All strategic matters noted for ongoing governance monitoring.\n`;
  } else {
    resolutions.forEach((res, idx) => {
      text += `\n4.${idx + 1} Resolution / Decision: ${res.itemTitle || res.title || ('Resolution ' + (idx + 1))}\n`;
      text += `• Decision Outcome: ${res.decision || 'Adopted'}\n`;
      text += `• Formal Text: ${res.resolutionText || res.text || 'Resolution adopted by consensus.'}\n`;
      if (Array.isArray(res.actionItems) && res.actionItems.length > 0) {
        text += `• Action Items & Execution Deadlines:\n`;
        res.actionItems.forEach((act, aIdx) => {
          text += `   ${idx + 1}.${aIdx + 1} Task: ${act.task} | Responsible: ${act.assignee || 'Assigned Officer'} | Due: ${act.dueDate || 'Immediate'} | Status: ${act.status || 'Pending'}\n`;
        });
      }
    });
  }

  if (archive.transcript?.text) {
    text += `
5. EXECUTIVE SUMMARY OF AUDIO TRANSCRIPT
${archive.transcript.text.trim()}
`;
  }

  text += `
6. FORMAL SIGN-OFF & CERTIFICATION OF MINUTES
We, the undersigned executive office-bearers, hereby confirm that these minutes and resolutions constitute a true, binding, and accurate record of the sitting held on ${meetingDate}.
`;

  const config = {
    documentTitle: 'OFFICIAL MEETING MINUTES & GOVERNANCE DOSSIER',
    documentSubtitle: `LADY GREY ARTS ACADEMY • ${meetingTitle.toUpperCase()} (${meetingDate})`,
    typography: {
      fontFamily: 'Aptos',
      lineSpacing: 1.2,
      spaceBeforePt: 4,
      spaceAfterPt: 0,
      paragraphSpacingPt: 0,
      titleSizePt: 14,
      subtitleSizePt: 11,
      bodySizePt: 10,
      primaryColor: '#0C2340',
      secondaryColor: '#A6192E',
      textColor: '#1A1A1A'
    },
    pageSetup: {
      paperSize: 'A4',
      borderStyle: 'none',
      leftMarginMm: 12,
      rightMarginMm: 12,
      topMarginMm: 12,
      bottomMarginMm: 12
    },
    header: {
      frequency: 'first_page_only',
      sourceMode: 'structured',
      layout: 'lgaa_official',
      showColorBar: true,
      title: 'LADY GREY ARTS ACADEMY',
      subtitle: 'School Governing Body & School Management Team',
      contact: '18 Brummer Street, Lady Grey, 9755 | Tel: 051 603 0046 | admin@lgaa.co.za',
      emis: 'EMIS: 200600985 | District: Joe Gqabi | Circuit: Ekhephini | CMC: Maletswai',
      badgeText: 'MINUTES',
      badgeSubtext: 'OFFICIAL'
    },
    footer: {
      pageNumberFormat: 'x_slash_y',
      alignment: 'center',
      showTopDivider: true,
      customText: `Official SGB/SMT Meeting Dossier • ${meetingDate}`
    },
    components: {
      metadataTable: { enabled: false },
      signatures: {
        enabled: true,
        title: 'ADOPTION OF MINUTES & GOVERNANCE CERTIFICATION',
        introText: `Certified and signed on this day for the meeting held on ${meetingDate}:`,
        signers: [
          { role: 'SGB CHAIRPERSON', name: 'Mr. K. Dyasi', date: meetingDate },
          { role: 'SCHOOL PRINCIPAL', name: 'Ms. M. Botha', date: meetingDate },
          { role: 'SGB SECRETARIAT / ADMIN', name: 'Mr. S. Vorster', date: meetingDate }
        ],
        showSchoolStamp: true,
        showDistrictStamp: false
      }
    }
  };

  const parsedBlocks = parseRawText(text);
  return await buildFormattedDocx(config, parsedBlocks);
}

// GET /api/archives: list all meeting archives (sorted newest first)
app.get('/api/archives', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const archives = Array.isArray(store.archives) ? store.archives : [];
    
    const summaries = archives.map(arch => ({
      id: arch.id,
      archiveNumber: arch.archiveNumber,
      archivedAt: arch.archivedAt,
      archivedBy: arch.archivedBy,
      lastModifiedAt: arch.lastModifiedAt,
      lastModifiedBy: arch.lastModifiedBy,
      meetingInfo: arch.meetingInfo,
      stats: arch.stats,
      hasMinutes: Array.isArray(arch.minutesFiles) && arch.minutesFiles.length > 0,
      minutesCount: Array.isArray(arch.minutesFiles) ? arch.minutesFiles.length : 0,
      minutesFiles: arch.minutesFiles || [],
      hasAudio: Array.isArray(arch.audioFiles) && arch.audioFiles.length > 0,
      audioCount: Array.isArray(arch.audioFiles) ? arch.audioFiles.length : 0,
      hasTranscript: Boolean((arch.transcript?.text && arch.transcript.text.trim()) || (Array.isArray(arch.transcript?.files) && arch.transcript.files.length > 0)),
      hasSignedRegister: Array.isArray(arch.signedAttendanceFiles) && arch.signedAttendanceFiles.length > 0,
      resolutionsCount: Array.isArray(arch.resolutions) ? arch.resolutions.length : 0,
      itemsCount: Array.isArray(arch.agendaSnapshot) ? arch.agendaSnapshot.length : 0,
      documentsCount: Array.isArray(arch.vaultDocuments) ? arch.vaultDocuments.length : 0,
      notes: arch.notes || ''
    })).sort((a, b) => new Date(b.meetingInfo?.date || b.archivedAt) - new Date(a.meetingInfo?.date || a.archivedAt));

    res.json(summaries);
  } catch (error) {
    console.error('Error fetching archives:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/archives/:id: retrieve single complete archive dossier
app.get('/api/archives/:id', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const archives = Array.isArray(store.archives) ? store.archives : [];
    const arch = archives.find(a => a.id === req.params.id);
    if (!arch) {
      return res.status(404).json({ error: 'Meeting archive not found' });
    }
    res.json(arch);
  } catch (error) {
    console.error('Error fetching archive dossier:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/archives/conclude: conclude active meeting, upload assets, archive and reset workspace
app.post('/api/archives/conclude', requireAuth, (req, res) => {
  archiveUpload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const member = req.member;
      const store = req.store;

      // Parse JSON fields from request
      let parsedMeetingInfo = {};
      try {
        parsedMeetingInfo = typeof req.body.meetingInfo === 'string' ? JSON.parse(req.body.meetingInfo) : (req.body.meetingInfo || {});
      } catch { parsedMeetingInfo = {}; }

      let parsedResolutions = [];
      try {
        parsedResolutions = typeof req.body.resolutions === 'string' ? JSON.parse(req.body.resolutions) : (req.body.resolutions || []);
      } catch { parsedResolutions = []; }

      let parsedAttendance = null;
      try {
        parsedAttendance = typeof req.body.attendanceData === 'string' ? JSON.parse(req.body.attendanceData) : (req.body.attendanceData || null);
      } catch { parsedAttendance = null; }

      let parsedNextMeetingInfo = {};
      try {
        parsedNextMeetingInfo = typeof req.body.nextMeetingInfo === 'string' ? JSON.parse(req.body.nextMeetingInfo) : (req.body.nextMeetingInfo || {});
      } catch { parsedNextMeetingInfo = {}; }

      const transcriptText = (req.body.transcriptText || '').trim();
      const notes = (req.body.notes || '').trim();
      const clearVault = req.body.clearVault !== 'false';

      // Helper to process uploaded files and save to PostgreSQL if active
      const mapUploadedFiles = async (filesList) => {
        if (!Array.isArray(filesList) || filesList.length === 0) return [];
        const result = [];
        for (const f of filesList) {
          const fileId = uuidv4();
          const ext = path.extname(f.originalname).toLowerCase().replace(/^\./, '');
          const fileObj = {
            id: fileId,
            originalName: f.originalname,
            storedName: f.filename,
            size: f.size,
            mimeType: f.mimetype || 'application/octet-stream',
            extension: ext,
            uploadedAt: new Date().toISOString()
          };

          if (pool) {
            try {
              const fileBuf = await fs.readFile(f.path);
              await pool.query(
                'INSERT INTO app_files (id, filename, mimetype, file_data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET filename = $2, mimetype = $3, file_data = $4',
                [fileId, f.originalname, f.mimetype, fileBuf]
              );
            } catch (dbErr) {
              console.error('Error persisting archive file to DB:', dbErr.message);
            }
          }
          result.push(fileObj);
        }
        return result;
      };

      const audioFilesList = await mapUploadedFiles(req.files?.audioFiles);
      const minutesFilesList = await mapUploadedFiles(req.files?.minutesFiles);
      const transcriptFilesList = await mapUploadedFiles(req.files?.transcriptFiles);
      const signedRegisterFilesList = await mapUploadedFiles(req.files?.signedRegisterFiles);
      const resolutionFilesList = await mapUploadedFiles(req.files?.resolutionFiles);

      // Deep copy snapshots of active meeting
      const agendaSnapshot = JSON.parse(JSON.stringify(store.agendaItems || []));
      const vaultDocuments = JSON.parse(JSON.stringify(store.documents || []));
      const currentMeetingInfo = store.meetingInfo || {};

      // Auto-compile resolutions from resolved agenda items if not already added
      agendaSnapshot.forEach((item, idx) => {
        if (item.isResolved && item.resolution && item.resolution.solutionText) {
          const alreadyExists = parsedResolutions.some(r => r.itemId === item.id || (r.itemTitle && r.itemTitle.toLowerCase() === item.title.toLowerCase()));
          if (!alreadyExists) {
            parsedResolutions.push({
              id: uuidv4(),
              itemId: item.id,
              itemTitle: item.title,
              resolutionText: item.resolution.solutionText,
              decision: 'Adopted',
              actionItems: [],
              resolvedBy: item.resolution.resolvedBy || {
                memberId: member.id,
                memberName: member.name,
                memberRole: member.role
              },
              resolvedAt: item.resolution.resolvedAt || new Date().toISOString()
            });
          }
        }
      });

      // Prepare attendance snapshot
      if (!parsedAttendance || !Array.isArray(parsedAttendance.components)) {
        const membersList = store.members || [];
        const componentsMap = {
          'Parent Component': [],
          'Management / SMT Component': [],
          'Educator Component': [],
          'Non-Teaching Staff & Secretariat Component': []
        };
        membersList.forEach((m, idx) => {
          const comp = getMemberComponent(m.role);
          if (!componentsMap[comp]) componentsMap[comp] = [];
          componentsMap[comp].push({
            id: m.id || `member-${idx + 1}`,
            name: m.name,
            title: m.title || '',
            role: m.role || '',
            component: comp,
            status: 'Present',
            timeIn: '10:00',
            signature: 'Signed'
          });
        });
        parsedAttendance = {
          components: Object.entries(componentsMap)
            .filter(([_, list]) => list.length > 0)
            .map(([name, list]) => ({ name, members: list })),
          quorumThreshold: Math.floor(membersList.length / 2) + 1,
          totalMembers: membersList.length,
          presentCount: membersList.length,
          apologyCount: 0,
          absentCount: 0,
          isQuorate: true
        };
      }

      // Calculate attendance statistics
      let totalAttCount = 0;
      let presentAttCount = 0;
      let apologyAttCount = 0;
      let absentAttCount = 0;

      if (Array.isArray(parsedAttendance.components)) {
        parsedAttendance.components.forEach(g => {
          (g.members || []).forEach(m => {
            totalAttCount++;
            if (m.status === 'Present') presentAttCount++;
            else if (m.status === 'Apology') apologyAttCount++;
            else absentAttCount++;
          });
        });
      }

      const totalMembers = totalAttCount || store.members.length;
      const quorumThreshold = Math.floor(totalMembers / 2) + 1;
      const isQuorate = presentAttCount >= quorumThreshold;
      const quorumPercentage = totalMembers > 0 ? ((presentAttCount / totalMembers) * 100).toFixed(1) + '%' : '100.0%';

      const meetingDate = parsedMeetingInfo.date || currentMeetingInfo.date || new Date().toISOString().split('T')[0];

      // Build complete archive record
      const newArchive = {
        id: uuidv4(),
        archiveNumber: (store.archives ? store.archives.length : 0) + 1,
        archivedAt: new Date().toISOString(),
        archivedBy: {
          memberId: member.id,
          memberName: member.name,
          memberRole: member.role
        },
        meetingInfo: {
          title: parsedMeetingInfo.title || currentMeetingInfo.title || 'SGB/SMT Strategy Meeting',
          date: meetingDate,
          time: parsedMeetingInfo.time || currentMeetingInfo.time || '10:00 SAST',
          venue: parsedMeetingInfo.venue || currentMeetingInfo.venue || 'School Staff Room / Boardroom',
          school: parsedMeetingInfo.school || currentMeetingInfo.school || 'Lady Grey Arts Academy',
          chairperson: parsedMeetingInfo.chairperson || currentMeetingInfo.chairperson || 'Mr. Kwezi Dyasi (SGB Chairperson)',
          secretary: parsedMeetingInfo.secretary || currentMeetingInfo.secretary || 'Mr. Stephen Vorster (Admin Clerk / Secretariat)',
          type: parsedMeetingInfo.type || currentMeetingInfo.type || 'Joint Ordinary SGB & SMT Strategic Governance Sitting',
          summary: parsedMeetingInfo.summary || notes || ''
        },
        stats: {
          totalMembers,
          presentCount: presentAttCount,
          apologyCount: apologyAttCount,
          absentCount: absentAttCount,
          quorumThreshold,
          isQuorate,
          quorumPercentage,
          totalItems: agendaSnapshot.length,
          totalVotes: agendaSnapshot.reduce((s, i) => s + (Array.isArray(i.votes) ? i.votes.length : 0), 0),
          totalResolutions: parsedResolutions.length,
          totalMinutesFiles: minutesFilesList.length,
          totalAudioFiles: audioFilesList.length,
          totalVaultDocuments: vaultDocuments.length
        },
        agendaSnapshot,
        resolutions: parsedResolutions,
        attendance: parsedAttendance,
        minutesFiles: minutesFilesList,
        audioFiles: audioFilesList,
        transcript: {
          text: transcriptText,
          files: transcriptFilesList
        },
        signedAttendanceFiles: signedRegisterFilesList,
        resolutionFiles: resolutionFilesList,
        vaultDocuments,
        notes,
        lastModifiedAt: new Date().toISOString(),
        lastModifiedBy: {
          memberId: member.id,
          memberName: member.name,
          memberRole: member.role
        }
      };

      if (!Array.isArray(store.archives)) {
        store.archives = [];
      }
      store.archives.unshift(newArchive);

      // ── RESET WORKSPACE FOR NEXT MEETING ──
      store.agendaItems = [];
      if (clearVault) {
        store.documents = [];
      }

      // Configure next meeting info
      const nextDate = parsedNextMeetingInfo.date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      store.meetingInfo = {
        title: parsedNextMeetingInfo.title || 'SGB & SMT Ordinary Meeting',
        date: nextDate,
        time: parsedNextMeetingInfo.time || '10:00 SAST',
        venue: parsedNextMeetingInfo.venue || 'School Staff Room / Boardroom',
        school: parsedNextMeetingInfo.school || 'Lady Grey Arts Academy',
        chairperson: parsedNextMeetingInfo.chairperson || 'Mr. Kwezi Dyasi (SGB Chairperson)',
        secretary: parsedNextMeetingInfo.secretary || 'Mr. Stephen Vorster (Admin Clerk / Secretariat)'
      };

      await storeHelper.write(store);

      console.log(`🏁 Meeting "${newArchive.meetingInfo.title}" on ${newArchive.meetingInfo.date} successfully concluded and archived by ${member.name}. System reset for next meeting on ${store.meetingInfo.date}.`);

      res.status(201).json({
        message: 'Meeting successfully concluded and archived. Workspace reset for next meeting.',
        archiveId: newArchive.id,
        archive: newArchive,
        nextMeetingInfo: store.meetingInfo
      });
    } catch (error) {
      console.error('Error concluding meeting:', error);
      res.status(500).json({ error: 'Failed to conclude and archive meeting: ' + error.message });
    }
  });
});

// PUT /api/archives/:id: update an existing archive (modify resolutions, transcript text, notes, attendance)
app.put('/api/archives/:id', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const member = req.member;
    const archives = Array.isArray(store.archives) ? store.archives : [];
    const arch = archives.find(a => a.id === req.params.id);

    if (!arch) {
      return res.status(404).json({ error: 'Meeting archive not found' });
    }

    const { meetingInfo, notes, transcriptText, resolutions, attendanceData } = req.body;

    if (meetingInfo && typeof meetingInfo === 'object') {
      arch.meetingInfo = {
        ...arch.meetingInfo,
        ...meetingInfo
      };
    }

    if (notes !== undefined) {
      arch.notes = (notes || '').trim();
    }

    if (transcriptText !== undefined) {
      if (!arch.transcript) arch.transcript = { text: '', files: [] };
      arch.transcript.text = (transcriptText || '').trim();
    }

    if (Array.isArray(resolutions)) {
      arch.resolutions = resolutions;
      if (arch.stats) {
        arch.stats.totalResolutions = resolutions.length;
      }
    }

    if (attendanceData && typeof attendanceData === 'object') {
      arch.attendance = attendanceData;
    }

    arch.lastModifiedAt = new Date().toISOString();
    arch.lastModifiedBy = {
      memberId: member.id,
      memberName: member.name,
      memberRole: member.role
    };

    await storeHelper.write(store);
    res.json({ message: 'Archive updated successfully', archive: arch });
  } catch (error) {
    console.error('Error updating archive:', error);
    res.status(500).json({ error: 'Failed to update archive: ' + error.message });
  }
});

// POST /api/archives/:id/files: upload additional files to an existing archive
app.post('/api/archives/:id/files', requireAuth, (req, res) => {
  archiveUpload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const store = req.store;
      const member = req.member;
      const archives = Array.isArray(store.archives) ? store.archives : [];
      const arch = archives.find(a => a.id === req.params.id);

      if (!arch) {
        return res.status(404).json({ error: 'Meeting archive not found' });
      }

      const mapUploadedFiles = async (filesList) => {
        if (!Array.isArray(filesList) || filesList.length === 0) return [];
        const result = [];
        for (const f of filesList) {
          const fileId = uuidv4();
          const ext = path.extname(f.originalname).toLowerCase().replace(/^\./, '');
          const fileObj = {
            id: fileId,
            originalName: f.originalname,
            storedName: f.filename,
            size: f.size,
            mimeType: f.mimetype || 'application/octet-stream',
            extension: ext,
            uploadedAt: new Date().toISOString()
          };

          if (pool) {
            try {
              const fileBuf = await fs.readFile(f.path);
              await pool.query(
                'INSERT INTO app_files (id, filename, mimetype, file_data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET filename = $2, mimetype = $3, file_data = $4',
                [fileId, f.originalname, f.mimetype, fileBuf]
              );
            } catch (dbErr) {
              console.error('Error saving file binary in DB:', dbErr.message);
            }
          }
          result.push(fileObj);
        }
        return result;
      };

      const newAudio = await mapUploadedFiles(req.files?.audioFiles);
      const newMinutes = await mapUploadedFiles(req.files?.minutesFiles);
      const newTranscripts = await mapUploadedFiles(req.files?.transcriptFiles);
      const newRegisters = await mapUploadedFiles(req.files?.signedRegisterFiles);
      const newResolutions = await mapUploadedFiles(req.files?.resolutionFiles);

      if (!Array.isArray(arch.audioFiles)) arch.audioFiles = [];
      arch.audioFiles.push(...newAudio);

      if (!Array.isArray(arch.minutesFiles)) arch.minutesFiles = [];
      arch.minutesFiles.push(...newMinutes);

      if (!arch.transcript) arch.transcript = { text: '', files: [] };
      if (!Array.isArray(arch.transcript.files)) arch.transcript.files = [];
      arch.transcript.files.push(...newTranscripts);

      if (!Array.isArray(arch.signedAttendanceFiles)) arch.signedAttendanceFiles = [];
      arch.signedAttendanceFiles.push(...newRegisters);

      if (!Array.isArray(arch.resolutionFiles)) arch.resolutionFiles = [];
      arch.resolutionFiles.push(...newResolutions);

      if (arch.stats) {
        arch.stats.totalAudioFiles = arch.audioFiles.length;
        arch.stats.totalMinutesFiles = arch.minutesFiles.length;
      }

      arch.lastModifiedAt = new Date().toISOString();
      arch.lastModifiedBy = {
        memberId: member.id,
        memberName: member.name,
        memberRole: member.role
      };

      await storeHelper.write(store);
      res.json({ message: 'Files added to archive successfully', archive: arch });
    } catch (error) {
      console.error('Error attaching files to archive:', error);
      res.status(500).json({ error: 'Failed to attach files: ' + error.message });
    }
  });
});

// DELETE /api/archives/:id/files/:fileId: delete a specific file from an archive
app.delete('/api/archives/:id/files/:fileId', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const member = req.member;
    const { id, fileId } = req.params;
    const archives = Array.isArray(store.archives) ? store.archives : [];
    const arch = archives.find(a => a.id === id);

    if (!arch) {
      return res.status(404).json({ error: 'Meeting archive not found' });
    }

    let removed = false;
    let storedFilename = null;

    if (Array.isArray(arch.audioFiles)) {
      const idx = arch.audioFiles.findIndex(f => f.id === fileId);
      if (idx !== -1) {
        storedFilename = arch.audioFiles[idx].storedName;
        arch.audioFiles.splice(idx, 1);
        removed = true;
      }
    }
    if (!removed && Array.isArray(arch.minutesFiles)) {
      const idx = arch.minutesFiles.findIndex(f => f.id === fileId);
      if (idx !== -1) {
        storedFilename = arch.minutesFiles[idx].storedName;
        arch.minutesFiles.splice(idx, 1);
        removed = true;
      }
    }
    if (!removed && arch.transcript && Array.isArray(arch.transcript.files)) {
      const idx = arch.transcript.files.findIndex(f => f.id === fileId);
      if (idx !== -1) {
        storedFilename = arch.transcript.files[idx].storedName;
        arch.transcript.files.splice(idx, 1);
        removed = true;
      }
    }
    if (!removed && Array.isArray(arch.signedAttendanceFiles)) {
      const idx = arch.signedAttendanceFiles.findIndex(f => f.id === fileId);
      if (idx !== -1) {
        storedFilename = arch.signedAttendanceFiles[idx].storedName;
        arch.signedAttendanceFiles.splice(idx, 1);
        removed = true;
      }
    }
    if (!removed && Array.isArray(arch.resolutionFiles)) {
      const idx = arch.resolutionFiles.findIndex(f => f.id === fileId);
      if (idx !== -1) {
        storedFilename = arch.resolutionFiles[idx].storedName;
        arch.resolutionFiles.splice(idx, 1);
        removed = true;
      }
    }

    if (!removed) {
      return res.status(404).json({ error: 'File not found in archive' });
    }

    if (pool) {
      try { await pool.query('DELETE FROM app_files WHERE id = $1', [fileId]); } catch {}
    }
    if (storedFilename) {
      try {
        const filePath = path.join(UPLOADS_DIR, storedFilename);
        if (fsSync.existsSync(filePath)) await fs.unlink(filePath);
      } catch {}
    }

    if (arch.stats) {
      arch.stats.totalAudioFiles = (arch.audioFiles || []).length;
    }

    arch.lastModifiedAt = new Date().toISOString();
    arch.lastModifiedBy = {
      memberId: member.id,
      memberName: member.name,
      memberRole: member.role
    };

    await storeHelper.write(store);
    res.json({ message: 'File deleted from archive', archive: arch });
  } catch (error) {
    console.error('Error deleting archive file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// DELETE /api/archives/:id: delete an entire archive (Admin only)
app.delete('/api/archives/:id', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const member = req.member;
    if (!isAdminMember(member)) {
      return res.status(403).json({ error: 'Only administrators can delete meeting archives' });
    }

    const archives = Array.isArray(store.archives) ? store.archives : [];
    const idx = archives.findIndex(a => a.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Meeting archive not found' });
    }

    const [deletedArchive] = archives.splice(idx, 1);

    // Clean up associated file binaries
    const allFileIds = [
      ...(deletedArchive.audioFiles || []).map(f => f.id),
      ...(deletedArchive.transcript?.files || []).map(f => f.id),
      ...(deletedArchive.signedAttendanceFiles || []).map(f => f.id),
      ...(deletedArchive.resolutionFiles || []).map(f => f.id)
    ];

    if (pool && allFileIds.length > 0) {
      try {
        await pool.query('DELETE FROM app_files WHERE id = ANY($1::text[])', [allFileIds]);
      } catch {}
    }

    await storeHelper.write(store);
    res.json({ message: 'Meeting archive deleted successfully', id: req.params.id });
  } catch (error) {
    console.error('Error deleting archive:', error);
    res.status(500).json({ error: 'Failed to delete archive' });
  }
});

// GET /api/archives/:id/audio/:fileId/stream: stream audio with HTTP 206 Range support
app.get('/api/archives/:id/audio/:fileId/stream', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const archives = Array.isArray(store.archives) ? store.archives : [];
    const arch = archives.find(a => a.id === req.params.id);
    if (!arch) return res.status(404).json({ error: 'Archive not found' });

    const fileRec = (arch.audioFiles || []).find(f => f.id === req.params.fileId);
    if (!fileRec) return res.status(404).json({ error: 'Audio recording not found' });

    const fileData = await getFileBufferFromRecord(fileRec);
    if (!fileData || !fileData.buffer) {
      return res.status(404).json({ error: 'Audio file buffer not found on server' });
    }

    const { buffer, mimeType } = fileData;
    const fileSize = buffer.length;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const chunk = buffer.subarray(start, end + 1);
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType || 'audio/mpeg',
      });
      res.end(chunk);
    } else {
      res.setHeader('Content-Type', mimeType || 'audio/mpeg');
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileRec.originalName)}"`);
      res.end(buffer);
    }
  } catch (error) {
    console.error('Error streaming audio:', error);
    res.status(500).json({ error: 'Failed to stream audio file' });
  }
});

// GET /api/archives/:id/files/:fileId/download: download any archive file
app.get('/api/archives/:id/files/:fileId/download', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const archives = Array.isArray(store.archives) ? store.archives : [];
    const arch = archives.find(a => a.id === req.params.id);
    if (!arch) return res.status(404).json({ error: 'Archive not found' });

    const allFiles = [
      ...(arch.minutesFiles || []),
      ...(arch.audioFiles || []),
      ...(arch.transcript?.files || []),
      ...(arch.signedAttendanceFiles || []),
      ...(arch.resolutionFiles || []),
      ...(arch.vaultDocuments || [])
    ];

    const fileRec = allFiles.find(f => f.id === req.params.fileId);
    if (!fileRec) return res.status(404).json({ error: 'File not found in archive' });

    const fileData = await getFileBufferFromRecord(fileRec);
    if (!fileData || !fileData.buffer) {
      return res.status(404).json({ error: 'File data not found on server' });
    }

    res.setHeader('Content-Type', fileData.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', fileData.buffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileRec.originalName || 'file')}"`);
    res.end(fileData.buffer);
  } catch (error) {
    console.error('Error downloading archive file:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// GET /api/archives/:id/export/docx: generate and download comprehensive meeting minutes DOCX
app.get('/api/archives/:id/export/docx', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const archives = Array.isArray(store.archives) ? store.archives : [];
    const arch = archives.find(a => a.id === req.params.id);
    if (!arch) return res.status(404).json({ error: 'Archive not found' });

    const docxBuffer = await generateArchiveMinutesDocx(arch);
    const meetingDate = arch.meetingInfo?.date || '2026-08-27';
    const safeTitle = (arch.meetingInfo?.title || 'Meeting').replace(/[^a-zA-Z0-9_\-]/g, '_');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="04_Minutes_of_SGB_Meeting_${meetingDate}_${safeTitle}.docx"`);
    res.send(docxBuffer);
  } catch (error) {
    console.error('Error generating archive minutes DOCX:', error);
    res.status(500).json({ error: 'Failed to generate meeting minutes document' });
  }
});

// GET /api/archives/:id/export/zip: package and download complete meeting dossier ZIP pack
app.get('/api/archives/:id/export/zip', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const archives = Array.isArray(store.archives) ? store.archives : [];
    const arch = archives.find(a => a.id === req.params.id);
    if (!arch) return res.status(404).json({ error: 'Archive not found' });

    const zip = new AdmZip();
    const meetingDate = arch.meetingInfo?.date || '2026-08-27';
    const safeTitle = (arch.meetingInfo?.title || 'Meeting').replace(/[^a-zA-Z0-9_\-]/g, '_');

    // 1. Add Generated Minutes DOCX and Uploaded Minutes Documents
    try {
      const minutesDocxBuf = await generateArchiveMinutesDocx(arch);
      zip.addFile(`01_Official_Minutes_and_Resolutions_${meetingDate}.docx`, minutesDocxBuf);
    } catch (docErr) {
      console.warn('Could not generate DOCX for ZIP:', docErr.message);
    }

    for (const mf of (arch.minutesFiles || [])) {
      const fileData = await getFileBufferFromRecord(mf);
      if (fileData && fileData.buffer) {
        zip.addFile(`01_Adopted_Minutes_Documents/${mf.originalName}`, fileData.buffer);
      }
    }

    // 2. Add Transcript text or docs
    if (arch.transcript?.text && arch.transcript.text.trim()) {
      zip.addFile(`02_Meeting_Transcript_${meetingDate}.txt`, Buffer.from(arch.transcript.text, 'utf8'));
    }
    for (const tf of (arch.transcript?.files || [])) {
      const fileData = await getFileBufferFromRecord(tf);
      if (fileData && fileData.buffer) {
        zip.addFile(`02_Transcript_Documents/${tf.originalName}`, fileData.buffer);
      }
    }

    // 3. Add Signed Attendance Register files
    for (const rf of (arch.signedAttendanceFiles || [])) {
      const fileData = await getFileBufferFromRecord(rf);
      if (fileData && fileData.buffer) {
        zip.addFile(`03_Signed_Attendance_Registers/${rf.originalName}`, fileData.buffer);
      }
    }

    // 4. Add Resolution documents
    for (const resF of (arch.resolutionFiles || [])) {
      const fileData = await getFileBufferFromRecord(resF);
      if (fileData && fileData.buffer) {
        zip.addFile(`04_Formal_Resolutions/${resF.originalName}`, fileData.buffer);
      }
    }

    // 5. Add Audio Recordings
    for (const af of (arch.audioFiles || [])) {
      const fileData = await getFileBufferFromRecord(af);
      if (fileData && fileData.buffer) {
        zip.addFile(`Audio_Recordings/${af.originalName}`, fileData.buffer);
      }
    }

    // 6. Add Vault Supporting Documents
    for (const vd of (arch.vaultDocuments || [])) {
      const fileData = await getFileBufferFromRecord(vd);
      if (fileData && fileData.buffer) {
        zip.addFile(`Supporting_Documents/${vd.originalName}`, fileData.buffer);
      }
    }

    // 7. Add Manifest
    const stats = arch.stats || {};
    const manifestText = `========================================================================
LADY GREY ARTS ACADEMY — SGB & SMT MEETING ARCHIVE DOSSIER
========================================================================
Meeting Title: ${arch.meetingInfo?.title || 'SGB/SMT Meeting'}
Meeting Date:  ${meetingDate} | ${arch.meetingInfo?.time || '10:00 SAST'}
Venue:         ${arch.meetingInfo?.venue || 'School Staff Room / Boardroom'}
Type:          ${arch.meetingInfo?.type || 'Strategic Governance Sitting'}
Chairperson:   ${arch.meetingInfo?.chairperson || 'Mr. K. Dyasi'}
Secretariat:   ${arch.meetingInfo?.secretary || 'Mr. S. Vorster'}

STATISTICS & QUORUM:
- Total Members:     ${stats.totalMembers || 0}
- Present:           ${stats.presentCount || 0} (${stats.quorumPercentage || '100%'})
- Apologies:         ${stats.apologyCount || 0}
- Quorum Status:     ${stats.isQuorate !== false ? 'QUORATE (Binding Governance Decisions)' : 'NON-QUORATE'}
- Proposed Items:    ${stats.totalItems || 0}
- Formal Decisions:  ${stats.totalResolutions || 0}
- Audio Recordings:  ${stats.totalAudioFiles || 0}
- Vault Documents:   ${stats.totalVaultDocuments || 0}

Archived By:   ${arch.archivedBy?.memberName || 'Secretariat'} (${arch.archivedBy?.memberRole || 'Admin'})
Archived Date: ${arch.archivedAt}
========================================================================
`;
    zip.addFile(`00_MEETING_ARCHIVE_MANIFEST.txt`, Buffer.from(manifestText, 'utf8'));

    const zipBuffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="LGAA_Meeting_Dossier_${meetingDate}_${safeTitle}.zip"`);
    res.send(zipBuffer);
  } catch (error) {
    console.error('Error generating archive ZIP:', error);
    res.status(500).json({ error: 'Failed to generate meeting pack ZIP: ' + error.message });
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
      vaultTag = 'Policies'
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

    try {
      await convertDocxToPdf(docxFilePath, pdfFilePath, config, parsedBlocks);
      if (fsSync.existsSync(pdfFilePath)) {
        const sBuf = await fs.readFile(pdfFilePath);
        if (sBuf.length >= 500 && sBuf.toString('utf8', 0, 4).startsWith('%PDF')) {
          pdfBuffer = sBuf;
        }
      }
    } catch (pdfErr) {
      console.warn('Server PDF conversion notice:', pdfErr.message);
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

// ── SGB Functionality Audit Watcher & Evidence API ──
app.get('/api/audit/status', async (req, res) => {
  try {
    const running = isAuditWatcherRunning();
    const folders = [];
    if (fsSync.existsSync(AUDIT_BASE_DIR)) {
      const entries = await fs.readdir(AUDIT_BASE_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && /^\d{2}_/.test(entry.name) && entry.name !== '00_Sources') {
          const folderPath = path.join(AUDIT_BASE_DIR, entry.name);
          const sourceDoc = findCoreSourceDocInFolder(folderPath);
          const allFiles = await fs.readdir(folderPath);
          const docxCount = allFiles.filter(f => f.endsWith('.docx') && !f.startsWith('~$')).length;
          const pdfCount = allFiles.filter(f => f.endsWith('.pdf')).length;
          folders.push({
            folderId: entry.name,
            sourceDoc: sourceDoc ? path.basename(sourceDoc) : null,
            totalFiles: allFiles.filter(f => !f.startsWith('~$')).length,
            docxCount,
            pdfCount,
            hasFullEvidencePack: docxCount >= 8 && pdfCount >= 8
          });
        }
      }
    }
    res.json({ watcherRunning: running, folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/audit/regenerate/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    const folderPath = path.join(AUDIT_BASE_DIR, folderId);
    if (!fsSync.existsSync(folderPath)) {
      return res.status(404).json({ error: `Folder ${folderId} not found` });
    }
    const sourceDoc = findCoreSourceDocInFolder(folderPath);
    if (!sourceDoc) {
      return res.status(400).json({ error: `No core source document found in ${folderId}` });
    }
    const result = await generateEvidencePack(folderPath, sourceDoc);
    res.json({ message: `Regenerated evidence pack for ${folderId}`, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start Server ──
const PORT = process.env.PORT || 3000;

storeHelper.init().then(() => {
  // Start file watcher for local development
  startExcelWatcher();

  // Start SGB Functionality Audit 16-folder watcher
  startAuditWatcher();

  app.listen(PORT, () => {
    console.log(`🚀 SGB/SMT Agenda Builder running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
