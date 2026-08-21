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
    documents: [],   // shared files & documents
    categories: [],  // agenda item categories
    documentTags: [], // file vault tags (flat array)
    selectedUploadTags: [], // tags selected for current upload
    activeTab: 'agenda', // 'agenda' | 'documents'
    activeCategoryModalType: 'agenda', // 'agenda' | 'documents'
    filters: {
        category: 'All',
        status: 'All'
    },
    docFilters: {
        tags: [],        // active tag filters (multi-select OR)
        sort: 'newest',
        search: ''
    },
    sort: 'votes',
    openComments: new Set(), // item IDs with expanded comment drawers
    activeCommentType: {},   // { [itemId]: 'idea' | 'action' | 'question' | 'comment' }
    commentDrafts: {},       // { [itemId]: 'draft text' }
    editingComments: {}      // { [commentId]: { content: '...', type: '...' } }
};

// Check if current user has Admin privileges
function isAdmin() {
    if (!state.member) return false;
    const name = (state.member.name || '').toLowerCase().trim();
    const role = (state.member.role || '').toLowerCase().trim();
    return name === 'stephen vorster' || role.includes('admin') || role.includes('principal') || role.includes('chairperson');
}

const APP_VERSION = '20260821-26';
const MEETING_DATE = new Date('2026-08-27T10:00:00');
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

    async getMeetingInfo() {
        const res = await fetch('/api/meeting-info');
        if (!res.ok) throw new Error('Failed to load meeting info');
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

    async getMe() {
        const res = await fetch('/api/me', { headers: authHeaders() });
        if (!res.ok) throw new Error('Session invalid');
        return res.json();
    },

    async logout() {
        await fetch('/api/logout', { method: 'POST', headers: authHeaders() });
    },

    async getMembers() {
        const res = await fetch('/api/members', { headers: authHeaders() });
        if (res.status === 401) { handleSessionExpired(); return []; }
        if (!res.ok) throw new Error('Failed to load members');
        return res.json();
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
            throw new Error(err.error || 'Failed to submit proposal');
        }
        return res.json();
    },

    async voteItem(itemId) {
        const res = await fetch(`/api/items/${itemId}/vote`, {
            method: 'POST',
            headers: authHeaders()
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to vote');
        }
        return res.json();
    },

    async unvoteItem(itemId) {
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
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to delete item');
        }
        return res.json();
    },

    async addComment(itemId, content, type = 'idea') {
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

    async editComment(itemId, commentId, content, type = 'idea') {
        const res = await fetch(`/api/items/${itemId}/comments/${commentId}`, {
            method: 'PATCH',
            headers: authHeaders(),
            body: JSON.stringify({ content, type })
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to update comment');
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

    async resolveItem(itemId, solutionText) {
        const res = await fetch(`/api/items/${itemId}/resolve`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ solutionText })
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to record resolution');
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
    },

    async getDocuments() {
        const res = await fetch('/api/documents', { headers: authHeaders() });
        if (res.status === 401) { handleSessionExpired(); return { documents: [], tags: [] }; }
        if (!res.ok) throw new Error('Failed to load shared documents');
        return res.json();
    },

    uploadDocument(formData, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/documents/upload');
            if (state.token) {
                xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);
            }

            if (xhr.upload && onProgress) {
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        onProgress(percent);
                    }
                };
            }

            xhr.onload = () => {
                if (xhr.status === 401) {
                    handleSessionExpired();
                    return reject(new Error('Session expired'));
                }
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(data.error || 'Upload failed'));
                    }
                } catch {
                    reject(new Error('Upload failed'));
                }
            };

            xhr.onerror = () => reject(new Error('Network error during file upload'));
            xhr.send(formData);
        });
    },

    async deleteDocument(docId) {
        const res = await fetch(`/api/documents/${docId}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to delete document');
        }
        return res.json();
    },

    // ── Category API Methods (Admin) ──
    async addAgendaCategory(name, parent = null) {
        const res = await fetch('/api/categories/agenda', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ name, parent })
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to add agenda category');
        }
        return res.json();
    },

    async deleteAgendaCategory(name) {
        const res = await fetch(`/api/categories/agenda/${encodeURIComponent(name)}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to delete agenda category');
        }
        return res.json();
    },

    async addDocumentCategory(name) {
        const res = await fetch('/api/categories/documents', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ name })
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to add document tag');
        }
        return res.json();
    },

    async deleteDocumentCategory(name) {
        const res = await fetch(`/api/categories/documents/${encodeURIComponent(name)}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to delete document tag');
        }
        return res.json();
    },

    async moveCategory(type, sourcePath, targetParentPath = null) {
        const res = await fetch('/api/categories/move', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ type, sourcePath, targetParentPath })
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to move category');
        }
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
    statDocs:         document.getElementById('stat-docs'),
    statCardMembers:  document.getElementById('stat-card-members'),
    statCardItems:    document.getElementById('stat-card-items'),
    statCardVotes:    document.getElementById('stat-card-votes'),
    statCardDocs:     document.getElementById('stat-card-docs'),

    tabBtnAgenda:     document.getElementById('tab-btn-agenda'),
    tabBtnDocuments:  document.getElementById('tab-btn-documents'),
    tabAgendaBadge:   document.getElementById('tab-agenda-badge'),
    tabDocsBadge:     document.getElementById('tab-docs-badge'),
    tabViewAgenda:    document.getElementById('tab-view-agenda'),
    tabViewDocuments: document.getElementById('tab-view-documents'),

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

    itemCategory:         document.getElementById('item-category'),
    filterCategory:       document.getElementById('filter-category'),
    btnManageAgendaCats:  document.getElementById('btn-manage-agenda-cats'),
    btnAddAgendaCatInline:document.getElementById('btn-add-agenda-cat-inline'),
    sortItems:            document.getElementById('sort-items'),
    statusFilters:        document.getElementById('status-filters'),

    itemsContainer:   document.getElementById('agenda-items-container'),
    emptyState:       document.getElementById('empty-state'),

    // Documents Vault Elements
    btnToggleUpload:      document.getElementById('btn-toggle-upload'),
    uploadDocContainer:   document.getElementById('upload-doc-container'),
    uploadDocForm:        document.getElementById('upload-doc-form'),
    fileDropZone:         document.getElementById('file-drop-zone'),
    docFileInput:         document.getElementById('doc-file-input'),
    dropZoneTitle:        document.getElementById('drop-zone-title'),
    dropZoneHint:         document.getElementById('drop-zone-hint'),
    docFileError:         document.getElementById('doc-file-error'),
    docTitle:             document.getElementById('doc-title'),
    docTagPicker:         document.getElementById('doc-tag-picker'),
    docTagNewInput:       document.getElementById('doc-tag-new-input'),
    docTagsError:         document.getElementById('doc-tags-error'),
    btnManageDocTags:     document.getElementById('btn-manage-doc-tags'),
    docDescription:       document.getElementById('doc-description'),
    uploadProgressWrapper: document.getElementById('upload-progress-wrapper'),
    uploadProgressFill:   document.getElementById('upload-progress-fill'),
    uploadProgressText:   document.getElementById('upload-progress-text'),
    uploadProgressPercent: document.getElementById('upload-progress-percent'),
    btnCancelUpload:      document.getElementById('btn-cancel-upload'),
    btnSubmitUpload:      document.getElementById('btn-submit-upload'),

    docTagFilterStrip:    document.getElementById('doc-tag-filter-strip'),
    sortDocs:             document.getElementById('sort-docs'),
    btnManageDocTagsModal:document.getElementById('btn-manage-doc-tags-modal'),
    docSearchInput:       document.getElementById('doc-search-input'),
    documentsContainer:   document.getElementById('documents-container'),
    documentsEmptyState:  document.getElementById('documents-empty-state'),

    // Category Management Modal Elements (Admin)
    categoryModal:          document.getElementById('category-modal'),
    categoryModalTitle:     document.getElementById('category-modal-title'),
    categoryModalDesc:      document.getElementById('category-modal-desc'),
    btnCloseCategoryModal:  document.getElementById('btn-close-category-modal'),
    addCategoryForm:        document.getElementById('add-category-form'),
    catBuilderCard:         document.getElementById('cat-builder-card'),
    catParentL1:            document.getElementById('cat-parent-l1'),
    catParentL2:            document.getElementById('cat-parent-l2'),
    catParentL2Group:       document.getElementById('cat-parent-l2-group'),
    catTargetPath:          document.getElementById('cat-target-path'),
    newCategoryInput:       document.getElementById('new-category-input'),
    btnSubmitNewCategory:   document.getElementById('btn-submit-new-category'),
    categoryModalError:     document.getElementById('category-modal-error'),
    categoryModalListTitle: document.getElementById('category-modal-list-title'),
    categoryModalCount:     document.getElementById('category-modal-count'),
    catDragTip:             document.getElementById('cat-drag-tip'),
    catDropRootZone:        document.getElementById('cat-drop-root-zone'),
    categoryTreeContainer:  document.getElementById('category-tree-container'),

    btnExport:        document.getElementById('btn-export'),
    modal:            document.getElementById('export-modal'),
    btnPrint:         document.getElementById('btn-print'),
    btnCloseModal:    document.getElementById('btn-close-modal'),
    printableAgenda:  document.getElementById('printable-agenda'),

    refreshCountdown: document.getElementById('refresh-countdown')
};

// ── Initialisation ──
async function init() {
    setupEventListeners();
    initHistoryNavigation();
    startCountdown();

    const savedToken = localStorage.getItem('agenda_token');

    if (savedToken) {
        state.token = savedToken;
        try {
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
        } catch (err) {
            console.error('Session verify failed:', err);
            await loadMemberList();
        }
    } else {
        await loadMemberList();
    }
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

    // Track drafts when typing in comment textareas (both new comments and edits)
    els.itemsContainer.addEventListener('input', (e) => {
        if (e.target.classList.contains('comment-edit-textarea')) {
            const commentId = e.target.dataset.commentId;
            if (commentId && state.editingComments[commentId]) {
                state.editingComments[commentId].content = e.target.value;
            }
        } else if (e.target.classList.contains('comment-textarea')) {
            const itemId = e.target.dataset.itemId;
            if (itemId) {
                state.commentDrafts[itemId] = e.target.value;
            }
        }
    });

    // Support Ctrl+Enter / Cmd+Enter to post or save comment, and Escape to cancel edit
    els.itemsContainer.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('comment-edit-textarea')) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                const commentId = e.target.dataset.commentId;
                const saveBtn = els.itemsContainer.querySelector(`.btn-save-edit-comment[data-comment-id="${commentId}"]`);
                if (saveBtn) saveBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const commentId = e.target.dataset.commentId;
                delete state.editingComments[commentId];
                renderItems();
            }
        } else if (e.target.classList.contains('comment-textarea') && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            const itemId = e.target.dataset.itemId;
            if (itemId) {
                submitCommentForItem(itemId);
            }
        }
    });

    // Main View Tabs navigation (direct listeners + event delegation for maximum reliability)
    if (els.tabBtnAgenda) {
        els.tabBtnAgenda.addEventListener('click', (e) => { e.preventDefault(); switchTab('agenda'); });
        els.tabBtnAgenda.addEventListener('touchend', (e) => { e.preventDefault(); switchTab('agenda'); }, { passive: false });
    }
    if (els.tabBtnDocuments) {
        els.tabBtnDocuments.addEventListener('click', (e) => { e.preventDefault(); switchTab('documents'); });
        els.tabBtnDocuments.addEventListener('touchend', (e) => { e.preventDefault(); switchTab('documents'); }, { passive: false });
    }

    document.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.tab-nav-btn');
        if (tabBtn) {
            e.preventDefault();
            const tab = tabBtn.dataset.tab;
            if (tab) switchTab(tab);
        }
    });

    // Stat cards click handlers (opens clean dialogs or switches tab)
    if (els.statCardMembers) {
        els.statCardMembers.addEventListener('click', showMembersModal);
        els.statCardMembers.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') showMembersModal(); });
    }
    if (els.statCardItems) {
        els.statCardItems.addEventListener('click', () => {
            switchTab('agenda');
            showItemsModal();
        });
        els.statCardItems.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { switchTab('agenda'); showItemsModal(); } });
    }
    if (els.statCardVotes) {
        els.statCardVotes.addEventListener('click', showVotesModal);
        els.statCardVotes.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') showVotesModal(); });
    }
    if (els.statCardDocs) {
        els.statCardDocs.addEventListener('click', () => switchTab('documents'));
        els.statCardDocs.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') switchTab('documents'); });
    }

    // Document Upload and Vault Listeners
    if (els.btnToggleUpload) els.btnToggleUpload.addEventListener('click', toggleUploadForm);
    if (els.btnCancelUpload) els.btnCancelUpload.addEventListener('click', toggleUploadForm);
    if (els.uploadDocForm) els.uploadDocForm.addEventListener('submit', handleSubmitUpload);

    if (els.fileDropZone && els.docFileInput) {
        els.fileDropZone.addEventListener('click', () => els.docFileInput.click());
        els.docFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleSelectedFile(e.target.files[0]);
            }
        });

        els.fileDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            els.fileDropZone.classList.add('drag-over');
        });
        els.fileDropZone.addEventListener('dragleave', () => {
            els.fileDropZone.classList.remove('drag-over');
        });
        els.fileDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            els.fileDropZone.classList.remove('drag-over');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                els.docFileInput.files = e.dataTransfer.files;
                handleSelectedFile(e.dataTransfer.files[0]);
            }
        });
    }

    if (els.docTagPicker) {
        els.docTagPicker.addEventListener('click', (e) => {
            const lbl = e.target.closest('.doc-tag-chip-label');
            if (!lbl) return;
            const tag = lbl.dataset.tag;
            if (!tag) return;
            const idx = state.selectedUploadTags.indexOf(tag);
            if (idx === -1) {
                state.selectedUploadTags.push(tag);
            } else {
                state.selectedUploadTags.splice(idx, 1);
            }
            lbl.classList.toggle('selected', state.selectedUploadTags.includes(tag));
            if (els.docTagsError && state.selectedUploadTags.length > 0) {
                els.docTagsError.textContent = '';
            }
        });
    }

    if (els.docTagNewInput) {
        els.docTagNewInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const raw = (els.docTagNewInput.value || '').trim();
                if (!raw) return;
                if (!state.documentTags.some(t => t.toLowerCase() === raw.toLowerCase())) {
                    state.documentTags.push(raw);
                }
                const matchTag = state.documentTags.find(t => t.toLowerCase() === raw.toLowerCase()) || raw;
                if (!state.selectedUploadTags.includes(matchTag)) {
                    state.selectedUploadTags.push(matchTag);
                }
                els.docTagNewInput.value = '';
                if (els.docTagsError) els.docTagsError.textContent = '';
                renderDocTagPicker();
                renderDocTagFilterStrip();
            }
        });
    }

    if (els.docTagFilterStrip) {
        els.docTagFilterStrip.addEventListener('click', (e) => {
            const chip = e.target.closest('.tag-filter-chip');
            if (!chip) return;
            const tag = chip.dataset.tag;
            if (!tag || tag === '__ALL__') {
                state.docFilters.tags = [];
            } else {
                const idx = state.docFilters.tags.indexOf(tag);
                if (idx === -1) {
                    state.docFilters.tags.push(tag);
                } else {
                    state.docFilters.tags.splice(idx, 1);
                }
            }
            renderDocTagFilterStrip();
            renderDocuments();
        });
    }

    if (els.sortDocs) {
        els.sortDocs.addEventListener('change', (e) => {
            state.docFilters.sort = e.target.value;
            renderDocuments();
        });
    }
    if (els.docSearchInput) {
        els.docSearchInput.addEventListener('input', (e) => {
            state.docFilters.search = e.target.value.trim();
            renderDocuments();
        });
    }

    if (els.documentsContainer) {
        els.documentsContainer.addEventListener('click', async (e) => {
            const delBtn = e.target.closest('.btn-doc-delete, .btn-doc-reupload-prompt');
            if (delBtn) {
                const docId = delBtn.dataset.docId;
                const isReupload = delBtn.dataset.action === 'reupload' || delBtn.classList.contains('btn-doc-reupload-prompt');
                const doc = (state.documents || []).find(d => d.id === docId);

                const confirmMsg = isReupload
                    ? `Remove placeholder for "${doc ? doc.title : 'this file'}" and open the upload form to re-upload it?`
                    : 'Are you sure you want to delete this shared file?';

                if (confirm(confirmMsg)) {
                    try {
                        await api.deleteDocument(docId);
                        showToast(isReupload ? 'Placeholder removed! Ready to upload.' : 'Document deleted');
                        
                        if (isReupload && doc) {
                            // Pre-fill upload form with doc title, description, and tags
                            if (els.docTitle) els.docTitle.value = doc.title || '';
                            if (els.docDescription) els.docDescription.value = doc.description || '';
                            const docTags = Array.isArray(doc.tags) ? doc.tags : (doc.category ? doc.category.split(/\s*>\s*/).map(p => p.trim()).filter(Boolean) : []);
                            state.selectedUploadTags = [...docTags];
                            renderDocTagPicker();

                            // Expand upload form
                            if (els.uploadDocContainer && els.uploadDocContainer.classList.contains('collapsed')) {
                                els.uploadDocContainer.classList.remove('collapsed');
                            }
                            if (els.fileDropZone) {
                                els.fileDropZone.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }

                        await loadData();
                    } catch (error) {
                        showToast(error.message || 'Failed to delete document', true);
                    }
                }
            }
        });
    }

    // Category & Tag Management Listeners (Admin)
    if (els.btnManageAgendaCats) {
        els.btnManageAgendaCats.addEventListener('click', () => openCategoryModal('agenda'));
    }
    if (els.btnAddAgendaCatInline) {
        els.btnAddAgendaCatInline.addEventListener('click', () => openCategoryModal('agenda'));
    }
    if (els.btnManageDocTags) {
        els.btnManageDocTags.addEventListener('click', () => openCategoryModal('documents'));
    }
    if (els.btnManageDocTagsModal) {
        els.btnManageDocTagsModal.addEventListener('click', () => openCategoryModal('documents'));
    }
    if (els.btnCloseCategoryModal) {
        els.btnCloseCategoryModal.addEventListener('click', closeCategoryModal);
    }
    if (els.categoryModal) {
        els.categoryModal.addEventListener('click', (e) => {
            if (e.target === els.categoryModal) closeCategoryModal();
        });
    }
    if (els.addCategoryForm) {
        els.addCategoryForm.addEventListener('submit', handleAddCategory);
    }
    if (els.catParentL1) {
        els.catParentL1.addEventListener('change', () => updateL2Selector());
    }
    if (els.catParentL2) {
        els.catParentL2.addEventListener('change', () => updateTargetPreview());
    }
    if (els.categoryTreeContainer) {
        els.categoryTreeContainer.addEventListener('click', (e) => {
            const addSubBtn = e.target.closest('.btn-cat-add-sub');
            if (addSubBtn) {
                const l1 = addSubBtn.dataset.l1;
                const l2 = addSubBtn.dataset.l2;
                updateCategoryBuilderSelectors(l1, l2);
                if (els.newCategoryInput) els.newCategoryInput.focus();
                return;
            }
            const moveBtn = e.target.closest('.btn-cat-move');
            if (moveBtn) {
                const path = moveBtn.dataset.path;
                promptMoveCategory(path);
                return;
            }
            const delBtn = e.target.closest('.btn-cat-delete');
            if (delBtn) {
                const path = delBtn.dataset.path;
                handleDeleteCategory(path);
            }
        });
        setupCategoryDragAndDrop();
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

    // Comment Tag selector (for composer or inline edit)
    if (btn.classList.contains('composer-type-btn')) {
        const editCommentId = btn.dataset.editCommentId;
        if (editCommentId && state.editingComments[editCommentId]) {
            state.editingComments[editCommentId].type = btn.dataset.type;
            const input = document.getElementById(`comment-edit-input-${editCommentId}`);
            if (input) state.editingComments[editCommentId].content = input.value;
            renderItems();
            const newInput = document.getElementById(`comment-edit-input-${editCommentId}`);
            if (newInput) newInput.focus();
            return;
        }

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

    // Start editing comment
    if (btn.classList.contains('btn-edit-comment')) {
        const itemId = btn.dataset.itemId;
        const commentId = btn.dataset.commentId;
        const item = state.items.find(i => i.id === itemId);
        if (!item) return;
        const comment = (item.comments || []).find(c => c.id === commentId);
        if (!comment) return;

        state.editingComments[commentId] = {
            content: comment.content,
            type: comment.type || 'comment'
        };
        renderItems();
        const input = document.getElementById(`comment-edit-input-${commentId}`);
        if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }
        return;
    }

    // Cancel editing comment
    if (btn.classList.contains('btn-cancel-edit-comment')) {
        const commentId = btn.dataset.commentId;
        delete state.editingComments[commentId];
        renderItems();
        return;
    }

    // Save edited comment
    if (btn.classList.contains('btn-save-edit-comment')) {
        const itemId = btn.dataset.itemId;
        const commentId = btn.dataset.commentId;
        const input = document.getElementById(`comment-edit-input-${commentId}`);
        const content = input ? input.value.trim() : (state.editingComments[commentId]?.content || '').trim();
        const type = state.editingComments[commentId]?.type || 'comment';

        if (!content) {
            showToast('Comment content cannot be empty', true);
            return;
        }

        try {
            await api.updateComment(itemId, commentId, { content, type });
            delete state.editingComments[commentId];
            showToast('Comment updated!');
            await loadData();
        } catch (error) {
            showToast(error.message || 'Failed to update comment', true);
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
    updateAdminVisibility();
}

function updateAdminVisibility() {
    const adminUser = isAdmin();
    document.querySelectorAll('.admin-only').forEach(el => {
        if (adminUser) {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });
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

        const [items, stats, docData] = await Promise.all([
            api.getItems(),
            api.getStats(),
            api.getDocuments()
        ]);
        state.items = items;
        if (docData && Array.isArray(docData.documents)) {
            state.documents = docData.documents;
            if (Array.isArray(docData.tags) && docData.tags.length > 0) {
                state.documentTags = docData.tags;
            }
        }
        if (stats) {
            if (Array.isArray(stats.categories) && stats.categories.length > 0) {
                state.categories = stats.categories;
            }
            if (Array.isArray(stats.documentTags) && stats.documentTags.length > 0) {
                state.documentTags = stats.documentTags;
            }
            updateStats(stats);
            updateCategoryDropdowns();
            // Cache members list if needed
            if (state.members.length === 0) {
                try {
                    state.members = await api.getMemberList();
                } catch { /* non-critical */ }
            }
        }

        renderItems();
        renderDocuments();

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
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// ── Rendering ──
function renderItems() {
    let filtered = state.items.filter(item => {
        const matchCat = state.filters.category === 'All' || 
                         item.category === state.filters.category || 
                         (item.category && item.category.startsWith(state.filters.category + ' > '));
        
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
                        ${renderCategoryBadge(item.category, 'category-tag')}
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
                            const isEditing = Boolean(state.editingComments[c.id]);
                            const editState = state.editingComments[c.id] || { content: c.content, type: c.type || 'comment' };
                            const isCommentAuthor = c.memberId === state.member.id;
                            const canDelete = isCommentAuthor || isProposer;
                            const isSol = Boolean(c.isSolution);
                            const type = isEditing ? editState.type : (c.type || 'comment');
                            const typeLabel = typeLabels[type] || '💬 Discussion';

                            return `
                                <div class="comment-item ${isSol ? 'is-solution' : ''}" id="comment-${c.id}">
                                    <div class="comment-avatar">${getInitials(c.memberName)}</div>
                                    <div class="comment-main">
                                        <div class="comment-header-row">
                                            <div class="comment-author-info">
                                                <strong class="comment-author-name">${escapeHTML(c.memberName)}</strong>
                                                <span class="comment-author-role">${escapeHTML(c.memberRole || 'Member')}</span>
                                                <span class="comment-time">• ${timeAgo(c.createdAt)}${c.editedAt ? ' <em class="comment-edited-hint">(edited)</em>' : ''}</span>
                                            </div>
                                            <div class="comment-tag-wrapper">
                                                <span class="comment-type-badge type-${type}">${typeLabel}</span>
                                                ${isSol ? '<span class="badge-solution-pill">⭐ Accepted Solution</span>' : ''}
                                            </div>
                                        </div>
                                        ${isEditing ? `
                                            <div class="comment-edit-box">
                                                <div class="composer-type-selector composer-type-selector--edit">
                                                    <span class="composer-type-label">Tag:</span>
                                                    <button type="button" class="composer-type-btn ${editState.type === 'idea' ? 'selected' : ''}" data-edit-comment-id="${c.id}" data-type="idea">💡 Idea</button>
                                                    <button type="button" class="composer-type-btn ${editState.type === 'action' ? 'selected' : ''}" data-edit-comment-id="${c.id}" data-type="action">🎯 Action</button>
                                                    <button type="button" class="composer-type-btn ${editState.type === 'question' ? 'selected' : ''}" data-edit-comment-id="${c.id}" data-type="question">❓ Question</button>
                                                    <button type="button" class="composer-type-btn ${editState.type === 'comment' ? 'selected' : ''}" data-edit-comment-id="${c.id}" data-type="comment">💬 Discussion</button>
                                                </div>
                                                <textarea class="comment-textarea comment-edit-textarea" id="comment-edit-input-${c.id}" data-comment-id="${c.id}" rows="2">${escapeHTML(editState.content)}</textarea>
                                                <div class="comment-edit-actions">
                                                    <button type="button" class="btn btn-outline btn-sm btn-cancel-edit-comment" data-comment-id="${c.id}">Cancel</button>
                                                    <button type="button" class="btn btn-primary btn-sm btn-save-edit-comment" data-item-id="${item.id}" data-comment-id="${c.id}">Save Changes</button>
                                                </div>
                                            </div>
                                        ` : `
                                            <div class="comment-text">${escapeHTML(c.content)}</div>
                                            <div class="comment-footer-actions">
                                                ${(!isResolved && (isProposer || isCommentAuthor)) ? `
                                                    <button class="btn-mark-solution" data-item-id="${item.id}" data-comment-id="${c.id}" data-comment-text="${escapeHTML(c.content)}" title="Accept this comment as the resolution">
                                                        ⭐ Accept as Solution
                                                    </button>
                                                ` : ''}
                                                ${isCommentAuthor ? `
                                                    <button class="btn-edit-comment" data-item-id="${item.id}" data-comment-id="${c.id}" title="Edit your comment">
                                                        ✏️ Edit
                                                    </button>
                                                ` : ''}
                                                ${canDelete ? `
                                                    <button class="btn-delete-comment" data-item-id="${item.id}" data-comment-id="${c.id}" title="Delete comment">
                                                        Delete
                                                    </button>
                                                ` : ''}
                                            </div>
                                        `}
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
    if (els.statItems)   els.statItems.textContent = stats.totalItems ?? state.items.length;
    if (els.statMembers) els.statMembers.textContent = stats.totalMembers ?? state.members.length;
    if (els.statVotes)   els.statVotes.textContent = state.items.reduce((sum, item) => sum + item.votes.length, 0);
    if (els.statDocs)    els.statDocs.textContent = stats.totalDocuments ?? state.documents.length;
    if (els.tabAgendaBadge) els.tabAgendaBadge.textContent = state.items.length;
    if (els.tabDocsBadge)   els.tabDocsBadge.textContent = state.documents.length;
}

// ── 3-Level Category Hierarchy System ──
function parseCategoryHierarchy(categories = []) {
    const tree = [];
    const map = new Map(); // path -> node

    categories.forEach(raw => {
        if (!raw || !raw.trim()) return;
        const parts = raw.split(/\s*>\s*|\s*\/\s*/).map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) return;

        // Level 1
        const l1Name = parts[0];
        const l1Path = l1Name;
        let l1Node = map.get(l1Path);
        if (!l1Node) {
            l1Node = { name: l1Name, path: l1Path, level: 1, children: [], hasExactItem: false };
            map.set(l1Path, l1Node);
            tree.push(l1Node);
        }
        if (parts.length === 1) l1Node.hasExactItem = true;

        // Level 2
        if (parts.length >= 2) {
            const l2Name = parts[1];
            const l2Path = `${l1Name} > ${l2Name}`;
            let l2Node = map.get(l2Path);
            if (!l2Node) {
                l2Node = { name: l2Name, path: l2Path, level: 2, children: [], hasExactItem: false, parent: l1Node };
                map.set(l2Path, l2Node);
                l1Node.children.push(l2Node);
            }
            if (parts.length === 2) l2Node.hasExactItem = true;

            // Level 3
            if (parts.length >= 3) {
                const l3Name = parts[2];
                const l3Path = `${l1Name} > ${l2Name} > ${l3Name}`;
                let l3Node = map.get(l3Path);
                if (!l3Node) {
                    l3Node = { name: l3Name, path: l3Path, level: 3, children: [], hasExactItem: true, parent: l2Node };
                    map.set(l3Path, l3Node);
                    l2Node.children.push(l3Node);
                }
            }
        }
    });

    return { tree, map };
}

function renderCategoryBadge(categoryStr, customClass = '') {
    if (!categoryStr) return '';
    const parts = categoryStr.split(/\s*>\s*|\s*\/\s*/).map(p => p.trim()).filter(Boolean);
    if (parts.length <= 1) {
        return `<span class="${customClass}">${escapeHTML(categoryStr)}</span>`;
    }
    const crumbs = parts.map((p, idx) => {
        const isLast = idx === parts.length - 1;
        return `<span class="cat-crumb ${isLast ? 'cat-crumb-last' : 'cat-crumb-parent'}">${escapeHTML(p)}</span>`;
    }).join('<span class="cat-crumb-sep">›</span>');
    
    return `<span class="${customClass} cat-badge-nested" title="${escapeHTML(categoryStr)}">${crumbs}</span>`;
}

function renderCategorySelectOptions(categories, selectEl, promptText = 'Select category...') {
    if (!selectEl) return;
    const { tree } = parseCategoryHierarchy(categories);
    const currentVal = selectEl.value;

    let html = `<option value="" disabled selected>${promptText}</option>`;

    tree.forEach(l1 => {
        if (l1.children.length === 0) {
            html += `<option value="${escapeHTML(l1.path)}">📁 ${escapeHTML(l1.name)}</option>`;
        } else {
            html += `<optgroup label="📁 ${escapeHTML(l1.name)}">`;
            html += `<option value="${escapeHTML(l1.path)}">📁 ${escapeHTML(l1.name)} (General / Main)</option>`;
            l1.children.forEach(l2 => {
                if (l2.children.length === 0) {
                    html += `<option value="${escapeHTML(l2.path)}">&nbsp;&nbsp;↳ 📂 ${escapeHTML(l2.name)}</option>`;
                } else {
                    html += `<option value="${escapeHTML(l2.path)}">&nbsp;&nbsp;↳ 📂 ${escapeHTML(l2.name)} (Overview)</option>`;
                    l2.children.forEach(l3 => {
                        html += `<option value="${escapeHTML(l3.path)}">&nbsp;&nbsp;&nbsp;&nbsp;↳ 📄 ${escapeHTML(l3.name)}</option>`;
                    });
                }
            });
            html += `</optgroup>`;
        }
    });

    selectEl.innerHTML = html;
    if (currentVal && categories.includes(currentVal)) {
        selectEl.value = currentVal;
    }
}

function renderCategoryFilterOptions(categories, selectEl, allPrompt = 'All Categories') {
    if (!selectEl) return;
    const { tree } = parseCategoryHierarchy(categories);
    const currentVal = selectEl.value || 'All';

    let html = `<option value="All">${allPrompt}</option>`;

    tree.forEach(l1 => {
        if (l1.children.length === 0) {
            html += `<option value="${escapeHTML(l1.path)}">📁 ${escapeHTML(l1.name)}</option>`;
        } else {
            html += `<optgroup label="📁 ${escapeHTML(l1.name)}">`;
            html += `<option value="${escapeHTML(l1.path)}">📁 All "${escapeHTML(l1.name)}"</option>`;
            l1.children.forEach(l2 => {
                if (l2.children.length === 0) {
                    html += `<option value="${escapeHTML(l2.path)}">&nbsp;&nbsp;↳ 📂 ${escapeHTML(l2.name)}</option>`;
                } else {
                    html += `<option value="${escapeHTML(l2.path)}">&nbsp;&nbsp;↳ 📂 All "${escapeHTML(l2.name)}"</option>`;
                    l2.children.forEach(l3 => {
                        html += `<option value="${escapeHTML(l3.path)}">&nbsp;&nbsp;&nbsp;&nbsp;↳ 📄 ${escapeHTML(l3.name)}</option>`;
                    });
                }
            });
            html += `</optgroup>`;
        }
    });

    selectEl.innerHTML = html;
    if (currentVal && (currentVal === 'All' || categories.includes(currentVal))) {
        selectEl.value = currentVal;
    } else {
        selectEl.value = 'All';
    }
}

// ── Category Dropdowns & Dynamic Options ──
function updateCategoryDropdowns() {
    updateAdminVisibility();

    // 1. Agenda item proposal category dropdown
    renderCategorySelectOptions(state.categories || [], els.itemCategory, 'Select category...');
    // 2. Agenda filter category dropdown
    renderCategoryFilterOptions(state.categories || [], els.filterCategory, 'All Categories');
    // 3. Document upload tag picker & filter strip
    renderDocTagPicker();
    renderDocTagFilterStrip();
}

// ── File Vault Tag Rendering Helpers ──
function renderDocTagPicker() {
    if (!els.docTagPicker) return;
    const tags = state.documentTags || [];
    if (tags.length === 0) {
        els.docTagPicker.innerHTML = '<span style="color:var(--text-muted);font-size:0.82rem;padding:0.25rem 0.5rem;">No tags available yet. Type a tag below and press Enter.</span>';
        return;
    }
    els.docTagPicker.innerHTML = tags.map(tag => {
        const isSelected = (state.selectedUploadTags || []).includes(tag);
        return `<label class="doc-tag-chip-label ${isSelected ? 'selected' : ''}" data-tag="${escapeHTML(tag)}">
            ${escapeHTML(tag)}
        </label>`;
    }).join('');
}

function renderDocTagFilterStrip() {
    if (!els.docTagFilterStrip) return;
    const allActive = !state.docFilters.tags || state.docFilters.tags.length === 0;
    let html = `<button type="button" class="tag-filter-chip ${allActive ? 'active' : ''}" data-tag="__ALL__">All Files (${(state.documents || []).length})</button>`;
    
    (state.documentTags || []).forEach(tag => {
        const isActive = Array.isArray(state.docFilters.tags) && state.docFilters.tags.includes(tag);
        const count = (state.documents || []).filter(d => {
            const dTags = Array.isArray(d.tags) ? d.tags : (d.category ? [d.category] : []);
            return dTags.includes(tag);
        }).length;
        if (count === 0 && !isActive) return;
        html += `<button type="button" class="tag-filter-chip ${isActive ? 'active' : ''}" data-tag="${escapeHTML(tag)}">${escapeHTML(tag)} <span style="opacity:0.65;font-size:0.7rem;margin-left:0.2rem;">${count}</span></button>`;
    });
    els.docTagFilterStrip.innerHTML = html;
}

function renderDocTagManager() {
    if (!els.categoryTreeContainer) return;
    const tags = state.documentTags || [];
    if (els.categoryModalCount) els.categoryModalCount.textContent = tags.length;
    if (tags.length === 0) {
        els.categoryTreeContainer.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem;padding:1rem;text-align:center;display:block;">No tags defined yet. Use the input above to add tags.</span>';
        return;
    }
    els.categoryTreeContainer.innerHTML = `
        <div class="doc-tag-manager-list">
            ${tags.map(tag => {
                const count = (state.documents || []).filter(d => {
                    const dTags = Array.isArray(d.tags) ? d.tags : (d.category ? [d.category] : []);
                    return dTags.includes(tag);
                }).length;
                return `
                    <div class="doc-tag-manager-row">
                        <span class="doc-tag-pill">${escapeHTML(tag)}</span>
                        <span class="doc-tag-manager-count">${count > 0 ? count + ' file' + (count > 1 ? 's' : '') : 'unused'}</span>
                        <button type="button" class="btn-cat-delete" data-path="${escapeHTML(tag)}" title="Delete tag">🗑️</button>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ── Category Management Modal Logic (Admin) ──
function openCategoryModal(type = 'agenda') {
    state.activeCategoryModalType = type;
    if (!els.categoryModal) return;

    if (type === 'agenda') {
        if (els.categoryModalTitle) els.categoryModalTitle.textContent = 'Manage Agenda Categories';
        if (els.categoryModalDesc)  els.categoryModalDesc.textContent = 'Create and organize up to 3 levels of nested categories for agenda items.';
        if (els.btnSubmitNewCategory) els.btnSubmitNewCategory.textContent = '+ Add Category';
        if (els.newCategoryInput) els.newCategoryInput.placeholder = 'Enter main category name (e.g. Governance & Legal)...';
        if (els.catBuilderCard) els.catBuilderCard.classList.remove('hidden');
        if (els.categoryModalListTitle) els.categoryModalListTitle.textContent = 'Hierarchy Structure';
        if (els.catDragTip) els.catDragTip.classList.remove('hidden');
        if (els.catDropRootZone) els.catDropRootZone.classList.add('hidden');
        updateCategoryBuilderSelectors();
        renderCategoryTree();
    } else {
        if (els.categoryModalTitle) els.categoryModalTitle.textContent = 'Manage File Vault Tags';
        if (els.categoryModalDesc)  els.categoryModalDesc.textContent = 'Add or remove tags for files in the vault. Files can have multiple tags.';
        if (els.btnSubmitNewCategory) els.btnSubmitNewCategory.textContent = '+ Add Tag';
        if (els.newCategoryInput) els.newCategoryInput.placeholder = 'Enter tag name (e.g. Policies, Term 3, Financial Reports)...';
        if (els.catBuilderCard) els.catBuilderCard.classList.add('hidden');
        if (els.categoryModalListTitle) els.categoryModalListTitle.textContent = 'Available Tags';
        if (els.catDragTip) els.catDragTip.classList.add('hidden');
        if (els.catDropRootZone) els.catDropRootZone.classList.add('hidden');
        renderDocTagManager();
    }

    if (els.newCategoryInput) {
        els.newCategoryInput.value = '';
    }
    if (els.categoryModalError) {
        els.categoryModalError.textContent = '';
    }

    els.categoryModal.classList.add('active');
    setTimeout(() => {
        if (els.newCategoryInput) els.newCategoryInput.focus();
    }, 100);
}

function closeCategoryModal() {
    if (els.categoryModal) {
        els.categoryModal.classList.remove('active');
    }
}

function updateCategoryBuilderSelectors(preselectL1 = null, preselectL2 = null) {
    const list = state.categories || [];
    const { tree } = parseCategoryHierarchy(list);

    if (els.catParentL1) {
        let l1Html = `<option value="__NEW__">+ New Main Category (Level 1)</option>`;
        tree.forEach(node => {
            l1Html += `<option value="${escapeHTML(node.path)}">📁 ${escapeHTML(node.name)}</option>`;
        });
        els.catParentL1.innerHTML = l1Html;
        if (preselectL1 && tree.some(n => n.path === preselectL1)) {
            els.catParentL1.value = preselectL1;
        } else {
            els.catParentL1.value = '__NEW__';
        }
    }

    updateL2Selector(preselectL2);
}

function updateL2Selector(preselectL2 = null) {
    if (!els.catParentL1 || !els.catParentL2 || !els.catParentL2Group) return;
    const selectedL1 = els.catParentL1.value;
    const list = state.categories || [];
    const { map } = parseCategoryHierarchy(list);

    if (selectedL1 === '__NEW__') {
        els.catParentL2Group.classList.add('hidden');
        els.catParentL2.innerHTML = `<option value="__NEW__">+ New Subcategory (Level 2)</option>`;
        els.catParentL2.value = '__NEW__';
        updateTargetPreview();
        return;
    }

    const l1Node = map.get(selectedL1);
    els.catParentL2Group.classList.remove('hidden');

    let l2Html = `<option value="__NEW__">+ New Subcategory under [${escapeHTML(l1Node ? l1Node.name : selectedL1)}] (Level 2)</option>`;
    if (l1Node && l1Node.children) {
        l1Node.children.forEach(child => {
            l2Html += `<option value="${escapeHTML(child.path)}">📂 ${escapeHTML(child.name)}</option>`;
        });
    }
    els.catParentL2.innerHTML = l2Html;

    if (preselectL2 && l1Node && l1Node.children.some(c => c.path === preselectL2)) {
        els.catParentL2.value = preselectL2;
    } else {
        els.catParentL2.value = '__NEW__';
    }

    updateTargetPreview();
}

function updateTargetPreview() {
    if (!els.catParentL1 || !els.catTargetPath || !els.newCategoryInput) return;
    const selectedL1 = els.catParentL1.value;
    const selectedL2 = els.catParentL2 ? els.catParentL2.value : '__NEW__';

    if (selectedL1 === '__NEW__') {
        els.catTargetPath.textContent = 'New Main Category (Level 1)';
        els.newCategoryInput.placeholder = 'Enter main category name (e.g. Governance & Legal)...';
    } else if (selectedL2 === '__NEW__') {
        els.catTargetPath.textContent = `${selectedL1} › [New Subcategory (Level 2)]`;
        els.newCategoryInput.placeholder = `Enter subcategory name under "${selectedL1}"...`;
    } else {
        els.catTargetPath.textContent = `${selectedL2} › [New Topic (Level 3)]`;
        els.newCategoryInput.placeholder = `Enter topic name under "${selectedL2}"...`;
    }
}

let draggedCatPath = null;
let draggedCatEl = null;

function renderCategoryTree() {
    if (!els.categoryTreeContainer) return;
    const list = state.categories || [];
    const { tree } = parseCategoryHierarchy(list);

    if (els.categoryModalCount) {
        els.categoryModalCount.textContent = list.length;
    }

    if (tree.length === 0) {
        els.categoryTreeContainer.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem;padding:1rem;text-align:center;display:block;">No categories defined yet. Use the form above to create your first category.</span>';
        return;
    }

    let html = '';

    tree.forEach(l1 => {
        const l1Count = state.items.filter(i => i.category === l1.path || i.category?.startsWith(l1.path + ' > ')).length;

        html += `
            <div class="cat-tree-node level-1" draggable="true" data-path="${escapeHTML(l1.path)}" data-level="1">
                <div class="cat-tree-info">
                    <span class="cat-drag-handle" title="Drag to nest this category under another">⠿</span>
                    <span class="cat-tree-icon">📁</span>
                    <span class="cat-tree-title">${escapeHTML(l1.name)}</span>
                    <span class="cat-tree-level-tag tag-l1">Level 1</span>
                    ${l1Count > 0 ? `<span class="doc-size-badge">${l1Count} ${isAgenda ? 'items' : 'files'}</span>` : ''}
                </div>
                <div class="cat-tree-actions">
                    <button type="button" class="btn-cat-add-sub" data-l1="${escapeHTML(l1.path)}" data-l2="__NEW__" title="Add Subcategory (Level 2) under this">+ Sub (L2)</button>
                    <button type="button" class="btn-cat-move" data-path="${escapeHTML(l1.path)}" title="Move / Nest under another category">⇄ Move</button>
                    <button type="button" class="btn-cat-delete" data-path="${escapeHTML(l1.path)}" title="Delete category & subcategories">🗑️</button>
                </div>
            </div>
        `;

        l1.children.forEach(l2 => {
            const l2Count = isAgenda
                ? state.items.filter(i => i.category === l2.path || i.category?.startsWith(l2.path + ' > ')).length
                : (state.documents || []).filter(d => d.category === l2.path || d.category?.startsWith(l2.path + ' > ')).length;

            html += `
                <div class="cat-tree-node level-2" draggable="true" data-path="${escapeHTML(l2.path)}" data-level="2">
                    <div class="cat-tree-info">
                        <span class="cat-drag-handle" title="Drag to nest under another category or drag to top to un-nest">⠿</span>
                        <span class="cat-tree-icon">📂</span>
                        <span class="cat-tree-title">${escapeHTML(l2.name)}</span>
                        <span class="cat-tree-level-tag tag-l2">Level 2</span>
                        ${l2Count > 0 ? `<span class="doc-size-badge">${l2Count}</span>` : ''}
                    </div>
                    <div class="cat-tree-actions">
                        <button type="button" class="btn-cat-add-sub" data-l1="${escapeHTML(l1.path)}" data-l2="${escapeHTML(l2.path)}" title="Add Topic (Level 3) under this">+ Sub (L3)</button>
                        <button type="button" class="btn-cat-move" data-path="${escapeHTML(l2.path)}" title="Move / Nest under another category">⇄ Move</button>
                        <button type="button" class="btn-cat-delete" data-path="${escapeHTML(l2.path)}" title="Delete subcategory">🗑️</button>
                    </div>
                </div>
            `;

            l2.children.forEach(l3 => {
                const l3Count = isAgenda
                    ? state.items.filter(i => i.category === l3.path).length
                    : (state.documents || []).filter(d => d.category === l3.path).length;

                html += `
                    <div class="cat-tree-node level-3" draggable="true" data-path="${escapeHTML(l3.path)}" data-level="3">
                        <div class="cat-tree-info">
                            <span class="cat-drag-handle" title="Drag to move under another category">⠿</span>
                            <span class="cat-tree-icon">📄</span>
                            <span class="cat-tree-title">${escapeHTML(l3.name)}</span>
                            <span class="cat-tree-level-tag tag-l3">Level 3</span>
                            ${l3Count > 0 ? `<span class="doc-size-badge">${l3Count}</span>` : ''}
                        </div>
                        <div class="cat-tree-actions">
                            <button type="button" class="btn-cat-move" data-path="${escapeHTML(l3.path)}" title="Move / Nest under another category">⇄ Move</button>
                            <button type="button" class="btn-cat-delete" data-path="${escapeHTML(l3.path)}" title="Delete topic">🗑️</button>
                        </div>
                    </div>
                `;
            });
        });
    });

    els.categoryTreeContainer.innerHTML = html;
}

let isDragEventsInitialized = false;

function setupCategoryDragAndDrop() {
    if (!els.categoryTreeContainer || isDragEventsInitialized) return;
    isDragEventsInitialized = true;

    els.categoryTreeContainer.addEventListener('dragstart', (e) => {
        const node = e.target.closest('.cat-tree-node');
        if (!node) return;

        draggedCatPath = node.dataset.path;
        draggedCatEl = node;

        node.classList.add('is-dragging');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedCatPath);
        }

        // Show root drop zone if the dragged category has a parent
        if (els.catDropRootZone && draggedCatPath && draggedCatPath.includes(' > ')) {
            els.catDropRootZone.classList.remove('hidden');
        }
    });

    // Root drop zone dragover & drop
    if (els.catDropRootZone) {
        els.catDropRootZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            els.catDropRootZone.classList.add('drag-target-hover');
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        });

        els.catDropRootZone.addEventListener('dragleave', (e) => {
            if (!els.catDropRootZone.contains(e.relatedTarget)) {
                els.catDropRootZone.classList.remove('drag-target-hover');
            }
        });

        els.catDropRootZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            const currentDragged = draggedCatPath;
            cleanDragStyles();
            if (!currentDragged) return;

            const type = state.activeCategoryModalType;
            const srcParts = currentDragged.split(/\s*>\s*/);
            const leafName = srcParts[srcParts.length - 1];

            try {
                const res = await api.moveCategory('agenda', currentDragged, null);
                if (res && Array.isArray(res.categories)) {
                    state.categories = res.categories;
                    showToast(`Moved "${leafName}" to Top Level (Level 1)!`);
                    updateCategoryBuilderSelectors();
                    renderCategoryTree();
                    updateCategoryDropdowns();
                    await loadData();
                }
            } catch (error) {
                showToast(error.message || 'Failed to move category', true);
            }
        });
    }

    els.categoryTreeContainer.addEventListener('dragover', (e) => {
        const targetNode = e.target.closest('.cat-tree-node');
        if (!targetNode || !draggedCatPath) return;

        const targetPath = targetNode.dataset.path;
        const targetLevel = parseInt(targetNode.dataset.level, 10);

        // Cannot drop on self or own child branch
        if (targetPath === draggedCatPath || targetPath.startsWith(draggedCatPath + ' > ')) {
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
            return;
        }

        // Cannot drop onto Level 3 (since max depth is 3)
        if (targetLevel >= 3) {
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
            return;
        }

        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        targetNode.classList.add('drag-target-hover');
    });

    els.categoryTreeContainer.addEventListener('dragleave', (e) => {
        const targetNode = e.target.closest('.cat-tree-node');
        if (targetNode && !targetNode.contains(e.relatedTarget)) {
            targetNode.classList.remove('drag-target-hover');
        }
    });

    els.categoryTreeContainer.addEventListener('drop', async (e) => {
        e.preventDefault();
        const currentDragged = draggedCatPath;
        const targetNode = e.target.closest('.cat-tree-node');
        cleanDragStyles();

        if (!currentDragged || !targetNode) return;

        const targetParent = targetNode.dataset.path;
        if (!targetParent || targetParent === currentDragged || targetParent.startsWith(currentDragged + ' > ')) {
            return;
        }

        const srcParts = currentDragged.split(/\s*>\s*/);
        const leafName = srcParts[srcParts.length - 1];

        try {
            const res = await api.moveCategory('agenda', currentDragged, targetParent);
            if (res && Array.isArray(res.categories)) {
                state.categories = res.categories;
                showToast(`Moved "${leafName}" under "${targetParent}"!`);
                updateCategoryBuilderSelectors();
                renderCategoryTree();
                updateCategoryDropdowns();
                await loadData();
            }
        } catch (error) {
            showToast(error.message || 'Failed to move category', true);
        }
    });

    els.categoryTreeContainer.addEventListener('dragend', () => {
        cleanDragStyles();
    });
}

function cleanDragStyles() {
    draggedCatPath = null;
    draggedCatEl = null;
    if (els.catDropRootZone) {
        els.catDropRootZone.classList.add('hidden');
        els.catDropRootZone.classList.remove('drag-target-hover');
    }
    if (els.categoryTreeContainer) {
        els.categoryTreeContainer.querySelectorAll('.cat-tree-node').forEach(n => {
            n.classList.remove('is-dragging', 'drag-target-hover');
        });
    }
}

async function promptMoveCategory(sourcePath) {
    if (!sourcePath) return;
    const list = state.categories || [];
    const { tree } = parseCategoryHierarchy(list);

    const srcParts = sourcePath.split(/\s*>\s*/);
    const leafName = srcParts[srcParts.length - 1];
    const srcLower = sourcePath.toLowerCase();

    // Collect valid targets (exclude self and descendants)
    const options = [
        { label: '⬆️ [Top Level / Main Category (Level 1)]', value: '__ROOT__' }
    ];

    tree.forEach(l1 => {
        if (l1.path.toLowerCase() !== srcLower && !l1.path.toLowerCase().startsWith(srcLower + ' > ')) {
            options.push({ label: `📁 ${l1.name} (Level 1 Parent)`, value: l1.path });
            l1.children.forEach(l2 => {
                if (l2.path.toLowerCase() !== srcLower && !l2.path.toLowerCase().startsWith(srcLower + ' > ')) {
                    options.push({ label: `  ↳ 📂 ${l1.name} > ${l2.name} (Level 2 Parent)`, value: l2.path });
                }
            });
        }
    });

    const promptMsg = `Move / Nest "${leafName}" under:\n\n` + 
        options.map((opt, idx) => `${idx + 1}. ${opt.label}`).join('\n') +
        `\n\nEnter number (1-${options.length}):`;

    const choice = prompt(promptMsg, '1');
    if (!choice) return;

    const num = parseInt(choice.trim(), 10);
    if (isNaN(num) || num < 1 || num > options.length) {
        alert('Invalid selection.');
        return;
    }

    const selectedOpt = options[num - 1];
    const targetParent = selectedOpt.value === '__ROOT__' ? null : selectedOpt.value;

    try {
        const res = await api.moveCategory('agenda', sourcePath, targetParent);
        if (res && Array.isArray(res.categories)) {
            state.categories = res.categories;
            showToast(`Moved "${leafName}" under ${targetParent ? `"${targetParent}"` : 'Top Level'}!`);
            updateCategoryBuilderSelectors();
            renderCategoryTree();
            updateCategoryDropdowns();
            await loadData();
        }
    } catch (error) {
        showToast(error.message || 'Failed to move category', true);
    }
}

async function handleAddCategory(e) {
    e.preventDefault();
    if (!els.newCategoryInput) return;
    const rawName = els.newCategoryInput.value.trim();
    if (!rawName) {
        if (els.categoryModalError) els.categoryModalError.textContent = 'Please enter a name';
        return;
    }

    const type = state.activeCategoryModalType;
    const isAgenda = type === 'agenda';

    const selectedL1 = els.catParentL1 ? els.catParentL1.value : '__NEW__';
    const selectedL2 = els.catParentL2 ? els.catParentL2.value : '__NEW__';

    let parentPath = null;
    if (isAgenda) {
        if (selectedL2 !== '__NEW__' && selectedL2) {
            parentPath = selectedL2;
        } else if (selectedL1 !== '__NEW__' && selectedL1) {
            parentPath = selectedL1;
        }
    }

    if (els.categoryModalError) els.categoryModalError.textContent = '';
    if (els.btnSubmitNewCategory) {
        els.btnSubmitNewCategory.disabled = true;
        els.btnSubmitNewCategory.textContent = 'Adding...';
    }

    try {
        if (isAgenda) {
            const res = await api.addAgendaCategory(rawName, parentPath);
            if (res && Array.isArray(res.categories)) {
                state.categories = res.categories;
            }
            showToast(`Agenda category added!`);
            updateCategoryDropdowns();
            if (els.itemCategory && res && res.category) els.itemCategory.value = res.category;
            els.newCategoryInput.value = '';
            updateCategoryBuilderSelectors(selectedL1, selectedL2);
            renderCategoryTree();
            renderItems();
        } else {
            const res = await api.addDocumentCategory(rawName);
            if (res && Array.isArray(res.documentTags)) {
                state.documentTags = res.documentTags;
            } else if (!state.documentTags.includes(rawName)) {
                state.documentTags.push(rawName);
            }
            showToast(`Document tag "${rawName}" added!`);
            els.newCategoryInput.value = '';
            renderDocTagManager();
            renderDocTagPicker();
            renderDocTagFilterStrip();
            renderDocuments();
        }
    } catch (error) {
        if (els.categoryModalError) els.categoryModalError.textContent = error.message || 'Failed to add category';
    } finally {
        if (els.btnSubmitNewCategory) {
            els.btnSubmitNewCategory.disabled = false;
            els.btnSubmitNewCategory.textContent = isAgenda ? '+ Add Category' : '+ Add Tag';
        }
    }
}

async function handleDeleteCategory(name) {
    if (!name) return;
    const type = state.activeCategoryModalType;
    const isAgenda = type === 'agenda';
    
    // Check if in use
    if (isAgenda) {
        const inUseCount = state.items.filter(i => i.category === name || i.category?.startsWith(name + ' > ')).length;
        if (inUseCount > 0) {
            if (!confirm(`Warning: "${name}" (and its subcategories) is currently used by ${inUseCount} agenda item(s). Deleting will remove it and any sub-branches. Proceed?`)) {
                return;
            }
        } else {
            if (!confirm(`Are you sure you want to delete "${name}"? Any subcategories under it will also be deleted.`)) return;
        }
    } else {
        const inUseCount = (state.documents || []).filter(d => {
            const dTags = Array.isArray(d.tags) ? d.tags : (d.category ? [d.category] : []);
            return dTags.includes(name);
        }).length;
        if (inUseCount > 0) {
            if (!confirm(`Warning: Tag "${name}" is currently used by ${inUseCount} file(s). Deleting will remove this tag from the list. Proceed?`)) {
                return;
            }
        } else {
            if (!confirm(`Are you sure you want to delete tag "${name}"?`)) return;
        }
    }

    try {
        if (isAgenda) {
            const res = await api.deleteAgendaCategory(name);
            if (res && Array.isArray(res.categories)) {
                state.categories = res.categories;
            } else {
                state.categories = state.categories.filter(c => c !== name && !c.startsWith(name + ' > '));
            }
            showToast(`Agenda category "${name}" removed`);
            updateCategoryBuilderSelectors();
            renderCategoryTree();
            updateCategoryDropdowns();
            renderItems();
        } else {
            const res = await api.deleteDocumentCategory(name);
            if (res && Array.isArray(res.documentTags)) {
                state.documentTags = res.documentTags;
            } else {
                state.documentTags = state.documentTags.filter(t => t.toLowerCase() !== name.toLowerCase());
            }
            state.selectedUploadTags = state.selectedUploadTags.filter(t => t.toLowerCase() !== name.toLowerCase());
            state.docFilters.tags = state.docFilters.tags.filter(t => t.toLowerCase() !== name.toLowerCase());
            showToast(`Tag "${name}" removed`);
            renderDocTagManager();
            renderDocTagPicker();
            renderDocTagFilterStrip();
            renderDocuments();
        }
    } catch (error) {
        showToast(error.message || 'Failed to delete category', true);
    }
}

// ── Tab Navigation ──
function switchTab(tabName) {
    state.activeTab = tabName;
    
    // Update all tab buttons
    document.querySelectorAll('.tab-nav-btn').forEach(btn => {
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const agendaView = document.getElementById('tab-view-agenda');
    const docsView = document.getElementById('tab-view-documents');

    if (tabName === 'agenda') {
        if (agendaView) agendaView.classList.add('active');
        if (docsView) docsView.classList.remove('active');
    } else {
        if (agendaView) agendaView.classList.remove('active');
        if (docsView) docsView.classList.add('active');
        renderDocuments();
    }
}
window.switchTab = switchTab;

// ── Document Vault Rendering & Helpers ──
function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getFileTypeInfo(doc) {
    const ext = (doc.extension || '').toLowerCase();
    const mime = (doc.mimeType || '').toLowerCase();

    if (doc.isVideo || mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', '3gp'].includes(ext)) {
        return { icon: '🎬', className: 'type-video', label: 'Video' };
    }
    if (['xlsx', 'xls', 'csv', 'ods'].includes(ext) || mime.includes('spreadsheet') || mime.includes('excel')) {
        return { icon: '📊', className: 'type-excel', label: 'Spreadsheet' };
    }
    if (['docx', 'doc', 'odt', 'rtf'].includes(ext) || mime.includes('word') || mime.includes('document')) {
        return { icon: '📑', className: 'type-word', label: 'Document' };
    }
    if (['pptx', 'ppt', 'odp', 'key'].includes(ext) || mime.includes('presentation') || mime.includes('powerpoint')) {
        return { icon: '📽️', className: 'type-ppt', label: 'Presentation' };
    }
    if (ext === 'pdf' || mime.includes('pdf')) {
        return { icon: '📄', className: 'type-pdf', label: 'PDF Document' };
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || mime.startsWith('image/')) {
        return { icon: '🖼️', className: 'type-image', label: 'Image' };
    }
    return { icon: '📁', className: 'type-file', label: 'File' };
}

function renderDocuments() {
    if (!els.documentsContainer) return;

    // Filter documents
    let filtered = (state.documents || []).filter(doc => {
        const docTags = Array.isArray(doc.tags) ? doc.tags : (doc.category ? doc.category.split(/\s*>\s*/).map(p => p.trim()).filter(Boolean) : []);
        const matchTags = !state.docFilters.tags || state.docFilters.tags.length === 0 || 
                          docTags.some(t => state.docFilters.tags.includes(t));
        
        let matchSearch = true;
        if (state.docFilters.search) {
            const q = state.docFilters.search.toLowerCase();
            const titleMatch = (doc.title || '').toLowerCase().includes(q);
            const authorMatch = (doc.uploadedBy?.memberName || '').toLowerCase().includes(q);
            const descMatch = (doc.description || '').toLowerCase().includes(q);
            const fileMatch = (doc.originalName || '').toLowerCase().includes(q);
            const tagMatch = docTags.some(t => t.toLowerCase().includes(q));
            matchSearch = titleMatch || authorMatch || descMatch || fileMatch || tagMatch;
        }

        return matchTags && matchSearch;
    });

    // Sort documents
    filtered.sort((a, b) => {
        if (state.docFilters.sort === 'newest') return new Date(b.uploadedAt) - new Date(a.uploadedAt);
        if (state.docFilters.sort === 'oldest') return new Date(a.uploadedAt) - new Date(b.uploadedAt);
        if (state.docFilters.sort === 'size') return (b.size || 0) - (a.size || 0);
        if (state.docFilters.sort === 'title') return (a.title || '').localeCompare(b.title || '');
        return 0;
    });

    // Update badges
    if (els.tabAgendaBadge) els.tabAgendaBadge.textContent = state.items.length;
    if (els.tabDocsBadge)   els.tabDocsBadge.textContent = state.documents.length;
    if (els.statDocs)       els.statDocs.textContent = state.documents.length;

    if (filtered.length === 0) {
        els.documentsContainer.innerHTML = '';
        if (els.documentsEmptyState) els.documentsEmptyState.classList.remove('hidden');
        return;
    }

    if (els.documentsEmptyState) els.documentsEmptyState.classList.add('hidden');

    els.documentsContainer.innerHTML = filtered.map(doc => {
        const typeInfo = getFileTypeInfo(doc);
        const isAvailable = doc.isAvailable !== false;
        const isUploader = doc.uploadedBy?.memberId === state.member?.id;
        const isPrivileged = isAdmin();
        const canDelete = isUploader || isPrivileged || !isAvailable;
        const docTags = Array.isArray(doc.tags) ? doc.tags : (doc.category ? doc.category.split(/\s*>\s*/).map(p => p.trim()).filter(Boolean) : []);

        return `
            <div class="doc-card ${!isAvailable ? 'doc-card-unavailable' : ''}" id="doc-${doc.id}">
                <div class="doc-card-top">
                    <div class="doc-card-header">
                        <div class="doc-icon-badge ${typeInfo.className}">
                            ${typeInfo.icon}
                        </div>
                        <div class="doc-meta-badges">
                            ${docTags.length > 0 ? `<div class="doc-tags-row">${docTags.map(t => `<span class="doc-tag-pill">${escapeHTML(t)}</span>`).join('')}</div>` : ''}
                            ${!isAvailable ? '<span class="doc-warning-badge" title="This file was uploaded prior to database persistence and needs to be re-uploaded">⚠️ Re-upload Needed</span>' : ''}
                            <span class="doc-size-badge">${formatBytes(doc.size)}</span>
                        </div>
                    </div>
                    <div class="doc-main-info">
                        <h3 class="doc-title">${escapeHTML(doc.title)}</h3>
                        <div class="doc-filename">
                            <span>📄</span> <span class="doc-filename-text">${escapeHTML(doc.originalName)}</span>
                        </div>
                        ${doc.description ? `
                            <div class="doc-description">${escapeHTML(doc.description)}</div>
                        ` : ''}
                    </div>
                </div>

                <div class="doc-card-bottom">
                    <div class="doc-uploader">
                        <span class="doc-uploader-name">${escapeHTML(doc.uploadedBy?.memberName || 'Member')}</span>
                        <span>${escapeHTML(doc.uploadedBy?.memberRole || 'Member')} • ${timeAgo(doc.uploadedAt)}</span>
                    </div>
                    <div class="doc-actions-group">
                        ${isAvailable ? `
                            <a href="/api/documents/${doc.id}/view?token=${encodeURIComponent(state.token || '')}" target="_blank" rel="noopener" class="btn-doc-action btn-doc-view" title="Preview / Open in new tab">
                                👁️ View
                            </a>
                            <a href="/api/documents/${doc.id}/download?token=${encodeURIComponent(state.token || '')}" class="btn-doc-action btn-doc-download" title="Download file">
                                ⬇️ Download
                            </a>
                        ` : `
                            <button type="button" class="btn-doc-action btn-doc-unavailable" onclick="showToast('This document needs to be re-uploaded. Please delete and upload it again.', true)" title="Physical file not found on server">
                                ⚠️ Missing File
                            </button>
                        `}
                        ${canDelete ? `
                            <button type="button" class="btn-doc-action btn-doc-delete ${!isAvailable ? 'btn-doc-reupload-prompt' : ''}" data-doc-id="${doc.id}" data-action="${!isAvailable ? 'reupload' : 'delete'}" title="${!isAvailable ? 'Remove missing placeholder to re-upload' : 'Delete document'}">
                                ${!isAvailable ? '🗑️ Remove & Re-upload' : '🗑️'}
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ── Upload Form Logic ──
function toggleUploadForm() {
    if (!els.uploadDocContainer) return;
    const isCollapsed = els.uploadDocContainer.classList.contains('collapsed');
    if (isCollapsed) {
        els.uploadDocContainer.classList.remove('collapsed');
        if (els.docTitle) els.docTitle.focus();
    } else {
        els.uploadDocContainer.classList.add('collapsed');
        resetUploadForm();
    }
}

function resetUploadForm() {
    if (els.uploadDocForm) els.uploadDocForm.reset();
    if (els.dropZoneTitle) els.dropZoneTitle.textContent = 'Click to browse or drag & drop file here';
    if (els.dropZoneHint)  els.dropZoneHint.textContent = 'PDF, Word, Excel, PowerPoint, Images (100MB) or Videos (500MB)';
    if (els.docFileError)  els.docFileError.textContent = '';
    if (els.docTagsError)  els.docTagsError.textContent = '';
    state.selectedUploadTags = [];
    renderDocTagPicker();
    if (els.uploadProgressWrapper) els.uploadProgressWrapper.classList.add('hidden');
    if (els.uploadProgressFill)    els.uploadProgressFill.style.width = '0%';
    if (els.btnSubmitUpload) {
        els.btnSubmitUpload.disabled = false;
        els.btnSubmitUpload.textContent = 'Start Upload';
    }
}

function handleSelectedFile(file) {
    if (!file) return false;

    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|wmv)$/i.test(file.name);
    const maxBytes = isVideo ? 500 * 1024 * 1024 : 100 * 1024 * 1024;
    const limitLabel = isVideo ? '500 MB' : '100 MB';

    if (file.size > maxBytes) {
        if (els.docFileError) {
            els.docFileError.textContent = `Selected file is too large (${formatBytes(file.size)}). Max allowed is ${limitLabel}.`;
        }
        showToast(`File exceeds ${limitLabel} size limit!`, true);
        return false;
    }

    if (els.docFileError) els.docFileError.textContent = '';
    if (els.dropZoneTitle) els.dropZoneTitle.textContent = file.name;
    if (els.dropZoneHint)  els.dropZoneHint.textContent = `${formatBytes(file.size)} • Ready to upload`;

    // Auto-populate Title if empty
    if (els.docTitle && !els.docTitle.value.trim()) {
        const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[_\-\.]+/g, " ");
        els.docTitle.value = baseName;
    }
    return true;
}

async function handleSubmitUpload(e) {
    e.preventDefault();
    if (!els.docFileInput.files || els.docFileInput.files.length === 0) {
        if (els.docFileError) els.docFileError.textContent = 'Please choose a file to upload';
        return;
    }

    const file = els.docFileInput.files[0];
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|wmv)$/i.test(file.name);
    const maxBytes = isVideo ? 500 * 1024 * 1024 : 100 * 1024 * 1024;
    if (file.size > maxBytes) {
        showToast(`File exceeds size limit (${isVideo ? '500MB' : '100MB'})`, true);
        return;
    }

    if (!state.selectedUploadTags || state.selectedUploadTags.length === 0) {
        if (els.docTagsError) els.docTagsError.textContent = 'Please select or add at least one tag';
        showToast('Please select or add at least one tag for this file', true);
        return;
    }

    const title = (els.docTitle.value || '').trim() || file.name;
    const description = (els.docDescription.value || '').trim();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    formData.append('tags', JSON.stringify(state.selectedUploadTags));
    formData.append('description', description);

    if (els.uploadProgressWrapper) els.uploadProgressWrapper.classList.remove('hidden');
    if (els.btnSubmitUpload) {
        els.btnSubmitUpload.disabled = true;
        els.btnSubmitUpload.textContent = 'Uploading...';
    }

    try {
        await api.uploadDocument(formData, (percent) => {
            if (els.uploadProgressFill) els.uploadProgressFill.style.width = `${percent}%`;
            if (els.uploadProgressPercent) els.uploadProgressPercent.textContent = `${percent}%`;
            if (els.uploadProgressText) {
                els.uploadProgressText.textContent = percent === 100 ? 'Processing file...' : `Uploading (${percent}%)...`;
            }
        });

        showToast('File uploaded and shared successfully!');
        toggleUploadForm();
        await loadData();
    } catch (error) {
        showToast(error.message || 'Upload failed', true);
        if (els.btnSubmitUpload) {
            els.btnSubmitUpload.disabled = false;
            els.btnSubmitUpload.textContent = 'Start Upload';
        }
    }
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
                <p><strong>Date:</strong> 27 August 2026 — 10:00</p>
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
async function checkAppVersion() {
    try {
        const res = await fetch(`/api/version?_t=${Date.now()}`);
        if (res.ok) {
            const data = await res.json();
            if (data.version && data.version !== APP_VERSION) {
                console.log(`New version detected (${data.version}). Refreshing app...`);
                window.location.reload(true);
            }
        }
    } catch { /* ignore */ }
}

// Check version and reload data when phone wakes up or tab gains focus
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        checkAppVersion();
        if (state.token) loadData();
    }
});
window.addEventListener('focus', () => {
    checkAppVersion();
    if (state.token) loadData();
});

function startPolling() {
    let secondsLeft = 15;
    countdownTimer = setInterval(() => {
        secondsLeft--;
        if (els.refreshCountdown) els.refreshCountdown.textContent = Math.max(0, secondsLeft);
        if (secondsLeft <= 0) secondsLeft = 15;
    }, 1000);
    pollTimer = setInterval(async () => {
        await checkAppVersion();
        await loadData();
    }, POLL_INTERVAL_MS);
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
    // 1. Category Management Modal (Admin)
    if (els.categoryModal && els.categoryModal.classList.contains('active')) {
        closeCategoryModal();
        rearmHistory();
        return;
    }

    // 2. Info Modal (Members, Items, Voting Breakdown)
    if (els.infoModal && els.infoModal.classList.contains('active')) {
        closeInfoModal();
        rearmHistory();
        return;
    }

    // 3. Export / View Agenda Modal
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

    // 4. Upload Document Form (if expanded)
    if (els.uploadDocContainer && !els.uploadDocContainer.classList.contains('collapsed')) {
        els.uploadDocContainer.classList.add('collapsed');
        resetUploadForm();
        rearmHistory();
        return;
    }

    // 5. Any expanded comment / brainstorm drawers
    if (state.openComments && state.openComments.size > 0) {
        state.openComments.clear();
        renderItems();
        rearmHistory();
        return;
    }

    // 6. In Documents Vault View -> Switch back to Agenda view
    if (state.activeTab === 'documents') {
        switchTab('agenda');
        rearmHistory();
        return;
    }

    // 7. Base Screen (Main View or Login View) -> Double back to exit
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
