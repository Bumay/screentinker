'use strict';

/* PowerPoint → PDF (lib/office-convert.js), the fork's one server-side document step.
 *
 * The PDF is handed back, never stored: the dashboard imports it with the existing client-side PDF
 * path, so the content allowlist (lib/upload-sniff.js) stays exactly as strict as upstream. The
 * conversion test itself needs LibreOffice and is skipped where it is not installed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const oc = require('../lib/office-convert');

test('extensions and magic bytes', () => {
  assert.ok(oc.isOfficeName('Lobby deck.PPTX'));
  assert.ok(oc.isOfficeName('a.odp'));
  assert.ok(!oc.isOfficeName('a.pdf'));
  assert.ok(!oc.isOfficeName('pptx'));
  assert.ok(oc.looksLikeOffice(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])));
  assert.ok(oc.looksLikeOffice(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])));
  assert.ok(!oc.looksLikeOffice(Buffer.from('%PDF-1.7')));
  assert.ok(!oc.looksLikeOffice(null));
});

test('OFFICE_CONVERT=false switches it off', () => {
  const prev = process.env.OFFICE_CONVERT;
  process.env.OFFICE_CONVERT = 'false';
  try {
    assert.equal(oc.status().enabled, false);
  } finally {
    if (prev === undefined) delete process.env.OFFICE_CONVERT; else process.env.OFFICE_CONVERT = prev;
  }
});

test('the content allowlist still does not take presentations', () => {
  const sniff = fs.readFileSync(path.join(__dirname, '..', 'lib', 'upload-sniff.js'), 'utf8');
  assert.doesNotMatch(sniff, /presentationml|\.pptx/);
});

test('the dashboard routes presentations through the PDF importer', () => {
  const root = path.join(__dirname, '..', '..', 'frontend', 'js');
  const lib = fs.readFileSync(path.join(root, 'views', 'content-library.js'), 'utf8');
  assert.match(lib, /setPdfImporter\(importDocument\)/);
  assert.match(lib, /convertOfficeToPdf/);
  const queue = fs.readFileSync(path.join(root, 'components', 'library', 'upload-queue.js'), 'utf8');
  assert.match(queue, /isPdf\(file\) \|\| isOffice\(file\)/);
  const en = fs.readFileSync(path.join(root, 'i18n', 'en.js'), 'utf8');
  for (const k of ['content.office.uploading', 'content.office.converting']) assert.ok(en.includes(`'${k}'`), k);
});

/** A minimal, valid single-slide .odp written by hand (stored zip, no deflate needed by LibreOffice). */
function minimalOdp(file) {
  const entries = [
    ['mimetype', 'application/vnd.oasis.opendocument.presentation'],
    ['META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.presentation"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>'],
    ['content.xml', '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2"><office:body><office:presentation><draw:page draw:name="p1"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>Hallo Bildschirm</text:p></draw:text-box></draw:frame></draw:page><draw:page draw:name="p2"/></office:presentation></office:body></office:document-content>'],
  ];
  const parts = []; const central = []; let offset = 0;
  for (const [name, body] of entries) {
    const data = Buffer.from(body); const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, end]));
}

test('converts a presentation to a PDF and leaves nothing behind', { skip: !oc.status().enabled && 'LibreOffice not installed', timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-office-test-'));
  try {
    const src = path.join(dir, 'deck.odp');
    minimalOdp(src);
    const { pdfPath, cleanup } = await oc.convertToPdf(src, 'Begrüßung.odp');
    const pdf = fs.readFileSync(pdfPath);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.toString('latin1'), /\/Count 2\b/, 'two slides → two pages');
    const work = path.dirname(path.dirname(pdfPath));
    cleanup();
    assert.ok(!fs.existsSync(work), 'work directory removed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a file that is not a presentation is refused, not crashed on', { skip: !oc.status().enabled && 'LibreOffice not installed', timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-office-test-'));
  try {
    const src = path.join(dir, 'x.pptx');
    fs.writeFileSync(src, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200)]));
    await assert.rejects(oc.convertToPdf(src, 'x.pptx'), (e) => e.status === 422 || e.status === 504);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
