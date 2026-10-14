import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';

export const AI_LIVE_RECEIPT_SOURCE_COUNT = 6;
export const AI_LIVE_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const AI_LIVE_RECEIPT_TICKET_COUNT = 4;
export const AI_LIVE_RECEIPT_COMPLETION_BUDGET = 8;
export const AI_LIVE_RECEIPT_UNSUBMITTED_ONLY_SELECTION = 'unsubmitted-only';
export const AI_LIVE_RECEIPT_UNSUBMITTED_TICKET_COUNT = 2;
export const AI_LIVE_RECEIPT_UNSUBMITTED_COMPLETION_BUDGET = 4;
export const AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION = 'long-ticket-only';
export const AI_LIVE_RECEIPT_LONG_TICKET_ONLY_TICKET_COUNT = 1;
export const AI_LIVE_RECEIPT_LONG_TICKET_ONLY_COMPLETION_BUDGET = 1;
export const AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_SELECTION = 'preferred-jpeg-only';
export const AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_TICKET_COUNT = 1;
export const AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_COMPLETION_BUDGET = 2;

const NAME_COLLATOR = new Intl.Collator('es-ES', { numeric: true, sensitivity: 'base' });

/** Load six local source files as four in-memory receipt inputs, never returning original names. */
export async function loadAiLiveReceiptPlan({
  directory,
  preferredJpegOrdinal,
  selection = 'all',
  readFileImpl = readFile
} = {}) {
  if (
    ![
      'all',
      AI_LIVE_RECEIPT_UNSUBMITTED_ONLY_SELECTION,
      AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION,
      AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_SELECTION
    ].includes(selection)
  ) {
    throw new Error('The receipt selection is invalid.');
  }
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new Error('A local absolute ticket directory is required.');
  }

  let root;
  let entries;
  try {
    const suppliedRootStats = await lstat(directory);
    if (!suppliedRootStats.isDirectory() || suppliedRootStats.isSymbolicLink()) {
      throw new Error('not-a-direct-directory');
    }
    root = await realpath(directory);
    const rootStats = await lstat(root);
    if (!rootStats.isDirectory()) throw new Error('not-a-directory');
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    throw new Error('The local ticket directory is unavailable.');
  }

  if (
    entries.length !== AI_LIVE_RECEIPT_SOURCE_COUNT ||
    entries.some(
      (entry) =>
        !entry.isFile() || !['.pdf', '.jpg', '.jpeg'].includes(extname(entry.name).toLowerCase())
    )
  ) {
    throw new Error('The ticket directory must contain exactly six regular PDF/JPEG files.');
  }

  const compareNames = (left, right) =>
    NAME_COLLATOR.compare(left.name, right.name) ||
    (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const pdfEntries = entries
    .filter((entry) => extname(entry.name).toLowerCase() === '.pdf')
    .sort(compareNames);
  const jpegEntries = entries
    .filter((entry) => ['.jpg', '.jpeg'].includes(extname(entry.name).toLowerCase()))
    .sort(compareNames);
  if (pdfEntries.length !== 2 || jpegEntries.length !== 4) {
    throw new Error('The ticket directory must contain two PDFs and four JPEGs.');
  }
  if (
    !Number.isSafeInteger(preferredJpegOrdinal) ||
    preferredJpegOrdinal < 1 ||
    preferredJpegOrdinal > jpegEntries.length
  ) {
    throw new Error('The preferred JPEG must be selected by its sorted 1-based index.');
  }

  if (selection === AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_SELECTION) {
    const preferredJpeg = await readVerifiedFile(
      root,
      jpegEntries[preferredJpegOrdinal - 1].name,
      'jpeg',
      readFileImpl
    );
    return Object.freeze({
      sourceCount: AI_LIVE_RECEIPT_SOURCE_COUNT,
      ticketCount: AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_TICKET_COUNT,
      selection,
      tickets: Object.freeze([makeTicket(preferredJpeg, 'jpeg', 1)])
    });
  }

  const longTicketEntries = jpegEntries.filter((_, index) => index !== preferredJpegOrdinal - 1);
  const [bestJpeg, longTicketJpegs] = await Promise.all([
    selection === AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION
      ? Promise.resolve(undefined)
      : readVerifiedFile(root, jpegEntries[preferredJpegOrdinal - 1].name, 'jpeg', readFileImpl),
    Promise.all(
      longTicketEntries.map((entry) => readVerifiedFile(root, entry.name, 'jpeg', readFileImpl))
    )
  ]);
  const longTicketPdf = buildMultiPageJpegPdf(longTicketJpegs);
  if (longTicketPdf.byteLength > AI_LIVE_RECEIPT_MAX_BYTES) {
    throw new Error('The in-memory multi-page ticket exceeds the 10 MiB upload limit.');
  }

  if (selection === AI_LIVE_RECEIPT_UNSUBMITTED_ONLY_SELECTION) {
    if (bestJpeg === undefined) throw new Error('The preferred JPEG was not loaded.');
    return Object.freeze({
      sourceCount: AI_LIVE_RECEIPT_SOURCE_COUNT,
      ticketCount: AI_LIVE_RECEIPT_UNSUBMITTED_TICKET_COUNT,
      selection,
      tickets: Object.freeze([
        makeTicket(bestJpeg, 'jpeg', 1),
        makeTicket(longTicketPdf, 'pdf', longTicketJpegs.length, longTicketJpegs.length)
      ])
    });
  }

  if (selection === AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION) {
    return Object.freeze({
      sourceCount: AI_LIVE_RECEIPT_SOURCE_COUNT,
      ticketCount: AI_LIVE_RECEIPT_LONG_TICKET_ONLY_TICKET_COUNT,
      selection,
      tickets: Object.freeze([
        makeTicket(longTicketPdf, 'pdf', longTicketJpegs.length, longTicketJpegs.length)
      ])
    });
  }

  if (bestJpeg === undefined) throw new Error('The preferred JPEG was not loaded.');

  const pdfs = await Promise.all(
    pdfEntries.map((entry) => readVerifiedFile(root, entry.name, 'pdf', readFileImpl))
  );

  return Object.freeze({
    sourceCount: AI_LIVE_RECEIPT_SOURCE_COUNT,
    ticketCount: AI_LIVE_RECEIPT_TICKET_COUNT,
    selection,
    tickets: Object.freeze([
      ...pdfs.map((buffer) => makeTicket(buffer, 'pdf', 1, null)),
      makeTicket(bestJpeg, 'jpeg', 1),
      makeTicket(longTicketPdf, 'pdf', longTicketJpegs.length, longTicketJpegs.length)
    ])
  });
}

async function readVerifiedFile(root, name, expectedKind, readFileImpl) {
  let buffer;
  try {
    const filePath = join(root, name);
    const stats = await lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('not-a-file');
    if (stats.size <= 0 || stats.size > AI_LIVE_RECEIPT_MAX_BYTES) {
      throw new Error('invalid-size');
    }
    buffer = await readFileImpl(filePath);
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid-size') {
      throw new Error('A ticket file is empty or exceeds the 10 MiB limit.');
    }
    throw new Error('A ticket file could not be safely read.');
  }

  const signatureMatches =
    expectedKind === 'pdf'
      ? buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-'
      : buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!signatureMatches) {
    throw new Error('A ticket file extension does not match its signature.');
  }
  return buffer;
}

function makeTicket(buffer, kind, sourceFileCount, pageCount = 1) {
  return Object.freeze({
    kind,
    mimeType: kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
    pageCount,
    sourceFileCount,
    buffer
  });
}

function buildMultiPageJpegPdf(jpegs) {
  const dimensions = jpegs.map(getJpegDimensions);
  const objects = new Map();
  const pageIds = jpegs.map((_, index) => 3 + index * 3);
  objects.set(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii'));
  objects.set(
    2,
    Buffer.from(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${jpegs.length} >>`,
      'ascii'
    )
  );

  for (const [index, jpeg] of jpegs.entries()) {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const size = fitPdfPage(dimensions[index]);
    const colorSpace =
      dimensions[index].components === 1
        ? 'DeviceGray'
        : dimensions[index].components === 4
          ? 'DeviceCMYK'
          : 'DeviceRGB';
    objects.set(
      pageId,
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.width} ${size.height}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
        'ascii'
      )
    );
    const content = Buffer.from(`q\n${size.width} 0 0 ${size.height} 0 0 cm\n/Im0 Do\nQ`, 'ascii');
    objects.set(
      contentId,
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'ascii'),
        content,
        Buffer.from('\nendstream', 'ascii')
      ])
    );
    objects.set(
      imageId,
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${dimensions[index].width} /Height ${dimensions[index].height} /ColorSpace /${colorSpace} /BitsPerComponent ${dimensions[index].precision} /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
          'ascii'
        ),
        jpeg,
        Buffer.from('\nendstream', 'ascii')
      ])
    );
  }

  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary');
  const chunks = [header];
  const offsets = [0];
  let currentOffset = header.length;
  const objectCount = objects.size;
  for (let objectId = 1; objectId <= objectCount; objectId += 1) {
    const object = objects.get(objectId);
    if (!object) throw new Error('The multi-page PDF could not be assembled.');
    const prefix = Buffer.from(`${objectId} 0 obj\n`, 'ascii');
    const suffix = Buffer.from('\nendobj\n', 'ascii');
    offsets[objectId] = currentOffset;
    chunks.push(prefix, object, suffix);
    currentOffset += prefix.length + object.length + suffix.length;
  }

  const xrefOffset = currentOffset;
  const xref = [
    `xref\n0 ${objectCount + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  ].join('');
  chunks.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(chunks);
}

function getJpegDimensions(buffer) {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (isStartOfFrame(marker) && segmentLength >= 8) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      const components = buffer[offset + 7];
      const precision = buffer[offset + 2];
      if (!width || !height || ![1, 3, 4].includes(components) || ![8, 12].includes(precision))
        break;
      return { width, height, components, precision };
    }
    offset += segmentLength;
  }
  throw new Error('A JPEG segment has no supported image dimensions.');
}

function isStartOfFrame(marker) {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
    marker
  );
}

function fitPdfPage({ width, height }) {
  const pageWidth = Math.min(width, 595);
  return {
    width: pageWidth.toFixed(2),
    height: ((height * pageWidth) / width).toFixed(2)
  };
}
