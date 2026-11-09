'use strict';

/**
 * PowerPoint (and friends) → PDF, via LibreOffice headless.
 *
 * The PDF is NOT stored. It goes straight back to the browser, which already knows how to turn a
 * PDF into one image per page plus a folder and a playlist (frontend/js/components/pdf-pages.js).
 * So this module adds exactly one step in front of the existing PDF import and nothing else: no
 * new content type, no new player code, no new storage path.
 *
 * Enabled when a LibreOffice binary is present, unless OFFICE_CONVERT=false. Set OFFICE_CONVERT=true
 * to fail loudly at request time if the binary is missing instead of silently reporting "disabled".
 * SOFFICE_PATH overrides the binary; OFFICE_CONVERT_TIMEOUT_MS the per-file budget (default 180 s).
 *
 * ⚠️ One conversion at a time. LibreOffice is memory hungry (a large deck can take 500 MB+), and
 * a small signage box should not fall over because three people dropped decks at once. Further
 * requests wait in a short queue; past MAX_QUEUE they are refused with 503 rather than piling up.
 *
 * ⚠️ Each run gets its OWN user profile directory. Two soffice processes sharing a profile do not
 * run in parallel — the second one silently hands its job to the first and exits 0 without output.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/** Extensions offered for conversion. */
const OFFICE_EXTS = ['pptx', 'ppt', 'ppsx', 'pps', 'pptm', 'potx', 'odp'];

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);                       // pptx, ppsx, odp, ...
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // legacy .ppt / .pps

const MAX_QUEUE = 5;

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

function isOfficeName(name) { return OFFICE_EXTS.includes(extOf(name)); }

/** True when the first bytes are a ZIP or OLE container — what every accepted format is. */
function looksLikeOffice(head) {
  if (!Buffer.isBuffer(head)) return false;
  return (head.length >= 4 && head.subarray(0, 4).equals(ZIP_MAGIC))
      || (head.length >= 8 && head.subarray(0, 8).equals(OLE_MAGIC));
}

const CANDIDATES = ['/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice', '/usr/local/bin/soffice',
  '/opt/libreoffice/program/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'];

let cachedBinary;
function findBinary() {
  if (cachedBinary !== undefined) return cachedBinary;
  const explicit = process.env.SOFFICE_PATH;
  const list = explicit ? [explicit] : CANDIDATES;
  cachedBinary = list.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch (_) { return false; } }) || null;
  return cachedBinary;
}

/** { enabled, binary, reason } — what the route and the status endpoint report. */
function status() {
  const flag = String(process.env.OFFICE_CONVERT || '').toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return { enabled: false, binary: null, reason: 'disabled by OFFICE_CONVERT=false' };
  const binary = findBinary();
  if (!binary) return { enabled: false, binary: null, reason: 'LibreOffice (soffice) is not installed on this server' };
  return { enabled: true, binary, reason: null };
}

function timeoutMs() {
  const n = Number(process.env.OFFICE_CONVERT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 180000;
}

/* ---------------------------------------------------------------- one-at-a-time queue */
let busy = false;
const waiting = [];
function acquire() {
  if (!busy) { busy = true; return Promise.resolve(); }
  if (waiting.length >= MAX_QUEUE) {
    const err = new Error('The server is busy converting other presentations. Try again in a minute.');
    err.status = 503;
    return Promise.reject(err);
  }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else busy = false;
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* best effort */ } }

/**
 * Convert one file to PDF.
 *
 * @param {string} inputPath   the uploaded file (left in place; the caller removes it)
 * @param {string} originalName used only for its extension, so soffice picks the right filter
 * @returns {Promise<{ pdfPath: string, cleanup: () => void }>}
 */
async function convertToPdf(inputPath, originalName) {
  const st = status();
  if (!st.enabled) {
    const err = new Error(`PowerPoint conversion is not available: ${st.reason}.`);
    err.status = 501;
    throw err;
  }
  const ext = extOf(originalName);
  if (!OFFICE_EXTS.includes(ext)) {
    const err = new Error(`Unsupported presentation type ".${ext}".`);
    err.status = 400;
    throw err;
  }

  await acquire();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'st-office-'));
  const cleanup = () => rmrf(work);
  try {
    // A fixed, harmless name: the user's filename never reaches the command line.
    const src = path.join(work, `deck.${ext}`);
    fs.copyFileSync(inputPath, src);
    const profile = path.join(work, 'profile');
    const outDir = path.join(work, 'out');
    fs.mkdirSync(outDir);

    await new Promise((resolve, reject) => {
      const child = spawn(st.binary, [
        `-env:UserInstallation=file://${profile}`,
        '--headless', '--invisible', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore', '--nolockcheck',
        '--convert-to', 'pdf:impress_pdf_Export',
        '--outdir', outDir,
        src,
      ], {
        cwd: work,
        env: { ...process.env, HOME: work, TMPDIR: work },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
      let stderr = '';
      child.stdout.on('data', () => {});
      child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d.toString(); });
      const timer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { try { child.kill('SIGKILL'); } catch (__) { /* gone */ } }
        const err = new Error('Converting the presentation took too long and was stopped.');
        err.status = 504;
        reject(err);
      }, timeoutMs());
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else {
          const err = new Error(`LibreOffice could not convert the presentation (exit ${code}).`);
          err.status = 422;
          err.detail = stderr.trim();
          reject(err);
        }
      });
    });

    const pdfPath = path.join(outDir, 'deck.pdf');
    let size = 0;
    try { size = fs.statSync(pdfPath).size; } catch (_) { size = 0; }
    if (!size) {
      const err = new Error('LibreOffice produced no PDF. The file may be damaged, password-protected, or not a presentation.');
      err.status = 422;
      throw err;
    }
    return { pdfPath, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  } finally {
    release();
  }
}

module.exports = { OFFICE_EXTS, isOfficeName, looksLikeOffice, status, convertToPdf, extOf, _resetForTests: () => { cachedBinary = undefined; } };
