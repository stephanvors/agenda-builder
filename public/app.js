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
    selectedEditTags: [],   // tags selected for current edit modal
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
    theme: 'light',          // 'light' | 'dark'
    openComments: new Set(), // item IDs with expanded comment drawers
    openDocs: new Set(),     // doc IDs with expanded description drawers (starts collapsed by default)
    activeCommentType: {},   // { [itemId]: 'idea' | 'action' | 'question' | 'comment' }
    commentDrafts: {},       // { [itemId]: 'draft text' }
    editingComments: {},     // { [commentId]: { content: '...', type: '...' } }

    // ── Meeting Archives & Conclude State ──
    archives: [],            // past meeting archives
    meetingInfo: null,       // current active meeting info { title, date, time, venue, school }
    activeArchive: null,     // archive currently viewed in dossier modal
    editingArchive: null,    // archive currently edited in edit modal
    concludeStep: 1,         // current step in conclude wizard (1..5)
    selectedConcludeAudios: [], // files selected for audio upload
    selectedConcludeMinutes: [], // files selected for minutes upload
    concludeResolutions: [], // dynamic resolutions array in wizard
    concludeAttendance: null, // dynamic attendance roster in wizard
    archiveFilters: {
        filter: 'all',       // 'all' | 'audio' | 'transcript' | 'signed' | 'resolutions'
        sort: 'newest',      // 'newest' | 'oldest' | 'items' | 'resolutions'
        search: ''
    },
    dossierActiveTab: 'overview' // 'overview' | 'minutes' | 'audio' | 'transcript' | 'resolutions' | 'agenda' | 'attendance' | 'files'
};

// Check if current user has Admin privileges
function isAdmin() {
    if (!state.member) return false;
    const name = (state.member.name || '').toLowerCase().trim();
    const role = (state.member.role || '').toLowerCase().trim();
    return name.includes('vorster') || role.includes('admin') || role.includes('principal') || role.includes('chairperson') || role.includes('smt') || role.includes('treasurer') || role.includes('finance') || role.includes('officer') || role.includes('sgb') || role.includes('deputy');
}

const APP_VERSION = '20260826-03';
const MEETING_DATE = new Date('2026-08-27T10:00:00');
const POLL_INTERVAL_MS = 15000;

function determineStatus(voteCount) {
    if (voteCount >= 5) return 'endorsed';
    if (voteCount >= 2) return 'seconded';
    return 'proposed';
}

function formatShortName(fullName, title = '') {
    if (!fullName || typeof fullName !== 'string') return '';
    let clean = fullName.trim();
    
    // Check if the input already contains a title prefix
    const titleMatch = clean.match(/^(Mr|Mrs|Ms|Miss|Dr|Prof|Adv|Rev)\.?\s+/i);
    let extractedTitle = title ? title.trim() : '';
    if (titleMatch) {
        if (!extractedTitle) extractedTitle = titleMatch[1];
        clean = clean.substring(titleMatch[0].length).trim();
    }

    // If it's already in "Surname I." or "Surname I" format
    if (/^[A-Za-z\s'-]+\s+[A-Z]\.?$/.test(clean)) {
        return extractedTitle ? `${extractedTitle} ${clean}` : clean;
    }

    const parts = clean.split(/\s+/);
    if (parts.length === 1) {
        return extractedTitle ? `${extractedTitle} ${parts[0]}` : parts[0];
    }

    const first = parts[0];
    const surname = parts.slice(1).join(' ');
    const initial = first.charAt(0).toUpperCase();
    const formatted = `${surname} ${initial}.`;

    return extractedTitle ? `${extractedTitle} ${formatted}` : formatted;
}

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

    async verifySession() {
        return this.getMe();
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

    async vote(itemId) {
        return this.voteItem(itemId);
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

    async unvote(itemId) {
        return this.unvoteItem(itemId);
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

    async updateComment(itemId, commentId, { content, type = 'idea' }) {
        return this.editComment(itemId, commentId, content, type);
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

    async getAttendance() {
        const res = await fetch('/api/attendance', { headers: authHeaders() });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) throw new Error('Failed to load attendance register');
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

    async updateDocument(docId, formData) {
        const res = await fetch(`/api/documents/${docId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${state.token}`
            },
            body: formData
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to update document');
        }
        return res.json();
    },

    // ── Attendance Register API Methods ──
    async getAttendance() {
        const res = await fetch('/api/attendance', { headers: authHeaders() });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) throw new Error('Failed to load attendance register');
        return res.json();
    },

    async saveAttendance(payload) {
        const res = await fetch('/api/attendance', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to save attendance register');
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
    },

    // ── Meeting Archives API Methods ──
    async getArchives() {
        const res = await fetch('/api/archives', { headers: authHeaders() });
        if (res.status === 401) { handleSessionExpired(); return []; }
        if (!res.ok) throw new Error('Failed to load archives');
        return res.json();
    },

    async getArchive(archiveId) {
        const res = await fetch(`/api/archives/${archiveId}`, { headers: authHeaders() });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) throw new Error('Failed to load meeting archive');
        return res.json();
    },

    concludeMeeting(formData, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/archives/conclude');
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
                        reject(new Error(data.error || 'Failed to conclude and archive meeting'));
                    }
                } catch {
                    reject(new Error('Failed to conclude and archive meeting'));
                }
            };

            xhr.onerror = () => reject(new Error('Network error during archive packaging'));
            xhr.send(formData);
        });
    },

    async updateArchive(archiveId, payload) {
        const res = await fetch(`/api/archives/${archiveId}`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to update archive');
        }
        return res.json();
    },

    uploadArchiveFiles(archiveId, formData, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/archives/${archiveId}/files`);
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

    async deleteArchiveFile(archiveId, fileId) {
        const res = await fetch(`/api/archives/${archiveId}/files/${fileId}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to delete file from archive');
        }
        return res.json();
    },

    async deleteArchive(archiveId) {
        const res = await fetch(`/api/archives/${archiveId}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (res.status === 401) { handleSessionExpired(); return null; }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to delete archive');
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
    btnThemeToggleApp:   document.getElementById('btn-theme-toggle-app'),
    btnThemeToggleLogin: document.getElementById('btn-theme-toggle-login'),

    statDays:         document.getElementById('stat-days'),
    statTicker:       document.getElementById('stat-ticker'),
    statMembers:      document.getElementById('stat-members'),
    statItems:        document.getElementById('stat-items'),
    statVotes:        document.getElementById('stat-votes'),
    statDocs:         document.getElementById('stat-docs'),
    statArchives:     document.getElementById('stat-archives'),
    statCardMembers:  document.getElementById('stat-card-members'),
    statCardItems:    document.getElementById('stat-card-items'),
    statCardVotes:    document.getElementById('stat-card-votes'),
    statCardDocs:     document.getElementById('stat-card-docs'),
    statCardArchives: document.getElementById('stat-card-archives'),

    tabBtnAgenda:     document.getElementById('tab-btn-agenda'),
    tabBtnDocuments:  document.getElementById('tab-btn-documents'),
    tabBtnArchives:   document.getElementById('tab-btn-archives'),
    tabAgendaBadge:   document.getElementById('tab-agenda-badge'),
    tabDocsBadge:     document.getElementById('tab-docs-badge'),
    tabArchivesBadge: document.getElementById('tab-archives-badge'),
    tabViewAgenda:    document.getElementById('tab-view-agenda'),
    tabViewDocuments: document.getElementById('tab-view-documents'),
    tabViewArchives:  document.getElementById('tab-view-archives'),

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
    docDescriptionWrapper:document.getElementById('doc-description-wrapper'),
    docEditorToolbar:     document.getElementById('doc-editor-toolbar'),
    docDescriptionEditor: document.getElementById('doc-description-editor'),
    editorFormatBlock:    document.getElementById('editor-format-block'),
    editorFontSize:       document.getElementById('editor-font-size'),
    docFontColor:         document.getElementById('doc-font-color'),
    docColorBar:          document.getElementById('doc-color-bar'),
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

    // Edit Document Modal Elements
    editDocModal:             document.getElementById('edit-doc-modal'),
    btnCloseEditDocModal:     document.getElementById('btn-close-edit-doc-modal'),
    btnCancelEditDoc:         document.getElementById('btn-cancel-edit-doc'),
    editDocForm:              document.getElementById('edit-doc-form'),
    editDocId:                document.getElementById('edit-doc-id'),
    editDocTitle:             document.getElementById('edit-doc-title'),
    editDocTagPicker:         document.getElementById('edit-doc-tag-picker'),
    editDocTagNewInput:       document.getElementById('edit-doc-tag-new-input'),
    editDocTagsError:         document.getElementById('edit-doc-tags-error'),
    editDocDescriptionWrapper:document.getElementById('edit-doc-description-wrapper'),
    editDocEditorToolbar:     document.getElementById('edit-doc-editor-toolbar'),
    editDocDescriptionEditor: document.getElementById('edit-doc-description-editor'),
    editEditorFormatBlock:    document.getElementById('edit-editor-format-block'),
    editEditorFontSize:       document.getElementById('edit-editor-font-size'),
    editDocFontColor:         document.getElementById('edit-doc-font-color'),
    editDocColorBar:          document.getElementById('edit-doc-color-bar'),
    editDocFileInput:         document.getElementById('edit-doc-file-input'),
    editDocCurrentFilename:   document.getElementById('edit-doc-current-filename'),
    btnSaveEditDoc:           document.getElementById('btn-save-edit-doc'),

    btnExport:        document.getElementById('btn-export'),
    modal:            document.getElementById('export-modal'),
    btnPrint:         document.getElementById('btn-print'),
    btnCloseModal:    document.getElementById('btn-close-modal'),
    printableAgenda:  document.getElementById('printable-agenda'),

    btnAttendance:             document.getElementById('btn-attendance'),
    attendanceModal:           document.getElementById('attendance-modal'),
    printableAttendance:       document.getElementById('printable-attendance'),
    btnPrintAttendance:        document.getElementById('btn-print-attendance'),
    btnCloseAttendanceModal:   document.getElementById('btn-close-attendance-modal'),
    btnSwitchToAttendance:     document.getElementById('btn-switch-to-attendance'),
    btnSwitchToAgenda:         document.getElementById('btn-switch-to-agenda'),
    btnDownloadAttendanceDocx: document.getElementById('btn-download-attendance-docx'),

    // Meeting Archives & Conclude Wizard Elements
    btnConcludeMeeting:       document.getElementById('btn-conclude-meeting'),
    btnConcludeFromArchives:  document.getElementById('btn-conclude-from-archives'),
    archiveSearchInput:       document.getElementById('archive-search-input'),
    archiveFilterChips:       document.getElementById('archive-filter-chips'),
    sortArchives:             document.getElementById('sort-archives'),
    archivesContainer:        document.getElementById('archives-container'),
    archivesEmptyState:       document.getElementById('archives-empty-state'),

    // Conclude Wizard Modal
    concludeModal:            document.getElementById('conclude-modal'),
    concludeModalSubtitle:    document.getElementById('conclude-modal-subtitle'),
    btnCloseConcludeModal:    document.getElementById('btn-close-conclude-modal'),
    concludeWizardStepper:    document.getElementById('conclude-wizard-stepper'),
    concludeMeetingForm:      document.getElementById('conclude-meeting-form'),
    concludeStep1:            document.getElementById('conclude-step-1'),
    concludeStep2:            document.getElementById('conclude-step-2'),
    concludeStep3:            document.getElementById('conclude-step-3'),
    concludeStep4:            document.getElementById('conclude-step-4'),
    concludeStep5:            document.getElementById('conclude-step-5'),
    concludeStep6:            document.getElementById('conclude-step-6'),
    concludeMeetingTitle:     document.getElementById('conclude-meeting-title'),
    concludeMeetingDate:      document.getElementById('conclude-meeting-date'),
    concludeMeetingTime:      document.getElementById('conclude-meeting-time'),
    concludeMeetingVenue:     document.getElementById('conclude-meeting-venue'),
    concludeStatsSummaryCard: document.getElementById('conclude-stats-summary-card'),
    concludeMeetingNotes:     document.getElementById('conclude-meeting-notes'),
    concludeAudioDropZone:    document.getElementById('conclude-audio-drop-zone'),
    concludeAudioInput:       document.getElementById('conclude-audio-input'),
    concludeAudioDropTitle:   document.getElementById('conclude-audio-drop-title'),
    concludeAudioTray:        document.getElementById('conclude-audio-tray'),
    concludeMinutesDropZone:  document.getElementById('conclude-minutes-drop-zone'),
    concludeMinutesFileInput: document.getElementById('conclude-minutes-file-input'),
    concludeMinutesDropTitle: document.getElementById('conclude-minutes-drop-title'),
    concludeMinutesTray:      document.getElementById('conclude-minutes-tray'),
    concludeTranscriptFileInput: document.getElementById('conclude-transcript-file-input'),
    concludeTranscriptText:   document.getElementById('conclude-transcript-text'),
    concludeResCount:         document.getElementById('conclude-res-count'),
    btnAddResolutionRow:      document.getElementById('btn-add-resolution-row'),
    concludeResolutionsList:  document.getElementById('conclude-resolutions-list'),
    concludeResolutionFileInput: document.getElementById('conclude-resolution-file-input'),
    concludeSignedRegDropZone:document.getElementById('conclude-signed-reg-drop-zone'),
    concludeSignedRegInput:   document.getElementById('conclude-signed-reg-input'),
    concludeSignedRegTitle:   document.getElementById('conclude-signed-reg-title'),
    concludeSignedRegError:   document.getElementById('conclude-signed-reg-error'),
    concludeAttendanceReviewBox: document.getElementById('conclude-attendance-review-box'),
    nextMeetingTitle:         document.getElementById('next-meeting-title'),
    nextMeetingDate:          document.getElementById('next-meeting-date'),
    nextMeetingTime:          document.getElementById('next-meeting-time'),
    nextMeetingVenue:         document.getElementById('next-meeting-venue'),
    concludeClearVault:       document.getElementById('conclude-clear-vault'),
    concludeProgressWrapper:  document.getElementById('conclude-progress-wrapper'),
    concludeProgressFill:     document.getElementById('conclude-progress-fill'),
    concludeProgressText:     document.getElementById('conclude-progress-text'),
    concludeProgressPercent:  document.getElementById('conclude-progress-percent'),
    btnConcludePrev:          document.getElementById('btn-conclude-prev'),
    btnConcludeNext:          document.getElementById('btn-conclude-next'),
    btnConcludeSubmit:        document.getElementById('btn-conclude-submit'),
    btnConcludeCancel:        document.getElementById('btn-conclude-cancel'),

    // Archive Dossier Viewer Modal
    archiveDossierModal:      document.getElementById('archive-dossier-modal'),
    dossierModalTitle:        document.getElementById('dossier-modal-title'),
    dossierModalSubtitle:     document.getElementById('dossier-modal-subtitle'),
    btnDossierEdit:           document.getElementById('btn-dossier-edit'),
    btnDossierDownloadDocx:   document.getElementById('btn-dossier-download-docx'),
    btnDossierDownloadZip:    document.getElementById('btn-dossier-download-zip'),
    btnDossierPrint:          document.getElementById('btn-dossier-print'),
    btnCloseDossierModal:     document.getElementById('btn-close-dossier-modal'),
    dossierTabsStrip:         document.getElementById('dossier-tabs-strip'),
    dossierModalBody:         document.getElementById('dossier-modal-body'),
    dossierMinutesTabCount:   document.getElementById('dossier-minutes-tab-count'),
    dossierAudioTabCount:     document.getElementById('dossier-audio-tab-count'),
    dossierResTabCount:       document.getElementById('dossier-res-tab-count'),
    dossierItemsTabCount:     document.getElementById('dossier-items-tab-count'),
    dossierFilesTabCount:     document.getElementById('dossier-files-tab-count'),

    // Edit Archive Modal
    editArchiveModal:         document.getElementById('edit-archive-modal'),
    editArchiveModalSubtitle: document.getElementById('edit-archive-modal-subtitle'),
    btnCloseEditArchiveModal: document.getElementById('btn-close-edit-archive-modal'),
    editArchiveForm:          document.getElementById('edit-archive-form'),
    editArchiveId:            document.getElementById('edit-archive-id'),
    editArchiveTitle:         document.getElementById('edit-archive-title'),
    editArchiveDate:          document.getElementById('edit-archive-date'),
    editArchiveTime:          document.getElementById('edit-archive-time'),
    editArchiveVenue:         document.getElementById('edit-archive-venue'),
    editArchiveNotes:         document.getElementById('edit-archive-notes'),
    editArchiveResolutionsList: document.getElementById('edit-archive-resolutions-list'),
    btnEditAddResolutionRow:  document.getElementById('btn-edit-add-resolution-row'),
    editArchiveTranscript:    document.getElementById('edit-archive-transcript'),
    editArchiveExistingFiles: document.getElementById('edit-archive-existing-files'),
    editArchiveNewAudio:      document.getElementById('edit-archive-new-audio'),
    editArchiveNewMinutes:    document.getElementById('edit-archive-new-minutes'),
    editArchiveNewSigned:     document.getElementById('edit-archive-new-signed'),
    editArchiveNewTranscript: document.getElementById('edit-archive-new-transcript'),
    editArchiveNewResolution: document.getElementById('edit-archive-new-resolution'),
    btnCancelEditArchive:     document.getElementById('btn-cancel-edit-archive'),
    btnSaveEditArchive:       document.getElementById('btn-save-edit-archive'),

    refreshCountdown: document.getElementById('refresh-countdown')
};

// ── Theme Management (Light / Dark Mode) ──
function initTheme() {
    let current = 'light';
    try {
        const saved = localStorage.getItem('agendabuilder_theme');
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (saved === 'dark' || (!saved && prefersDark)) {
            current = 'dark';
        }
    } catch (e) {
        current = 'light';
    }
    setTheme(current, false);

    // Listen for OS system theme changes if user hasn't explicitly saved a preference
    if (window.matchMedia) {
        try {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (!localStorage.getItem('agendabuilder_theme')) {
                    setTheme(e.matches ? 'dark' : 'light', false);
                }
            });
        } catch (err) {}
    }
}

function setTheme(theme, save = true) {
    state.theme = theme;
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
    }
    if (save) {
        try {
            localStorage.setItem('agendabuilder_theme', theme);
        } catch (e) {}
    }
    updateThemeToggleUI();
}

function toggleTheme() {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme, true);
    showToast(nextTheme === 'dark' ? '🌙 Dark Mode enabled' : '☀️ Light Mode enabled');
}

function updateThemeToggleUI() {
    const isDark = state.theme === 'dark';
    const icon = isDark ? '☀️' : '🌙';
    const textApp = isDark ? 'Light' : 'Dark';
    const textLogin = isDark ? 'Light Mode' : 'Dark Mode';

    if (els.btnThemeToggleApp) {
        const iconSpan = els.btnThemeToggleApp.querySelector('.theme-toggle-icon');
        const textSpan = els.btnThemeToggleApp.querySelector('.theme-toggle-text');
        if (iconSpan) iconSpan.textContent = icon;
        if (textSpan) textSpan.textContent = textApp;
        els.btnThemeToggleApp.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    }

    if (els.btnThemeToggleLogin) {
        const iconSpan = els.btnThemeToggleLogin.querySelector('.theme-toggle-icon');
        const textSpan = els.btnThemeToggleLogin.querySelector('.theme-toggle-text');
        if (iconSpan) iconSpan.textContent = icon;
        if (textSpan) textSpan.textContent = textLogin;
        els.btnThemeToggleLogin.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    }
}

// ── Initialisation ──
async function init() {
    initTheme();
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
            opt.textContent = `${formatShortName(m.name, m.title)} — ${m.role}`;
            els.loginMember.appendChild(opt);
        });
    } catch (error) {
        console.error('Failed to load member list:', error);
        showToast('Failed to load member list. Please refresh.', true);
    }
}

// ── Event Listeners ──
function setupEventListeners() {
    if (els.btnThemeToggleApp) {
        els.btnThemeToggleApp.addEventListener('click', toggleTheme);
    }
    if (els.btnThemeToggleLogin) {
        els.btnThemeToggleLogin.addEventListener('click', toggleTheme);
    }

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
            const memberName = (state.member?.name || '').trim();
            if (memberName && tag.toLowerCase() === memberName.toLowerCase()) {
                showToast('Your contributor tag is automatically assigned to your upload and cannot be removed.', true);
                return;
            }
            const idx = state.selectedUploadTags.findIndex(t => t.toLowerCase() === tag.toLowerCase());
            if (idx === -1) {
                state.selectedUploadTags.push(tag);
            } else {
                state.selectedUploadTags.splice(idx, 1);
            }
            renderDocTagPicker();
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
            const toggleDescBtn = e.target.closest('.btn-toggle-doc-desc');
            if (toggleDescBtn) {
                const docId = toggleDescBtn.dataset.docId;
                if (!state.openDocs) state.openDocs = new Set();
                if (state.openDocs.has(docId)) {
                    state.openDocs.delete(docId);
                } else {
                    state.openDocs.add(docId);
                }
                renderDocuments();
                return;
            }

            const editBtn = e.target.closest('.btn-doc-edit');
            if (editBtn) {
                const docId = editBtn.dataset.docId;
                openEditDocModal(docId);
                return;
            }

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
                            if (els.docDescriptionEditor) els.docDescriptionEditor.innerHTML = doc.description || '';
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

    // Edit Document Modal Listeners
    if (els.editDocTagPicker) {
        els.editDocTagPicker.addEventListener('click', (e) => {
            const lbl = e.target.closest('.doc-tag-chip-label');
            if (!lbl) return;
            const tag = lbl.dataset.tag;
            if (!tag) return;
            const docUploaderName = (state.editingDoc?.uploadedBy?.memberName || '').trim();
            if (docUploaderName && tag.toLowerCase() === docUploaderName.toLowerCase()) {
                showToast('The contributor tag is permanently assigned to this document and cannot be removed.', true);
                return;
            }
            const idx = state.selectedEditTags.findIndex(t => t.toLowerCase() === tag.toLowerCase());
            if (idx === -1) {
                state.selectedEditTags.push(tag);
            } else {
                state.selectedEditTags.splice(idx, 1);
            }
            renderEditDocTagPicker();
            if (els.editDocTagsError) els.editDocTagsError.textContent = '';
        });
    }

    if (els.editDocTagNewInput) {
        els.editDocTagNewInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const tag = els.editDocTagNewInput.value.trim();
                if (!tag) return;
                if (!state.documentTags.some(t => t.toLowerCase() === tag.toLowerCase())) {
                    state.documentTags.push(tag);
                }
                if (!state.selectedEditTags.some(t => t.toLowerCase() === tag.toLowerCase())) {
                    state.selectedEditTags.push(tag);
                }
                els.editDocTagNewInput.value = '';
                renderEditDocTagPicker();
                if (els.editDocTagsError) els.editDocTagsError.textContent = '';
            }
        });
    }

    if (els.btnCloseEditDocModal) {
        els.btnCloseEditDocModal.addEventListener('click', closeEditDocModal);
    }
    if (els.btnCancelEditDoc) {
        els.btnCancelEditDoc.addEventListener('click', closeEditDocModal);
    }
    if (els.editDocModal) {
        els.editDocModal.addEventListener('click', (e) => {
            if (e.target === els.editDocModal) closeEditDocModal();
        });
    }
    if (els.editDocForm) {
        els.editDocForm.addEventListener('submit', handleSaveEditDoc);
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

    // Global delegation for opening and closing category/tag modal
    document.addEventListener('click', (e) => {
        const catBtn = e.target.closest('#btn-manage-agenda-cats, .btn-manage-categories, #btn-add-agenda-cat-inline');
        if (catBtn) {
            e.preventDefault();
            e.stopPropagation();
            const type = (catBtn.id.includes('doc') || catBtn.id.includes('tag')) ? 'documents' : 'agenda';
            openCategoryModal(type);
            return;
        }

        if (e.target.id === 'btn-close-category-modal' || e.target.closest('#btn-close-category-modal')) {
            e.preventDefault();
            closeCategoryModal();
            return;
        }

        if (e.target.id === 'category-modal') {
            closeCategoryModal();
            return;
        }
    });

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

    if (els.btnAttendance) {
        els.btnAttendance.addEventListener('click', showAttendanceModal);
    }
    if (els.btnCloseAttendanceModal) {
        els.btnCloseAttendanceModal.addEventListener('click', closeAttendanceModal);
    }
    if (els.btnPrintAttendance) {
        els.btnPrintAttendance.addEventListener('click', () => window.print());
    }
    if (els.attendanceModal) {
        els.attendanceModal.addEventListener('click', (e) => {
            if (e.target === els.attendanceModal) closeAttendanceModal();
        });
    }
    if (els.btnSwitchToAttendance) {
        els.btnSwitchToAttendance.addEventListener('click', () => {
            els.modal.classList.remove('active');
            showAttendanceModal();
        });
    }
    if (els.btnSwitchToAgenda) {
        els.btnSwitchToAgenda.addEventListener('click', () => {
            closeAttendanceModal();
            showExportModal();
        });
    }
    if (els.btnDownloadAttendanceDocx) {
        els.btnDownloadAttendanceDocx.addEventListener('click', () => {
            const token = encodeURIComponent(state.token || '');
            window.location.href = `/api/attendance/docx?token=${token}`;
        });
    }

    const openDocFormatter = () => {
        const token = encodeURIComponent(state.token || '');
        const timestamp = Date.now();
        window.open(`/doc-formatter.html?token=${token}&_v=${timestamp}`, '_blank');
    };
    const btnOpenDocFormatter = document.getElementById('btn-open-doc-formatter');
    if (btnOpenDocFormatter) {
        btnOpenDocFormatter.addEventListener('click', openDocFormatter);
    }
    const btnOpenDocFormatterAgenda = document.getElementById('btn-open-doc-formatter-agenda');
    if (btnOpenDocFormatterAgenda) {
        btnOpenDocFormatterAgenda.addEventListener('click', openDocFormatter);
    }
    const btnHeaderDocFormatter = document.getElementById('btn-header-doc-formatter');
    if (btnHeaderDocFormatter) {
        btnHeaderDocFormatter.addEventListener('click', openDocFormatter);
    }
    const tabBtnFormatter = document.getElementById('tab-btn-formatter');
    if (tabBtnFormatter) {
        tabBtnFormatter.addEventListener('click', openDocFormatter);
    }

    setupRichTextEditor();
    setupEditDocRichTextEditor();
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
        const item = state.items.find(i => i.id === id);
        if (!item || !state.member) return;

        const currentMemberId = state.member.id;
        const currentMemberName = (state.member.name || '').toLowerCase().trim();

        const hasVoted = (item.votes || []).some(v => 
            v.memberId === currentMemberId || 
            (v.memberName && v.memberName.toLowerCase().trim() === currentMemberName)
        );
        
        // Optimistic UI update
        if (hasVoted) {
            item.votes = (item.votes || []).filter(v => 
                v.memberId !== currentMemberId && 
                !(v.memberName && v.memberName.toLowerCase().trim() === currentMemberName)
            );
            item.status = determineStatus(item.votes.length);
            showToast('Vote withdrawn');
        } else {
            if (!Array.isArray(item.votes)) item.votes = [];
            item.votes.push({
                memberId: state.member.id,
                memberName: state.member.name,
                votedAt: new Date().toISOString()
            });
            item.status = determineStatus(item.votes.length);
            showToast('Vote cast!');
        }
        renderItems();
        updateStats();

        try {
            let updatedItem;
            if (hasVoted) {
                updatedItem = await api.unvote(id);
            } else {
                updatedItem = await api.vote(id);
            }
            if (updatedItem && updatedItem.id) {
                const idx = state.items.findIndex(i => i.id === id);
                if (idx !== -1) {
                    state.items[idx] = { ...state.items[idx], ...updatedItem };
                    renderItems();
                    updateStats();
                }
            }
            await loadData();
        } catch (error) {
            console.error('Vote failed:', error);
            showToast(error.message || 'Failed to record vote', true);
            await loadData();
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
    els.userName.textContent = formatShortName(state.member.name, state.member.title);
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

        const [items, stats, docData, archives, meetingInfo] = await Promise.all([
            api.getItems(),
            api.getStats(),
            api.getDocuments(),
            api.getArchives().catch(() => []),
            api.getMeetingInfo().catch(() => null)
        ]);
        state.items = items;
        state.archives = Array.isArray(archives) ? archives : [];
        if (meetingInfo) {
            state.meetingInfo = meetingInfo;
            updateMeetingHeaderInfo(meetingInfo);
        }
        if (docData && Array.isArray(docData.documents)) {
            state.documents = docData.documents.map(d => {
                const uploader = (d.uploadedBy?.memberName || '').trim();
                const tags = Array.isArray(d.tags) ? [...d.tags] : (d.category ? d.category.split(/\s*>\s*/).map(p => p.trim()).filter(Boolean) : []);
                if (uploader && !tags.some(t => t.toLowerCase() === uploader.toLowerCase())) {
                    tags.push(uploader);
                }
                return { ...d, tags };
            });
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
        if (state.activeTab === 'archives') {
            renderArchives();
        }

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
        const statusClass = item.status.toLowerCase();
        const statusLabel = item.status.charAt(0).toUpperCase() + item.status.slice(1);
        const isResolved = Boolean(item.isResolved);
        const comments = Array.isArray(item.comments) ? item.comments : [];
        const commentCount = comments.length;
        const isOpen = state.openComments.has(item.id);
        const selectedType = state.activeCommentType[item.id] || 'idea';
        const draftText = state.commentDrafts[item.id] || '';

        // Voting breakdown:
        // 1. Proposer: item.proposedBy
        // 2. Seconder: First voter who is NOT the proposer
        const nonProposerVotes = (item.votes || []).filter(v => v.memberId !== item.proposedBy.memberId);
        const seconderVote = nonProposerVotes[0] || null;
        const seconderName = seconderVote ? seconderVote.memberName : null;

        // 3. Other supporters: Subsequent votes excluding proposer and seconder
        const otherVotes = nonProposerVotes.slice(1);
        const otherVoterNames = otherVotes.map(v => formatShortName(v.memberName)).join(', ');

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
                        ${statusClass === 'seconded' ? `
                            <div class="seconder-badge-group">
                                <span class="badge status-badge status-seconded">SECONDED BY</span>
                                <span class="seconder-name">${escapeHTML(formatShortName(seconderName) || 'Member')}</span>
                            </div>
                        ` : (statusClass === 'endorsed' ? `
                            <div class="seconder-badge-group">
                                <span class="badge status-badge status-endorsed">Endorsed</span>
                                ${seconderName ? `<span class="seconder-name">Seconded by ${escapeHTML(formatShortName(seconderName))}</span>` : ''}
                            </div>
                        ` : `
                            <span class="badge status-badge status-${statusClass}">${statusLabel}</span>
                        `)}
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
                            Resolved by <strong>${escapeHTML(formatShortName(item.resolution.resolvedBy ? item.resolution.resolvedBy.memberName : 'Member'))}</strong> • ${timeAgo(item.resolution.resolvedAt)}
                        </div>
                    </div>
                ` : ''}

                <div class="item-desc">${escapeHTML(item.description)}</div>

                <div class="item-meta">
                    <div class="proposer-info">
                        <strong>${escapeHTML(formatShortName(item.proposedBy.memberName))}</strong>
                        <span>${escapeHTML(item.proposedBy.memberRole)} • ${timeAgo(item.proposedAt)}</span>
                        ${otherVotes.length > 0 ? `
                            <span class="voters-preview">
                                Supported by: <strong>${escapeHTML(otherVoterNames)}</strong>
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
                                    title="${hasVoted ? 'Click to withdraw your support vote' : 'Click to second / support this proposal'}">
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
                                                <strong class="comment-author-name">${escapeHTML(formatShortName(c.memberName))}</strong>
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

function updateStats(stats = null) {
    if (els.statItems)   els.statItems.textContent = stats?.totalItems ?? state.items.length;
    if (els.statMembers) els.statMembers.textContent = stats?.totalMembers ?? (state.members.length || 15);
    if (els.statVotes)   els.statVotes.textContent = state.items.reduce((sum, item) => sum + (Array.isArray(item.votes) ? item.votes.length : 0), 0);
    if (els.statDocs)    els.statDocs.textContent = stats?.totalDocuments ?? state.documents.length;
    if (els.statArchives) els.statArchives.textContent = state.archives.length;
    if (els.tabAgendaBadge) els.tabAgendaBadge.textContent = state.items.length;
    if (els.tabDocsBadge)   els.tabDocsBadge.textContent = state.documents.length;
    if (els.tabArchivesBadge) els.tabArchivesBadge.textContent = state.archives.length;
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
function isContributorTagName(tag, doc = null) {
    if (!tag) return false;
    const cleanTag = tag.trim().toLowerCase();
    if (doc && doc.uploadedBy?.memberName) {
        return cleanTag === doc.uploadedBy.memberName.trim().toLowerCase();
    }
    if (state.member?.name && cleanTag === state.member.name.trim().toLowerCase()) {
        return true;
    }
    if (Array.isArray(state.documents) && state.documents.some(d => d.uploadedBy?.memberName && d.uploadedBy.memberName.trim().toLowerCase() === cleanTag)) {
        return true;
    }
    if (Array.isArray(state.members) && state.members.some(m => m.name && m.name.trim().toLowerCase() === cleanTag)) {
        return true;
    }
    return false;
}

function renderDocTagPicker() {
    if (!els.docTagPicker) return;
    const memberName = (state.member?.name || '').trim();
    const tags = [...(state.documentTags || [])];
    if (memberName && !tags.some(t => t.toLowerCase() === memberName.toLowerCase())) {
        tags.unshift(memberName);
    }
    if (tags.length === 0) {
        els.docTagPicker.innerHTML = '<span style="color:var(--text-muted);font-size:0.82rem;padding:0.25rem 0.5rem;">No tags available yet. Type a tag below and press Enter.</span>';
        return;
    }
    els.docTagPicker.innerHTML = tags.map(tag => {
        const isCurrentUploader = !!(memberName && tag.toLowerCase() === memberName.toLowerCase());
        const isSelected = isCurrentUploader || (state.selectedUploadTags || []).some(t => t.toLowerCase() === tag.toLowerCase());
        if (isCurrentUploader) {
            return `<label class="doc-tag-chip-label doc-tag-chip-uploader selected locked" data-tag="${escapeHTML(tag)}" title="Your contributor tag is automatically assigned to this upload and cannot be removed">
                👤 ${escapeHTML(tag)} <span class="tag-locked-icon" title="Cannot be removed">🔒</span>
            </label>`;
        }
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
            return dTags.some(t => t.toLowerCase() === tag.toLowerCase());
        }).length;
        if (count === 0 && !isActive) return;
        const isContributor = isContributorTagName(tag);
        html += `<button type="button" class="tag-filter-chip ${isContributor ? 'tag-filter-chip-uploader' : ''} ${isActive ? 'active' : ''}" data-tag="${escapeHTML(tag)}">${isContributor ? '👤 ' : ''}${escapeHTML(tag)} <span style="opacity:0.65;font-size:0.7rem;margin-left:0.2rem;">${count}</span></button>`;
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
                    return dTags.some(t => t.toLowerCase() === tag.toLowerCase());
                }).length;
                const isContributor = isContributorTagName(tag);
                return `
                    <div class="doc-tag-manager-row ${isContributor ? 'doc-tag-manager-row-contributor' : ''}">
                        <span class="doc-tag-pill ${isContributor ? 'doc-tag-pill-uploader' : ''}">${isContributor ? '👤 ' : ''}${escapeHTML(tag)}</span>
                        <span class="doc-tag-manager-count">${count > 0 ? count + ' file' + (count > 1 ? 's' : '') : 'unused'}</span>
                        ${isContributor ? `
                            <span class="doc-tag-contributor-badge" title="Contributor tag (cannot be deleted)">🔒 Protected</span>
                        ` : `
                            <button type="button" class="btn-cat-delete" data-path="${escapeHTML(tag)}" title="Delete tag">🗑️</button>
                        `}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ── Category Management Modal Logic (Admin) ──
function openCategoryModal(type = 'agenda') {
    state.activeCategoryModalType = type;
    if (!els.categoryModal) {
        els.categoryModal = document.getElementById('category-modal');
    }
    if (!els.categoryModal) {
        console.error('categoryModal element not found in DOM!');
        return;
    }

    // 1. Immediately display the modal so clicking is never unresponsive
    els.categoryModal.classList.add('active');

    try {
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
    } catch (err) {
        console.error('Error populating category modal:', err);
    }

    if (els.newCategoryInput) {
        els.newCategoryInput.value = '';
        setTimeout(() => {
            if (els.newCategoryInput) els.newCategoryInput.focus();
        }, 100);
    }
    if (els.categoryModalError) {
        els.categoryModalError.textContent = '';
    }
}

function closeCategoryModal() {
    const modal = els.categoryModal || document.getElementById('category-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function updateCategoryBuilderSelectors(preselectL1 = null, preselectL2 = null) {
    if (!els.catParentL1) els.catParentL1 = document.getElementById('cat-parent-l1');
    const list = Array.isArray(state.categories) ? state.categories : [];
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
    if (!els.catParentL1) els.catParentL1 = document.getElementById('cat-parent-l1');
    if (!els.catParentL2) els.catParentL2 = document.getElementById('cat-parent-l2');
    if (!els.catParentL2Group) els.catParentL2Group = document.getElementById('cat-parent-l2-group');
    if (!els.catParentL1 || !els.catParentL2 || !els.catParentL2Group) return;

    const selectedL1 = els.catParentL1.value;
    const list = Array.isArray(state.categories) ? state.categories : [];
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

    if (preselectL2 && l1Node && l1Node.children && l1Node.children.some(c => c.path === preselectL2)) {
        els.catParentL2.value = preselectL2;
    } else {
        els.catParentL2.value = '__NEW__';
    }

    updateTargetPreview();
}

function updateTargetPreview() {
    if (!els.catParentL1) els.catParentL1 = document.getElementById('cat-parent-l1');
    if (!els.catTargetPath) els.catTargetPath = document.getElementById('cat-target-path');
    if (!els.newCategoryInput) els.newCategoryInput = document.getElementById('new-category-input');
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
    if (!els.categoryTreeContainer) {
        els.categoryTreeContainer = document.getElementById('category-tree-container');
    }
    if (!els.categoryTreeContainer) return;

    const list = Array.isArray(state.categories) ? state.categories : [];
    const { tree } = parseCategoryHierarchy(list);
    const isAgenda = state.activeCategoryModalType === 'agenda';
    const items = Array.isArray(state.items) ? state.items : [];
    const docs = Array.isArray(state.documents) ? state.documents : [];

    if (els.categoryModalCount) {
        els.categoryModalCount.textContent = list.length;
    }

    if (tree.length === 0) {
        els.categoryTreeContainer.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem;padding:1rem;text-align:center;display:block;">No categories defined yet. Use the form above to create your first category.</span>';
        return;
    }

    let html = '';

    tree.forEach(l1 => {
        const l1Count = items.filter(i => i && (i.category === l1.path || (typeof i.category === 'string' && i.category.startsWith(l1.path + ' > ')))).length;

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

        (l1.children || []).forEach(l2 => {
            const l2Count = isAgenda
                ? items.filter(i => i && (i.category === l2.path || (typeof i.category === 'string' && i.category.startsWith(l2.path + ' > ')))).length
                : docs.filter(d => d && (d.category === l2.path || (typeof d.category === 'string' && d.category.startsWith(l2.path + ' > ')))).length;

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

            (l2.children || []).forEach(l3 => {
                const l3Count = isAgenda
                    ? items.filter(i => i && i.category === l3.path).length
                    : docs.filter(d => d && d.category === l3.path).length;

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
    
    if (!isAgenda && isContributorTagName(name)) {
        showToast(`Contributor tag "${name}" is protected and cannot be deleted.`, true);
        return;
    }

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
            return dTags.some(t => t.toLowerCase() === name.toLowerCase());
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
    const archivesView = document.getElementById('tab-view-archives');

    if (agendaView) agendaView.classList.toggle('active', tabName === 'agenda');
    if (docsView) docsView.classList.toggle('active', tabName === 'documents');
    if (archivesView) archivesView.classList.toggle('active', tabName === 'archives');

    if (tabName === 'documents') {
        renderDocuments();
    } else if (tabName === 'archives') {
        renderArchives();
    }
}
window.switchTab = switchTab;

// ── Document Vault Rendering & Helpers ──
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i)) + ' ' + sizes[i];
}

function getFileTypeInfo(doc) {
    let ext = (doc.extension || '').toLowerCase().replace(/^\./, '');
    const filename = (doc.originalName || doc.filename || doc.title || '').toLowerCase().trim();
    if (!ext && filename.includes('.')) {
        ext = filename.split('.').pop().trim();
    }
    const mime = (doc.mimetype || doc.mimeType || '').toLowerCase();

    // 1. PDF Document (Official Adobe Red Style)
    if (ext === 'pdf' || mime.includes('pdf')) {
        return {
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="20" height="20" rx="4" fill="#E5252A"/>
                <path d="M7 6.5C6.44772 6.5 6 6.94772 6 7.5V16.5C6 17.0523 6.44772 17.5 7 17.5H17C17.5523 17.5 18 17.0523 18 16.5V11L13.5 6.5H7Z" fill="white" fill-opacity="0.25"/>
                <path d="M13.5 6.5V11H18L13.5 6.5Z" fill="white" fill-opacity="0.5"/>
                <text x="12" y="15" fill="white" font-size="7" font-weight="900" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" text-anchor="middle" letter-spacing="0.5">PDF</text>
            </svg>`,
            className: 'type-pdf',
            label: 'PDF Document'
        };
    }

    // 2. Microsoft Word Document (Official Blue 'W' Style)
    if (['docx', 'doc', 'odt', 'rtf', 'dotx'].includes(ext) || mime.includes('word') || mime.includes('wordprocessingml') || mime.includes('document')) {
        return {
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="20" height="20" rx="4" fill="#185ABD"/>
                <path d="M7 6.5C6.44772 6.5 6 6.94772 6 7.5V16.5C6 17.0523 6.44772 17.5 7 17.5H17C17.5523 17.5 18 17.0523 18 16.5V11L13.5 6.5H7Z" fill="white" fill-opacity="0.25"/>
                <path d="M13.5 6.5V11H18L13.5 6.5Z" fill="white" fill-opacity="0.5"/>
                <text x="12" y="15.2" fill="white" font-size="8.5" font-weight="900" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" text-anchor="middle">W</text>
            </svg>`,
            className: 'type-word',
            label: 'Word Document'
        };
    }

    // 3. Microsoft Excel Spreadsheet (Official Green 'X' Style)
    if (['xlsx', 'xls', 'csv', 'ods', 'xltx'].includes(ext) || mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) {
        return {
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="20" height="20" rx="4" fill="#107C41"/>
                <path d="M7 6.5C6.44772 6.5 6 6.94772 6 7.5V16.5C6 17.0523 6.44772 17.5 7 17.5H17C17.5523 17.5 18 17.0523 18 16.5V11L13.5 6.5H7Z" fill="white" fill-opacity="0.25"/>
                <path d="M13.5 6.5V11H18L13.5 6.5Z" fill="white" fill-opacity="0.5"/>
                <text x="12" y="15.2" fill="white" font-size="8.5" font-weight="900" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" text-anchor="middle">X</text>
            </svg>`,
            className: 'type-excel',
            label: 'Spreadsheet'
        };
    }

    // 4. Microsoft PowerPoint Presentation (Official Orange-Red 'P' Style)
    if (['pptx', 'ppt', 'odp', 'key', 'ppsx'].includes(ext) || mime.includes('presentation') || mime.includes('powerpoint')) {
        return {
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="20" height="20" rx="4" fill="#D24726"/>
                <path d="M7 6.5C6.44772 6.5 6 6.94772 6 7.5V16.5C6 17.0523 6.44772 17.5 7 17.5H17C17.5523 17.5 18 17.0523 18 16.5V11L13.5 6.5H7Z" fill="white" fill-opacity="0.25"/>
                <path d="M13.5 6.5V11H18L13.5 6.5Z" fill="white" fill-opacity="0.5"/>
                <text x="12" y="15.2" fill="white" font-size="8.5" font-weight="900" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" text-anchor="middle">P</text>
            </svg>`,
            className: 'type-ppt',
            label: 'Presentation'
        };
    }

    // 5. Video Files
    if (doc.isVideo || mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', '3gp'].includes(ext)) {
        return {
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="20" height="20" rx="4" fill="#0891B2"/>
                <polygon points="10 8 16 12 10 16 10 8" fill="white"/>
            </svg>`,
            className: 'type-video',
            label: 'Video'
        };
    }

    // 6. Image Files
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext) || mime.startsWith('image/')) {
        return {
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="20" height="20" rx="4" fill="#8B5CF6"/>
                <circle cx="8.5" cy="8.5" r="1.5" fill="white"/>
                <path d="M20 15L15 10L6 19H18C19.1046 19 20 18.1046 20 17V15Z" fill="white" fill-opacity="0.8"/>
            </svg>`,
            className: 'type-image',
            label: 'Image'
        };
    }

    // 7. Zip / Archive Files
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext) || mime.includes('zip') || mime.includes('compressed')) {
        return {
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="20" height="20" rx="4" fill="#D97706"/>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="white" fill-opacity="0.2"/>
                <text x="12" y="15" fill="white" font-size="7" font-weight="900" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" text-anchor="middle">ZIP</text>
            </svg>`,
            className: 'type-archive',
            label: 'Archive'
        };
    }

    // 8. Generic / Other Files
    return {
        icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="2" width="20" height="20" rx="4" fill="#475569"/>
            <path d="M14 6H8a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-8l-3-3z" fill="white" fill-opacity="0.85"/>
            <polyline points="14 6 14 9 17 9" stroke="#475569" stroke-width="1.2"/>
        </svg>`,
        className: 'type-file',
        label: 'File'
    };
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
            const descText = (doc.description || '').replace(/<[^>]*>/g, ' ').toLowerCase();
            const descMatch = descText.includes(q);
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
        const canEdit = isUploader || isPrivileged;
        const docTags = Array.isArray(doc.tags) ? doc.tags : (doc.category ? doc.category.split(/\s*>\s*/).map(p => p.trim()).filter(Boolean) : []);
        const uploaderName = (doc.uploadedBy?.memberName || '').trim();

        const hasDescription = Boolean(doc.description && doc.description.trim());
        const isDocOpen = state.openDocs ? state.openDocs.has(doc.id) : false;

        return `
            <div class="doc-card ${!isAvailable ? 'doc-card-unavailable' : ''}" id="doc-${doc.id}">
                <div class="doc-card-top">
                    <div class="doc-card-header">
                        <div class="doc-icon-badge ${typeInfo.className}">
                            ${typeInfo.icon}
                        </div>
                        <div class="doc-meta-badges">
                            ${docTags.length > 0 ? `<div class="doc-tags-row">${docTags.map(t => {
                                const isContributor = (uploaderName && t.trim().toLowerCase() === uploaderName.toLowerCase()) || isContributorTagName(t, doc);
                                return `<span class="doc-tag-pill ${isContributor ? 'doc-tag-pill-uploader' : ''}" title="${isContributor ? 'Contributor: ' + escapeHTML(formatShortName(t)) : 'Tag: ' + escapeHTML(t)}">${isContributor ? '👤 ' : ''}${escapeHTML(isContributor ? formatShortName(t) : t)}</span>`;
                            }).join('')}</div>` : ''}
                            ${!isAvailable ? '<span class="doc-warning-badge" title="This file was uploaded prior to database persistence and needs to be re-uploaded">⚠️ Re-upload Needed</span>' : ''}
                            <span class="doc-size-badge">${formatBytes(doc.size)}</span>
                        </div>
                    </div>
                    <div class="doc-main-info">
                        <h3 class="doc-title">${escapeHTML(doc.title)}</h3>
                        <div class="doc-filename">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.55;flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                            <span class="doc-filename-text">${escapeHTML(doc.originalName)}</span>
                        </div>
                        ${hasDescription ? `
                            <div class="doc-expand-row">
                                <button type="button" class="btn-toggle-doc-desc ${isDocOpen ? 'active' : ''}" data-doc-id="${doc.id}" title="${isDocOpen ? 'Hide notes & summary' : 'View notes & summary'}">
                                    <span class="toggle-doc-icon">${isDocOpen ? '▲' : '▼'}</span>
                                    <span class="toggle-doc-label">${isDocOpen ? 'Hide Notes & Summary' : 'View Notes & Summary'}</span>
                                </button>
                            </div>
                            <div class="doc-description-wrapper ${isDocOpen ? 'open' : ''}" id="doc-desc-${doc.id}">
                                <div class="doc-description">${sanitizeRichHtml(doc.description)}</div>
                            </div>
                        ` : ''}
                    </div>
                </div>

                <div class="doc-card-bottom">
                    <div class="doc-uploader">
                        <span class="doc-uploader-name">${escapeHTML(formatShortName(doc.uploadedBy?.memberName) || 'Member')}</span>
                        <span>${escapeHTML(doc.uploadedBy?.memberRole || 'Member')} • ${timeAgo(doc.uploadedAt)}</span>
                    </div>
                    <div class="doc-actions-group">
                        ${isAvailable ? `
                            <a href="/api/documents/${doc.id}/view?token=${encodeURIComponent(state.token || '')}" target="_blank" rel="noopener" class="btn-doc-action btn-doc-view" title="Preview / Open in new tab">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                <span>View</span>
                            </a>
                            <a href="/api/documents/${doc.id}/download?token=${encodeURIComponent(state.token || '')}" class="btn-doc-action btn-doc-download" title="Download file">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                <span>Download</span>
                            </a>
                        ` : `
                            <button type="button" class="btn-doc-action btn-doc-unavailable" onclick="showToast('This document needs to be re-uploaded. Please delete and upload it again.', true)" title="Physical file not found on server">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                <span>Missing File</span>
                            </button>
                        `}
                        ${canEdit ? `
                            <button type="button" class="btn-doc-action btn-doc-edit" data-doc-id="${doc.id}" title="Edit document title, tags, or notes">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                <span>Edit</span>
                            </button>
                        ` : ''}
                        ${canDelete ? `
                            <button type="button" class="btn-doc-action btn-doc-delete ${!isAvailable ? 'btn-doc-reupload-prompt' : ''}" data-doc-id="${doc.id}" data-action="${!isAvailable ? 'reupload' : 'delete'}" title="${!isAvailable ? 'Remove missing placeholder to re-upload' : 'Delete document'}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                ${!isAvailable ? '<span>Remove & Re-upload</span>' : ''}
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ── Rich Text Sanitizer & Editor Setup ──
function cleanPastedHtml(rawHtml) {
    if (!rawHtml || typeof rawHtml !== 'string') return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    // Remove unwanted script, style, meta, xml tags from Word / Google Docs
    doc.querySelectorAll('script, style, meta, link, xml, noscript').forEach(el => el.remove());

    const safeStyleProps = new Set([
        'font-size', 'font-weight', 'font-style', 'text-decoration', 
        'text-align', 'color', 'margin-left', 'margin-right'
    ]);

    function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return;
        if (node.nodeType !== Node.ELEMENT_NODE) {
            node.remove();
            return;
        }

        // Remove any background attributes
        node.removeAttribute('bgcolor');
        node.removeAttribute('background');

        // Strip background-related styles
        if (node.hasAttribute('style')) {
            const style = node.getAttribute('style');
            const cleanedStyles = [];
            style.split(';').forEach(decl => {
                const parts = decl.split(':');
                if (parts.length >= 2) {
                    const prop = parts[0].trim().toLowerCase();
                    const val = parts.slice(1).join(':').trim();
                    if (prop.startsWith('background') || prop.startsWith('box-shadow') || prop === 'border') {
                        return; // Discard background and border boxes
                    }
                    if (safeStyleProps.has(prop)) {
                        cleanedStyles.push(`${prop}: ${val}`);
                    }
                }
            });

            if (cleanedStyles.length > 0) {
                node.setAttribute('style', cleanedStyles.join('; '));
            } else {
                node.removeAttribute('style');
            }
        }

        // Unwrap spans with no attributes
        const tag = node.tagName.toUpperCase();
        if (tag === 'SPAN' && node.attributes.length === 0) {
            const parent = node.parentNode;
            if (parent) {
                while (node.firstChild) {
                    parent.insertBefore(node.firstChild, node);
                }
                parent.removeChild(node);
                return;
            }
        }

        Array.from(node.childNodes).forEach(processNode);
    }

    Array.from(doc.body.childNodes).forEach(processNode);
    return doc.body.innerHTML;
}

function sanitizeRichHtml(dirtyHtml) {
    if (!dirtyHtml || typeof dirtyHtml !== 'string') return '';

    // If plain text with no HTML tags, escape and preserve newlines
    if (!/<[a-z][\s\S]*>/i.test(dirtyHtml)) {
        return escapeHTML(dirtyHtml).replace(/\n/g, '<br>');
    }

    const template = document.createElement('template');
    template.innerHTML = dirtyHtml.trim();

    const allowedTags = new Set([
        'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE',
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI',
        'BLOCKQUOTE', 'SPAN', 'DIV', 'FONT', 'A', 'HR', 'CODE', 'PRE', 'TABLE', 'TR', 'TD', 'TH', 'TBODY', 'THEAD'
    ]);
    const allowedAttrs = new Set(['style', 'class', 'href', 'target', 'rel', 'size', 'color', 'align']);
    const safeStyleProps = new Set([
        'font-size', 'font-weight', 'font-style', 'text-decoration', 
        'text-align', 'color', 'margin-left', 'margin-right'
    ]);

    function cleanNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return;
        if (node.nodeType !== Node.ELEMENT_NODE) {
            node.remove();
            return;
        }

        const tag = node.tagName.toUpperCase();
        if (!allowedTags.has(tag)) {
            while (node.firstChild) {
                node.parentNode.insertBefore(node.firstChild, node);
            }
            node.remove();
            return;
        }

        node.removeAttribute('bgcolor');
        node.removeAttribute('background');

        const attrs = Array.from(node.attributes);
        for (const attr of attrs) {
            const attrName = attr.name.toLowerCase();
            if (attrName.startsWith('on') || !allowedAttrs.has(attrName)) {
                node.removeAttribute(attr.name);
            } else if (attrName === 'href') {
                const val = attr.value.trim().toLowerCase();
                if (val.startsWith('javascript:') || val.startsWith('data:') || val.startsWith('vbscript:')) {
                    node.removeAttribute(attr.name);
                } else {
                    node.setAttribute('target', '_blank');
                    node.setAttribute('rel', 'noopener noreferrer');
                }
            } else if (attrName === 'style') {
                const cleanedStyles = [];
                const styleDecls = attr.value.split(';');
                for (const decl of styleDecls) {
                    const parts = decl.split(':');
                    if (parts.length >= 2) {
                        const prop = parts[0].trim().toLowerCase();
                        const val = parts.slice(1).join(':').trim();
                        if (prop.startsWith('background') || prop.startsWith('box-shadow') || prop === 'border') {
                            continue; // Discard background styles
                        }
                        if (safeStyleProps.has(prop)) {
                            cleanedStyles.push(`${prop}: ${val}`);
                        }
                    }
                }
                if (cleanedStyles.length > 0) {
                    node.setAttribute('style', cleanedStyles.join('; '));
                } else {
                    node.removeAttribute('style');
                }
            }
        }

        Array.from(node.childNodes).forEach(cleanNode);
    }

    Array.from(template.content.childNodes).forEach(cleanNode);
    return template.innerHTML;
}

function setupRichTextEditor() {
    if (!els.docDescriptionEditor || !els.docEditorToolbar) return;

    // Toolbar button clicks
    els.docEditorToolbar.querySelectorAll('.toolbar-btn').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent blur
            const command = btn.dataset.command;
            if (!command) return;
            document.execCommand(command, false, null);
            updateToolbarState();
        });
    });

    // Heading / Block Format dropdown
    if (els.editorFormatBlock) {
        els.editorFormatBlock.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'p') {
                document.execCommand('formatBlock', false, '<p>');
            } else if (val === 'blockquote') {
                document.execCommand('formatBlock', false, '<blockquote>');
            } else {
                document.execCommand('formatBlock', false, `<${val}>`);
            }
            els.docDescriptionEditor.focus();
            updateToolbarState();
        });
    }

    // Font Size dropdown
    if (els.editorFontSize) {
        els.editorFontSize.addEventListener('change', (e) => {
            const val = e.target.value;
            document.execCommand('fontSize', false, val);
            els.docDescriptionEditor.focus();
            updateToolbarState();
        });
    }

    // Selection helper for color picking
    let savedSelection = null;
    function saveEditorSelection() {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            savedSelection = sel.getRangeAt(0).cloneRange();
        }
    }
    function restoreEditorSelection() {
        if (savedSelection) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(savedSelection);
        }
    }

    // Font Color picker
    if (els.docFontColor) {
        const applyColor = (color) => {
            if (!color) return;
            els.docDescriptionEditor.focus();
            restoreEditorSelection();
            document.execCommand('foreColor', false, color);
            if (els.docColorBar) els.docColorBar.style.backgroundColor = color;
            if (els.docDescription) els.docDescription.value = els.docDescriptionEditor.innerHTML;
            updateToolbarState();
        };

        const colorBtn = els.docFontColor.closest('.toolbar-color-btn');
        if (colorBtn) {
            colorBtn.addEventListener('mousedown', () => {
                saveEditorSelection();
            });
        }
        els.docFontColor.addEventListener('input', (e) => applyColor(e.target.value));
        els.docFontColor.addEventListener('change', (e) => applyColor(e.target.value));
    }

    // Sync content on input
    els.docDescriptionEditor.addEventListener('input', () => {
        if (els.docDescription) {
            els.docDescription.value = els.docDescriptionEditor.innerHTML;
        }
        updateToolbarState();
    });

    // Intercept paste to strip any background styling, highlights, or background colors
    els.docDescriptionEditor.addEventListener('paste', (e) => {
        e.preventDefault();
        const clipboard = e.clipboardData || window.clipboardData;
        if (!clipboard) return;

        const html = clipboard.getData('text/html');
        const text = clipboard.getData('text/plain');

        if (html) {
            const cleaned = cleanPastedHtml(html);
            document.execCommand('insertHTML', false, cleaned);
        } else if (text) {
            const formattedText = escapeHTML(text).replace(/\r\n|\r|\n/g, '<br>');
            document.execCommand('insertHTML', false, formattedText);
        }

        if (els.docDescription) {
            els.docDescription.value = els.docDescriptionEditor.innerHTML;
        }
        updateToolbarState();
    });

    // Update active toolbar buttons on selection change
    ['keyup', 'mouseup', 'click'].forEach(evt => {
        els.docDescriptionEditor.addEventListener(evt, updateToolbarState);
    });

    document.addEventListener('selectionchange', () => {
        if (document.activeElement === els.docDescriptionEditor) {
            updateToolbarState();
        }
    });

    function updateToolbarState() {
        if (!els.docEditorToolbar) return;
        const commands = ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList'];
        commands.forEach(cmd => {
            const btn = els.docEditorToolbar.querySelector(`[data-command="${cmd}"]`);
            if (btn) {
                try {
                    const isActive = document.queryCommandState(cmd);
                    btn.classList.toggle('active', !!isActive);
                } catch {
                    btn.classList.remove('active');
                }
            }
        });
    }
}

// ── Edit Document Modal Logic ──
function openEditDocModal(docId) {
    const doc = (state.documents || []).find(d => d.id === docId);
    if (!doc || !els.editDocModal) return;

    state.editingDoc = doc;
    if (els.editDocId) els.editDocId.value = doc.id;
    if (els.editDocTitle) els.editDocTitle.value = doc.title || '';
    if (els.editDocCurrentFilename) els.editDocCurrentFilename.textContent = doc.originalName || 'file';
    if (els.editDocFileInput) els.editDocFileInput.value = '';

    const docTags = Array.isArray(doc.tags) ? [...doc.tags] : (doc.category ? doc.category.split(/\s*>\s*/).map(p => p.trim()).filter(Boolean) : []);
    const docUploaderName = (doc.uploadedBy?.memberName || '').trim();
    if (docUploaderName && !docTags.some(t => t.toLowerCase() === docUploaderName.toLowerCase())) {
        docTags.unshift(docUploaderName);
    }
    state.selectedEditTags = [...docTags];

    if (els.editDocDescriptionEditor) {
        els.editDocDescriptionEditor.innerHTML = doc.description || '';
    }
    if (els.editEditorFormatBlock) els.editEditorFormatBlock.value = 'p';
    if (els.editEditorFontSize) els.editEditorFontSize.value = '3';
    if (els.editDocColorBar) els.editDocColorBar.style.backgroundColor = '#1E293B';
    if (els.editDocFontColor) els.editDocFontColor.value = '#1E293B';
    if (els.editDocTagsError) els.editDocTagsError.textContent = '';

    renderEditDocTagPicker();
    els.editDocModal.classList.add('active');
    setTimeout(() => {
        if (els.editDocTitle) els.editDocTitle.focus();
    }, 100);
}

function closeEditDocModal() {
    state.editingDoc = null;
    if (els.editDocModal) {
        els.editDocModal.classList.remove('active');
    }
}

function renderEditDocTagPicker() {
    if (!els.editDocTagPicker) return;
    const docUploaderName = (state.editingDoc?.uploadedBy?.memberName || '').trim();
    const allTags = [...(state.documentTags || [])];
    if (docUploaderName && !allTags.some(at => at.toLowerCase() === docUploaderName.toLowerCase())) {
        allTags.unshift(docUploaderName);
    }
    state.selectedEditTags.forEach(t => {
        if (!allTags.some(at => at.toLowerCase() === t.toLowerCase())) {
            allTags.push(t);
        }
    });

    if (allTags.length === 0) {
        els.editDocTagPicker.innerHTML = '<span style="color:var(--text-muted);font-size:0.82rem;">No tags available. Type a tag below and press Enter.</span>';
        return;
    }

    els.editDocTagPicker.innerHTML = allTags.map(tag => {
        const isDocUploader = !!(docUploaderName && tag.toLowerCase() === docUploaderName.toLowerCase());
        const isSelected = isDocUploader || state.selectedEditTags.some(t => t.toLowerCase() === tag.toLowerCase());
        if (isDocUploader) {
            return `
                <label class="doc-tag-chip-label doc-tag-chip-uploader selected locked" data-tag="${escapeHTML(tag)}" title="Contributor tag is permanently assigned to this document and cannot be removed">
                    👤 ${escapeHTML(tag)} <span class="tag-locked-icon" title="Cannot be removed">🔒</span>
                </label>
            `;
        }
        return `
            <label class="doc-tag-chip-label ${isSelected ? 'selected' : ''}" data-tag="${escapeHTML(tag)}">
                ${escapeHTML(tag)}
            </label>
        `;
    }).join('');
}

function setupEditDocRichTextEditor() {
    if (!els.editDocDescriptionEditor || !els.editDocEditorToolbar) return;

    // Toolbar button clicks
    els.editDocEditorToolbar.querySelectorAll('.toolbar-btn').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const command = btn.dataset.command;
            if (!command) return;
            document.execCommand(command, false, null);
            updateEditToolbarState();
        });
    });

    // Format Block dropdown
    if (els.editEditorFormatBlock) {
        els.editEditorFormatBlock.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'p') {
                document.execCommand('formatBlock', false, '<p>');
            } else if (val === 'blockquote') {
                document.execCommand('formatBlock', false, '<blockquote>');
            } else {
                document.execCommand('formatBlock', false, `<${val}>`);
            }
            els.editDocDescriptionEditor.focus();
            updateEditToolbarState();
        });
    }

    // Font Size dropdown
    if (els.editEditorFontSize) {
        els.editEditorFontSize.addEventListener('change', (e) => {
            const val = e.target.value;
            document.execCommand('fontSize', false, val);
            els.editDocDescriptionEditor.focus();
            updateEditToolbarState();
        });
    }

    // Selection helper for edit color picking
    let savedEditSelection = null;
    function saveEditEditorSelection() {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            savedEditSelection = sel.getRangeAt(0).cloneRange();
        }
    }
    function restoreEditEditorSelection() {
        if (savedEditSelection) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(savedEditSelection);
        }
    }

    // Font Color picker in edit modal
    if (els.editDocFontColor) {
        const applyEditColor = (color) => {
            if (!color) return;
            els.editDocDescriptionEditor.focus();
            restoreEditEditorSelection();
            document.execCommand('foreColor', false, color);
            if (els.editDocColorBar) els.editDocColorBar.style.backgroundColor = color;
            updateEditToolbarState();
        };

        const editColorBtn = els.editDocFontColor.closest('.toolbar-color-btn');
        if (editColorBtn) {
            editColorBtn.addEventListener('mousedown', () => {
                saveEditEditorSelection();
            });
        }
        els.editDocFontColor.addEventListener('input', (e) => applyEditColor(e.target.value));
        els.editDocFontColor.addEventListener('change', (e) => applyEditColor(e.target.value));
    }

    // Paste handler to strip background
    els.editDocDescriptionEditor.addEventListener('paste', (e) => {
        e.preventDefault();
        const clipboard = e.clipboardData || window.clipboardData;
        if (!clipboard) return;

        const html = clipboard.getData('text/html');
        const text = clipboard.getData('text/plain');

        if (html) {
            const cleaned = cleanPastedHtml(html);
            document.execCommand('insertHTML', false, cleaned);
        } else if (text) {
            const formattedText = escapeHTML(text).replace(/\r\n|\r|\n/g, '<br>');
            document.execCommand('insertHTML', false, formattedText);
        }
        updateEditToolbarState();
    });

    ['keyup', 'mouseup', 'click'].forEach(evt => {
        els.editDocDescriptionEditor.addEventListener(evt, updateEditToolbarState);
    });

    document.addEventListener('selectionchange', () => {
        if (document.activeElement === els.editDocDescriptionEditor) {
            updateEditToolbarState();
        }
    });

    function updateEditToolbarState() {
        if (!els.editDocEditorToolbar) return;
        const commands = ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList'];
        commands.forEach(cmd => {
            const btn = els.editDocEditorToolbar.querySelector(`[data-command="${cmd}"]`);
            if (btn) {
                try {
                    const isActive = document.queryCommandState(cmd);
                    btn.classList.toggle('active', !!isActive);
                } catch {
                    btn.classList.remove('active');
                }
            }
        });
    }
}

async function handleSaveEditDoc(e) {
    e.preventDefault();
    const docId = els.editDocId ? els.editDocId.value : null;
    if (!docId) return;

    const title = (els.editDocTitle ? els.editDocTitle.value : '').trim();
    if (!title) {
        showToast('Document title is required', true);
        return;
    }

    const docUploaderName = (state.editingDoc?.uploadedBy?.memberName || '').trim();
    if (docUploaderName && !state.selectedEditTags.some(t => t.toLowerCase() === docUploaderName.toLowerCase())) {
        state.selectedEditTags.unshift(docUploaderName);
    }

    if (!state.selectedEditTags || state.selectedEditTags.length === 0) {
        if (els.editDocTagsError) els.editDocTagsError.textContent = 'Please select or add at least one tag';
        showToast('Please select at least one tag', true);
        return;
    }

    let description = '';
    if (els.editDocDescriptionEditor) {
        const textOnly = els.editDocDescriptionEditor.textContent.trim();
        if (textOnly || els.editDocDescriptionEditor.querySelector('img, hr, table, br, ul, ol, blockquote, p')) {
            description = els.editDocDescriptionEditor.innerHTML.trim();
        }
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('tags', JSON.stringify(state.selectedEditTags));
    formData.append('description', description);

    if (els.editDocFileInput && els.editDocFileInput.files && els.editDocFileInput.files.length > 0) {
        formData.append('file', els.editDocFileInput.files[0]);
    }

    if (els.btnSaveEditDoc) {
        els.btnSaveEditDoc.disabled = true;
        els.btnSaveEditDoc.textContent = 'Saving...';
    }

    try {
        await api.updateDocument(docId, formData);
        showToast('Document updated successfully!');
        closeEditDocModal();
        await loadData();
    } catch (error) {
        showToast(error.message || 'Failed to update document', true);
    } finally {
        if (els.btnSaveEditDoc) {
            els.btnSaveEditDoc.disabled = false;
            els.btnSaveEditDoc.textContent = 'Save Changes';
        }
    }
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
    
    // Reset rich text editor
    if (els.docDescriptionEditor) els.docDescriptionEditor.innerHTML = '';
    if (els.docDescription) els.docDescription.value = '';
    if (els.editorFormatBlock) els.editorFormatBlock.value = 'p';
    if (els.editorFontSize) els.editorFontSize.value = '3';
    if (els.docColorBar) els.docColorBar.style.backgroundColor = '#1E293B';
    if (els.docFontColor) els.docFontColor.value = '#1E293B';

    // Auto-select current member's name as a default tag
    const memberName = (state.member?.name || '').trim();
    if (memberName) {
        if (!state.documentTags.some(t => t.toLowerCase() === memberName.toLowerCase())) {
            state.documentTags.push(memberName);
        }
        state.selectedUploadTags = [memberName];
    } else {
        state.selectedUploadTags = [];
    }

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

    // Ensure member's name is always included in the tags
    const memberName = (state.member?.name || '').trim();
    if (memberName && !state.selectedUploadTags.some(t => t.toLowerCase() === memberName.toLowerCase())) {
        state.selectedUploadTags.push(memberName);
    }

    if (!state.selectedUploadTags || state.selectedUploadTags.length === 0) {
        if (els.docTagsError) els.docTagsError.textContent = 'Please select or add at least one tag';
        showToast('Please select or add at least one tag for this file', true);
        return;
    }

    const title = (els.docTitle.value || '').trim() || file.name;
    
    let description = '';
    if (els.docDescriptionEditor) {
        const textOnly = els.docDescriptionEditor.textContent.trim();
        if (textOnly || els.docDescriptionEditor.querySelector('img, hr, table, br, ul, ol, blockquote, p')) {
            description = els.docDescriptionEditor.innerHTML.trim();
        }
    } else if (els.docDescription) {
        description = (els.docDescription.value || '').trim();
    }

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
                            <span class="modal-member-name">${escapeHTML(formatShortName(m.name, m.title))}</span>
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
                        <div class="modal-item-sub">${escapeHTML(item.category)} • By ${escapeHTML(formatShortName(item.proposedBy.memberName))}</div>
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
                        Voters: <strong>${escapeHTML(item.votes.map(v => formatShortName(v.memberName)).join(', '))}</strong>
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
                <div class="print-header-top">
                    <img src="logo.svg" alt="Lady Grey Arts Academy Logo" class="print-school-logo">
                    <div class="print-header-titles">
                        <div class="print-school-dept">EASTERN CAPE DEPARTMENT OF EDUCATION • JOE GQABI DISTRICT</div>
                        <h1 class="print-school-name">LADY GREY ARTS ACADEMY</h1>
                        <div class="print-school-sub">School Governing Body &amp; School Management Team</div>
                    </div>
                    <div class="print-header-badge">
                        <span class="badge-title">OFFICIAL</span>
                        <span class="badge-sub">AGENDA</span>
                    </div>
                </div>

                <div class="print-meeting-card">
                    <div class="print-meeting-title-row">
                        <h2 class="print-meeting-title">${escapeHTML(meetingInfo.title || 'SGB & SMT Strategy Meeting')}</h2>
                        <span class="print-badge-type">Strategic Planning &amp; Governance</span>
                    </div>
                    <div class="print-meta-grid">
                        <div class="print-meta-cell">
                            <span class="meta-label">📅 Date &amp; Time:</span>
                            <span class="meta-val">27 August 2026 — 10:00 SAST</span>
                        </div>
                        <div class="print-meta-cell">
                            <span class="meta-label">📍 Venue:</span>
                            <span class="meta-val">School Staff Room / Boardroom</span>
                        </div>
                        <div class="print-meta-cell">
                            <span class="meta-label">👥 Constitution:</span>
                            <span class="meta-val">Joint SGB &amp; SMT Sitting</span>
                        </div>
                        <div class="print-meta-cell">
                            <span class="meta-label">⚖️ Statutory Basis:</span>
                            <span class="meta-val">SASA Act 84 of 1996 &amp; SGB Constitution</span>
                        </div>
                    </div>
                    <div class="print-members-row">
                        <strong>Convened Members (${members.length}):</strong>
                        <span>${members.map(m => `<strong>${escapeHTML(formatShortName(m.name, m.title))}</strong> <small class="role-chip">(${escapeHTML(m.role)})</small>`).join(', ')}</span>
                    </div>
                </div>
                <div class="print-generation-notice">
                    <span>Official Notice &amp; Order of Proceedings</span>
                    <span>Generated on ${new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
            </div>
        `;

        // Flatten all items across categories and sort by vote count (most votes first)
        const allItems = agenda.flatMap(group => group.items.map(item => ({ ...item, category: group.category })));
        allItems.sort((a, b) => b.votes.length - a.votes.length);

        if (allItems.length === 0) {
            html += '<p style="text-align:center; color:#718096; padding:2rem;">No agenda items have been proposed yet.</p>';
        } else {
            allItems.forEach((item, idx) => {
                const itemNumber = idx + 1;
                const statusLabel = item.status.charAt(0).toUpperCase() + item.status.slice(1);
                const comments = Array.isArray(item.comments) ? item.comments : [];
                const isResolved = Boolean(item.isResolved);

                html += `
                    <div class="print-item ${isResolved ? 'print-item-resolved' : ''}">
                        <h4>${itemNumber}. ${escapeHTML(item.title)}
                            <small>(${isResolved ? 'Resolved • ' : ''}${statusLabel} — ${item.votes.length} ${item.votes.length === 1 ? 'vote' : 'votes'})</small>
                        </h4>
                        <p class="print-meta"><em>Proposed by: ${escapeHTML(formatShortName(item.proposedBy.memberName))} (${escapeHTML(item.proposedBy.memberRole)}) · ${escapeHTML(item.category)}</em></p>
                        <p class="print-desc">${escapeHTML(item.description)}</p>

                        ${isResolved && item.resolution ? `
                            <div class="print-resolution-box">
                                <strong>✅ Resolution / Agreed Plan:</strong> ${escapeHTML(item.resolution.solutionText)}
                                <span class="print-res-by">(Resolved by ${escapeHTML(formatShortName(item.resolution.resolvedBy ? item.resolution.resolvedBy.memberName : 'Member'))})</span>
                            </div>
                        ` : ''}

                        ${comments.length > 0 ? `
                            <div class="print-comments-box">
                                <div class="print-comments-title">Brainstorming & Discussion (${comments.length}):</div>
                                <ul class="print-comments-list">
                                    ${comments.map(c => `
                                        <li>
                                            <strong>${escapeHTML(formatShortName(c.memberName))}</strong>
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
            });

            // Agenda Adoption & Sign-off Section
            html += `
                <div class="print-adoption-section">
                    <div class="adoption-statement">
                        <strong>Agenda Adoption &amp; Certification:</strong> In accordance with Section 7 of the SGB Constitution, this agenda was duly circulated and approved for formal adoption at the commencement of the meeting.
                    </div>
                    <div class="print-sign-grid print-sign-grid--3">
                        <div class="print-sign-box">
                            <div class="sign-line"></div>
                            <div class="sign-name">Mr. K. Dyasi</div>
                            <div class="sign-role">SGB Chairperson</div>
                        </div>
                        <div class="print-sign-box">
                            <div class="sign-line"></div>
                            <div class="sign-name">Ms. M. Botha</div>
                            <div class="sign-role">School Principal</div>
                        </div>
                        <div class="print-sign-box">
                            <div class="sign-line"></div>
                            <div class="sign-name">Mr. S. Vorster</div>
                            <div class="sign-role">SGB Secretariat / Admin</div>
                        </div>
                    </div>
                </div>
            `;
        }

        els.printableAgenda.innerHTML = html;
        els.modal.classList.add('active');
    } catch (error) {
        showToast('Failed to generate agenda preview', true);
    }
}

// ── Attendance Register Modal ──
let attendanceRosterState = null;

async function showAttendanceModal() {
    try {
        const data = await api.getAttendance();
        if (!data) return;

        attendanceRosterState = data;
        renderAttendanceModalContent();
        els.attendanceModal.classList.add('active');
    } catch (error) {
        showToast('Failed to load formal attendance register', true);
    }
}

function closeAttendanceModal() {
    if (els.attendanceModal) {
        els.attendanceModal.classList.remove('active');
    }
}

function renderAttendanceModalContent() {
    if (!attendanceRosterState) return;
    const { schoolInfo, meetingInfo, stats, components } = attendanceRosterState;

    // Calculate dynamic attendance stats
    let totalCount = 0;
    let presentCount = 0;
    let apologyCount = 0;
    let absentCount = 0;

    components.forEach(group => {
        group.members.forEach(m => {
            totalCount++;
            if (m.status === 'Present') presentCount++;
            else if (m.status === 'Apology') apologyCount++;
            else absentCount++;
        });
    });

    const isQuorate = presentCount >= stats.quorumThreshold;
    const quorumPercent = totalCount > 0 ? ((presentCount / totalCount) * 100).toFixed(1) : '100.0';

    let html = `
        <div class="print-agenda-header print-attendance-header">
            <div class="print-header-top">
                <img src="logo.svg" alt="Lady Grey Arts Academy Logo" class="print-school-logo">
                <div class="print-header-titles">
                    <div class="print-school-dept">${escapeHTML(schoolInfo.department)} • ${escapeHTML(schoolInfo.district)}</div>
                    <h1 class="print-school-name">${escapeHTML(schoolInfo.name)}</h1>
                    <div class="print-school-sub">School Governing Body &amp; School Management Team</div>
                </div>
                <div class="print-header-badge">
                    <span class="badge-title">OFFICIAL</span>
                    <span class="badge-sub">ATTENDANCE</span>
                </div>
            </div>

            <div class="print-meeting-card">
                <div class="print-meeting-title-row">
                    <h2 class="print-meeting-title">OFFICIAL SGB &amp; SMT MEETING ATTENDANCE REGISTER</h2>
                    <span class="print-badge-type">Statutory Quorum Declaration</span>
                </div>
                <div class="print-meta-grid">
                    <div class="print-meta-cell">
                        <span class="meta-label">
                            <svg class="meta-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                            Date &amp; Time:
                        </span>
                        <span class="meta-val">${escapeHTML(meetingInfo.dateFormatted)} — ${escapeHTML(meetingInfo.time)}</span>
                    </div>
                    <div class="print-meta-cell">
                        <span class="meta-label">
                            <svg class="meta-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                            Venue:
                        </span>
                        <span class="meta-val">${escapeHTML(meetingInfo.venue)}</span>
                    </div>
                    <div class="print-meta-cell">
                        <span class="meta-label">
                            <svg class="meta-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M4 18h16M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 3L2 8h20L12 3z"/></svg>
                            Meeting Type:
                        </span>
                        <span class="meta-val">${escapeHTML(meetingInfo.type)}</span>
                    </div>
                    <div class="print-meta-cell">
                        <span class="meta-label">
                            <svg class="meta-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M6 8l6-2 6 2M6 8L3 14h6L6 8zM18 8l-3 6h6l-3-6zM8 21h8"/></svg>
                            Statutory Authority:
                        </span>
                        <span class="meta-val">SASA Act No. 84 of 1996 (Sections 12 &amp; 18)</span>
                    </div>
                </div>
            </div>

            <!-- Quorum Summary Banner -->
            <div class="quorum-summary-card ${isQuorate ? 'quorum-passed' : 'quorum-failed'}">
                <div class="quorum-summary-main">
                    <div class="quorum-status-pill">
                        ${isQuorate 
                            ? `<svg class="pill-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> DULY CONSTITUTED &amp; QUORATE` 
                            : `<svg class="pill-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> NON-QUORATE SITTING`}
                    </div>
                    <div class="quorum-stats-text">
                        <strong>Total Members:</strong> ${totalCount} &nbsp;|&nbsp; 
                        <strong>Present:</strong> ${presentCount} (${quorumPercent}%) &nbsp;|&nbsp; 
                        <strong>Apologies:</strong> ${apologyCount} &nbsp;|&nbsp; 
                        <strong>Required Quorum (&gt;50%):</strong> ${stats.quorumThreshold} Members
                    </div>
                </div>
                <div class="quorum-legal-note">
                    ${isQuorate 
                        ? 'Statutory quorum requirement satisfied. Meeting is legally empowered to adopt binding governance resolutions.' 
                        : 'Quorum requirement not met. Decisions subject to subsequent ratification.'}
                </div>
            </div>
        </div>

        <!-- Attendance Roster by Component -->
        <div class="attendance-roster-section">
            <h3 class="attendance-section-title">1. RECORD OF ATTENDANCE BY GOVERNANCE COMPONENT</h3>
    `;

    let globalIndex = 1;
    components.forEach((group) => {
        html += `
            <div class="attendance-component-block">
                <h4 class="attendance-component-heading">${escapeHTML(group.name)}</h4>
                <div class="table-responsive">
                    <table class="attendance-table">
                        <thead>
                            <tr>
                                <th style="width: 36px; text-align: center;">#</th>
                                <th style="width: 25%;">Member Name &amp; Title</th>
                                <th style="width: 28%;">Governance / SMT Role</th>
                                <th style="width: 17%; text-align: center;">Status</th>
                                <th style="width: 12%; text-align: center;">Time In</th>
                                <th style="width: 18%; text-align: center;">Signature / Initial</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        group.members.forEach((member) => {
            const memberIdx = globalIndex++;
            const fullName = `${member.title ? member.title + ' ' : ''}${member.name}`;
            html += `
                <tr class="attendance-row ${member.status.toLowerCase()}">
                    <td style="text-align: center; font-weight: 600; color: var(--text-muted);">${memberIdx}</td>
                    <td>
                        <strong>${escapeHTML(fullName)}</strong>
                        ${member.email ? `<br><small class="text-muted">${escapeHTML(member.email)}</small>` : ''}
                    </td>
                    <td>
                        <span class="member-role-text">${escapeHTML(member.role)}</span>
                    </td>
                    <td style="text-align: center;">
                        <select class="attendance-status-select no-print" onchange="window.updateMemberAttendanceStatus('${escapeHTML(member.id)}', this.value)">
                            <option value="Present" ${member.status === 'Present' ? 'selected' : ''}>Present</option>
                            <option value="Apology" ${member.status === 'Apology' ? 'selected' : ''}>Apology</option>
                            <option value="Absent" ${member.status === 'Absent' ? 'selected' : ''}>Absent</option>
                        </select>
                        <span class="attendance-print-status only-print ${member.status === 'Present' ? 'status-present' : 'status-apology'}">
                            ${member.status === 'Present' ? '✔ Present' : (member.status === 'Apology' ? 'Apology' : 'Absent')}
                        </span>
                    </td>
                    <td style="text-align: center;">
                        ${member.status === 'Present' 
                            ? `<input type="time" class="attendance-time-input no-print" value="${escapeHTML(member.timeIn || '10:00')}" onchange="window.updateMemberAttendanceTime('${escapeHTML(member.id)}', this.value)" title="Edit arrival time">
                               <span class="attendance-print-time only-print" style="font-size: 0.88rem;">${escapeHTML(member.timeIn || '10:00')}</span>` 
                            : '<span class="text-muted" style="font-size: 0.85rem;">—</span>'}
                    </td>
                    <td style="text-align: center;">
                        ${member.status === 'Present' 
                            ? `<div class="attendance-sig-space"><span class="attendance-signed-pill">Signed</span></div>` 
                            : `<span class="text-muted" style="font-size: 0.8rem;">—</span>`}
                    </td>
                </tr>
            `;
        });

        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });

    html += `
        </div>

        <!-- Section 2: Apologies -->
        <div class="attendance-apologies-block">
            <h3 class="attendance-section-title">2. RECORD OF FORMAL APOLOGIES &amp; LEAVE OF ABSENCE</h3>
            <div class="apologies-card">
                ${apologyCount === 0 
                    ? `<p class="apology-none-text">
                        <svg class="apology-check-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        <span>No formal apologies were tendered; full governance quorum recorded in attendance.</span>
                       </p>`
                    : `<ul class="apology-list">
                        ${components.flatMap(g => g.members).filter(m => m.status === 'Apology').map(m => `
                            <li><strong>${escapeHTML(m.title ? m.title + ' ' : '')}${escapeHTML(m.name)}</strong> (${escapeHTML(m.role)}): Formal apology tendered and recorded in terms of SGB meeting procedures.</li>
                        `).join('')}
                       </ul>`
                }
            </div>
        </div>

        <!-- Section 3: Verification & Certification -->
        <div class="print-adoption-section print-attendance-certification">
            <h3 class="attendance-section-title">3. VERIFICATION OF ATTENDANCE &amp; QUORUM CERTIFICATION</h3>
            <p class="adoption-statement">
                We, the undersigned executive office-bearers of the School Governing Body and School Management Team of Lady Grey Arts Academy, hereby certify that the above attendance roster represents an accurate, true, and complete record of the meeting held on <strong>27 August 2026</strong>.
            </p>
            <div class="print-sign-grid print-sign-grid--3">
                <div class="print-sign-box">
                    <div class="sign-line"></div>
                    <div class="sign-name">Mr. K. Dyasi</div>
                    <div class="sign-role">SGB Chairperson</div>
                    <div class="sign-date">Date: 27 August 2026</div>
                </div>
                <div class="print-sign-box">
                    <div class="sign-line"></div>
                    <div class="sign-name">Ms. M. Botha</div>
                    <div class="sign-role">School Principal</div>
                    <div class="sign-date">Date: 27 August 2026</div>
                </div>
                <div class="print-sign-box">
                    <div class="sign-line"></div>
                    <div class="sign-name">Mr. S. Vorster</div>
                    <div class="sign-role">SGB Secretariat / Admin</div>
                    <div class="sign-date">Date: 27 August 2026</div>
                </div>
            </div>
            <div class="cert-stamp-box">
                <div class="stamp-border">
                    <span>OFFICIAL SCHOOL STAMP</span>
                </div>
            </div>
        </div>

        <!-- Bottom Action Bar with Save Button -->
        <div class="attendance-footer-actions no-print" style="margin-top: 1.75rem; display: flex; justify-content: space-between; align-items: center; padding-top: 1.25rem; border-top: 1px solid var(--border-color, #243048);">
            <div class="attendance-last-saved-info" style="font-size: 0.82rem; color: var(--text-muted);">
                ${attendanceRosterState.lastSaved ? `Last saved to database: ${new Date(attendanceRosterState.lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Unsaved changes in roster'}
            </div>
            <div style="display: flex; gap: 0.75rem;">
                <button type="button" class="btn btn-success" id="btn-save-attendance-bottom" onclick="window.saveAttendanceToDatabase()">
                    <svg class="btn-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    <span>Save Attendance Register</span>
                </button>
            </div>
        </div>
    `;

    els.printableAttendance.innerHTML = html;
}

window.updateMemberAttendanceStatus = function(memberId, newStatus) {
    if (!attendanceRosterState) return;
    attendanceRosterState.components.forEach(group => {
        group.members.forEach(m => {
            if (m.id === memberId) {
                m.status = newStatus;
                if (newStatus === 'Present' && !m.timeIn) {
                    m.timeIn = '10:00';
                }
            }
        });
    });
    renderAttendanceModalContent();
};

window.updateMemberAttendanceTime = function(memberId, newTime) {
    if (!attendanceRosterState) return;
    attendanceRosterState.components.forEach(group => {
        group.members.forEach(m => {
            if (m.id === memberId) {
                m.timeIn = newTime || '10:00';
            }
        });
    });
};

window.saveAttendanceToDatabase = async function() {
    if (!attendanceRosterState) return;
    const saveBtns = [
        document.getElementById('btn-save-attendance'),
        document.getElementById('btn-save-attendance-bottom')
    ].filter(Boolean);

    saveBtns.forEach(b => {
        b.disabled = true;
        b.innerHTML = `
            <svg class="btn-icon spin" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
            <span>Saving...</span>
        `;
    });

    try {
        const res = await api.saveAttendance({ components: attendanceRosterState.components });
        attendanceRosterState.lastSaved = res?.lastSaved || new Date().toISOString();
        showToast('✅ Attendance register saved to database!');
        saveBtns.forEach(b => {
            b.innerHTML = `
                <svg class="btn-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <span>Saved!</span>
            `;
        });
        setTimeout(() => {
            renderAttendanceModalContent();
        }, 1500);
    } catch (err) {
        console.error('Error saving attendance:', err);
        showToast(err.message || 'Failed to save attendance', true);
        renderAttendanceModalContent();
    }
};

// ── Utilities ──
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
                console.log(`Server version ${data.version} available. Loading fresh data silently.`);
                if (state.token) await loadData();
            }
        }
    } catch { /* ignore */ }
}

// Reload data when phone wakes up or tab gains focus
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (state.token) loadData();
    }
});
window.addEventListener('focus', () => {
    if (state.token) loadData();
});

function startPolling() {
    let secondsLeft = 15;
    if (countdownTimer) clearInterval(countdownTimer);
    if (pollTimer) clearInterval(pollTimer);

    countdownTimer = setInterval(() => {
        secondsLeft--;
        if (els.refreshCountdown) els.refreshCountdown.textContent = Math.max(0, secondsLeft);
        if (secondsLeft <= 0) secondsLeft = 15;
    }, 1000);

    pollTimer = setInterval(async () => {
        if (state.token) {
            await loadData();
        }
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

    // 5. Conclude Meeting Wizard Modal
    if (els.concludeModal && els.concludeModal.classList.contains('active')) {
        closeConcludeWizard();
        rearmHistory();
        return;
    }

    // 6. Archive Dossier Viewer Modal
    if (els.archiveDossierModal && els.archiveDossierModal.classList.contains('active')) {
        closeArchiveDossier();
        rearmHistory();
        return;
    }

    // 7. Edit Archive Modal
    if (els.editArchiveModal && els.editArchiveModal.classList.contains('active')) {
        closeEditArchiveModal();
        rearmHistory();
        return;
    }

    // 8. Any expanded comment / brainstorm drawers
    if (state.openComments && state.openComments.size > 0) {
        state.openComments.clear();
        renderItems();
        rearmHistory();
        return;
    }

    // 9. In Documents Vault View or Archives View -> Switch back to Agenda view
    if (state.activeTab === 'documents' || state.activeTab === 'archives') {
        switchTab('agenda');
        rearmHistory();
        return;
    }

    // 10. Base Screen (Main View or Login View) -> Double back to exit
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

// ═════════════════════════════════════════════════════════════════
// ── MEETING ARCHIVES, CONCLUDE WIZARD & DOSSIER VIEWER MODULE ───
// ═════════════════════════════════════════════════════════════════

// Update Header, Login Screen, and countdown with dynamic meeting info
function updateMeetingHeaderInfo(info) {
    if (!info) return;
    const headerSubtitle = document.querySelector('.header-title .subtitle');
    if (headerSubtitle) {
        const formattedDate = formatDateLong(info.date || '2026-08-27');
        headerSubtitle.textContent = `${info.title || 'SGB/SMT Strategy Meeting'} • ${formattedDate} @ ${info.time || '10:00'} · ${info.venue || 'Staff Room'}`;
    }
    const loginDesc = document.querySelector('.login-card p');
    if (loginDesc) {
        const formattedDate = formatDateLong(info.date || '2026-08-27');
        loginDesc.innerHTML = `Welcome to the collaborative agenda builder for our upcoming sitting on <strong>${formattedDate} at ${info.time || '10:00 SAST'}</strong> in the <strong>${info.venue || 'School Staff Room'}</strong>. Select your name and enter your secure PIN to continue.`;
    }
}

function formatDateLong(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

function formatDayOnly(dateStr) {
    if (!dateStr) return '01';
    try {
        const d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d.getTime())) return '01';
        return d.toLocaleDateString('en-ZA', { day: '2-digit' });
    } catch {
        return '01';
    }
}

function formatMonthYearOnly(dateStr) {
    if (!dateStr) return 'AUG 2026';
    try {
        const d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d.getTime())) return 'AUG 2026';
        return d.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }).toUpperCase();
    } catch {
        return 'AUG 2026';
    }
}

// ── Render Meeting Archives List ──
function renderArchives() {
    if (!els.archivesContainer) return;

    let list = Array.isArray(state.archives) ? [...state.archives] : [];

    // Filter by search query
    const query = (state.archiveFilters.search || '').toLowerCase().trim();
    if (query) {
        list = list.filter(a => {
            const title = (a.meetingInfo?.title || '').toLowerCase();
            const date = (a.meetingInfo?.date || '').toLowerCase();
            const notes = (a.notes || '').toLowerCase();
            const resTitles = (a.resolutions || []).map(r => (r.itemTitle || r.title || '').toLowerCase()).join(' ');
            return title.includes(query) || date.includes(query) || notes.includes(query) || resTitles.includes(query);
        });
    }

    // Filter by category chip
    const filterType = state.archiveFilters.filter;
    if (filterType === 'audio') {
        list = list.filter(a => a.hasAudio || (Array.isArray(a.audioFiles) && a.audioFiles.length > 0));
    } else if (filterType === 'transcript') {
        list = list.filter(a => a.hasTranscript || Boolean(a.transcript?.text && a.transcript.text.trim()) || (Array.isArray(a.transcript?.files) && a.transcript.files.length > 0));
    } else if (filterType === 'signed') {
        list = list.filter(a => a.hasSignedRegister || (Array.isArray(a.signedAttendanceFiles) && a.signedAttendanceFiles.length > 0));
    } else if (filterType === 'resolutions') {
        list = list.filter(a => (a.resolutionsCount > 0) || (Array.isArray(a.resolutions) && a.resolutions.length > 0));
    }

    // Sort list
    const sortType = state.archiveFilters.sort;
    if (sortType === 'newest') {
        list.sort((a, b) => new Date(b.meetingInfo?.date || b.archivedAt) - new Date(a.meetingInfo?.date || a.archivedAt));
    } else if (sortType === 'oldest') {
        list.sort((a, b) => new Date(a.meetingInfo?.date || a.archivedAt) - new Date(b.meetingInfo?.date || b.archivedAt));
    } else if (sortType === 'items') {
        list.sort((a, b) => (b.itemsCount || 0) - (a.itemsCount || 0));
    } else if (sortType === 'resolutions') {
        list.sort((a, b) => (b.resolutionsCount || 0) - (a.resolutionsCount || 0));
    }

    if (list.length === 0) {
        els.archivesContainer.innerHTML = '';
        if (els.archivesEmptyState) els.archivesEmptyState.classList.remove('hidden');
        return;
    }

    if (els.archivesEmptyState) els.archivesEmptyState.classList.add('hidden');

    const adminUser = isAdmin();

    els.archivesContainer.innerHTML = list.map(arch => {
        const meetingInfo = arch.meetingInfo || {};
        const stats = arch.stats || {};
        const meetingDate = meetingInfo.date || arch.archivedAt?.split('T')[0] || '2026-08-27';
        const day = formatDayOnly(meetingDate);
        const monthYear = formatMonthYearOnly(meetingDate);
        const hasAudio = arch.hasAudio || (Array.isArray(arch.audioFiles) && arch.audioFiles.length > 0);
        const audioCount = arch.audioCount || (Array.isArray(arch.audioFiles) ? arch.audioFiles.length : 0);
        const hasSigned = arch.hasSignedRegister || (Array.isArray(arch.signedAttendanceFiles) && arch.signedAttendanceFiles.length > 0);
        const resCount = arch.resolutionsCount || (Array.isArray(arch.resolutions) ? arch.resolutions.length : 0);
        const itemsCount = arch.itemsCount || (Array.isArray(arch.agendaSnapshot) ? arch.agendaSnapshot.length : 0);

        return `
            <div class="archive-card" data-archive-id="${arch.id}">
                <div>
                    <div class="archive-card-header">
                        <div class="archive-date-badge">
                            <div class="archive-date-day">${day}</div>
                            <div class="archive-date-month-year">${monthYear}</div>
                        </div>
                        <div class="archive-card-title-group">
                            <h3 class="archive-card-title">${escapeHTML(meetingInfo.title || 'SGB/SMT Meeting')}</h3>
                            <div class="archive-card-meta">
                                <span>🕒 ${escapeHTML(meetingInfo.time || '10:00 SAST')}</span>
                                <span>📍 ${escapeHTML(meetingInfo.venue || 'Staff Room')}</span>
                            </div>
                        </div>
                    </div>

                    <div class="archive-badges-wrap">
                        ${hasAudio ? `<span class="archive-badge archive-badge--audio">🎙️ ${audioCount} Audio${audioCount > 1 ? 's' : ''}</span>` : ''}
                        ${hasSigned ? `<span class="archive-badge archive-badge--signed">📝 Signed Register</span>` : ''}
                        <span class="archive-badge archive-badge--res">⚖️ ${resCount} Decision${resCount !== 1 ? 's' : ''}</span>
                        <span class="archive-badge archive-badge--quorum">👥 ${stats.presentCount ?? stats.totalMembers ?? 15} Present (${stats.quorumPercentage || '100%'})</span>
                        <span class="archive-badge">📋 ${itemsCount} Items</span>
                    </div>

                    ${arch.notes ? `<p class="archive-card-summary">${escapeHTML(arch.notes)}</p>` : `<p class="archive-card-summary" style="font-style: italic; color: var(--text-muted);">Official sitting concluded and archived. Dossier contains full deliberations, voting log, audio recordings, and adopted resolutions.</p>`}
                </div>

                <div class="archive-card-footer">
                    <button type="button" class="btn btn-primary btn-sm btn-open-archive-dossier" data-id="${arch.id}">
                        📂 Open Dossier
                    </button>
                    <div class="archive-card-actions">
                        <button type="button" class="btn btn-outline btn-sm btn-download-archive-docx" data-id="${arch.id}" title="Download Word Minutes (.docx)">
                            📄 DOCX
                        </button>
                        <button type="button" class="btn btn-outline btn-sm btn-download-archive-zip" data-id="${arch.id}" title="Download Full Dossier ZIP Pack">
                            📦 ZIP
                        </button>
                        ${adminUser ? `
                            <button type="button" class="btn btn-outline btn-sm btn-edit-archive-quick" data-id="${arch.id}" title="Edit Archive Particulars & Resolutions">
                                ✏️
                            </button>
                            <button type="button" class="btn btn-outline btn-sm btn-delete-archive-quick" data-id="${arch.id}" title="Delete Archive (Admin Only)" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.3);">
                                🗑️
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ── Conclude & Archive Meeting Wizard Logic ──
function openConcludeWizard() {
    state.concludeStep = 1;
    state.selectedConcludeAudios = [];
    state.selectedConcludeMinutes = [];
    
    // Pre-fill meeting metadata from current meetingInfo or defaults
    const currentInfo = state.meetingInfo || {};
    if (els.concludeMeetingTitle) els.concludeMeetingTitle.value = currentInfo.title || 'SGB/SMT Strategy Meeting';
    if (els.concludeMeetingDate) els.concludeMeetingDate.value = currentInfo.date || '2026-08-27';
    if (els.concludeMeetingTime) els.concludeMeetingTime.value = currentInfo.time || '10:00 SAST';
    if (els.concludeMeetingVenue) els.concludeMeetingVenue.value = currentInfo.venue || 'School Staff Room / Boardroom';
    if (els.concludeMeetingNotes) els.concludeMeetingNotes.value = currentInfo.summary || '';

    // Render Stats Summary Card in Step 1
    if (els.concludeStatsSummaryCard) {
        const totalItems = state.items.length;
        const totalVotes = state.items.reduce((sum, item) => sum + (Array.isArray(item.votes) ? item.votes.length : 0), 0);
        const resolvedCount = state.items.filter(i => i.isResolved).length;
        const docsCount = state.documents.length;
        const membersCount = state.members.length || 15;

        els.concludeStatsSummaryCard.innerHTML = `
            <div class="conclude-stat-pill">
                <span class="conclude-stat-pill-label">Proposed Topics</span>
                <span class="conclude-stat-pill-val">${totalItems}</span>
            </div>
            <div class="conclude-stat-pill">
                <span class="conclude-stat-pill-label">Total Votes</span>
                <span class="conclude-stat-pill-val">${totalVotes}</span>
            </div>
            <div class="conclude-stat-pill">
                <span class="conclude-stat-pill-label">Resolved Decisions</span>
                <span class="conclude-stat-pill-val">${resolvedCount}</span>
            </div>
            <div class="conclude-stat-pill">
                <span class="conclude-stat-pill-label">Supporting Files</span>
                <span class="conclude-stat-pill-val">${docsCount}</span>
            </div>
            <div class="conclude-stat-pill">
                <span class="conclude-stat-pill-label">Convened Members</span>
                <span class="conclude-stat-pill-val">${membersCount}</span>
            </div>
        `;
    }

    // Step 2 Audio Tray Reset
    if (els.concludeAudioTray) els.concludeAudioTray.innerHTML = '';
    if (els.concludeAudioInput) els.concludeAudioInput.value = '';

    // Step 3 Minutes & Transcript Reset
    if (els.concludeMinutesTray) els.concludeMinutesTray.innerHTML = '';
    if (els.concludeMinutesFileInput) els.concludeMinutesFileInput.value = '';
    if (els.concludeMinutesDropTitle) els.concludeMinutesDropTitle.textContent = 'Click to upload Official Minutes Document (.docx, .pdf, .doc)';
    if (els.concludeTranscriptFileInput) els.concludeTranscriptFileInput.value = '';
    if (els.concludeTranscriptText) els.concludeTranscriptText.value = '';

    // Step 4 Pre-populate Resolutions
    state.concludeResolutions = [];
    state.items.forEach(item => {
        if (item.isResolved && item.resolution) {
            state.concludeResolutions.push({
                itemId: item.id,
                itemTitle: item.title,
                decision: 'Adopted',
                resolutionText: item.resolution.solutionText || item.resolution.summary || '',
                actionItems: [
                    { task: `Execute resolution on "${item.title}"`, assignee: item.proposedBy?.memberName || '', dueDate: '', priority: 'High', status: 'Pending' }
                ]
            });
        }
    });

    if (state.concludeResolutions.length === 0) {
        state.concludeResolutions.push({
            itemId: null,
            itemTitle: 'Adoption of Agenda & Strategic Directives',
            decision: 'Adopted',
            resolutionText: 'The meeting unanimously resolved to adopt all deliberations and proceedings as official policy.',
            actionItems: []
        });
    }
    renderConcludeResolutions();

    // Step 5 Attendance review pre-fill
    renderConcludeAttendanceReview();

    // Next Meeting setup pre-fill
    const currentDate = currentInfo.date ? new Date(currentInfo.date) : new Date();
    const nextDate = new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const nextDateStr = nextDate.toISOString().split('T')[0];
    if (els.nextMeetingDate) els.nextMeetingDate.value = nextDateStr;
    if (els.nextMeetingTitle) els.nextMeetingTitle.value = 'SGB & SMT Ordinary Meeting';
    if (els.nextMeetingTime) els.nextMeetingTime.value = '10:00 SAST';
    if (els.nextMeetingVenue) els.nextMeetingVenue.value = 'School Staff Room / Boardroom';
    if (els.concludeClearVault) els.concludeClearVault.checked = true;

    if (els.concludeSignedRegInput) els.concludeSignedRegInput.value = '';
    if (els.concludeSignedRegTitle) els.concludeSignedRegTitle.textContent = 'Click to upload official signed attendance scan / PDF';
    if (els.concludeSignedRegError) els.concludeSignedRegError.textContent = '';
    if (els.concludeProgressWrapper) els.concludeProgressWrapper.classList.add('hidden');

    updateConcludeWizardStep(1);
    if (els.concludeModal) els.concludeModal.classList.add('active');
}

function closeConcludeWizard() {
    if (els.concludeModal) els.concludeModal.classList.remove('active');
}

function updateConcludeWizardStep(step) {
    state.concludeStep = step;

    // Update wizard nodes
    document.querySelectorAll('.wizard-step-node').forEach(node => {
        const s = parseInt(node.dataset.step, 10);
        node.classList.toggle('active', s === step);
        node.classList.toggle('completed', s < step);
    });

    // Update panels
    for (let i = 1; i <= 6; i++) {
        const panel = document.getElementById(`conclude-step-${i}`);
        if (panel) panel.classList.toggle('active', i === step);
    }

    // Button states
    if (els.btnConcludePrev) els.btnConcludePrev.style.visibility = step === 1 ? 'hidden' : 'visible';
    if (els.btnConcludeNext) {
        if (step === 6) {
            els.btnConcludeNext.classList.add('hidden');
            if (els.btnConcludeSubmit) els.btnConcludeSubmit.classList.remove('hidden');
        } else {
            els.btnConcludeNext.classList.remove('hidden');
            if (els.btnConcludeSubmit) els.btnConcludeSubmit.classList.add('hidden');
        }
    }
}

// Render dynamic resolutions editor in Conclude Wizard
function renderConcludeResolutions() {
    if (!els.concludeResolutionsList) return;
    if (els.concludeResCount) els.concludeResCount.textContent = state.concludeResolutions.length;

    const membersList = state.members || [];

    els.concludeResolutionsList.innerHTML = state.concludeResolutions.map((res, resIdx) => `
        <div class="resolution-card-editor" data-res-index="${resIdx}">
            <div class="resolution-card-top-row">
                <input type="text" class="form-input res-edit-title" value="${escapeHTML(res.itemTitle || '')}" placeholder="Resolution / Decision Topic Title" required style="font-weight: 700;">
                <select class="resolution-decision-select res-edit-decision">
                    <option value="Adopted" ${res.decision === 'Adopted' ? 'selected' : ''}>✅ Adopted</option>
                    <option value="Approved" ${res.decision === 'Approved' ? 'selected' : ''}>👍 Approved</option>
                    <option value="Deferred" ${res.decision === 'Deferred' ? 'selected' : ''}>⏳ Deferred</option>
                    <option value="Rejected" ${res.decision === 'Rejected' ? 'selected' : ''}>❌ Rejected</option>
                    <option value="Action Required" ${res.decision === 'Action Required' ? 'selected' : ''}>🎯 Action Required</option>
                </select>
                <button type="button" class="btn-link-action btn-remove-resolution" data-res-index="${resIdx}" style="color: var(--danger);" title="Remove resolution">✕</button>
            </div>
            
            <textarea class="form-textarea res-edit-text" rows="2" placeholder="Record agreed binding resolution text...">${escapeHTML(res.resolutionText || '')}</textarea>

            <div class="action-items-editor-box">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted);">Action Items &amp; Deadlines</span>
                    <button type="button" class="btn-link-action btn-add-action-item" data-res-index="${resIdx}">+ Add Action Item</button>
                </div>

                <div class="action-items-list-container" data-res-index="${resIdx}">
                    ${(res.actionItems || []).map((act, actIdx) => `
                        <div class="action-item-row-edit" data-act-index="${actIdx}">
                            <input type="text" class="form-input act-edit-task" placeholder="Task description..." value="${escapeHTML(act.task || '')}" required>
                            <select class="form-input act-edit-assignee">
                                <option value="">Select Assignee...</option>
                                ${membersList.map(m => `<option value="${escapeHTML(m.name)}" ${act.assignee === m.name ? 'selected' : ''}>${escapeHTML(m.name)} (${escapeHTML(m.role)})</option>`).join('')}
                            </select>
                            <input type="date" class="form-input act-edit-due" value="${act.dueDate || ''}">
                            <button type="button" class="btn-link-action btn-remove-action-item" data-res-index="${resIdx}" data-act-index="${actIdx}" style="color: var(--danger);">✕</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `).join('');
}

// Render dynamic attendance verification checklist in Conclude Step 5
function renderConcludeAttendanceReview() {
    if (!els.concludeAttendanceReviewBox) return;

    const membersList = state.members || [];
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
            id: m.id || `m-${idx}`,
            name: m.name,
            role: m.role,
            status: 'Present'
        });
    });

    state.concludeAttendance = {
        components: Object.entries(componentsMap)
            .filter(([_, list]) => list.length > 0)
            .map(([name, list]) => ({ name, members: list }))
    };

    els.concludeAttendanceReviewBox.innerHTML = `
        <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.75rem 1rem; margin-top: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <strong style="font-size: 0.88rem;">👥 Digital Attendance &amp; Quorum Verification (${membersList.length} Members)</strong>
                <span class="badge badge--success" style="font-size: 0.75rem;">Quorate (Legally Valid)</span>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.5rem; max-height: 180px; overflow-y: auto; padding-right: 0.25rem;">
                ${membersList.map((m, idx) => `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: var(--white); border: 1px solid var(--border-color); border-radius: 6px; padding: 0.35rem 0.65rem; font-size: 0.8rem;">
                        <span style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;">${escapeHTML(m.name)}</span>
                        <select class="conclude-att-status-select" data-member-idx="${idx}" style="font-size: 0.75rem; padding: 0.15rem 0.35rem; border-radius: 4px; border: 1px solid var(--border-color);">
                            <option value="Present" selected>Present</option>
                            <option value="Apology">Apology</option>
                            <option value="Absent">Absent</option>
                        </select>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ── Open & Render Archive Dossier Modal ──
async function openArchiveDossier(archiveId) {
    try {
        const arch = await api.getArchive(archiveId);
        if (!arch) return;

        state.activeArchive = arch;
        state.dossierActiveTab = 'overview';

        const meetingInfo = arch.meetingInfo || {};
        const meetingDate = meetingInfo.date || '2026-08-27';

        if (els.dossierModalTitle) els.dossierModalTitle.textContent = `${meetingInfo.title || 'SGB/SMT Strategy Meeting'}`;
        if (els.dossierModalSubtitle) els.dossierModalSubtitle.textContent = `Official Meeting Dossier • ${formatDateLong(meetingDate)} • ${meetingInfo.venue || 'Staff Room'}`;

        // Update dossier tab counts
        const minutesCount = Array.isArray(arch.minutesFiles) ? arch.minutesFiles.length : 0;
        const audioCount = Array.isArray(arch.audioFiles) ? arch.audioFiles.length : 0;
        const resCount = Array.isArray(arch.resolutions) ? arch.resolutions.length : 0;
        const itemsCount = Array.isArray(arch.agendaSnapshot) ? arch.agendaSnapshot.length : 0;
        const filesCount = Array.isArray(arch.vaultDocuments) ? arch.vaultDocuments.length : 0;

        if (els.dossierMinutesTabCount) els.dossierMinutesTabCount.textContent = minutesCount;
        if (els.dossierAudioTabCount) els.dossierAudioTabCount.textContent = audioCount;
        if (els.dossierResTabCount) els.dossierResTabCount.textContent = resCount;
        if (els.dossierItemsTabCount) els.dossierItemsTabCount.textContent = itemsCount;
        if (els.dossierFilesTabCount) els.dossierFilesTabCount.textContent = filesCount;

        // Admin edit button visibility
        if (els.btnDossierEdit) {
            if (isAdmin()) els.btnDossierEdit.classList.remove('hidden');
            else els.btnDossierEdit.classList.add('hidden');
        }

        renderDossierContent();

        // Activate Overview tab strip button
        document.querySelectorAll('.dossier-tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.dtab === 'overview');
        });

        if (els.archiveDossierModal) els.archiveDossierModal.classList.add('active');
    } catch (error) {
        console.error('Error opening archive dossier:', error);
        showToast(error.message || 'Failed to open meeting dossier', true);
    }
}

function closeArchiveDossier() {
    // Pause any playing audio
    if (els.archiveDossierModal) {
        const audios = els.archiveDossierModal.querySelectorAll('audio');
        audios.forEach(a => { try { a.pause(); } catch {} });
        els.archiveDossierModal.classList.remove('active');
    }
}

// Render active tab inside Dossier Modal
function renderDossierContent() {
    if (!els.dossierModalBody || !state.activeArchive) return;
    const arch = state.activeArchive;
    const tab = state.dossierActiveTab;

    if (tab === 'overview') {
        renderDossierOverview(arch);
    } else if (tab === 'minutes') {
        renderDossierMinutes(arch);
    } else if (tab === 'audio') {
        renderDossierAudio(arch);
    } else if (tab === 'transcript') {
        renderDossierTranscript(arch);
    } else if (tab === 'resolutions') {
        renderDossierResolutions(arch);
    } else if (tab === 'agenda') {
        renderDossierAgenda(arch);
    } else if (tab === 'attendance') {
        renderDossierAttendance(arch);
    } else if (tab === 'files') {
        renderDossierFiles(arch);
    }
}

function renderDossierOverview(arch) {
    const meetingInfo = arch.meetingInfo || {};
    const stats = arch.stats || {};
    const meetingDate = meetingInfo.date || '2026-08-27';

    els.dossierModalBody.innerHTML = `
        <div class="printable-area dossier-printable-view">
            <!-- Official Header -->
            <div class="letterhead" style="margin-bottom: 1.5rem;">
                <div class="color-bar" style="height: 4px; background: linear-gradient(90deg, var(--primary), var(--accent)); margin-bottom: 1rem;"></div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <img src="logo.svg" alt="LGAA Logo" style="width: 54px; height: 54px;">
                        <div>
                            <h2 style="font-size: 1.25rem; font-weight: 800; color: var(--primary); margin: 0;">LADY GREY ARTS ACADEMY</h2>
                            <span style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">School Governing Body &amp; School Management Team</span>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <span class="badge" style="background: var(--primary); color: #fff; font-size: 0.8rem; font-weight: 700; padding: 0.35rem 0.75rem;">OFFICIAL ARCHIVE</span>
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">EMIS: 200600985 • Joe Gqabi</div>
                    </div>
                </div>
            </div>

            <!-- Meeting Overview Cards -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 10px; padding: 1.25rem;">
                    <h4 style="font-size: 0.95rem; margin-bottom: 0.75rem; color: var(--primary);">📋 Meeting Particulars</h4>
                    <div style="font-size: 0.85rem; line-height: 1.6;">
                        <div><strong>Title:</strong> ${escapeHTML(meetingInfo.title || 'SGB/SMT Strategy Meeting')}</div>
                        <div><strong>Date &amp; Time:</strong> ${formatDateLong(meetingDate)} @ ${escapeHTML(meetingInfo.time || '10:00 SAST')}</div>
                        <div><strong>Venue:</strong> ${escapeHTML(meetingInfo.venue || 'School Staff Room / Boardroom')}</div>
                        <div><strong>Chairperson:</strong> ${escapeHTML(meetingInfo.chairperson || 'Mr. Kwezi Dyasi')}</div>
                        <div><strong>Secretariat:</strong> ${escapeHTML(meetingInfo.secretary || 'Mr. Stephen Vorster')}</div>
                    </div>
                </div>

                <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 10px; padding: 1.25rem;">
                    <h4 style="font-size: 0.95rem; margin-bottom: 0.75rem; color: #059669;">👥 Quorum &amp; Legal Mandate</h4>
                    <div style="font-size: 0.85rem; line-height: 1.6;">
                        <div><strong>Statutory Authority:</strong> SASA Act 84 of 1996 (Sections 12 &amp; 18)</div>
                        <div><strong>Quorum Certification:</strong> <span class="badge badge--success" style="font-size: 0.75rem;">Legally Quorate (${stats.quorumPercentage || '100%'})</span></div>
                        <div><strong>Total Members:</strong> ${stats.totalMembers || 15} | <strong>Present:</strong> ${stats.presentCount || 15}</div>
                        <div><strong>Apologies:</strong> ${stats.apologyCount || 0} | <strong>Absent:</strong> ${stats.absentCount || 0}</div>
                        <div><strong>Archived By:</strong> ${escapeHTML(arch.archivedBy?.memberName || 'Secretariat')} on ${formatDateLong(arch.archivedAt?.split('T')[0])}</div>
                    </div>
                </div>
            </div>

            <!-- Notes & Executive Summary -->
            <div style="background: var(--white); border: 1px solid var(--border-color); border-radius: 10px; padding: 1.25rem; margin-bottom: 1.5rem;">
                <h4 style="font-size: 0.95rem; margin-bottom: 0.5rem; color: var(--text-main);">📝 Secretariat Executive Summary</h4>
                <p style="font-size: 0.88rem; line-height: 1.6; color: var(--text-muted); margin: 0;">
                    ${arch.notes ? escapeHTML(arch.notes) : 'All agenda items were formally deliberated in accordance with SGB statutory guidelines. The meeting arrived at binding governance resolutions and adopted actionable mandates.'}
                </p>
            </div>

            <!-- Quick Action Downloads Strip -->
            <div style="display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; justify-content: space-between; background: rgba(12, 79, 242, 0.05); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.75rem 1.25rem;">
                <span style="font-size: 0.85rem; font-weight: 600;">📥 Complete Governance Dossier Exports:</span>
                <div style="display: flex; gap: 0.5rem;">
                    <button type="button" class="btn btn-secondary btn-sm btn-download-archive-docx" data-id="${arch.id}">📄 Download Word Minutes</button>
                    <button type="button" class="btn btn-primary btn-sm btn-download-archive-zip" data-id="${arch.id}">📦 Download Full Dossier ZIP</button>
                </div>
            </div>
        </div>
    `;
}

function renderDossierMinutes(arch) {
    const minutesFiles = Array.isArray(arch.minutesFiles) ? arch.minutesFiles : [];
    const meetingDate = arch.meetingInfo?.date || '2026-08-27';

    if (minutesFiles.length === 0) {
        els.dossierModalBody.innerHTML = `
            <div class="empty-state" style="padding: 3rem 1rem;">
                <div class="empty-icon">📄</div>
                <h3>Official Minutes Documents</h3>
                <p>No minutes document was uploaded during meeting packaging.</p>
                <div style="display: flex; justify-content: center; gap: 0.75rem; margin-top: 1.25rem; flex-wrap: wrap;">
                    <button type="button" class="btn btn-primary btn-sm btn-download-archive-docx" data-id="${arch.id}">
                        📄 Download Auto-Generated Word Minutes (.docx)
                    </button>
                </div>
            </div>
        `;
        return;
    }

    els.dossierModalBody.innerHTML = `
        <div class="transcript-viewer-card">
            <div class="transcript-toolbar">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <h3 style="font-size: 1.1rem; margin: 0;">📄 Official Meeting Minutes Documents</h3>
                    <span class="badge badge--success" style="font-size: 0.75rem;">${minutesFiles.length} Adopted Document${minutesFiles.length > 1 ? 's' : ''}</span>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button type="button" class="btn btn-secondary btn-sm btn-download-archive-docx" data-id="${arch.id}">
                        📄 Generated Word Minutes (.docx)
                    </button>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-top: 1.25rem;">
                ${minutesFiles.map(mf => {
                    const downloadUrl = `/api/archives/${arch.id}/files/${mf.id}/download?token=${encodeURIComponent(state.token || '')}`;
                    const isPdf = mf.extension === 'pdf' || (mf.originalName || '').toLowerCase().endsWith('.pdf');
                    return `
                        <div class="dossier-file-card" style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 10px; padding: 1.25rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem;">
                            <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                                <div style="font-size: 1.8rem; line-height: 1;">${isPdf ? '📕' : '📘'}</div>
                                <div style="flex: 1; min-width: 0;">
                                    <div style="font-weight: 700; font-size: 0.92rem; word-break: break-word; color: var(--text-main);">${escapeHTML(mf.originalName)}</div>
                                    <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.25rem;">
                                        ${formatBytes(mf.size)} • Uploaded ${formatDateLong(mf.uploadedAt ? mf.uploadedAt.split('T')[0] : meetingDate)}
                                    </div>
                                </div>
                            </div>
                            <div style="display: flex; gap: 0.5rem; justify-content: flex-end; border-top: 1px solid var(--border-color); padding-top: 0.75rem;">
                                ${isPdf ? `<a href="${downloadUrl}" target="_blank" class="btn btn-outline btn-sm">👁️ Preview PDF</a>` : ''}
                                <a href="${downloadUrl}" download="${escapeHTML(mf.originalName)}" class="btn btn-primary btn-sm">⬇️ Download File</a>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function renderDossierAudio(arch) {
    const audios = Array.isArray(arch.audioFiles) ? arch.audioFiles : [];
    if (audios.length === 0) {
        els.dossierModalBody.innerHTML = `
            <div class="empty-state" style="padding: 3rem 1rem;">
                <div class="empty-icon">🎙️</div>
                <h3>No Audio Recordings Attached</h3>
                <p>No audio files were uploaded for this sitting. You can attach recordings by clicking <strong>✏️ Edit Archive</strong>.</p>
            </div>
        `;
        return;
    }

    els.dossierModalBody.innerHTML = `
        <div style="padding: 0.5rem 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="font-size: 1.1rem; margin: 0;">🎙️ Official Audio Recordings (${audios.length})</h3>
                <small style="color: var(--text-muted);">High-Fidelity in-browser playback with speed &amp; download controls</small>
            </div>

            <div class="audio-recordings-grid">
                ${audios.map((af, idx) => {
                    const streamUrl = `/api/archives/${arch.id}/audio/${af.id}/stream?token=${encodeURIComponent(state.token || '')}`;
                    const downloadUrl = `/api/archives/${arch.id}/files/${af.id}/download?token=${encodeURIComponent(state.token || '')}`;
                    return `
                        <div class="audio-player-card">
                            <div class="audio-player-card-header">
                                <span class="audio-player-title">🎙️ Audio Part ${idx + 1}: ${escapeHTML(af.originalName)}</span>
                                <span class="badge" style="font-size: 0.72rem;">${formatBytes(af.size)}</span>
                            </div>
                            <audio controls class="audio-native-player" preload="metadata" data-audio-id="${af.id}">
                                <source src="${streamUrl}" type="${af.mimeType || 'audio/mpeg'}">
                                Your browser does not support audio playback.
                            </audio>
                            <div class="audio-player-controls-row">
                                <label style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted);">Speed:</label>
                                <select class="filter-select audio-speed-select" data-audio-id="${af.id}" style="padding: 0.25rem 0.5rem; font-size: 0.78rem;">
                                    <option value="1">1.0x Normal</option>
                                    <option value="1.25">1.25x Fast</option>
                                    <option value="1.5">1.5x Rapid</option>
                                    <option value="2">2.0x Double</option>
                                </select>
                                <a href="${downloadUrl}" download="${escapeHTML(af.originalName)}" class="btn btn-outline btn-sm" style="margin-left: auto; font-size: 0.78rem;">
                                    ⬇️ Download
                                </a>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    // Attach playback speed listeners
    els.dossierModalBody.querySelectorAll('.audio-speed-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const audioId = e.target.dataset.audioId;
            const player = els.dossierModalBody.querySelector(`audio[data-audio-id="${audioId}"]`);
            if (player) {
                player.playbackRate = parseFloat(e.target.value);
            }
        });
    });
}

function renderDossierTranscript(arch) {
    const transcriptText = arch.transcript?.text || '';
    const transcriptFiles = Array.isArray(arch.transcript?.files) ? arch.transcript.files : [];

    if (!transcriptText && transcriptFiles.length === 0) {
        els.dossierModalBody.innerHTML = `
            <div class="empty-state" style="padding: 3rem 1rem;">
                <div class="empty-icon">📄</div>
                <h3>No Transcript Available</h3>
                <p>No transcript text or document was uploaded for this sitting. You can add one via <strong>✏️ Edit Archive</strong>.</p>
            </div>
        `;
        return;
    }

    els.dossierModalBody.innerHTML = `
        <div class="transcript-viewer-card">
            <div class="transcript-toolbar">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <h3 style="font-size: 1.1rem; margin: 0;">📄 Meeting Deliberation Transcript</h3>
                    ${transcriptFiles.length > 0 ? `<span class="badge" style="font-size: 0.75rem;">${transcriptFiles.length} Attached Document${transcriptFiles.length > 1 ? 's' : ''}</span>` : ''}
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    ${transcriptText ? `
                        <button type="button" class="btn btn-outline btn-sm btn-copy-transcript">📋 Copy Text</button>
                        <button type="button" class="btn btn-outline btn-sm btn-download-transcript-txt">⬇️ Text (.txt)</button>
                    ` : ''}
                </div>
            </div>

            ${transcriptFiles.length > 0 ? `
                <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border-color);">
                    ${transcriptFiles.map(tf => {
                        const downloadUrl = `/api/archives/${arch.id}/files/${tf.id}/download?token=${encodeURIComponent(state.token || '')}`;
                        return `
                            <a href="${downloadUrl}" download="${escapeHTML(tf.originalName)}" class="btn btn-secondary btn-sm">
                                📎 ${escapeHTML(tf.originalName)} (${formatBytes(tf.size)})
                            </a>
                        `;
                    }).join('')}
                </div>
            ` : ''}

            <div class="transcript-body" id="dossier-transcript-content">${transcriptText ? escapeHTML(transcriptText) : '<em style="color: var(--text-muted);">Transcript documents attached above. Click to view or download.</em>'}</div>
        </div>
    `;

    // Copy text trigger
    const btnCopy = els.dossierModalBody.querySelector('.btn-copy-transcript');
    if (btnCopy && transcriptText) {
        btnCopy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(transcriptText);
                showToast('Transcript copied to clipboard!');
            } catch {
                showToast('Failed to copy to clipboard', true);
            }
        });
    }

    // Download TXT trigger
    const btnDownloadTxt = els.dossierModalBody.querySelector('.btn-download-transcript-txt');
    if (btnDownloadTxt && transcriptText) {
        btnDownloadTxt.addEventListener('click', () => {
            const blob = new Blob([transcriptText], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Transcript_${arch.meetingInfo?.date || 'Meeting'}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }
}

function renderDossierResolutions(arch) {
    const resolutions = Array.isArray(arch.resolutions) ? arch.resolutions : [];
    const resFiles = Array.isArray(arch.resolutionFiles) ? arch.resolutionFiles : [];

    if (resolutions.length === 0 && resFiles.length === 0) {
        els.dossierModalBody.innerHTML = `
            <div class="empty-state" style="padding: 3rem 1rem;">
                <div class="empty-icon">⚖️</div>
                <h3>No Formal Resolutions Logged</h3>
                <p>No resolutions were recorded for this sitting. You can add resolutions via <strong>✏️ Edit Archive</strong>.</p>
            </div>
        `;
        return;
    }

    const decisionClassMap = {
        'Adopted': 'decision-adopted',
        'Approved': 'decision-approved',
        'Deferred': 'decision-deferred',
        'Rejected': 'decision-rejected',
        'Action Required': 'decision-action'
    };

    els.dossierModalBody.innerHTML = `
        <div style="padding: 0.5rem 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                <div>
                    <h3 style="font-size: 1.15rem; margin: 0;">⚖️ Formal Governance Resolutions &amp; Action Plan (${resolutions.length})</h3>
                    <small style="color: var(--text-muted);">Adopted strategic decisions, mandates, and assignable tasks</small>
                </div>
                ${resFiles.length > 0 ? `
                    <div style="display: flex; gap: 0.4rem;">
                        ${resFiles.map(rf => {
                            const downloadUrl = `/api/archives/${arch.id}/files/${rf.id}/download?token=${encodeURIComponent(state.token || '')}`;
                            return `<a href="${downloadUrl}" download="${escapeHTML(rf.originalName)}" class="btn btn-secondary btn-sm">📜 Signed Resolution Document</a>`;
                        }).join('')}
                    </div>
                ` : ''}
            </div>

            <div class="resolutions-matrix-grid">
                ${resolutions.map((res, idx) => {
                    const dec = res.decision || 'Adopted';
                    const decClass = decisionClassMap[dec] || 'decision-adopted';
                    const actionItems = Array.isArray(res.actionItems) ? res.actionItems : [];

                    return `
                        <div class="resolution-matrix-card">
                            <div class="resolution-matrix-header">
                                <div>
                                    <span style="font-size: 0.78rem; font-weight: 700; color: var(--primary); text-transform: uppercase;">Resolution ${idx + 1}</span>
                                    <h4 style="font-size: 1.05rem; font-weight: 700; margin: 0.15rem 0 0.35rem 0;">${escapeHTML(res.itemTitle || res.title || ('Resolution ' + (idx + 1)))}</h4>
                                </div>
                                <span class="resolution-decision-badge ${decClass}">${dec}</span>
                            </div>

                            <p style="font-size: 0.9rem; line-height: 1.6; color: var(--text-main); margin-bottom: 0.75rem;">
                                ${escapeHTML(res.resolutionText || res.text || 'Resolution adopted by unanimous sitting consensus.')}
                            </p>

                            ${actionItems.length > 0 ? `
                                <div style="margin-top: 0.75rem;">
                                    <strong style="font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">Action Items &amp; Deadlines:</strong>
                                    <table class="action-items-table">
                                        <thead>
                                            <tr>
                                                <th>Task</th>
                                                <th>Responsible Person</th>
                                                <th>Due Date</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${actionItems.map(act => `
                                                <tr>
                                                    <td><strong>${escapeHTML(act.task || '')}</strong></td>
                                                    <td>${escapeHTML(act.assignee || 'Assigned Officer')}</td>
                                                    <td>${act.dueDate ? formatDateLong(act.dueDate) : 'Immediate'}</td>
                                                    <td><span class="badge badge--success" style="font-size: 0.72rem;">${escapeHTML(act.status || 'Pending')}</span></td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function renderDossierAgenda(arch) {
    const items = Array.isArray(arch.agendaSnapshot) ? arch.agendaSnapshot : [];

    if (items.length === 0) {
        els.dossierModalBody.innerHTML = `
            <div class="empty-state" style="padding: 3rem 1rem;">
                <div class="empty-icon">📋</div>
                <h3>No Agenda Items Logged</h3>
                <p>No agenda items were captured in this sitting snapshot.</p>
            </div>
        `;
        return;
    }

    els.dossierModalBody.innerHTML = `
        <div style="padding: 0.5rem 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="font-size: 1.15rem; margin: 0;">📋 Agenda Items &amp; Deliberations Log (${items.length})</h3>
                <small style="color: var(--text-muted);">Complete record of topics, proposer, votes, and brainstorm comments</small>
            </div>

            <div style="display: flex; flex-direction: column; gap: 1rem;">
                ${items.map((item, idx) => {
                    const votes = Array.isArray(item.votes) ? item.votes : [];
                    const comments = Array.isArray(item.comments) ? item.comments : [];
                    return `
                        <div style="background: var(--white); border: 1px solid var(--border-color); border-radius: 10px; padding: 1.25rem; box-shadow: var(--shadow-sm);">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                                <div>
                                    <span style="font-size: 0.75rem; font-weight: 700; color: var(--primary);">ITEM ${idx + 1} • ${escapeHTML(item.category || 'General')}</span>
                                    <h4 style="font-size: 1.05rem; font-weight: 700; margin: 0.2rem 0;">${escapeHTML(item.title)}</h4>
                                    <div style="font-size: 0.8rem; color: var(--text-muted);">
                                        Proposed by: <strong>${escapeHTML(item.proposedBy?.memberName || 'Member')}</strong> (${escapeHTML(item.proposedBy?.memberRole || 'Governance')})
                                    </div>
                                </div>
                                <div style="text-align: right;">
                                    <span class="badge" style="background: rgba(12, 79, 242, 0.1); color: var(--primary); font-size: 0.8rem; font-weight: 700;">${votes.length} Votes</span>
                                </div>
                            </div>

                            <p style="font-size: 0.88rem; line-height: 1.6; color: var(--text-main); margin: 0.75rem 0;">
                                ${escapeHTML(item.description)}
                            </p>

                            ${item.isResolved && item.resolution ? `
                                <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 6px; padding: 0.6rem 0.85rem; font-size: 0.84rem; color: #166534; margin: 0.5rem 0;">
                                    <strong>⭐ Agreed Resolution:</strong> ${escapeHTML(item.resolution.solutionText || item.resolution.summary || '')}
                                </div>
                            ` : ''}

                            ${comments.length > 0 ? `
                                <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border-color);">
                                    <strong style="font-size: 0.76rem; text-transform: uppercase; color: var(--text-muted);">Discussion Log (${comments.length}):</strong>
                                    <div style="display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.4rem;">
                                        ${comments.map(c => `
                                            <div style="font-size: 0.82rem; background: var(--bg-color); border-radius: 6px; padding: 0.4rem 0.65rem;">
                                                <strong>${escapeHTML(c.memberName)}:</strong> ${escapeHTML(c.content)}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function renderDossierAttendance(arch) {
    const signedFiles = Array.isArray(arch.signedAttendanceFiles) ? arch.signedAttendanceFiles : [];
    const att = arch.attendance || {};
    const components = Array.isArray(att.components) ? att.components : [];

    els.dossierModalBody.innerHTML = `
        <div style="padding: 0.5rem 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                <div>
                    <h3 style="font-size: 1.15rem; margin: 0;">📝 Official Attendance Register &amp; Statutory Quorum</h3>
                    <small style="color: var(--text-muted);">Certified physical signed register scan and digital component roster</small>
                </div>
                ${signedFiles.length > 0 ? `
                    <div style="display: flex; gap: 0.5rem;">
                        ${signedFiles.map(sf => {
                            const downloadUrl = `/api/archives/${arch.id}/files/${sf.id}/download?token=${encodeURIComponent(state.token || '')}`;
                            return `<a href="${downloadUrl}" download="${escapeHTML(sf.originalName)}" class="btn btn-primary btn-sm">📄 Download Official Signed Register</a>`;
                        }).join('')}
                    </div>
                ` : ''}
            </div>

            ${signedFiles.length > 0 ? `
                <div style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 0.85rem 1.25rem; margin-bottom: 1.25rem; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <span style="font-size: 1.5rem;">📜</span>
                        <div>
                            <strong style="font-size: 0.92rem; color: #065F46;">Official Signed Register Attached</strong>
                            <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHTML(signedFiles[0].originalName)} (${formatBytes(signedFiles[0].size)})</div>
                        </div>
                    </div>
                    <a href="/api/archives/${arch.id}/files/${signedFiles[0].id}/download?token=${encodeURIComponent(state.token || '')}" class="btn btn-secondary btn-sm" download>⬇️ Open Document</a>
                </div>
            ` : `
                <div style="background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-size: 0.85rem; color: #92400E;">
                    ⚠️ No physical signed register scan attached yet. Upload scan via <strong>✏️ Edit Archive</strong>.
                </div>
            `}

            <!-- Statutory Roster by Component -->
            <div style="background: var(--white); border: 1px solid var(--border-color); border-radius: 10px; padding: 1.25rem;">
                <h4 style="font-size: 0.95rem; margin-bottom: 0.75rem;">Governance Component Roster</h4>
                ${components.length > 0 ? components.map(comp => `
                    <div style="margin-bottom: 1rem;">
                        <strong style="font-size: 0.82rem; color: var(--primary); text-transform: uppercase;">${escapeHTML(comp.name)}</strong>
                        <table class="action-items-table" style="margin-top: 0.35rem;">
                            <thead>
                                <tr>
                                    <th>Member Name</th>
                                    <th>Governance Role</th>
                                    <th>Attendance Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(comp.members || []).map(m => `
                                    <tr>
                                        <td><strong>${escapeHTML(m.title ? m.title + ' ' : '')}${escapeHTML(m.name)}</strong></td>
                                        <td>${escapeHTML(m.role || 'Member')}</td>
                                        <td><span class="badge ${m.status === 'Present' ? 'badge--success' : (m.status === 'Apology' ? 'badge--warning' : 'badge--danger')}" style="font-size: 0.72rem;">${escapeHTML(m.status || 'Present')}</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `).join('') : `
                    <p style="font-size: 0.85rem; color: var(--text-muted);">Full attendance certified in official signed register.</p>
                `}
            </div>
        </div>
    `;
}

function renderDossierFiles(arch) {
    const files = Array.isArray(arch.vaultDocuments) ? arch.vaultDocuments : [];

    if (files.length === 0) {
        els.dossierModalBody.innerHTML = `
            <div class="empty-state" style="padding: 3rem 1rem;">
                <div class="empty-icon">📁</div>
                <h3>No Vault Files Attached</h3>
                <p>No supporting shared documents were active in the vault during this sitting.</p>
            </div>
        `;
        return;
    }

    els.dossierModalBody.innerHTML = `
        <div style="padding: 0.5rem 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="font-size: 1.15rem; margin: 0;">📁 Supporting Documents Vault (${files.length})</h3>
                <small style="color: var(--text-muted);">Supporting reports, financials, and proposals tabled during sitting</small>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem;">
                ${files.map(doc => {
                    const downloadUrl = `/api/documents/${doc.id}/download?token=${encodeURIComponent(state.token || '')}`;
                    return `
                        <div style="background: var(--white); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; justify-content: space-between;">
                            <div>
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                                    <span style="font-size: 1.25rem;">📄</span>
                                    <strong style="font-size: 0.92rem; word-break: break-all;">${escapeHTML(doc.title || doc.originalName)}</strong>
                                </div>
                                <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.75rem;">
                                    Size: ${formatBytes(doc.size)} • Type: ${(doc.extension || 'file').toUpperCase()}
                                </div>
                            </div>
                            <a href="${downloadUrl}" download="${escapeHTML(doc.originalName)}" class="btn btn-outline btn-sm" style="text-align: center;">
                                ⬇️ Download File
                            </a>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

// ── Edit Archived Meeting Logic ──
async function openEditArchiveModal(archiveId) {
    try {
        const arch = await api.getArchive(archiveId);
        if (!arch) return;

        state.editingArchive = arch;
        const meetingInfo = arch.meetingInfo || {};

        if (els.editArchiveId) els.editArchiveId.value = arch.id;
        if (els.editArchiveTitle) els.editArchiveTitle.value = meetingInfo.title || '';
        if (els.editArchiveDate) els.editArchiveDate.value = meetingInfo.date || '';
        if (els.editArchiveTime) els.editArchiveTime.value = meetingInfo.time || '10:00 SAST';
        if (els.editArchiveVenue) els.editArchiveVenue.value = meetingInfo.venue || 'Staff Room';
        if (els.editArchiveNotes) els.editArchiveNotes.value = arch.notes || '';
        if (els.editArchiveTranscript) els.editArchiveTranscript.value = arch.transcript?.text || '';

        // Reset file inputs
        if (els.editArchiveNewAudio) els.editArchiveNewAudio.value = '';
        if (els.editArchiveNewSigned) els.editArchiveNewSigned.value = '';
        if (els.editArchiveNewTranscript) els.editArchiveNewTranscript.value = '';
        if (els.editArchiveNewResolution) els.editArchiveNewResolution.value = '';

        renderEditArchiveResolutions(arch.resolutions || []);
        renderEditArchiveExistingFiles(arch);

        if (els.editArchiveModal) els.editArchiveModal.classList.add('active');
    } catch (error) {
        console.error('Error opening edit archive:', error);
        showToast(error.message || 'Failed to open edit modal', true);
    }
}

function closeEditArchiveModal() {
    if (els.editArchiveModal) els.editArchiveModal.classList.remove('active');
    state.editingArchive = null;
}

function renderEditArchiveResolutions(resolutions) {
    if (!els.editArchiveResolutionsList) return;
    const membersList = state.members || [];

    els.editArchiveResolutionsList.innerHTML = resolutions.map((res, resIdx) => `
        <div class="resolution-card-editor" data-res-index="${resIdx}">
            <div class="resolution-card-top-row">
                <input type="text" class="form-input edit-res-title" value="${escapeHTML(res.itemTitle || res.title || '')}" placeholder="Resolution Title" required style="font-weight: 700;">
                <select class="resolution-decision-select edit-res-decision">
                    <option value="Adopted" ${res.decision === 'Adopted' ? 'selected' : ''}>Adopted</option>
                    <option value="Approved" ${res.decision === 'Approved' ? 'selected' : ''}>Approved</option>
                    <option value="Deferred" ${res.decision === 'Deferred' ? 'selected' : ''}>Deferred</option>
                    <option value="Rejected" ${res.decision === 'Rejected' ? 'selected' : ''}>Rejected</option>
                    <option value="Action Required" ${res.decision === 'Action Required' ? 'selected' : ''}>Action Required</option>
                </select>
                <button type="button" class="btn-link-action btn-edit-remove-resolution" data-res-index="${resIdx}" style="color: var(--danger);">✕</button>
            </div>
            
            <textarea class="form-textarea edit-res-text" rows="2" placeholder="Resolution text...">${escapeHTML(res.resolutionText || res.text || '')}</textarea>

            <div class="action-items-editor-box">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted);">Action Items</span>
                    <button type="button" class="btn-link-action btn-edit-add-action-item" data-res-index="${resIdx}">+ Add Action Item</button>
                </div>
                <div class="edit-action-items-container" data-res-index="${resIdx}">
                    ${(res.actionItems || []).map((act, actIdx) => `
                        <div class="action-item-row-edit" data-act-index="${actIdx}">
                            <input type="text" class="form-input edit-act-task" placeholder="Task..." value="${escapeHTML(act.task || '')}">
                            <select class="form-input edit-act-assignee">
                                <option value="">Assignee...</option>
                                ${membersList.map(m => `<option value="${escapeHTML(m.name)}" ${act.assignee === m.name ? 'selected' : ''}>${escapeHTML(m.name)}</option>`).join('')}
                            </select>
                            <input type="date" class="form-input edit-act-due" value="${act.dueDate || ''}">
                            <button type="button" class="btn-link-action btn-edit-remove-action-item" data-res-index="${resIdx}" data-act-index="${actIdx}" style="color: var(--danger);">✕</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `).join('');
}

function renderEditArchiveExistingFiles(arch) {
    if (!els.editArchiveExistingFiles) return;

    const allFiles = [
        ...(arch.minutesFiles || []).map(f => ({ ...f, typeLabel: '📄 Minutes Doc' })),
        ...(arch.audioFiles || []).map(f => ({ ...f, typeLabel: '🎙️ Audio' })),
        ...(arch.signedAttendanceFiles || []).map(f => ({ ...f, typeLabel: '📝 Signed Register' })),
        ...(arch.transcript?.files || []).map(f => ({ ...f, typeLabel: '📄 Transcript Doc' })),
        ...(arch.resolutionFiles || []).map(f => ({ ...f, typeLabel: '⚖️ Resolution Doc' }))
    ];

    if (allFiles.length === 0) {
        els.editArchiveExistingFiles.innerHTML = `<p style="font-size: 0.84rem; color: var(--text-muted);">No files attached to this archive.</p>`;
        return;
    }

    els.editArchiveExistingFiles.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.4rem;">
            ${allFiles.map(f => `
                <div class="uploaded-file-chip">
                    <div class="uploaded-file-chip-info">
                        <span style="font-size: 0.8rem; font-weight: 700; color: var(--primary);">${f.typeLabel}:</span>
                        <span>${escapeHTML(f.originalName)} (${formatBytes(f.size)})</span>
                    </div>
                    <button type="button" class="btn-link-action btn-delete-archive-file" data-archive-id="${arch.id}" data-file-id="${f.id}" style="color: var(--danger); font-size: 0.8rem;">
                        🗑️ Remove
                    </button>
                </div>
            `).join('')}
        </div>
    `;
}

// ── Global Event Listeners for Archives Module ──
function initArchivesModule() {
    // Stat card archives click
    if (els.statCardArchives) {
        els.statCardArchives.addEventListener('click', () => switchTab('archives'));
    }

    // Conclude Meeting button triggers
    if (els.btnConcludeMeeting) {
        els.btnConcludeMeeting.addEventListener('click', openConcludeWizard);
    }
    if (els.btnConcludeFromArchives) {
        els.btnConcludeFromArchives.addEventListener('click', openConcludeWizard);
    }
    if (els.btnCloseConcludeModal) {
        els.btnCloseConcludeModal.addEventListener('click', closeConcludeWizard);
    }
    if (els.btnConcludeCancel) {
        els.btnConcludeCancel.addEventListener('click', closeConcludeWizard);
    }

    // Wizard navigation
    if (els.btnConcludeNext) {
        els.btnConcludeNext.addEventListener('click', () => {
            if (state.concludeStep < 6) {
                updateConcludeWizardStep(state.concludeStep + 1);
            }
        });
    }
    if (els.btnConcludePrev) {
        els.btnConcludePrev.addEventListener('click', () => {
            if (state.concludeStep > 1) {
                updateConcludeWizardStep(state.concludeStep - 1);
            }
        });
    }

    // Wizard Step Nodes click
    document.querySelectorAll('.wizard-step-node').forEach(node => {
        node.addEventListener('click', () => {
            const step = parseInt(node.dataset.step, 10);
            if (step) updateConcludeWizardStep(step);
        });
    });

    // Step 2 Audio Dropzone & File Input
    if (els.concludeAudioDropZone && els.concludeAudioInput) {
        els.concludeAudioDropZone.addEventListener('click', () => els.concludeAudioInput.click());
        els.concludeAudioInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                Array.from(e.target.files).forEach(f => state.selectedConcludeAudios.push(f));
                renderConcludeAudioTray();
            }
        });

        els.concludeAudioDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            els.concludeAudioDropZone.classList.add('dragover');
        });
        els.concludeAudioDropZone.addEventListener('dragleave', () => {
            els.concludeAudioDropZone.classList.remove('dragover');
        });
        els.concludeAudioDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            els.concludeAudioDropZone.classList.remove('dragover');
            if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                Array.from(e.dataTransfer.files).forEach(f => state.selectedConcludeAudios.push(f));
                renderConcludeAudioTray();
            }
        });
    }

    function renderConcludeAudioTray() {
        if (!els.concludeAudioTray) return;
        if (state.selectedConcludeAudios.length === 0) {
            els.concludeAudioTray.innerHTML = '';
            if (els.concludeAudioDropTitle) els.concludeAudioDropTitle.textContent = 'Click to browse or drag & drop audio files here';
            return;
        }

        if (els.concludeAudioDropTitle) els.concludeAudioDropTitle.textContent = `${state.selectedConcludeAudios.length} Audio File(s) Selected — Click to add more`;

        els.concludeAudioTray.innerHTML = state.selectedConcludeAudios.map((f, idx) => `
            <div class="uploaded-file-chip">
                <div class="uploaded-file-chip-info">
                    <span>🎙️</span>
                    <span><strong>${escapeHTML(f.name)}</strong> (${formatBytes(f.size)})</span>
                </div>
                <button type="button" class="btn-link-action btn-remove-conclude-audio" data-index="${idx}" style="color: var(--danger);">✕ Remove</button>
            </div>
        `).join('');

        els.concludeAudioTray.querySelectorAll('.btn-remove-conclude-audio').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                state.selectedConcludeAudios.splice(idx, 1);
                renderConcludeAudioTray();
            });
        });
    }

    // Step 3 Minutes Document Dropzone & File Input
    if (els.concludeMinutesDropZone && els.concludeMinutesFileInput) {
        els.concludeMinutesDropZone.addEventListener('click', () => els.concludeMinutesFileInput.click());
        els.concludeMinutesFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                Array.from(e.target.files).forEach(f => state.selectedConcludeMinutes.push(f));
                renderConcludeMinutesTray();
            }
        });

        els.concludeMinutesDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            els.concludeMinutesDropZone.classList.add('dragover');
        });
        els.concludeMinutesDropZone.addEventListener('dragleave', () => {
            els.concludeMinutesDropZone.classList.remove('dragover');
        });
        els.concludeMinutesDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            els.concludeMinutesDropZone.classList.remove('dragover');
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                Array.from(e.dataTransfer.files).forEach(f => state.selectedConcludeMinutes.push(f));
                renderConcludeMinutesTray();
            }
        });
    }

    function renderConcludeMinutesTray() {
        if (!els.concludeMinutesTray) return;
        if (state.selectedConcludeMinutes.length === 0) {
            els.concludeMinutesTray.innerHTML = '';
            if (els.concludeMinutesDropTitle) els.concludeMinutesDropTitle.textContent = 'Click to upload Official Minutes Document (.docx, .pdf, .doc)';
            return;
        }

        if (els.concludeMinutesDropTitle) els.concludeMinutesDropTitle.textContent = `${state.selectedConcludeMinutes.length} Minutes Document(s) Selected — Click to add more`;

        els.concludeMinutesTray.innerHTML = state.selectedConcludeMinutes.map((f, idx) => `
            <div class="uploaded-file-chip">
                <div class="uploaded-file-chip-info">
                    <span>📄</span>
                    <span><strong>${escapeHTML(f.name)}</strong> (${formatBytes(f.size)})</span>
                </div>
                <button type="button" class="btn-link-action btn-remove-conclude-minutes" data-index="${idx}" style="color: var(--danger);">✕ Remove</button>
            </div>
        `).join('');

        els.concludeMinutesTray.querySelectorAll('.btn-remove-conclude-minutes').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                state.selectedConcludeMinutes.splice(idx, 1);
                renderConcludeMinutesTray();
            });
        });
    }

    // Step 4 Add Resolution Button
    if (els.btnAddResolutionRow) {
        els.btnAddResolutionRow.addEventListener('click', () => {
            state.concludeResolutions.push({
                itemId: null,
                itemTitle: 'New Governance Resolution',
                decision: 'Adopted',
                resolutionText: '',
                actionItems: []
            });
            renderConcludeResolutions();
        });
    }

    // Step 4 Resolution removal & action item management
    if (els.concludeResolutionsList) {
        els.concludeResolutionsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-remove-resolution')) {
                const idx = parseInt(e.target.dataset.resIndex, 10);
                state.concludeResolutions.splice(idx, 1);
                renderConcludeResolutions();
            } else if (e.target.classList.contains('btn-add-action-item')) {
                const idx = parseInt(e.target.dataset.resIndex, 10);
                if (!Array.isArray(state.concludeResolutions[idx].actionItems)) {
                    state.concludeResolutions[idx].actionItems = [];
                }
                state.concludeResolutions[idx].actionItems.push({
                    task: '',
                    assignee: '',
                    dueDate: '',
                    status: 'Pending'
                });
                renderConcludeResolutions();
            } else if (e.target.classList.contains('btn-remove-action-item')) {
                const resIdx = parseInt(e.target.dataset.resIndex, 10);
                const actIdx = parseInt(e.target.dataset.actIndex, 10);
                if (state.concludeResolutions[resIdx]?.actionItems) {
                    state.concludeResolutions[resIdx].actionItems.splice(actIdx, 1);
                    renderConcludeResolutions();
                }
            }
        });

        // Sync inputs back to state
        els.concludeResolutionsList.addEventListener('input', (e) => {
            const card = e.target.closest('.resolution-card-editor');
            if (!card) return;
            const resIdx = parseInt(card.dataset.resIndex, 10);
            const res = state.concludeResolutions[resIdx];
            if (!res) return;

            if (e.target.classList.contains('res-edit-title')) res.itemTitle = e.target.value;
            if (e.target.classList.contains('res-edit-decision')) res.decision = e.target.value;
            if (e.target.classList.contains('res-edit-text')) res.resolutionText = e.target.value;

            const actRow = e.target.closest('.action-item-row-edit');
            if (actRow) {
                const actIdx = parseInt(actRow.dataset.actIndex, 10);
                const act = res.actionItems?.[actIdx];
                if (act) {
                    if (e.target.classList.contains('act-edit-task')) act.task = e.target.value;
                    if (e.target.classList.contains('act-edit-assignee')) act.assignee = e.target.value;
                    if (e.target.classList.contains('act-edit-due')) act.dueDate = e.target.value;
                }
            }
        });
    }

    // Step 5 Signed Register Dropzone
    if (els.concludeSignedRegDropZone && els.concludeSignedRegInput) {
        els.concludeSignedRegDropZone.addEventListener('click', () => els.concludeSignedRegInput.click());
        els.concludeSignedRegInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                if (els.concludeSignedRegTitle) {
                    els.concludeSignedRegTitle.textContent = `Selected: ${e.target.files[0].name} (${formatBytes(e.target.files[0].size)})`;
                }
                if (els.concludeSignedRegError) els.concludeSignedRegError.textContent = '';
            }
        });
    }

    // Step 5 Conclude Wizard Submit Handler
    if (els.concludeMeetingForm) {
        els.concludeMeetingForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const title = (els.concludeMeetingTitle?.value || '').trim();
            const date = els.concludeMeetingDate?.value || '';

            if (!title || !date) {
                showToast('Please specify Meeting Title and Date', true);
                updateConcludeWizardStep(1);
                return;
            }

            const formData = new FormData();

            // Meeting Info
            const meetingInfo = {
                title,
                date,
                time: (els.concludeMeetingTime?.value || '10:00 SAST').trim(),
                venue: (els.concludeMeetingVenue?.value || 'School Staff Room / Boardroom').trim(),
                notes: (els.concludeMeetingNotes?.value || '').trim()
            };
            formData.append('meetingInfo', JSON.stringify(meetingInfo));
            formData.append('notes', meetingInfo.notes);

            // Audio Files
            state.selectedConcludeAudios.forEach(af => {
                formData.append('audioFiles', af);
            });

            // Minutes Files
            state.selectedConcludeMinutes.forEach(mf => {
                formData.append('minutesFiles', mf);
            });

            // Transcript
            if (els.concludeTranscriptFileInput?.files?.[0]) {
                formData.append('transcriptFiles', els.concludeTranscriptFileInput.files[0]);
            }
            formData.append('transcriptText', (els.concludeTranscriptText?.value || '').trim());

            // Resolutions
            formData.append('resolutions', JSON.stringify(state.concludeResolutions));
            if (els.concludeResolutionFileInput?.files?.[0]) {
                formData.append('resolutionFiles', els.concludeResolutionFileInput.files[0]);
            }

            // Signed Attendance Register
            if (els.concludeSignedRegInput?.files?.[0]) {
                formData.append('signedRegisterFiles', els.concludeSignedRegInput.files[0]);
            }

            // Attendance Data
            if (state.concludeAttendance) {
                // Collect status selects
                const selects = document.querySelectorAll('.conclude-att-status-select');
                let memberIdx = 0;
                (state.concludeAttendance.components || []).forEach(comp => {
                    (comp.members || []).forEach(m => {
                        const sel = document.querySelector(`.conclude-att-status-select[data-member-idx="${memberIdx}"]`);
                        if (sel) m.status = sel.value;
                        memberIdx++;
                    });
                });
                formData.append('attendanceData', JSON.stringify(state.concludeAttendance));
            }

            // Next Meeting Setup
            const nextMeetingInfo = {
                title: (els.nextMeetingTitle?.value || 'SGB & SMT Ordinary Meeting').trim(),
                date: els.nextMeetingDate?.value || '',
                time: (els.nextMeetingTime?.value || '10:00 SAST').trim(),
                venue: (els.nextMeetingVenue?.value || 'School Staff Room / Boardroom').trim()
            };
            formData.append('nextMeetingInfo', JSON.stringify(nextMeetingInfo));
            formData.append('clearVault', String(els.concludeClearVault?.checked !== false));

            // UI progress
            if (els.concludeProgressWrapper) els.concludeProgressWrapper.classList.remove('hidden');
            if (els.btnConcludeSubmit) els.btnConcludeSubmit.disabled = true;

            try {
                const res = await api.concludeMeeting(formData, (percent) => {
                    if (els.concludeProgressFill) els.concludeProgressFill.style.width = `${percent}%`;
                    if (els.concludeProgressPercent) els.concludeProgressPercent.textContent = `${percent}%`;
                });

                showToast('🏁 Meeting successfully concluded and archived!');
                closeConcludeWizard();
                await loadData();
                switchTab('archives');
                if (res.archiveId) {
                    openArchiveDossier(res.archiveId);
                }
            } catch (error) {
                console.error('Error concluding meeting:', error);
                showToast(error.message || 'Failed to archive meeting', true);
            } finally {
                if (els.btnConcludeSubmit) els.btnConcludeSubmit.disabled = false;
                if (els.concludeProgressWrapper) els.concludeProgressWrapper.classList.add('hidden');
            }
        });
    }

    // Dossier Modal Tab Strip click listener
    if (els.dossierTabsStrip) {
        els.dossierTabsStrip.addEventListener('click', (e) => {
            const btn = e.target.closest('.dossier-tab-btn');
            if (!btn) return;
            state.dossierActiveTab = btn.dataset.dtab;
            els.dossierTabsStrip.querySelectorAll('.dossier-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderDossierContent();
        });
    }

    // Dossier Modal Actions
    if (els.btnCloseDossierModal) els.btnCloseDossierModal.addEventListener('click', closeArchiveDossier);
    if (els.btnDossierPrint) els.btnDossierPrint.addEventListener('click', () => window.print());
    if (els.btnDossierDownloadDocx) {
        els.btnDossierDownloadDocx.addEventListener('click', () => {
            if (state.activeArchive) {
                window.location.href = `/api/archives/${state.activeArchive.id}/export/docx?token=${encodeURIComponent(state.token || '')}`;
            }
        });
    }
    if (els.btnDossierDownloadZip) {
        els.btnDossierDownloadZip.addEventListener('click', () => {
            if (state.activeArchive) {
                window.location.href = `/api/archives/${state.activeArchive.id}/export/zip?token=${encodeURIComponent(state.token || '')}`;
            }
        });
    }
    if (els.btnDossierEdit) {
        els.btnDossierEdit.addEventListener('click', () => {
            if (state.activeArchive) {
                closeArchiveDossier();
                openEditArchiveModal(state.activeArchive.id);
            }
        });
    }

    // Edit Archive Modal Actions
    if (els.btnCloseEditArchiveModal) els.btnCloseEditArchiveModal.addEventListener('click', closeEditArchiveModal);
    if (els.btnCancelEditArchive) els.btnCancelEditArchive.addEventListener('click', closeEditArchiveModal);

    if (els.btnEditAddResolutionRow) {
        els.btnEditAddResolutionRow.addEventListener('click', () => {
            if (!state.editingArchive) return;
            if (!Array.isArray(state.editingArchive.resolutions)) state.editingArchive.resolutions = [];
            state.editingArchive.resolutions.push({
                itemTitle: 'New Formal Resolution',
                decision: 'Adopted',
                resolutionText: '',
                actionItems: []
            });
            renderEditArchiveResolutions(state.editingArchive.resolutions);
        });
    }

    if (els.editArchiveResolutionsList) {
        els.editArchiveResolutionsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-edit-remove-resolution')) {
                const idx = parseInt(e.target.dataset.resIndex, 10);
                if (state.editingArchive?.resolutions) {
                    state.editingArchive.resolutions.splice(idx, 1);
                    renderEditArchiveResolutions(state.editingArchive.resolutions);
                }
            } else if (e.target.classList.contains('btn-edit-add-action-item')) {
                const idx = parseInt(e.target.dataset.resIndex, 10);
                if (state.editingArchive?.resolutions?.[idx]) {
                    if (!Array.isArray(state.editingArchive.resolutions[idx].actionItems)) {
                        state.editingArchive.resolutions[idx].actionItems = [];
                    }
                    state.editingArchive.resolutions[idx].actionItems.push({
                        task: '',
                        assignee: '',
                        dueDate: '',
                        status: 'Pending'
                    });
                    renderEditArchiveResolutions(state.editingArchive.resolutions);
                }
            } else if (e.target.classList.contains('btn-edit-remove-action-item')) {
                const resIdx = parseInt(e.target.dataset.resIndex, 10);
                const actIdx = parseInt(e.target.dataset.actIndex, 10);
                if (state.editingArchive?.resolutions?.[resIdx]?.actionItems) {
                    state.editingArchive.resolutions[resIdx].actionItems.splice(actIdx, 1);
                    renderEditArchiveResolutions(state.editingArchive.resolutions);
                }
            }
        });
    }

    // Delete single file from archive in edit modal
    if (els.editArchiveExistingFiles) {
        els.editArchiveExistingFiles.addEventListener('click', async (e) => {
            if (e.target.classList.contains('btn-delete-archive-file')) {
                const { archiveId, fileId } = e.target.dataset;
                if (confirm('Delete this file from the meeting archive?')) {
                    try {
                        const res = await api.deleteArchiveFile(archiveId, fileId);
                        showToast('File removed from archive');
                        state.editingArchive = res.archive;
                        renderEditArchiveExistingFiles(res.archive);
                        await loadData();
                    } catch (error) {
                        showToast(error.message || 'Failed to delete file', true);
                    }
                }
            }
        });
    }

    // Save Edit Archive Form
    if (els.editArchiveForm) {
        els.editArchiveForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const archiveId = els.editArchiveId?.value;
            if (!archiveId) return;

            // Collect resolutions
            const resCards = els.editArchiveResolutionsList?.querySelectorAll('.resolution-card-editor') || [];
            const updatedResolutions = [];
            resCards.forEach(card => {
                const title = card.querySelector('.edit-res-title')?.value || '';
                const decision = card.querySelector('.edit-res-decision')?.value || 'Adopted';
                const text = card.querySelector('.edit-res-text')?.value || '';
                const actionItems = [];
                card.querySelectorAll('.action-item-row-edit').forEach(actRow => {
                    const task = actRow.querySelector('.edit-act-task')?.value || '';
                    const assignee = actRow.querySelector('.edit-act-assignee')?.value || '';
                    const dueDate = actRow.querySelector('.edit-act-due')?.value || '';
                    if (task) actionItems.push({ task, assignee, dueDate, status: 'Pending' });
                });
                updatedResolutions.push({ itemTitle: title, decision, resolutionText: text, actionItems });
            });

            const payload = {
                meetingInfo: {
                    title: (els.editArchiveTitle?.value || '').trim(),
                    date: els.editArchiveDate?.value || '',
                    time: (els.editArchiveTime?.value || '').trim(),
                    venue: (els.editArchiveVenue?.value || '').trim()
                },
                notes: (els.editArchiveNotes?.value || '').trim(),
                transcriptText: (els.editArchiveTranscript?.value || '').trim(),
                resolutions: updatedResolutions
            };

            try {
                await api.updateArchive(archiveId, payload);

                // Upload additional files if selected
                const hasNewAudio = els.editArchiveNewAudio?.files?.length > 0;
                const hasNewMinutes = els.editArchiveNewMinutes?.files?.length > 0;
                const hasNewSigned = els.editArchiveNewSigned?.files?.length > 0;
                const hasNewTranscript = els.editArchiveNewTranscript?.files?.length > 0;
                const hasNewResolution = els.editArchiveNewResolution?.files?.length > 0;

                if (hasNewAudio || hasNewMinutes || hasNewSigned || hasNewTranscript || hasNewResolution) {
                    const formData = new FormData();
                    if (hasNewAudio) {
                        Array.from(els.editArchiveNewAudio.files).forEach(f => formData.append('audioFiles', f));
                    }
                    if (hasNewMinutes) {
                        Array.from(els.editArchiveNewMinutes.files).forEach(f => formData.append('minutesFiles', f));
                    }
                    if (hasNewSigned) {
                        formData.append('signedRegisterFiles', els.editArchiveNewSigned.files[0]);
                    }
                    if (hasNewTranscript) {
                        formData.append('transcriptFiles', els.editArchiveNewTranscript.files[0]);
                    }
                    if (hasNewResolution) {
                        formData.append('resolutionFiles', els.editArchiveNewResolution.files[0]);
                    }
                    await api.uploadArchiveFiles(archiveId, formData);
                }

                showToast('Archive updated successfully!');
                closeEditArchiveModal();
                await loadData();
                openArchiveDossier(archiveId);
            } catch (error) {
                console.error('Error saving archive edits:', error);
                showToast(error.message || 'Failed to update archive', true);
            }
        });
    }

    // Global click delegate for Archive cards
    if (els.archivesContainer) {
        els.archivesContainer.addEventListener('click', async (e) => {
            const btnDossier = e.target.closest('.btn-open-archive-dossier');
            if (btnDossier) {
                openArchiveDossier(btnDossier.dataset.id);
                return;
            }

            const btnDocx = e.target.closest('.btn-download-archive-docx');
            if (btnDocx) {
                window.location.href = `/api/archives/${btnDocx.dataset.id}/export/docx?token=${encodeURIComponent(state.token || '')}`;
                return;
            }

            const btnZip = e.target.closest('.btn-download-archive-zip');
            if (btnZip) {
                window.location.href = `/api/archives/${btnZip.dataset.id}/export/zip?token=${encodeURIComponent(state.token || '')}`;
                return;
            }

            const btnEdit = e.target.closest('.btn-edit-archive-quick');
            if (btnEdit) {
                openEditArchiveModal(btnEdit.dataset.id);
                return;
            }

            const btnDelete = e.target.closest('.btn-delete-archive-quick');
            if (btnDelete) {
                const archiveId = btnDelete.dataset.id;
                if (confirm('Are you sure you want to permanently delete this meeting archive? All recorded assets and audio will be removed.')) {
                    try {
                        await api.deleteArchive(archiveId);
                        showToast('Meeting archive deleted');
                        await loadData();
                    } catch (error) {
                        showToast(error.message || 'Failed to delete archive', true);
                    }
                }
                return;
            }

            // Card body click
            const card = e.target.closest('.archive-card');
            if (card && !e.target.closest('button') && !e.target.closest('a')) {
                openArchiveDossier(card.dataset.archiveId);
            }
        });
    }

    // Archive Search & Filters
    if (els.archiveSearchInput) {
        els.archiveSearchInput.addEventListener('input', (e) => {
            state.archiveFilters.search = e.target.value;
            renderArchives();
        });
    }

    if (els.archiveFilterChips) {
        els.archiveFilterChips.addEventListener('click', (e) => {
            const chip = e.target.closest('.tag-filter-chip');
            if (!chip) return;
            state.archiveFilters.filter = chip.dataset.filter;
            els.archiveFilterChips.querySelectorAll('.tag-filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderArchives();
        });
    }

    if (els.sortArchives) {
        els.sortArchives.addEventListener('change', (e) => {
            state.archiveFilters.sort = e.target.value;
            renderArchives();
        });
    }
}

// ── Start ──
init();
initArchivesModule();
