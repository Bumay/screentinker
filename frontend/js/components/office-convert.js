/**
 * PowerPoint → PDF on the server (server/lib/office-convert.js), then the ordinary PDF import.
 *
 * The browser cannot render a .pptx faithfully, so this one step happens server-side with
 * LibreOffice. What comes back is a PDF File that goes through pdf-pages.js exactly like a PDF the
 * user dropped in — same folder, same playlist, same page images.
 */

import { getAuthHeaders } from '../api.js';

export const OFFICE_EXTS = ['pptx', 'ppt', 'ppsx', 'pps', 'pptm', 'potx', 'odp'];

/** The `accept` fragment for file inputs. */
export const OFFICE_ACCEPT = OFFICE_EXTS.map((e) => '.' + e).join(',');

export function isOffice(file) {
  const m = /\.([a-z0-9]+)$/i.exec((file && file.name) || '');
  return !!m && OFFICE_EXTS.includes(m[1].toLowerCase());
}

/** `Lobby deck.pptx` → `Lobby deck.pdf`, so baseName() downstream yields `Lobby deck`. */
export function pdfNameFor(name) {
  return String(name || 'presentation').replace(/\.[a-z0-9]+$/i, '') + '.pdf';
}

/**
 * Upload one presentation and get its PDF back.
 *
 * @param {File} file
 * @param {(phase:'upload'|'convert', pct:number)=>void} [onProgress]
 * @returns {Promise<File>} the PDF
 */
export function convertOfficeToPdf(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/content/convert-office');
    const headers = getAuthHeaders() || {};
    for (const [k, v] of Object.entries(headers)) if (v != null) xhr.setRequestHeader(k, v);
    xhr.responseType = 'blob';
    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      onProgress(pct >= 100 ? 'convert' : 'upload', pct);
    };
    xhr.upload.onload = () => { if (onProgress) onProgress('convert', 100); };
    xhr.onerror = () => reject(new Error('Network error while converting the presentation.'));
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(new File([xhr.response], pdfNameFor(file.name), { type: 'application/pdf' }));
        return;
      }
      let msg = `Conversion failed (HTTP ${xhr.status}).`;
      try {
        const body = JSON.parse(await xhr.response.text());
        if (body && body.error) msg = body.error;
      } catch (_) { /* not JSON */ }
      reject(new Error(msg));
    };
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}
