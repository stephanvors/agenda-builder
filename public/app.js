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
    sort: 'votes',
    openComments: new Set(), // item IDs with expanded comment drawers
    activeCommentType: {},   // { [itemId]: 'idea' | 'action' | 'question' | 'comment' }
    commentDrafts: {}        // { [itemId]: 'draft text' }
};

const MEETING_DATE = new Date('2026-08-28T10:00:00');
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

    async addComment(itemId, content, type = 'comment') {
        const res = await fetch(`/api/items/${itemId}/comments`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ content, type })
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to add comment');
        }
        return res.json();
    },

    async deleteComment(itemId, commentId) {
        const res = await fetch(`/api/items/${itemId}/comments/${commentId}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to delete comment');
        }
        return res.json();
    },

    async resolveItem(itemId, solutionText, commentId = null) {
        const res = await fetch(`/api/items/${itemId}/resolve`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ solutionText, commentId })
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to resolve item');
        }
        return res.json();
    },

    async unresolveItem(itemId) {
        const res = await fetch(`/api/items/${itemId}/resolve`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to clear resolution');
        }
        return res.json();
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
    statCardMembers:  document.getElementById('stat-card-members'),
    statCardItems:    document.getElementById('stat-card-items'),
    statCardVotes:    document.getElementById('stat-card-votes'),

    infoModal:        document.getElementById('info-modal'),
    infoModalTitle:   document.getElementById('info-modal-title'),
    infoModalBody:    document.getElementById('info-modal-body'),
    btnCloseInfoModal:document.getElementById('btn-close-info-modal'),

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
    initHistoryNavigation();
    startCountdown();
}

// Load member names into the login dropdown
async function loadMemberList() {
    try {
        const members = await api.getMemberList();
        els.loginMember.innerHTML = '<option value="" disabled selected>Choose your name...</option>';
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

    // Item container events (delegation)
    els.itemsContainer.addEventListener('click', handleItemAction);

    // Track drafts when typing in comment textareas
    els.itemsContainer.addEventListener('input', (e) => {
        if (e.target.classList.contains('comment-textarea')) {
            const itemId = e.target.dataset.itemId;
            if (itemId) {
                state.commentDrafts[itemId] = e.target.value;
            }
        }
    });

    // Support Ctrl+Enter / Cmd+Enter to post comment
    els.itemsContainer.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('comment-textarea') && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            const itemId = e.target.dataset.itemId;
            if (itemId) {
                submitCommentForItem(itemId);
            }
        }
    });

    // Stat cards click handlers (opens clean dialogs)
    if (els.statCardMembers) {
        els.statCardMembers.addEventListener('click', showMembersModal);
        els.statCardMembers.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') showMembersModal(); });
    }
    if (els.statCardItems) {
        els.statCardItems.addEventListener('click', showItemsModal);
        els.statCardItems.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') showItemsModal(); });
    }
    if (els.statCardVotes) {
        els.statCardVotes.addEventListener('click', showVotesModal);
        els.statCardVotes.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') showVotesModal(); });
    }

    // Info modal close handlers
    if (els.btnCloseInfoModal) {
        els.btnCloseInfoModal.addEventListener('click', closeInfoModal);
    }
    if (els.infoModal) {
        els.infoModal.addEventListener('click', (e) => {
            if (e.target === els.infoModal) closeInfoModal();
        });
    }

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

    // Toggle comments drawer
    if (btn.classList.contains('btn-toggle-comments')) {
        const id = btn.dataset.id;
        if (state.openComments.has(id)) {
            state.openComments.delete(id);
        } else {
            state.openComments.add(id);
        }
        renderItems();
        if (state.openComments.has(id)) {
            const textarea = document.getElementById(`comment-input-${id}`);
            if (textarea) textarea.focus();
        }
        return;
    }

    // Comment Tag selector
    if (btn.classList.contains('composer-type-btn')) {
        const itemId = btn.dataset.itemId;
        const type = btn.dataset.type;
        state.activeCommentType[itemId] = type;
        const parent = btn.closest('.composer-type-selector');
        if (parent) {
            parent.querySelectorAll('.composer-type-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        }
        return;
    }

    // Post comment button
    if (btn.classList.contains('btn-post-comment')) {
        const itemId = btn.dataset.itemId;
        if (itemId) {
            await submitCommentForItem(itemId);
        }
        return;
    }

    // Delete comment button
    if (btn.classList.contains('btn-delete-comment')) {
        const itemId = btn.dataset.itemId;
        const commentId = btn.dataset.commentId;
        if (confirm('Are you sure you want to delete this comment?')) {
            try {
                await api.deleteComment(itemId, commentId);
                showToast('Comment deleted');
                await loadData();
            } catch (error) {
                showToast(error.message || 'Failed to delete comment', true);
            }
        }
        return;
    }

    // Mark comment as accepted solution
    if (btn.classList.contains('btn-mark-solution')) {
        const itemId = btn.dataset.itemId;
        const commentId = btn.dataset.commentId;
        const commentText = btn.dataset.commentText || '';
        if (confirm(`Accept this contribution as the agreed solution/resolution for this agenda item?\n\n"${commentText}"`)) {
            try {
                await api.resolveItem(itemId, commentText, commentId);
                showToast('Topic marked as Resolved with accepted solution!');
                await loadData();
            } catch (error) {
                showToast(error.message || 'Failed to resolve item', true);
            }
        }
        return;
    }

    // Direct resolve item button (proposer entering a resolution summary)
    if (btn.classList.contains('btn-resolve-direct')) {
        const itemId = btn.dataset.id;
        const solution = prompt('Enter the agreed resolution, decision, or action plan for this agenda item:');
        if (solution && solution.trim()) {
            try {
                await api.resolveItem(itemId, solution.trim());
                showToast('Topic marked as Resolved with agreed action plan!');
                await loadData();
            } catch (error) {
                showToast(error.message || 'Failed to resolve item', true);
            }
        }
        return;
    }

    // Reopen / clear resolution
    if (btn.classList.contains('btn-res-unresolve') || btn.classList.contains('btn-unresolve')) {
        const itemId = btn.dataset.itemId || btn.dataset.id;
        if (confirm('Reopen this topic and clear the resolved status?')) {
            try {
                await api.unresolveItem(itemId);
                showToast('Topic reopened');
                await loadData();
            } catch (error) {
                showToast(error.message || 'Failed to reopen topic', true);
            }
        }
        return;
    }

    // Vote button
    if (btn.classList.contains('btn-vote')) {
        const id = btn.dataset.id;
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
        return;
    }

    // Delete item button
    if (btn.classList.contains('btn-delete')) {
        const id = btn.dataset.id;
        if (confirm('Are you sure you want to withdraw this proposed agenda item?')) {
            try {
                await api.deleteItem(id);
                showToast('Agenda item withdrawn');
                await loadData();
            } catch (error) {
                showToast(error.message || 'Failed to delete item', true);
            }
        }
        return;
    }
}

// Post comment helper
async function submitCommentForItem(itemId) {
    const textarea = document.getElementById(`comment-input-${itemId}`);
    const content = (textarea ? textarea.value : (state.commentDrafts[itemId] || '')).trim();

    if (!content) {
        showToast('Please enter your comment or idea before posting', true);
        if (textarea) textarea.focus();
        return;
    }

    const type = state.activeCommentType[itemId] || 'comment';
    const postBtn = document.querySelector(`.btn-post-comment[data-item-id="${itemId}"]`);
    if (postBtn) {
        postBtn.disabled = true;
        postBtn.textContent = 'Posting...';
    }

    try {
        await api.addComment(itemId, content, type);
        delete state.commentDrafts[itemId];
        state.openComments.add(itemId);
        showToast('Comment posted!');
        await loadData();
    } catch (error) {
        showToast(error.message || 'Failed to post comment', true);
        if (postBtn) {
            postBtn.disabled = false;
            postBtn.textContent = 'Post';
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
        // Save current focused textarea if any
        let activeInputId = null;
        let activeSelectionStart = 0;
        let activeSelectionEnd = 0;
        if (document.activeElement && document.activeElement.classList.contains('comment-textarea')) {
            activeInputId = document.activeElement.id;
            activeSelectionStart = document.activeElement.selectionStart;
            activeSelectionEnd = document.activeElement.selectionEnd;
        }

        const [items, stats] = await Promise.all([
            api.getItems(),
            api.getStats()
        ]);
        state.items = items;
        renderItems();

        // Restore focus if appropriate
        if (activeInputId) {
            const restoredEl = document.getElementById(activeInputId);
            if (restoredEl) {
                restoredEl.focus();
                try {
                    restoredEl.setSelectionRange(activeSelectionStart, activeSelectionEnd);
                } catch { /* ignore */ }
            }
        }

        if (stats) {
            updateStats(stats);
            // Cache members list if needed
            if (state.members.length === 0) {
                try {
                    state.members = await api.getMemberList();
                } catch { /* non-critical */ }
            }
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// ── Rendering ──
function renderItems() {
    let filtered = state.items.filter(item => {
        const matchCat = state.filters.category === 'All' || item.category === state.filters.category;
        
        let matchStatus = true;
        if (state.filters.status !== 'All') {
            if (state.filters.status.toLowerCase() === 'resolved') {
                matchStatus = Boolean(item.isResolved);
            } else {
                matchStatus = item.status.toLowerCase() === state.filters.status.toLowerCase();
            }
        }
        
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
        const isResolved = Boolean(item.isResolved);
        const comments = Array.isArray(item.comments) ? item.comments : [];
        const commentCount = comments.length;
        const isOpen = state.openComments.has(item.id);
        const selectedType = state.activeCommentType[item.id] || 'idea';
        const draftText = state.commentDrafts[item.id] || '';

        const typeLabels = {
            idea: '💡 Idea / Solution',
            action: '🎯 Action Step',
            question: '❓ Question',
            comment: '💬 Discussion'
        };

        return `
            <div class="item-card ${isResolved ? 'card-resolved' : ''}" id="item-${item.id}">
                <div class="item-header">
                    <div class="item-main-info">
                        <span class="category-tag">${escapeHTML(item.category)}</span>
                        <h3 class="item-title">${escapeHTML(item.title)}</h3>
                    </div>
                    <div class="item-badges">
                        ${isResolved ? '<span class="badge status-badge badge-resolved">Resolved</span>' : ''}
                        <span class="badge status-badge status-${statusClass}">${statusLabel}</span>
                    </div>
                </div>

                ${isResolved && item.resolution ? `
                    <div class="item-resolution-banner">
                        <div class="res-banner-header">
                            <span class="res-banner-badge">✅ RESOLUTION / AGREED SOLUTION</span>
                            ${(isProposer || (item.resolution.resolvedBy && item.resolution.resolvedBy.memberId === state.member.id)) ? `
                                <button class="btn-res-unresolve" data-item-id="${item.id}" title="Reopen this topic / clear resolution">Reopen</button>
                            ` : ''}
                        </div>
                        <div class="res-banner-body">${escapeHTML(item.resolution.solutionText)}</div>
                        <div class="res-banner-meta">
                            Resolved by <strong>${escapeHTML(item.resolution.resolvedBy ? item.resolution.resolvedBy.memberName : 'Member')}</strong> • ${timeAgo(item.resolution.resolvedAt)}
                        </div>
                    </div>
                ` : ''}

                <div class="item-desc">${escapeHTML(item.description)}</div>

                <div class="item-meta">
                    <div class="proposer-info">
                        <strong>${escapeHTML(item.proposedBy.memberName)}</strong>
                        <span>${escapeHTML(item.proposedBy.memberRole)} • ${timeAgo(item.proposedAt)}</span>
                        ${voteCount > 0 ? `
                            <span class="voters-preview">
                                Supported by: <strong>${escapeHTML(voterNames)}</strong>
                            </span>
                        ` : ''}
                    </div>
                    <div class="item-actions">
                        <div class="item-actions-left">
                            ${isProposer ? `<button class="btn-delete" data-id="${item.id}">Withdraw</button>` : ''}
                            <button class="btn-toggle-comments ${commentCount > 0 ? 'has-comments' : ''} ${isOpen ? 'active' : ''}" data-id="${item.id}">
                                <span class="comment-icon">💬</span>
                                <span class="comment-count-label">${commentCount > 0 ? `${commentCount} ${commentCount === 1 ? 'Comment' : 'Comments'}` : 'Brainstorm'}</span>
                                <span class="comment-chevron">${isOpen ? '▲' : '▼'}</span>
                            </button>
                        </div>
                        <div class="vote-info">
                            <button class="btn-vote ${hasVoted ? 'voted' : ''}"
                                    data-id="${item.id}"
                                    ${isProposer ? 'disabled title="You automatically support your own proposal"' : ''}>
                                <span class="icon">${hasVoted ? '✓' : '↑'}</span> ${voteCount} ${voteCount === 1 ? 'Vote' : 'Votes'}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Comments & Brainstorming Drawer -->
                <div class="item-comments-container ${isOpen ? 'open' : ''}" id="comments-container-${item.id}">
                    <div class="comments-section-header">
                        <h4>Brainstorming & Discussion <span class="comments-counter">(${commentCount})</span></h4>
                        ${!isResolved && isProposer ? `
                            <button class="btn-resolve-direct" data-id="${item.id}" title="Mark this issue as resolved with an agreed decision or plan">
                                ✅ Mark as Resolved
                            </button>
                        ` : ''}
                    </div>

                    <!-- Comments List -->
                    <div class="comments-list">
                        ${commentCount === 0 ? `
                            <div class="comments-empty-hint">
                                <span class="empty-sparkle">💡</span>
                                <p>No brainstorm ideas or comments yet. Share your thoughts or propose a solution below!</p>
                            </div>
                        ` : comments.map(c => {
                            const isCommentAuthor = c.memberId === state.member.id;
                            const canDelete = isCommentAuthor || isProposer;
                            const isSol = Boolean(c.isSolution);
                            const type = c.type || 'comment';
                            const typeLabel = typeLabels[type] || '💬 Discussion';

                            return `
                                <div class="comment-item ${isSol ? 'is-solution' : ''}" id="comment-${c.id}">
                                    <div class="comment-avatar">${getInitials(c.memberName)}</div>
                                    <div class="comment-main">
                                        <div class="comment-header-row">
                                            <div class="comment-author-info">
                                                <strong class="comment-author-name">${escapeHTML(c.memberName)}</strong>
                                                <span class="comment-author-role">${escapeHTML(c.memberRole || 'Member')}</span>
                                                <span class="comment-time">• ${timeAgo(c.createdAt)}</span>
                                            </div>
                                            <div class="comment-tag-wrapper">
                                                <span class="comment-type-badge type-${type}">${typeLabel}</span>
                                                ${isSol ? '<span class="badge-solution-pill">⭐ Accepted Solution</span>' : ''}
                                            </div>
                                        </div>
                                        <div class="comment-text">${escapeHTML(c.content)}</div>
                                        <div class="comment-footer-actions">
                                            ${(!isResolved && (isProposer || isCommentAuthor)) ? `
                                                <button class="btn-mark-solution" data-item-id="${item.id}" data-comment-id="${c.id}" data-comment-text="${escapeHTML(c.content)}" title="Accept this comment as the resolution">
                                                    ⭐ Accept as Solution
                                                </button>
                                            ` : ''}
                                            ${canDelete ? `
                                                <button class="btn-delete-comment" data-item-id="${item.id}" data-comment-id="${c.id}" title="Delete comment">
                                                    Delete
                                                </button>
                                            ` : ''}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <!-- Comment Composer -->
                    <div class="comment-composer">
                        <div class="composer-type-selector">
                            <span class="composer-type-label">Tag as:</span>
                            <button type="button" class="composer-type-btn ${selectedType === 'idea' ? 'selected' : ''}" data-item-id="${item.id}" data-type="idea">
                                💡 Idea
                            </button>
                            <button type="button" class="composer-type-btn ${selectedType === 'action' ? 'selected' : ''}" data-item-id="${item.id}" data-type="action">
                                🎯 Action
                            </button>
                            <button type="button" class="composer-type-btn ${selectedType === 'question' ? 'selected' : ''}" data-item-id="${item.id}" data-type="question">
                                ❓ Question
                            </button>
                            <button type="button" class="composer-type-btn ${selectedType === 'comment' ? 'selected' : ''}" data-item-id="${item.id}" data-type="comment">
                                💬 Discussion
                            </button>
                        </div>
                        <div class="composer-input-row">
                            <textarea
                                class="comment-textarea"
                                id="comment-input-${item.id}"
                                data-item-id="${item.id}"
                                rows="2"
                                placeholder="Share an idea, ask a question, or suggest a solution..."
                            >${escapeHTML(draftText)}</textarea>
                            <button class="btn btn-primary btn-post-comment" data-item-id="${item.id}">
                                Post
                            </button>
                        </div>
                        <div class="composer-hints">
                            <small>Tip: Press <strong>Ctrl + Enter</strong> to post immediately</small>
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

// ── Info Modals (Members, Items, Voting Breakdown) ──
function getInitials(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function openInfoModal(title, contentHtml) {
    if (!els.infoModal || !els.infoModalBody) return;
    els.infoModalTitle.textContent = title;
    els.infoModalBody.innerHTML = contentHtml;
    els.infoModal.classList.add('active');
}

function closeInfoModal() {
    if (els.infoModal) {
        els.infoModal.classList.remove('active');
    }
}

async function showMembersModal() {
    if (state.members.length === 0) {
        try {
            state.members = await api.getMemberList();
        } catch { /* fallback */ }
    }

    // Sort alphabetically by surname
    const sorted = [...state.members].sort((a, b) => {
        const sA = a.name.split(' ').pop().toLowerCase();
        const sB = b.name.split(' ').pop().toLowerCase();
        return sA.localeCompare(sB);
    });

    const listHtml = `
        <div class="modal-list">
            ${sorted.map(m => `
                <div class="modal-member-card">
                    <div class="modal-member-main">
                        <div class="modal-member-avatar">${getInitials(m.name)}</div>
                        <div class="modal-member-info">
                            <span class="modal-member-name">${escapeHTML((m.title ? m.title + ' ' : '') + m.name)}</span>
                            <span class="modal-member-role">${escapeHTML(m.role || 'Member')}</span>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    openInfoModal(`Meeting Members (${sorted.length})`, listHtml);
}

function showItemsModal() {
    if (!state.items.length) {
        openInfoModal('Proposed Items (0)', '<p style="text-align:center;color:var(--text-muted);padding:2rem;">No items proposed yet.</p>');
        return;
    }

    const sorted = [...state.items].sort((a, b) => b.votes.length - a.votes.length);

    const listHtml = `
        <div class="modal-list">
            ${sorted.map((item, idx) => `
                <div class="modal-item-card" onclick="scrollToItem('${item.id}')">
                    <div class="modal-item-info">
                        <div class="modal-item-title">${idx + 1}. ${escapeHTML(item.title)}</div>
                        <div class="modal-item-sub">${escapeHTML(item.category)} • By ${escapeHTML(item.proposedBy.memberName)}</div>
                    </div>
                    <div class="modal-vote-pill">
                        ↑ ${item.votes.length}
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    openInfoModal(`Proposed Agenda Items (${sorted.length})`, listHtml);
}

function showVotesModal() {
    if (!state.items.length) {
        openInfoModal('Voting Summary (0)', '<p style="text-align:center;color:var(--text-muted);padding:2rem;">No votes recorded yet.</p>');
        return;
    }

    const totalVotes = state.items.reduce((sum, item) => sum + item.votes.length, 0);
    const sorted = [...state.items].filter(i => i.votes.length > 0).sort((a, b) => b.votes.length - a.votes.length);

    const listHtml = `
        <div class="modal-list">
            ${sorted.map(item => `
                <div class="modal-member-card" style="flex-direction:column;align-items:flex-start;gap:0.4rem;" onclick="scrollToItem('${item.id}')">
                    <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                        <strong style="color:var(--primary);font-size:0.88rem;">${escapeHTML(item.title)}</strong>
                        <span class="modal-vote-pill">↑ ${item.votes.length}</span>
                    </div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">
                        Voters: <strong>${escapeHTML(item.votes.map(v => v.memberName).join(', '))}</strong>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    openInfoModal(`Total Votes (${totalVotes})`, listHtml);
}

// Global scroll helper for modal item cards
window.scrollToItem = function(itemId) {
    closeInfoModal();
    setTimeout(() => {
        const el = document.getElementById('item-' + itemId);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.style.boxShadow = '0 0 0 3px var(--primary)';
            setTimeout(() => { el.style.boxShadow = ''; }, 2000);
        }
    }, 150);
};

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
                <p><strong>Date:</strong> 28 August 2026 — 10:00</p>
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
                    const comments = Array.isArray(item.comments) ? item.comments : [];
                    const isResolved = Boolean(item.isResolved);

                    html += `
                        <div class="print-item ${isResolved ? 'print-item-resolved' : ''}">
                            <h4>${itemNumber}. ${escapeHTML(item.title)}
                                <small>(${isResolved ? 'Resolved • ' : ''}${statusLabel} — ${item.votes.length} ${item.votes.length === 1 ? 'vote' : 'votes'})</small>
                            </h4>
                            <p class="print-meta"><em>Proposed by: ${escapeHTML(item.proposedBy.memberName)} (${escapeHTML(item.proposedBy.memberRole)})</em></p>
                            <p class="print-desc">${escapeHTML(item.description)}</p>

                            ${isResolved && item.resolution ? `
                                <div class="print-resolution-box">
                                    <strong>✅ Resolution / Agreed Plan:</strong> ${escapeHTML(item.resolution.solutionText)}
                                    <span class="print-res-by">(Resolved by ${escapeHTML(item.resolution.resolvedBy ? item.resolution.resolvedBy.memberName : 'Member')})</span>
                                </div>
                            ` : ''}

                            ${comments.length > 0 ? `
                                <div class="print-comments-box">
                                    <div class="print-comments-title">Brainstorming & Discussion (${comments.length}):</div>
                                    <ul class="print-comments-list">
                                        ${comments.map(c => `
                                            <li>
                                                <strong>${escapeHTML(c.memberName)}</strong>
                                                <span class="print-tag">[${escapeHTML(c.type || 'comment')}]</span>:
                                                ${escapeHTML(c.content)}
                                                ${c.isSolution ? ' <em>(⭐ Accepted Solution)</em>' : ''}
                                            </li>
                                        `).join('')}
                                    </ul>
                                </div>
                            ` : ''}
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

// ── Mobile & Browser Back-Button Management ──
let lastBackPressTime = 0;

function initHistoryNavigation() {
    try {
        history.replaceState({ app: 'agenda-base' }, '');
        history.pushState({ app: 'agenda-active' }, '');
    } catch (e) {
        // history API may throw in some restricted environments
    }

    window.addEventListener('popstate', () => {
        handleBackNavigation();
    });
}

function rearmHistory() {
    try {
        history.pushState({ app: 'agenda-active' }, '');
    } catch (e) { /* ignore */ }
}

function handleBackNavigation() {
    // 1. Info Modal (Members, Items, Voting Breakdown)
    if (els.infoModal && els.infoModal.classList.contains('active')) {
        closeInfoModal();
        rearmHistory();
        return;
    }

    // 2. Export / View Agenda Modal
    if (els.modal && els.modal.classList.contains('active')) {
        els.modal.classList.remove('active');
        rearmHistory();
        return;
    }

    // 3. Propose Item Form (if expanded)
    if (els.submitContainer && !els.submitContainer.classList.contains('collapsed')) {
        els.submitContainer.classList.add('collapsed');
        if (els.titleError) els.titleError.textContent = '';
        if (els.descError) els.descError.textContent = '';
        rearmHistory();
        return;
    }

    // 4. Any expanded comment / brainstorm drawers
    if (state.openComments && state.openComments.size > 0) {
        state.openComments.clear();
        renderItems();
        rearmHistory();
        return;
    }

    // 5. Base Screen (Main View or Login View) -> Double back to exit
    const now = Date.now();
    if (now - lastBackPressTime < 2000) {
        // Double press within 2s -> Allow exit
        history.back();
    } else {
        lastBackPressTime = now;
        showToast('Press back again to exit');
        rearmHistory();
    }
}

// ── Start ──
init();
