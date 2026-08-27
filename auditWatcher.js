// ─────────────────────────────────────────────────────────────────────────────
// SGB Functionality Audit 2026 — Resilient File-System Folder Watcher Daemon
// Monitors the 16 SGB Audit subfolders. When a core source Word document
// (named in ALL CAPS without numbers at the start) is dropped or modified,
// automatically regenerates all 7 supporting documents and PDF conversions.
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { fileURLToPath } from 'url';
import { AUDIT_BASE_DIR, SGB_AUDIT_REGISTRY, generateEvidencePack } from './auditEvidenceGenerator.js';
export { AUDIT_BASE_DIR };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let watcherInstance = null;
let pollingInterval = null;
let isProcessing = false;
const debounceTimers = new Map(); // folderPath -> timer

// Helper to determine if a filename represents a core source document
export function isCoreSourceDoc(filename) {
  if (!filename) return false;
  const basename = path.basename(filename);
  if (!basename.toLowerCase().endsWith('.docx')) return false;
  if (basename.startsWith('~')) return false; // Ignore Office temporary & lock files (~$, ~*.tmp, etc.)
  if (/^\d{2}_/.test(basename)) return false; // Ignore generated files like 01_*, 02_*, etc.
  if (/^\d+/.test(basename)) return false; // Ignore any files starting with digits

  const titleOnly = basename.replace(/\.docx$/i, '').trim();
  // Must be ALL CAPS and contain at least one letter
  const isAllCaps = titleOnly === titleOnly.toUpperCase() && /[A-Z]/.test(titleOnly);
  return isAllCaps;
}

// Find the core source doc in a given folder, if any
export function findCoreSourceDocInFolder(folderPath) {
  if (!fsSync.existsSync(folderPath)) return null;
  const files = fsSync.readdirSync(folderPath);
  for (const f of files) {
    if (isCoreSourceDoc(f)) {
      return path.join(folderPath, f);
    }
  }
  return null;
}

// Check if a folder needs generation or regeneration:
// 1. If any of the 7 supporting docs or source pdf are missing.
// 2. OR if the source doc was modified MORE RECENTLY than the generated files!
export function doesFolderNeedRegeneration(folderPath, sourceDocPath) {
  if (!sourceDocPath || !fsSync.existsSync(sourceDocPath)) return false;

  let sourceStat;
  try {
    sourceStat = fsSync.statSync(sourceDocPath);
  } catch (e) {
    return false;
  }
  const sourceMtime = sourceStat.mtimeMs;

  // 1. Source PDF check
  const sourcePdfPath = sourceDocPath.replace(/\.docx$/i, '.pdf');
  if (!fsSync.existsSync(sourcePdfPath)) return true;
  try {
    const pdfStat = fsSync.statSync(sourcePdfPath);
    if (pdfStat.size < 1000 || pdfStat.mtimeMs < sourceMtime - 1000) {
      return true;
    }
  } catch (e) {
    return true;
  }

  // 2. 7 supporting docs check (both docx and pdf, and must be newer than sourceDoc)
  let files;
  try {
    files = fsSync.readdirSync(folderPath);
  } catch (e) {
    return false;
  }

  for (let i = 1; i <= 7; i++) {
    const prefix = `0${i}_`;
    const docxFile = files.find(f => f.startsWith(prefix) && f.endsWith('.docx') && !f.startsWith('~'));
    const pdfFile = files.find(f => f.startsWith(prefix) && f.endsWith('.pdf'));
    if (!docxFile || !pdfFile) {
      return true;
    }

    try {
      const docxStat = fsSync.statSync(path.join(folderPath, docxFile));
      const itemPdfStat = fsSync.statSync(path.join(folderPath, pdfFile));
      if (docxStat.size < 1000 || docxStat.mtimeMs < sourceMtime - 1000) {
        return true;
      }
      if (itemPdfStat.size < 1000 || itemPdfStat.mtimeMs < sourceMtime - 1000) {
        return true;
      }
    } catch (e) {
      return true;
    }
  }

  return false;
}

// Backward compatibility alias
export const isFolderMissingEvidence = doesFolderNeedRegeneration;

// Trigger generation with file stability check
async function handleSourceDocTrigger(folderPath, sourceDocPath) {
  if (isProcessing) {
    console.log(`[Audit Watcher] Generation already in progress, queuing check...`);
    return;
  }

  const folderName = path.basename(folderPath);
  console.log(`[Audit Watcher] Detected source doc change in "${folderName}": ${path.basename(sourceDocPath)}`);

  // Wait for file lock / completion (Word takes time to flush and close)
  let attempts = 0;
  while (attempts < 5) {
    try {
      const handle = await fs.open(sourceDocPath, 'r');
      await handle.close();
      break;
    } catch (e) {
      attempts++;
      console.log(`[Audit Watcher] File locked by Word/editor, waiting... (attempt ${attempts}/5)`);
      await new Promise(res => setTimeout(res, 1000));
    }
  }

  try {
    isProcessing = true;
    await generateEvidencePack(folderPath, sourceDocPath);
  } catch (err) {
    console.error(`[Audit Watcher] Error generating evidence for ${folderName}:`, err.message);
  } finally {
    isProcessing = false;
  }
}

// Scan all 16 audit folders and regenerate any outdated or incomplete packs
export async function scanAndSyncAllFolders() {
  console.log('[Audit Watcher] Scanning SGB Functionality Audit folders for outdated or missing evidence packs...');
  if (!fsSync.existsSync(AUDIT_BASE_DIR)) {
    console.warn(`[Audit Watcher] Audit directory not found: ${AUDIT_BASE_DIR}`);
    return;
  }

  const entries = fsSync.readdirSync(AUDIT_BASE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && /^\d{2}_/.test(entry.name) && entry.name !== '00_Sources') {
      const folderPath = path.join(AUDIT_BASE_DIR, entry.name);
      const sourceDocPath = findCoreSourceDocInFolder(folderPath);
      if (sourceDocPath) {
        const needsGeneration = doesFolderNeedRegeneration(folderPath, sourceDocPath);
        if (needsGeneration) {
          console.log(`[Audit Watcher] Folder "${entry.name}" source doc "${path.basename(sourceDocPath)}" was updated or missing evidence. Regenerating now...`);
          try {
            await handleSourceDocTrigger(folderPath, sourceDocPath);
          } catch (err) {
            console.error(`[Audit Watcher] Failed to generate for ${entry.name}:`, err.message);
          }
        }
      }
    }
  }
  console.log('[Audit Watcher] Audit folder scan and sync complete.');
}

// Start watching the audit folder recursively with hybrid polling safety net
export function startAuditWatcher() {
  if (watcherInstance) {
    console.log('[Audit Watcher] Watcher already running.');
    return;
  }

  if (!fsSync.existsSync(AUDIT_BASE_DIR)) {
    console.warn(`[Audit Watcher] Audit base directory does not exist: ${AUDIT_BASE_DIR}`);
    return;
  }

  console.log(`[Audit Watcher] Initializing watch on: ${AUDIT_BASE_DIR}`);

  try {
    // 1. Real-time fs.watch
    watcherInstance = fsSync.watch(AUDIT_BASE_DIR, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      const cleanRelPath = filename.replace(/\\/g, '/');
      const parts = cleanRelPath.split('/');
      const subfolder = parts[0];
      if (!/^\d{2}_/.test(subfolder) || subfolder === '00_Sources') return;

      const folderPath = path.join(AUDIT_BASE_DIR, subfolder);
      const sourceDocPath = findCoreSourceDocInFolder(folderPath);
      if (!sourceDocPath) return;

      // Debounce folder triggers to allow Word to finish writing
      if (debounceTimers.has(folderPath)) {
        clearTimeout(debounceTimers.get(folderPath));
      }

      const timer = setTimeout(async () => {
        debounceTimers.delete(folderPath);
        if (fsSync.existsSync(sourceDocPath)) {
          if (doesFolderNeedRegeneration(folderPath, sourceDocPath)) {
            await handleSourceDocTrigger(folderPath, sourceDocPath);
          }
        }
      }, 2000);

      debounceTimers.set(folderPath, timer);
    });

    watcherInstance.on('error', (err) => {
      console.error('[Audit Watcher] Watcher error:', err.message);
    });

    // 2. Periodic Polling Safety Net (every 4 seconds)
    // Ensures changes are NEVER missed even if Word locks, renames, or drops events
    pollingInterval = setInterval(async () => {
      if (isProcessing) return;
      try {
        const entries = fsSync.readdirSync(AUDIT_BASE_DIR, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && /^\d{2}_/.test(entry.name) && entry.name !== '00_Sources') {
            const folderPath = path.join(AUDIT_BASE_DIR, entry.name);
            const sourceDocPath = findCoreSourceDocInFolder(folderPath);
            if (sourceDocPath && doesFolderNeedRegeneration(folderPath, sourceDocPath)) {
              console.log(`[Audit Watcher Poller] Detected modified source doc in "${entry.name}". Regenerating...`);
              await handleSourceDocTrigger(folderPath, sourceDocPath);
            }
          }
        }
      } catch (pollErr) {
        // Silently continue
      }
    }, 4000);

    console.log('[Audit Watcher] Active and monitoring 16 SGB audit subfolders (Realtime + Poller).');

    // Run initial scan in background
    scanAndSyncAllFolders().catch(err => {
      console.error('[Audit Watcher] Startup scan error:', err.message);
    });
  } catch (err) {
    console.error('[Audit Watcher] Failed to initialize watcher:', err.message);
  }
}

// Stop watcher
export function stopAuditWatcher() {
  if (watcherInstance) {
    watcherInstance.close();
    watcherInstance = null;
  }
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  console.log('[Audit Watcher] Watcher stopped.');
}

// Check status
export function isAuditWatcherRunning() {
  return watcherInstance !== null || pollingInterval !== null;
}

// Direct execution from CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  console.log('───────────────────────────────────────────────────');
  console.log(' SGB Functionality Audit 2026 — Folder Watcher CLI');
  console.log('───────────────────────────────────────────────────');
  startAuditWatcher();

  // Keep process running
  process.on('SIGINT', () => {
    console.log('\nStopping audit watcher...');
    stopAuditWatcher();
    process.exit(0);
  });
}
