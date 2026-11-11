'use strict';
/* PDF del logbook in formato EASA, sempre A4 orizzontale (Safari su iPad ignora l'orientamento della stampa).
   Layout "book": ogni pagina del logbook diventa due fogli, sinistra (colonne 1-8) e destra (9-12), come il libretto cartaceo. */
function loadJs(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)?.dataset.ok) return res(); const s = document.createElement('script'); s.src = src; s.onload = () => { s.dataset.ok = 1; res(); }; s.onerror = () => rej(new Error(src + ' not available')); document.head.append(s); }); }
async function easaPdf(pages, rpp, totalPages, layout) {
  await loadJs('lib/jspdf.umd.min.js'); await loadJs('lib/jspdf.plugin.autotable.min.js');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const W = 297, ML = 5, MR = 5, MT = 6, usable = W - ML - MR;
  const sheets = easaSheets(layout), compact = layout === 'single';
  const fs = compact ? 5.6 : 7.6, fsHead = compact ? 5 : 6.4, fsSmall = compact ? 4.8 : 6;
  const H = (content, o = {}) => ({ content, styles: { halign: 'center', valign: 'middle', fontStyle: 'bold', fontSize: fsHead, ...o.styles }, ...o });
  // altezza righe: la pagina deve contenere intestazione, righe, 3 totali e piè di pagina
  const headH = compact ? 17 : 21, totH = compact ? 5.2 : 6.6, footH = 8, rowH = Math.max(5, (210 - MT - footH - headH - 3 * totH) / rpp - 0.6);
  let first = true;
  for (const p of pages) for (const sheet of sheets) {
    await new Promise(r => setTimeout(r));   // l'app resta usabile mentre il PDF si crea
    if (!first) doc.addPage(); first = false;
    const cols = sheet.cols, remIdx = cols.findIndex(c => c.key === 'rem');
    const fixed = cols.reduce((a, c) => a + c.w, 0);
    const widths = cols.map(c => c.w || usable - fixed);
    const hm3 = easaHeadModel(cols);
    const head = [
      hm3.nums.map(x => H(x.text, { colSpan: x.span, styles: { fontSize: fsSmall, minCellHeight: 3.2 } })),
      hm3.groups.map(x => H(x.text, { colSpan: x.span, rowSpan: x.tall ? 2 : 1 })),
      hm3.subs.map(x => H(x.text, { styles: { fontStyle: 'normal', fontSize: fsSmall } }))
    ];
    const imgs = [];
    const body = p.rows.map(f => cols.map(c => {
      if (c.key !== 'rem') return { content: c.cell(f), styles: c.cls ? { fontSize: fsSmall } : {} };
      return { content: [c.cell(f), ...easaRemExtra(f)].filter(Boolean).join('\n'), styles: { halign: 'left', fontSize: fsSmall }, sigs: [f.check?.sig, f.signature].filter(Boolean) };
    }));
    while (body.length < rpp) body.push(cols.map(() => ''));
    const ls = easaLabelSpan(cols);
    const tot = (lab, t, firstRow) => [
      ...(ls ? [{ content: lab, colSpan: ls, styles: { halign: 'left', fontStyle: 'bold', fontSize: fsSmall } }] : []),
      ...cols.slice(ls).flatMap(c => c.key === 'rem'
        ? (firstRow ? [{ content: `${easaCert()}\n\n______________________\nPILOT'S SIGNATURE`, rowSpan: 3, styles: { halign: 'center', valign: 'middle', fontSize: fsSmall, fontStyle: 'normal' } }] : [])
        : [{ content: c.tot ? c.tot(t) : '', styles: { fontStyle: 'bold' } }])
    ];
    const foot = [tot('TOTAL THIS PAGE', p.page, true), tot('TOTAL FROM PREVIOUS PAGES', p.prev), tot('TOTAL TIME', p.tot)];
    doc.autoTable({
      head, body, foot, startY: MT, margin: { left: ML, right: MR, top: MT, bottom: 4 }, tableWidth: usable, theme: 'grid', showFoot: 'lastPage', pageBreak: 'auto', rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: fs, cellPadding: 0.6, halign: 'center', valign: 'middle', lineColor: [40, 40, 40], lineWidth: 0.15, textColor: [20, 20, 20], minCellHeight: rowH, overflow: 'linebreak' },
      headStyles: { fillColor: [255, 255, 255], textColor: [20, 20, 20], minCellHeight: (headH - 3.2) / 2, lineWidth: 0.25, cellPadding: 0.4 },
      footStyles: { fillColor: [245, 245, 245], textColor: [20, 20, 20], minCellHeight: totH, fontSize: fs },
      columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w }])),
      // il testo va a capo ma senza allungare la riga: righe in più tagliate con …
      didParseCell: d => {
        if (d.section === 'head') return;
        let w = 0; for (let k = 0; k < (d.cell.colSpan || 1); k++) w += widths[d.column.index + k] || 0;
        w -= 1.4;
        const size = d.cell.styles.fontSize, lineH = size * 0.3528 * 1.15, h = d.section === 'foot' ? (d.cell.rowSpan > 1 ? totH * 3 : totH) : rowH;
        const max = Math.max(1, Math.floor((h - 0.8) / lineH));
        doc.setFontSize(size);
        let lines = doc.splitTextToSize(d.cell.text.join('\n'), w);
        if (lines.length > max) { lines = lines.slice(0, max); lines[max - 1] = lines[max - 1].replace(/.{0,2}$/, '…'); }
        d.cell.text = lines;
      },
      didDrawCell: d => { if (d.section === 'body' && d.column.index === remIdx && d.cell.raw?.sigs?.length) imgs.push({ x: d.cell.x, y: d.cell.y, w: d.cell.width, h: d.cell.height, sigs: d.cell.raw.sigs }); }
    });
    // firme (pilota ed esaminatore) a destra nella cella delle note
    for (const c of imgs) {
      const h = Math.min(c.h - 0.6, compact ? 4.2 : 6), w = h * 3;
      c.sigs.forEach((s, i) => { try { doc.addImage(s, 'PNG', c.x + c.w - (w + 0.4) * (i + 1), c.y + (c.h - h) / 2, w, h); } catch { /* firma illeggibile */ } });
    }
    doc.setFontSize(7); doc.setTextColor(60);
    doc.text(data.pilot || '', ML, 210 - 4);
    doc.text(`Page ${p.n}${sheet.side ? ` · ${easaSideName(sheet.side)}` : ''} / ${totalPages}`, W - MR, 210 - 4, { align: 'right' });
    doc.setTextColor(20);
  }
  return doc.output('blob');
}
