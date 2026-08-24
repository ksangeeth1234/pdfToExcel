import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const dropZone = $('dropZone');
const fileInput = $('fileInput');
let workbookData = null;

$('chooseButton').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => fileInput.files.length && processPdfs(Array.from(fileInput.files)));

['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
dropZone.addEventListener('drop', (e) => { const files = Array.from(e.dataTransfer.files); if (files.length) processPdfs(files); });
$('newFileButton').addEventListener('click', () => fileInput.click());
$('downloadButton').addEventListener('click', downloadWorkbook);

// ─── Progress helper ────────────────────────────────────────────────────────
function setProgress(value, detail, label = 'Reading document') {
  $('progressPanel').classList.remove('hidden');
  $('progressBar').style.width = `${value}%`;
  $('progressValue').textContent = `${Math.round(value)}%`;
  $('progressLabel').textContent = label;
  $('progressDetail').textContent = detail;
}

// ─── Main entry ─────────────────────────────────────────────────────────────
async function processPdfs(files) {
  const previousData = workbookData;
  reset(false);
  if (files.some((f) => f.type !== 'application/pdf')) return showError('Please choose PDF files only.');
  try {
    setProgress(4, 'Loading PDF pages…');
    const pages = [];
    for (let fi = 0; fi < files.length; fi++) {
      const pdf = await pdfjsLib.getDocument({ data: await files[fi].arrayBuffer() }).promise;
      for (let pn = 1; pn <= pdf.numPages; pn++) {
        const prog = ((fi + pn / pdf.numPages) / files.length) * 70;
        setProgress(prog, `PDF ${fi + 1}/${files.length} · page ${pn}/${pdf.numPages}`);
        pages.push({ lines: await readPage(await pdf.getPage(pn)), fileIndex: fi });
      }
    }
    setProgress(82, 'Detecting tables and programme titles…', 'Organising');
    const newData = buildTables(pages, previousData ? previousData.tables.length : 0);
    if (!newData.tables.length) throw new Error('No tables found. The PDF may not contain selectable text.');
    workbookData = previousData
      ? { headers: previousData.headers, tables: [...previousData.tables, ...newData.tables] }
      : newData;
    setProgress(100, `${workbookData.tables.length} table(s) ready.`, 'Complete');
    renderResult(workbookData, files.length === 1 ? files[0].name : `Combined ${files.length} PDFs`);
  } catch (err) {
    showError(err.message || 'The PDF could not be processed.');
  }
}

// ─── Page reader ─────────────────────────────────────────────────────────────
async function readPage(page) {
  const content = await page.getTextContent();
  // resolve fonts so commonObjs.get() works
  try { await page.getOperatorList(); } catch (_) {}

  const fontCache = {};
  const raw = content.items.filter((it) => it.str && it.str.trim()).map((it) => {
    let italic = false;
    let bold = false;
    const fn = it.fontName;
    if (fn) {
      if (fontCache[fn]) {
        italic = fontCache[fn].italic;
        bold   = fontCache[fn].bold;
      } else {
        try {
          const fo = page.commonObjs.get(fn);
          if (fo && fo.name) {
            const n = fo.name.toLowerCase();
            italic = n.includes('italic') || n.includes('oblique') || !!(fo.cssFontInfo && fo.cssFontInfo.italic);
            bold   = n.includes('bold')   || n.includes('black')   || n.includes('heavy') || !!(fo.cssFontInfo && fo.cssFontInfo.bold);
          }
        } catch (_) {}
        fontCache[fn] = { italic, bold };
      }
    }
    return { text: it.str.trim(), x: it.transform[4], y: it.transform[5], italic, bold };
  });

  // group into visual lines (y-tolerance 3pt)
  const lines = [];
  raw.sort((a, b) => b.y - a.y || a.x - b.x).forEach((it) => {
    let ln = lines.find((l) => Math.abs(l.y - it.y) < 3);
    if (!ln) { ln = { y: it.y, items: [] }; lines.push(ln); }
    ln.items.push(it);
  });
  lines.forEach((ln) => {
    ln.items.sort((a, b) => a.x - b.x);
    ln.text = ln.items.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim();
  });
  return lines.sort((a, b) => b.y - a.y);
}

// ─── Constants ───────────────────────────────────────────────────────────────
const HEADERS = ['Reg No','Centre Ref','First Name','Last Name','Sex','DOB','ULN','Est Comp Date','Award Date','Certification Award No','Award Code','Overall Result'];

// Fallback column x positions taken directly from the sample PDF header
const DEFAULT_COL_X = [44.34, 81.51, 126.93, 216.09, 301.30, 317.86, 351.83, 370.66, 412.84, 446.81, 496.77, 527.96];

const PALETTE = [
  { fill: '#E5F1FB', header: '#B9D9EE' },
  { fill: '#E3F4E8', header: '#B8E2C5' },
  { fill: '#FFF4CF', header: '#F3D77F' },
  { fill: '#FFEADF', header: '#F4BDA8' },
  { fill: '#EEE8F8', header: '#D1C1EC' },
  { fill: '#E2F2EF', header: '#B4DDD4' },
  { fill: '#F8E5EF', header: '#E8B9D0' },
  { fill: '#E9EDDA', header: '#CBD69D' },
  { fill: '#E6E5FB', header: '#C1C0EC' },
  { fill: '#F8E8D6', header: '#E7C493' },
];

// Words that appear as link/UI chrome in the last column – strip them
const STRIP_WORDS = /\b(details|exit|view selected|all)\b/gi;

// ─── Header detection ────────────────────────────────────────────────────────
function isHeaderLine(line) {
  const t = line.text.toLowerCase();
  return t.includes('reg no') || (t.includes('reg') && t.includes('centre'));
}

// ─── Title extraction ────────────────────────────────────────────────────────
function extractTitle(nearbyLines) {
  const allItems = nearbyLines.flatMap((l) => l.items);

  // Strategy 1: find the "Title" label item, then find the value item on the
  // row BELOW it (same x ± 5) – the PDF lays out Code/Title as column headers
  // on one y, then Code-value / Title-value on the next y.
  const titleLabelItem = allItems.find((it) => /^title$/i.test(it.text));
  if (titleLabelItem) {
    // Value is on a lower y (smaller number), at approximately the same x
    const valueItem = allItems.find(
      (it) =>
        it.y < titleLabelItem.y - 2 &&           // below the label
        Math.abs(it.x - titleLabelItem.x) < 8 && // same column
        !/^title$/i.test(it.text)                // not the label itself
    );
    if (valueItem) return valueItem.text;
  }

  // Strategy 2: "Title: VALUE" or "Title : VALUE" inline pattern
  for (const ln of nearbyLines) {
    const m = ln.text.match(/\bTitle\s*:\s*(.+)/i);
    if (m) return m[1].trim();
  }

  // Strategy 3: Programme Details → find "Code / Title" label row, then the
  // value row below it where the title value starts at x > 80 (after the code)
  const pdIdx = nearbyLines.findIndex((l) => /programme details/i.test(l.text));
  if (pdIdx >= 0) {
    // Scan lines after Programme Details
    for (let i = pdIdx + 1; i < nearbyLines.length; i++) {
      const ln = nearbyLines[i];
      // If this line has both a code-like short token AND a long title token,
      // the title token is the one with higher x (beyond column boundary ~80)
      const titleToken = ln.items.find((it) => it.x > 80 && it.text.length > 4 && !/^(code|title|no|date|ref|all)$/i.test(it.text));
      if (titleToken) return titleToken.text;
    }
  }

  return null;
}

// ─── Column position mapper ───────────────────────────────────────────────────
function detectColumnX(lines, headerY) {
  // Collect all items within ±15 y-pts of headerY (covers 3-line headers)
  const headerItems = lines
    .filter((l) => Math.abs(l.y - headerY) < 15)
    .flatMap((l) => l.items);

  const colX = Array(HEADERS.length).fill(null);

  // Heuristic mapping based on x-position proximity to defaults + keyword matching
  headerItems.forEach((it) => {
    const t = it.text.toLowerCase();
    const x = it.x;

    if (t === 'reg no' || t === 'reg')         { if (x < 100) colX[0] = x; }
    if (t === 'centre ref' || t === 'centre')   { colX[1] = x; }
    if (t === 'first name' || t === 'first')    { colX[2] = x; }
    if (t === 'last name' || t === 'last')      { colX[3] = x; }
    if (t === 'sex')                            { colX[4] = x; }
    if (t === 'dob')                            { colX[5] = x; }
    if (t === 'uln')                            { colX[6] = x; }
    if (t === 'est comp' || t === 'est')        { colX[7] = x; }
    if (t === 'certification')                  { colX[9] = x; }
    if (t === 'overall')                        { colX[11] = x; }

    // "Award" appears twice: once for "Award Date" (col 8) and once for "Award Code" (col 10)
    // Disambiguate by proximity to defaults
    if (t === 'award') {
      const d8  = Math.abs(x - DEFAULT_COL_X[8]);
      const d10 = Math.abs(x - DEFAULT_COL_X[10]);
      if (d8 <= d10) colX[8]  = x;
      else           colX[10] = x;
    }

    // "Code" belongs to col 10
    if (t === 'code') { colX[10] = x; }
    // "Result" belongs to col 11
    if (t === 'result') { colX[11] = x; }
    // "No" at cert position → col 9
    if (t === 'no' && x > 420 && x < 490) { colX[9] = x; }
    // "Date" can be award-date (col 8) or est-comp-date (col 7) – use proximity
    if (t === 'date') {
      const d7 = Math.abs(x - DEFAULT_COL_X[7]);
      const d8 = Math.abs(x - DEFAULT_COL_X[8]);
      if (d7 <= d8 && colX[7] === null) colX[7] = x;
      else if (colX[8] === null) colX[8] = x;
    }
  });

  // Fill remaining nulls from defaults
  colX.forEach((v, i) => { if (v === null) colX[i] = DEFAULT_COL_X[i]; });

  return colX;
}

// ─── Table builder ────────────────────────────────────────────────────────────
function buildTables(pages, colorOffset = 0) {
  const tables = [];
  let current = null;          // active table (persists across pages)
  let currentColorIdx = colorOffset;

  pages.forEach((pageData, pageIndex) => {
    const { lines, fileIndex } = pageData;
    const pageItems = lines.flatMap((l) => l.items);

    // Find every header line on this page
    const headerIndices = lines.reduce((acc, ln, idx) => {
      if (isHeaderLine(ln)) acc.push(idx);
      return acc;
    }, []);

    if (headerIndices.length > 0) {
      headerIndices.forEach((headerIdx, listIdx) => {
        const headerY      = lines[headerIdx].y;
        const nextHeaderY  = listIdx < headerIndices.length - 1 ? lines[headerIndices[listIdx + 1]].y : -Infinity;
        const sectionStart = listIdx === 0 ? 0 : headerIndices[listIdx - 1] + 1;
        const nearbyLines  = lines.slice(sectionStart, headerIdx);

        const title = extractTitle(nearbyLines) || (current ? current.title : 'Untitled Programme');
        const colX  = detectColumnX(lines, headerY);

        // Build midpoint boundaries between consecutive column starts
        const boundaries = [];
        for (let i = 0; i < colX.length - 1; i++) {
          boundaries.push((colX[i] + colX[i + 1]) / 2);
        }

        current = {
          title,
          boundaries,
          rows: [],
          colors: PALETTE[currentColorIdx % PALETTE.length],
          page: pageIndex + 1,
          fileIndex,
        };
        currentColorIdx++;
        tables.push(current);

        const anchors = pageItems
          .filter((it) => it.x >= colX[0] - 2 && it.x < boundaries[0] && it.y < headerY - 5 && it.y > nextHeaderY)
          .sort((a, b) => b.y - a.y);

        parseRows(anchors, pageItems, current, headerY - 5, nextHeaderY, pageIndex, colX[0]);
      });

    } else if (current) {
      // Continuation page – no header; reuse active table's boundaries
      const b0    = current.boundaries[0];
      const col0X = DEFAULT_COL_X[0];
      const anchors = pageItems
        .filter((it) => it.x >= col0X - 2 && it.x < b0)
        .sort((a, b) => b.y - a.y);

      const topY = anchors.length ? anchors[0].y + 15 : Infinity;
      parseRows(anchors, pageItems, current, topY, -Infinity, pageIndex, col0X);
    }
  });

  return {
    headers: ['Programme Title', ...HEADERS],
    tables: tables.filter((t) => t.rows.length > 0),
  };
}

// ─── Row parser ───────────────────────────────────────────────────────────────
function colIdx(x, boundaries) {
  for (let i = 0; i < boundaries.length; i++) if (x < boundaries[i]) return i;
  return boundaries.length; // last column
}

function parseRows(anchors, pageItems, tableObj, topY, bottomY, pageIndex, col0X) {
  const { boundaries } = tableObj;

  anchors.forEach((anchor, k) => {
    const upper = k === 0 ? topY : (anchors[k - 1].y + anchor.y) / 2;
    const lower = k === anchors.length - 1 ? bottomY : (anchor.y + anchors[k + 1].y) / 2;

    const cells = Array(HEADERS.length).fill('');
    let italic = false;
    let bold   = false;

    pageItems
      .filter((it) => it.y <= upper && it.y > lower && it.x >= col0X - 2)
      .forEach((it) => {
        const ci = colIdx(it.x, boundaries);
        if (ci < HEADERS.length) {
          cells[ci] = (`${cells[ci]} ${it.text}`).trim();
        }
        if (it.italic) italic = true;
        if (it.bold)   bold   = true;
      });

    // Strip UI chrome ("Details", "Exit", "View Selected") from last cell
    cells[HEADERS.length - 1] = cells[HEADERS.length - 1].replace(STRIP_WORDS, '').trim();

    // Require at least Reg No + 2 other fields to be a valid student row
    if (cells.filter((c) => c !== '').length >= 3) {
      tableObj.rows.push({ cells, italic: !!italic, bold: !!bold, page: pageIndex + 1 });
    }
  });
}

// ─── Preview renderer ─────────────────────────────────────────────────────────
function renderResult(data, filename) {
  $('resultPanel').classList.remove('hidden');
  $('resultTitle').textContent = filename.replace(/\.pdf$/i, '') + '.xlsx';

  const totalRows       = data.tables.reduce((s, t) => s + t.rows.length, 0);
  const italicTables    = data.tables.filter((t) => t.rows.some((r) => r.italic)).length;

  $('stats').innerHTML = `
    <div class="stat"><b>${data.tables.length}</b><span>tables found</span></div>
    <div class="stat"><b>${totalRows}</b><span>student rows</span></div>
    <div class="stat"><b>${italicTables}</b><span>tables with withdrawn rows</span></div>`;

  const previewRows = data.tables.flatMap((t) => t.rows.map((r) => ({ ...r, title: t.title, colors: t.colors })));

  $('previewTable').innerHTML =
    `<thead><tr>${data.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${previewRows.map((r) =>
      `<tr style="background:${r.colors.fill};${r.italic ? 'font-style:italic;font-weight:600;' : ''}">` +
      `${[r.title, ...r.cells].map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;

  $('previewNote').textContent = `${totalRows} student rows extracted. All rows will be exported to one worksheet.`;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}

// ─── Excel exporter ───────────────────────────────────────────────────────────
function downloadWorkbook() {
  const rows = [];
  let rowNumber = 0;

  workbookData.tables.forEach((table) => {
    rows.push(workbookData.headers.map((h) => ({ v: h, t: 's' })));
    rowNumber++;
    table.rows.forEach((row) => {
      rows.push([table.title, ...row.cells].map((v) => ({ v: String(v ?? ''), t: 's' })));
      rowNumber++;
    });
    rows.push([]); // blank separator
    rowNumber++;
  });

  const sheet = XLSX.utils.aoa_to_sheet(rows);

  sheet['!cols'] = [
    { wch: 44 }, // Programme Title
    { wch: 12 }, // Reg No
    { wch: 14 }, // Centre Ref
    { wch: 18 }, // First Name
    { wch: 18 }, // Last Name
    { wch:  6 }, // Sex
    { wch: 12 }, // DOB
    { wch: 14 }, // ULN
    { wch: 15 }, // Est Comp Date
    { wch: 15 }, // Award Date
    { wch: 24 }, // Certification Award No
    { wch: 13 }, // Award Code
    { wch: 15 }, // Overall Result
  ];

  sheet['!autofilter'] = { ref: `A1:M${Math.max(1, rowNumber - 1)}` };
  sheet['!freeze']     = { xSplit: 0, ySplit: 1 };
  sheet['!pageSetup']  = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet['!margins']    = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };

  // Column alignment map (0-indexed, relative to full 13-col range)
  // Left: 0 (title), 1 (reg), 2 (centre), 3 (first), 4 (last)
  // Center: 5 (sex), 6 (dob), 7 (uln), 8 (est comp), 9 (award date), 10 (cert no), 11 (award code), 12 (overall)
  const centeredCols = new Set([5, 6, 7, 8, 9, 10, 11, 12]);

  const thin = (rgb) => ({ style: 'thin', color: { rgb } });
  const medium = (rgb) => ({ style: 'medium', color: { rgb } });

  let cursor = 0;
  workbookData.tables.forEach((table) => {
    const hRgb = table.colors.header.slice(1).toUpperCase();
    const fRgb = table.colors.fill.slice(1).toUpperCase();

    // Header row styling
    for (let col = 0; col < workbookData.headers.length; col++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: cursor, c: col })];
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: '17332A' }, sz: 10 },
          fill: { fgColor: { rgb: hRgb } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: {
            top:    thin('8EB39E'),
            bottom: medium('8EB39E'),
            left:   thin('8EB39E'),
            right:  thin('8EB39E'),
          },
        };
      }
    }
    cursor++;

    // Data row styling
    table.rows.forEach((row) => {
      for (let col = 0; col < workbookData.headers.length; col++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: cursor, c: col })];
        if (cell) {
          cell.s = {
            fill: { fgColor: { rgb: fRgb } },
            font: { italic: row.italic, bold: row.bold, sz: 9 },
            alignment: {
              horizontal: centeredCols.has(col) ? 'center' : 'left',
              vertical:   'center',
              wrapText:   true,
            },
            border: {
              top:    thin('D3D3D3'),
              bottom: thin('D3D3D3'),
              left:   thin('D3D3D3'),
              right:  thin('D3D3D3'),
            },
          };
        }
      }
      cursor++;
    });

    cursor++; // blank row
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'PDF Tables');
  XLSX.writeFile(wb, 'pdf-tables.xlsx', { cellStyles: true });
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function showError(msg) {
  $('errorMessage').textContent = msg;
  $('errorMessage').classList.remove('hidden');
  $('progressPanel').classList.add('hidden');
}

function reset(hideProgress = true) {
  $('errorMessage').classList.add('hidden');
  $('resultPanel').classList.add('hidden');
  if (hideProgress) $('progressPanel').classList.add('hidden');
  fileInput.value = '';
}
