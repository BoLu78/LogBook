'use strict';
/* PDF del logbook in formato EASA, sempre A4 orizzontale (Safari su iPad ignora l'orientamento della stampa). */
function loadJs(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)?.dataset.ok) return res(); const s = document.createElement('script'); s.src = src; s.onload = () => { s.dataset.ok = 1; res(); }; s.onerror = () => rej(new Error(src + ' not available')); document.head.append(s); }); }
async function easaPdf(pages, rpp, totalPages) {
  await loadJs('lib/jspdf.umd.min.js'); await loadJs('lib/jspdf.plugin.autotable.min.js');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const W = 297, ML = 5, MR = 5, MT = 6, usable = W - ML - MR;
  const fixed = EASA_COLS.slice(0, -1).reduce((a, b) => a + b, 0);
  const widths = [...EASA_COLS.slice(0, -1), usable - fixed];
  const colStyles = Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w }]));
  const n = v => v ? String(v) : '';
  const H = (content, o = {}) => ({ content, styles: { halign: 'center', valign: 'middle', fontStyle: 'bold', fontSize: 5.6, ...o.styles }, ...o });
  const head = [
    [H('DATE\n(dd/mm/yy)', { rowSpan: 2 }), H('DEPARTURE', { colSpan: 2 }), H('ARRIVAL', { colSpan: 2 }), H('AIRCRAFT', { colSpan: 2 }), H('SINGLE PILOT\nTIME', { colSpan: 2 }),
      H('MULTI\nPILOT\nTIME', { rowSpan: 2 }), H('TOTAL\nTIME OF\nFLIGHT', { rowSpan: 2 }), H('NAME\nPIC', { rowSpan: 2 }), H('TAKE-OFFS', { colSpan: 2 }), H('LANDINGS', { colSpan: 2 }),
      H('PILOT FUNCTION TIME', { colSpan: 4 }), H('OPERATIONAL\nCONDITION TIME', { colSpan: 2 }), H('FSTD SESSION', { colSpan: 2 }), H('REMARKS AND\nENDORSEMENTS', { rowSpan: 2 })],
    ['PLACE', 'TIME', 'PLACE', 'TIME', 'MAKE, MODEL\nVARIANT', 'REGIS-\nTRATION', 'SE', 'ME', 'DAY', 'NIGHT', 'DAY', 'NIGHT', 'PIC', 'CO-\nPILOT', 'DUAL', 'INSTR.', 'NIGHT', 'IFR', 'TYPE', 'TOTAL\nTIME'].map(t => H(t, { styles: { fontSize: 5 } }))
  ];
  // altezza righe: la pagina deve contenere intestazione, righe, 3 totali e piè di pagina
  const headH = 14, totH = 5.2, footH = 8, rowH = Math.max(5, (210 - MT - footH - headH - 3 * totH) / rpp - 0.6);
  pages.forEach((p, pi) => {
    if (pi) doc.addPage();
    const imgs = [];
    const body = p.rows.map(f => {
      const remParts = [f.remarks || ''];
      if (f.check) remParts.push([f.check.type, f.check.name, f.check.lic].filter(Boolean).join(' · '));
      const sigs = [f.check?.sig, f.signature].filter(Boolean);
      const rem = { content: remParts.filter(Boolean).join('\n'), styles: { halign: 'left', fontSize: 4.8 }, sigs };
      if (f.kind === 'sim') { rem.content = [fstdRemarks(f), remParts.slice(1).join('\n')].filter(Boolean).join('\n'); return [dmy(f.date), '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', fstdType(f), hm(f.sim), rem]; }
      return [dmy(f.date), n(f.dep), n(f.out), n(f.arr), n(f.inn), n(f.type), n(f.reg), hm(f.spSe), hm(f.spMe), hm(f.mp), hm(f.total), n(f.picName), n(f.toDay), n(f.toNight), n(f.ldgDay), n(f.ldgNight), hm(f.pic), hm(f.sic), hm(f.dual), hm(f.instr), hm(f.night), hm(f.ifr), '', '', rem];
    });
    while (body.length < rpp) body.push(Array(25).fill(''));
    const tot = (lab, t, sig) => [{ content: lab, colSpan: 7, styles: { halign: 'left', fontStyle: 'bold', fontSize: 5.4 } }, hm(t.spSe), hm(t.spMe), hm(t.mp), hm(t.total), '', n(t.toDay), n(t.toNight), n(t.ldgDay), n(t.ldgNight), hm(t.pic), hm(t.sic), hm(t.dual), hm(t.instr), hm(t.night), hm(t.ifr), '', hm(t.sim), ...(sig ? [sig] : [])]
      .map(c => typeof c === 'string' ? { content: c, styles: { fontStyle: 'bold' } } : c);
    const sig = { content: `I, ${data.pilot || ''}, certify that the entries in this log are true.\n\nPilot's signature ____________`, rowSpan: 3, styles: { halign: 'left', fontSize: 4.8, valign: 'top' } };
    const foot = [tot('TOTAL THIS PAGE', p.page, sig), tot('TOTAL FROM PREVIOUS PAGES', p.prev), tot('TOTAL TIME', p.tot)];
    doc.autoTable({
      head, body, foot, startY: MT, margin: { left: ML, right: MR, top: MT, bottom: 4 }, tableWidth: usable, theme: 'grid', showFoot: 'lastPage', pageBreak: 'auto', rowPageBreak: 'auto',
      styles: { font: 'helvetica', fontSize: 6, cellPadding: 0.5, halign: 'center', valign: 'middle', lineColor: [40, 40, 40], lineWidth: 0.15, textColor: [20, 20, 20], minCellHeight: rowH, overflow: 'linebreak' },
      headStyles: { fillColor: [255, 255, 255], textColor: [20, 20, 20], minCellHeight: headH / 2, lineWidth: 0.25, cellPadding: 0.3 },
      footStyles: { fillColor: [245, 245, 245], textColor: [20, 20, 20], minCellHeight: totH, fontSize: 6 },
      columnStyles: { ...colStyles, 5: { cellWidth: widths[5], fontSize: 5.2 }, 11: { cellWidth: widths[11], fontSize: 5.2 }, 22: { cellWidth: widths[22], fontSize: 5 } },
      // il testo va a capo ma senza allungare la riga: righe in più tagliate con …
      didParseCell: d => {
        if (d.section === 'head') return;
        const w = (widths[d.column.index] || 20) * (d.cell.colSpan || 1) - 1.2, fs = d.cell.styles.fontSize;
        const lineH = fs * 0.3528 * 1.15, h = d.section === 'foot' ? (d.cell.rowSpan > 1 ? totH * 3 : totH) : rowH;
        const max = Math.max(1, Math.floor((h - 0.8) / lineH));
        doc.setFontSize(fs);
        let lines = doc.splitTextToSize(d.cell.text.join('\n'), w);
        if (lines.length > max) { lines = lines.slice(0, max); lines[max - 1] = lines[max - 1].replace(/.{0,2}$/, '…'); }
        d.cell.text = lines;
      },
      didDrawCell: d => { if (d.section === 'body' && d.column.index === 24 && d.cell.raw?.sigs?.length) imgs.push({ x: d.cell.x, y: d.cell.y, w: d.cell.width, h: d.cell.height, sigs: d.cell.raw.sigs }); }
    });
    // firme (pilota ed esaminatore) a destra nella cella delle note
    for (const c of imgs) {
      const h = Math.min(c.h - 0.6, 4.2), w = h * 3;
      c.sigs.forEach((s, i) => { try { doc.addImage(s, 'PNG', c.x + c.w - (w + 0.4) * (i + 1), c.y + (c.h - h) / 2, w, h); } catch { /* firma illeggibile */ } });
    }
    doc.setFontSize(7); doc.setTextColor(60);
    doc.text(data.pilot || '', ML, 210 - 4);
    doc.text(`Page ${p.n} / ${totalPages}`, W - MR, 210 - 4, { align: 'right' });
  });
  return doc.output('blob');
}
