// ─────────────────────────────────────────────────────
// SGB/SMT Strategy Meeting — Agenda Builder
// Client-side Application (Authenticated)
// ─────────────────────────────────────────────────────

// ── State ──
const state = {
    token: null,     // session token
    member: null,    // { id, name, title, role }
    members: [],     // all members (for tooltip)
    items: [],       // agenda items from server
    filters: {
        category: 'All',
        status: 'All'
    },
    sort: 'votes'
};

const MEETING_DATE = new Date('2026-08-21T10:00:00');
const POLL_INTERVAL_MS = 15000;

// ── API Layer (all requests include auth token) ──
function authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }
    return headers;
}

const api = {
    async getMemberList() {
        const res = await fetch('/api/members/list');
        if (!res.ok) throw new Error('Failed to load member list');
        return res.json();
    },

    async login(memberId, pin) {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ memberId, pin })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Login failed');
        }
        return res.json();
    },

    async verifySession() {
        const res = await fetch('/api/me', { headers: authHeaders() });
        if (!res.ok) return null;
        return res.json();
    },

    async logout() {
        await fetch('/api/logout', {
            method: 'POST',
            headers: authHeaders()
        });
    },

    async getItems() {
        const res = await fetch('/api/items', { headers: authHeaders() });
        if (res.status === 401) { handleSessionExpired(); return []; }
        if (!res.ok) throw new Error('Failed to load agenda items');
        return res.json();
    },

    async createItem({ title, description, category }) {
        const res = await fetch('/api/items', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ title, description, category })
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to create item');
        }
        return res.json();
    },

    async vote(itemId) {
        const res = await fetch(`/api/items/${itemId}/vote`, {
            method: 'POST',
            headers: authHeaders()
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to cast vote');
        }
        return res.json();
    },

    async unvote(itemId) {
        const res = await fetch(`/api/items/${itemId}/vote`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to remove vote');
        }
        return res.json();
    },

    async deleteItem(itemId) {
        const res = await fetch(`/api/items/${itemId}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (res.status === 401) { handleSessionExpired(); return; }
        if (res.status !== 204 && !res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to delete item');
        }
    },

    async getStats() {
        const res = await fetch('/api/stats', { headers: authHeaders() });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) throw new Error('Failed to load statistics');
        return res.json();
    },

    async getExport() {
        const res = await fetch('/api/export', { headers: authHeaders() });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) throw new Error('Failed to export agenda');
        return res.json();
    }
};

// ── DOM Elements ──
const els = {
    loginView:        document.getElementById('login-view'),
    mainView:         document.getElementById('main-view'),
    loginForm:        document.getElementById('login-form'),
    loginMember:      document.getElementById('login-member'),
    loginPin:         document.getElementById('login-pin'),
    loginError:       document.getElementById('login-error'),
    btnLogin:         document.getElementById('btn-login'),
    userName:         document.getElementById('current-user-name'),
    userRole:         document.getElementById('current-user-role'),
    btnSignout:       document.getElementById('btn-signout'),

    statDays:         document.getElementById('stat-days'),
    statTicker:       document.getElementById('stat-ticker'),
    statMembers:      document.getElementById('stat-members'),
    statItems:        document.getElementById('stat-items'),
    statVotes:        document.getElementById('stat-votes'),
    membersTooltip:   document.getElementById('members-tooltip'),
    itemsTooltip:     document.getElementById('items-tooltip'),

    btnToggleForm:    document.getElementById('btn-toggle-form'),
    submitContainer:  document.getElementById('submit-item-container'),
    submitForm:       document.getElementById('submit-item-form'),
    btnCancelSubmit:  document.getElementById('btn-cancel-submit'),
    titleError:       document.getElementById('title-error'),
    descError:        document.getElementById('desc-error'),

    filterCategory:   document.getElementById('filter-category'),
    sortItems:        document.getElementById('sort-items'),
    statusFilters:    document.getElementById('status-filters'),

    itemsContainer:   document.getElementById('agenda-items-container'),
    emptyState:       document.getElementById('empty-state'),

    btnExport:        document.getElementById('btn-export'),
    modal:            document.getElementById('export-modal'),
    btnPrint:         document.getElementById('btn-print'),
    btnCloseModal:    document.getElementById('btn-close-modal'),
    printableAgenda:  document.getElementById('printable-agenda'),

    refreshCountdown: document.getElementById('refresh-countdown')
};

// ── Initialisation ──
async function init() {
    const savedToken = localStorage.getItem('agenda_token');

    if (savedToken) {
        state.token = savedToken;
        const member = await api.verifySession();
        if (member) {
            state.member = member;
            showMainView();
            await loadData();
            startPolling();
        } else {
            // Session expired — clear and show login
            localStorage.removeItem('agenda_token');
            state.token = null;
            await loadMemberList();
        }
    } else {
        await loadMemberList();
    }

    setupEventListeners();
    startCountdown();
}

// Load member names into the login dropdown
async function loadMemberList() {
    try {
        const members = await api.getMemberList();
        els.loginMember.innerHTML = '<option value="" disabled selected>Select your name...</option>';
        members.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = `${m.title} ${m.name} — ${m.role}`;
            els.loginMember.appendChild(opt);
        });
    } catch (error) {
        console.error('Failed to load member list:', error);
        showToast('Failed to load member list. Please refresh.', true);
    }
}

// ── Event Listeners ──
function setupEventListeners() {
    els.loginForm.addEventListener('submit', handleLogin);
    els.btnSignout.addEventListener('click', handleSignout);

    els.btnToggleForm.addEventListener('click', toggleSubmitForm);
    els.btnCancelSubmit.addEventListener('click', toggleSubmitForm);
    els.submitForm.addEventListener('submit', handleSubmitItem);

    els.filterCategory.addEventListener('change', (e) => {
        state.filters.category = e.target.value;
        renderItems();
    });

    els.sortItems.addEventListener('change', (e) => {
        state.sort = e.target.value;
        renderItems();
    });

    els.statusFilters.addEventListener('click', (e) => {
        if (e.target.classList.contains('status-btn')) {
            document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.filters.status = e.target.dataset.status;
            renderItems();
        }
    });

    els.itemsContainer.addEventListener('click', handleItemAction);

    // Mobile tap-to-toggle for stat tooltips
    document.querySelectorAll('.stat-item--hoverable').forEach(box => {
        box.addEventListener('click', (e) => {
            // only toggle on touch devices (pointerType === 'touch' or no hover support)
            if (window.matchMedia('(hover: none)').matches) {
                const isOpen = box.classList.contains('tooltip-open');
                document.querySelectorAll('.stat-item--hoverable').forEach(b => b.classList.remove('tooltip-open'));
                if (!isOpen) box.classList.add('tooltip-open');
                e.stopPropagation();
            }
        });
    });
    document.addEventListener('click', () => {
        document.querySelectorAll('.stat-item--hoverable').forEach(b => b.classList.remove('tooltip-open'));
    });

    els.btnExport.addEventListener('click', showExportModal);
    els.btnCloseModal.addEventListener('click', () => els.modal.classList.remove('active'));
    els.btnPrint.addEventListener('click', () => window.print());
    els.modal.addEventListener('click', (e) => {
        if (e.target === els.modal) els.modal.classList.remove('active');
    });
}

// ── Handlers ──
async function handleLogin(e) {
    e.preventDefault();
    els.loginError.textContent = '';

    const memberId = els.loginMember.value;
    const pin = els.loginPin.value.trim();

    if (!memberId) {
        els.loginError.textContent = 'Please select your name';
        return;
    }
    if (!pin || pin.length !== 4) {
        els.loginError.textContent = 'Please enter your 4-digit PIN';
        return;
    }

    els.btnLogin.disabled = true;
    els.btnLogin.textContent = 'Signing in...';

    try {
        const { token, member } = await api.login(memberId, pin);
        state.token = token;
        state.member = member;
        localStorage.setItem('agenda_token', token);

        showMainView();
        await loadData();
        startPolling();
        showToast(`Welcome, ${member.title} ${member.name}!`);
    } catch (error) {
        els.loginError.textContent = error.message || 'Login failed. Check your PIN.';
    } finally {
        els.btnLogin.disabled = false;
        els.btnLogin.textContent = 'Sign In';
    }
}

async function handleSignout() {
    try {
        await api.logout();
    } catch { /* ignore */ }

    localStorage.removeItem('agenda_token');
    state.token = null;
    state.member = null;
    stopPolling();
    location.reload();
}

function handleSessionExpired() {
    localStorage.removeItem('agenda_token');
    state.token = null;
    state.member = null;
    stopPolling();
    showToast('Your session has expired. Please sign in again.', true);
    setTimeout(() => location.reload(), 2000);
}

function toggleSubmitForm() {
    const isCollapsed = els.submitContainer.classList.contains('collapsed');
    els.submitContainer.classList.toggle('collapsed');
    if (isCollapsed) {
        els.submitForm.reset();
        els.titleError.textContent = '';
        els.descError.textContent = '';
    }
}

async function handleSubmitItem(e) {
    e.preventDefault();
    const title = document.getElementById('item-title').value.trim();
    const category = document.getElementById('item-category').value;
    const description = document.getElementById('item-description').value.trim();

    let valid = true;
    els.titleError.textContent = '';
    els.descError.textContent = '';

    if (title.length < 5) {
        els.titleError.textContent = 'Title must be at least 5 characters';
        valid = false;
    }
    if (description.length < 10) {
        els.descError.textContent = 'Description must be at least 10 characters';
        valid = false;
    }
    if (!category) {
        showToast('Please select a category', true);
        valid = false;
    }
    if (!valid) return;

    try {
        await api.createItem({ title, description, category });
        toggleSubmitForm();
        showToast('Agenda item proposed successfully');
        await loadData();
    } catch (error) {
        showToast(error.message || 'Failed to propose item', true);
    }
}

async function handleItemAction(e) {
    const btn = e.target.closest('button');
    if (!btn) return;

    const id = btn.dataset.id;
    if (!id) return;

    if (btn.classList.contains('btn-vote')) {
        const hasVoted = btn.classList.contains('voted');
        try {
            if (hasVoted) {
                await api.unvote(id);
                showToast('Vote withdrawn');
            } else {
                await api.vote(id);
                showToast('Vote cast!');
            }
            await loadData();
        } catch (error) {
            showToast(error.message || 'Failed to record vote', true);
        }
    } else if (btn.classList.contains('btn-delete')) {
        if (confirm('Are you sure you want to withdraw this proposed agenda item?')) {
            try {
                await api.deleteItem(id);
                showToast('Agenda item withdrawn');
                await loadData();
            } catch (error) {
                showToast(error.message || 'Failed to delete item', true);
            }
        }
    }
}

// ── Views ──
function showMainView() {
    els.loginView.classList.remove('active');
    els.mainView.classList.add('active');
    els.userName.textContent = `${state.member.title} ${state.member.name}`;
    els.userRole.textContent = state.member.role;
}

// ── Data Loading ──
async function loadData() {
    try {
        const [items, stats] = await Promise.all([
            api.getItems(),
            api.getStats()
        ]);
        state.items = items;
        renderItems();
        if (stats) {
            updateStats(stats);
            // Refresh members list for tooltip if needed
            if (state.members.length === 0) {
                try {
                    state.members = await api.getMemberList();
                } catch { /* non-critical */ }
            }
            populateMembersTooltip();
            populateItemsTooltip();
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// ── Rendering ──
function renderItems() {
    let filtered = state.items.filter(item => {
        const matchCat = state.filters.category === 'All' || item.category === state.filters.category;
        const matchStatus = state.filters.status === 'All' ||
            item.status.toLowerCase() === state.filters.status.toLowerCase();
        return matchCat && matchStatus;
    });

    filtered.sort((a, b) => {
        if (state.sort === 'votes') return b.votes.length - a.votes.length || new Date(b.proposedAt) - new Date(a.proposedAt);
        if (state.sort === 'newest') return new Date(b.proposedAt) - new Date(a.proposedAt);
        if (state.sort === 'oldest') return new Date(a.proposedAt) - new Date(b.proposedAt);
        return 0;
    });

    if (filtered.length === 0) {
        els.itemsContainer.innerHTML = '';
        els.emptyState.classList.remove('hidden');
        return;
    }

    els.emptyState.classList.add('hidden');
    els.itemsContainer.innerHTML = filtered.map(item => {
        const isProposer = item.proposedBy.memberId === state.member.id;
        const hasVoted = item.votes.some(v => v.memberId === state.member.id);
        const voteCount = item.votes.length;
        const voterNames = item.votes.map(v => v.memberName).join(', ');
        const statusClass = item.status.toLowerCase();
        const statusLabel = item.status.charAt(0).toUpperCase() + item.status.slice(1);

        return `
            <div class="item-card">
                <div class="item-header">
                    <div class="item-main-info">
                        <span class="category-tag">${escapeHTML(item.category)}</span>
                        <h3 class="item-title">${escapeHTML(item.title)}</h3>
                    </div>
                    <div class="item-badges">
                        <span class="badge status-badge status-${statusClass}">${statusLabel}</span>
                    </div>
                </div>
                <div class="item-desc">${escapeHTML(item.description)}</div>

                <div class="item-meta">
                    <div class="proposer-info">
                        <strong>${escapeHTML(item.proposedBy.memberName)}</strong>
                        <span>${escapeHTML(item.proposedBy.memberRole)} • ${timeAgo(item.proposedAt)}</span>
                    </div>
                    <div class="item-actions">
                        ${isProposer ? `<button class="btn-delete" data-id="${item.id}">Withdraw</button>` : ''}
                        <div class="vote-info">
                            <button class="btn-vote ${hasVoted ? 'voted' : ''}"
                                    data-id="${item.id}"
                                    ${isProposer ? 'disabled title="You automatically support your own proposal"' : ''}>
                                <span class="icon">${hasVoted ? '✓' : '↑'}</span> ${voteCount} ${voteCount === 1 ? 'Vote' : 'Votes'}
                            </button>
                            ${voteCount > 0 ? `
                                <div class="voters-tooltip">
                                    Supported by: ${escapeHTML(voterNames)}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateStats(stats) {
    els.statItems.textContent = stats.totalItems ?? 0;
    els.statMembers.textContent = stats.totalMembers ?? 0;
    els.statVotes.textContent = state.items.reduce((sum, item) => sum + item.votes.length, 0);
}

// ── Live Countdown ──
let countdownInterval = null;

function startCountdown() {
    function tick() {
        const now = new Date();
        const diff = MEETING_DATE - now;

        if (diff <= 0) {
            if (els.statDays)   els.statDays.textContent = '0';
            if (els.statTicker) els.statTicker.textContent = 'MEETING DAY!';
            return;
        }

        const totalSecs = Math.floor(diff / 1000);
        const days  = Math.floor(totalSecs / 86400);
        const hours = Math.floor((totalSecs % 86400) / 3600);
        const mins  = Math.floor((totalSecs % 3600)  / 60);
        const secs  = totalSecs % 60;

        if (els.statDays)   els.statDays.textContent = days;
        if (els.statTicker) els.statTicker.textContent =
            String(hours).padStart(2,'0') + ':' +
            String(mins).padStart(2,'0')  + ':' +
            String(secs).padStart(2,'0');
    }

    tick();
    countdownInterval = setInterval(tick, 1000);
}

// Legacy alias (called from init)
function updateDays() { /* replaced by startCountdown */ }

// ── Stat Tooltips ──
function populateMembersTooltip() {
    if (!els.membersTooltip) return;
    if (!state.members.length) return;

    // Sort alphabetically by surname (last word of name)
    const sorted = [...state.members].sort((a, b) => {
        const sA = a.name.split(' ').pop().toLowerCase();
        const sB = b.name.split(' ').pop().toLowerCase();
        return sA.localeCompare(sB);
    });

    els.membersTooltip.innerHTML = sorted.map(m => `
        <div class="stat-tooltip-row">
            <span class="stat-tooltip-name">${escapeHTML(m.name)}</span>
            <span class="stat-tooltip-role">${escapeHTML(m.role || '')}</span>
        </div>
    `).join('');
}

function populateItemsTooltip() {
    if (!els.itemsTooltip) return;

    if (!state.items.length) {
        els.itemsTooltip.innerHTML = '<div style="color:rgba(255,255,255,0.65);font-style:italic">No items yet</div>';
        return;
    }

    // Sort by votes desc
    const sorted = [...state.items].sort((a, b) => b.votes.length - a.votes.length);

    els.itemsTooltip.innerHTML = sorted.map(item => `
        <div class="stat-tooltip-row">
            <span class="stat-tooltip-name">${escapeHTML(item.title)}</span>
            <span class="stat-tooltip-role">${item.votes.length}v</span>
        </div>
    `).join('');
}

// ── Export Modal ──
async function showExportModal() {
    try {
        const data = await api.getExport();
        if (!data) return;

        const { meetingInfo, members, agenda } = data;

        let html = `
            <div class="print-agenda-header">
                <h1>${escapeHTML(meetingInfo.title)}</h1>
                <h3>School Governing Body & School Management Team</h3>
                <p><strong>Date:</strong> 21 August 2026 — 10:00</p>
                <p><strong>Venue:</strong> Staff Room</p>
                <p><strong>Type:</strong> Strategy Meeting — Way Forward</p>
                <p><strong>Members:</strong> ${members.map(m => `${m.title} ${m.name}`).join(', ')}</p>
                <p><em>Agenda generated on ${new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}</em></p>
            </div>
        `;

        if (agenda.length === 0) {
            html += '<p style="text-align:center; color:#718096; padding:2rem;">No agenda items have been proposed yet.</p>';
        } else {
            let itemNumber = 1;
            agenda.forEach(group => {
                html += `<h3 class="print-category">${escapeHTML(group.category)}</h3>`;
                html += '<div class="print-items">';
                group.items.forEach(item => {
                    const statusLabel = item.status.charAt(0).toUpperCase() + item.status.slice(1);
                    html += `
                        <div class="print-item">
                            <h4>${itemNumber}. ${escapeHTML(item.title)}
                                <small>(${statusLabel} — ${item.votes.length} ${item.votes.length === 1 ? 'vote' : 'votes'})</small>
                            </h4>
                            <p><em>Proposed by: ${escapeHTML(item.proposedBy.memberName)} (${escapeHTML(item.proposedBy.memberRole)})</em></p>
                            <p>${escapeHTML(item.description)}</p>
                        </div>
                    `;
                    itemNumber++;
                });
                html += '</div>';
            });
        }

        els.printableAgenda.innerHTML = html;
        els.modal.classList.add('active');
    } catch (error) {
        showToast('Failed to generate agenda preview', true);
    }
}

// ── Utilities ──
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}

function timeAgo(isoString) {
    const seconds = Math.floor((new Date() - new Date(isoString)) / 1000);
    if (seconds < 60) return 'just now';
    const intervals = [
        { label: 'year', seconds: 31536000 },
        { label: 'month', seconds: 2592000 },
        { label: 'week', seconds: 604800 },
        { label: 'day', seconds: 86400 },
        { label: 'hour', seconds: 3600 },
        { label: 'minute', seconds: 60 }
    ];
    for (const interval of intervals) {
        const count = Math.floor(seconds / interval.seconds);
        if (count >= 1) return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
    }
    return 'just now';
}

function showToast(message, isError = false) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    if (isError) toast.style.backgroundColor = 'var(--danger)';
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ── Polling ──
let pollTimer = null;
let countdownTimer = null;

function startPolling() {
    let secondsLeft = 15;
    countdownTimer = setInterval(() => {
        secondsLeft--;
        if (els.refreshCountdown) els.refreshCountdown.textContent = Math.max(0, secondsLeft);
        if (secondsLeft <= 0) secondsLeft = 15;
    }, 1000);
    pollTimer = setInterval(async () => { await loadData(); }, POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    if (countdownTimer) clearInterval(countdownTimer);
}

// ── Start ──
init();
