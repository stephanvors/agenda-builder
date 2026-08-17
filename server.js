import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import pg from 'pg';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const EXCEL_FILE = path.join(__dirname, 'users', 'UserDetails.xlsx');

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
          meetingInfo: {
            title: 'SGB/SMT Strategy Meeting',
            date: '2026-08-21',
            school: 'LGAA'
          }
        };
        await pool.query('INSERT INTO app_store (id, data) VALUES ($1, $2)', ['main_store', JSON.stringify(initialStore)]);
        console.log(`✅ ${members.length} members initialized in PostgreSQL`);
      } else {
        console.log('✅ Persistent store loaded from PostgreSQL');
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
      meetingInfo: {
        title: 'SGB/SMT Strategy Meeting',
        date: '2026-08-21',
        school: 'LGAA'
      }
    };
    await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2));
  },

  async read() {
    if (pool) {
      const res = await pool.query('SELECT data FROM app_store WHERE id = $1', ['main_store']);
      if (res.rows.length > 0) {
        return res.rows[0].data;
      }
    }
    const data = await fs.readFile(STORE_FILE, 'utf-8');
    return JSON.parse(data);
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
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
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
    const sortedItems = [...store.agendaItems].sort((a, b) => b.votes.length - a.votes.length);
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
      status: determineStatus(1)
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
  app.listen(PORT, () => {
    console.log(`🚀 SGB/SMT Agenda Builder running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
