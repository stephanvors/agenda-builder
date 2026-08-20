import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import pg from 'pg';
import multer from 'multer';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const EXCEL_FILE = path.join(__dirname, 'users', 'UserDetails.xlsx');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fsSync.existsSync(UPLOADS_DIR)) {
  fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const CATEGORIES = [
  'Fee Collection & Debt Recovery',
  'Budget & Financial Management',
  'Fundraising & Alternative Revenue',
  'Infrastructure & Maintenance',
  'Curriculum & Academic Performance',
  'Human Resources & Staffing',
  'Parent & Community Engagement',
  'Governance & Policy',
  'Learner Welfare & Support',
  'Communication & Administration',
  'General'
];

const DOCUMENT_CATEGORIES = [
  'Meeting Documents & Policies',
  'Presentations & Slides',
  'Financial & Budget Reports',
  'Curriculum & Academic',
  'Infrastructure & Maintenance',
  'General & Media'
];

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

const storeHelper = {
  async init() {
    if (pool) {
      // Initialize PostgreSQL tables
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_store (
          id VARCHAR(50) PRIMARY KEY,
          data JSONB NOT NULL
        )
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
          meetingInfo: {
            title: 'SGB/SMT Strategy Meeting',
            date: '2026-08-27',
            school: 'LGAA'
          }
        };
        await pool.query('INSERT INTO app_store (id, data) VALUES ($1, $2)', ['main_store', JSON.stringify(initialStore)]);
        console.log(`✅ ${members.length} members initialized in PostgreSQL`);
      } else {
        console.log('✅ Persistent store loaded — syncing member details from Excel...');
        // Always sync titles/roles/contacts from Excel so spreadsheet changes apply on redeploy
        await syncMembersFromExcel();
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
        return;
      }
    } catch { /* create fresh */ }

    const members = readMembersFromExcel();
    const store = {
      members,
      sessions: [],
      agendaItems: [],
      documents: [],
      meetingInfo: {
        title: 'SGB/SMT Strategy Meeting',
        date: '2026-08-27',
        school: 'LGAA'
      }
    };
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
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const token = authHeader.split(' ')[1];
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

// Member list (no PINs)
app.get('/api/members/list', async (req, res) => {
  try {
    const store = await storeHelper.read();
    const memberList = store.members.map(m => ({
      id: m.id,
      name: m.name,
      title: m.title,
      role: m.role
    }));
    res.json(memberList);
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

// List members
app.get('/api/members', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    const memberList = store.members.map(m => ({
      id: m.id,
      name: m.name,
      title: m.title,
      role: m.role
    }));
    res.json(memberList);
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
      comments: Array.isArray(i.comments) ? i.comments : [],
      isResolved: Boolean(i.isResolved),
      resolution: i.resolution || null
    })).sort((a, b) => b.votes.length - a.votes.length);
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

    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const store = req.store;
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

    if (item.votes.some(v => v.memberId === member.id)) {
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

    const voteIndex = item.votes.findIndex(v => v.memberId === member.id);
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

// ── Shared Documents & Files Endpoints ──

// List all documents
app.get('/api/documents', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    if (!Array.isArray(store.documents)) {
      store.documents = [];
    }
    // Return newest first
    const sorted = [...store.documents].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json({
      documents: sorted,
      categories: DOCUMENT_CATEGORIES
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

      const { title, category, description } = req.body;
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

      const finalCategory = DOCUMENT_CATEGORIES.includes(category) ? category : 'General & Media';
      const finalTitle = (title && title.trim()) ? title.trim() : req.file.originalname;

      const newDoc = {
        id: uuidv4(),
        title: finalTitle,
        description: (description || '').trim(),
        category: finalCategory,
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

      store.documents.push(newDoc);
      await storeHelper.write(store);

      res.status(201).json(newDoc);
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
    if (!Array.isArray(store.documents)) return res.status(404).json({ error: 'Document not found' });

    const doc = store.documents.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const filePath = path.join(UPLOADS_DIR, doc.storedName);
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    res.download(filePath, doc.originalName);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Inline view / stream a document (supports HTTP Range for video)
app.get('/api/documents/:id/view', requireAuth, async (req, res) => {
  try {
    const store = req.store;
    if (!Array.isArray(store.documents)) return res.status(404).json({ error: 'Document not found' });

    const doc = store.documents.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const filePath = path.join(UPLOADS_DIR, doc.storedName);
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    const stat = fsSync.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range && doc.isVideo) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fsSync.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': doc.mimeType || 'video/mp4',
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalName)}"`);
      fsSync.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    console.error('Error streaming/viewing file:', error);
    res.status(500).json({ error: 'Failed to stream/view file' });
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
    const isUploader = doc.uploadedBy.memberId === member.id;
    const isPrivileged = (member.role || '').includes('Principal') || (member.role || '').includes('Chairperson') || (member.role || '').includes('Admin');

    if (!isUploader && !isPrivileged) {
      return res.status(403).json({ error: 'You can only delete documents you uploaded' });
    }

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
      categories: CATEGORIES,
      documentCategories: DOCUMENT_CATEGORIES,
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

    const groupedItems = CATEGORIES.map(category => {
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
