// // services/pdf.service.js
// const PDFDocument = require('pdfkit');
// const fs = require('fs');
// const path = require('path');

// class PDFService {
//   static async generateInvoicePDF(invoiceData, outputPath) {
//     return new Promise((resolve, reject) => {
//       const doc = new PDFDocument({ 
//         margin: 50, 
//         size: 'A4',
//         info: {
//           Title: `Invoice ${invoiceData.invoiceNumber}`,
//           Author: 'RentEase',
//           Subject: 'Rental Invoice',
//           Keywords: 'invoice, rental, payment'
//         }
//       });
      
//       const stream = fs.createWriteStream(outputPath);
//       doc.pipe(stream);
      
//       // Helper function to format currency
//       const formatCurrency = (amount) => {
//         return new Intl.NumberFormat('en-IN', {
//           style: 'currency',
//           currency: 'INR',
//           minimumFractionDigits: 2
//         }).format(amount);
//       };
      
//       const formatDate = (date) => {
//         return new Date(date).toLocaleDateString('en-IN', {
//           day: '2-digit',
//           month: 'short',
//           year: 'numeric'
//         });
//       };
      
//       // Colors
//       const primaryColor = '#4f46e5';
//       const secondaryColor = '#6b7280';
      
//       // Header with logo
//       doc.fontSize(24)
//          .font('Helvetica-Bold')
//          .fillColor(primaryColor)
//          .text('RentEase', { align: 'center' })
//          .fontSize(10)
//          .font('Helvetica')
//          .fillColor(secondaryColor)
//          .text('Furniture & Appliance Rentals', { align: 'center' })
//          .moveDown(0.5)
//          .fontSize(8)
//          .text(`GST: ${invoiceData.vendor.gstin}`, { align: 'center' })
//          .moveDown();
      
//       // Invoice Title
//       doc.fontSize(16)
//          .font('Helvetica-Bold')
//          .fillColor('#000000')
//          .text('TAX INVOICE', { align: 'center' })
//          .fontSize(10)
//          .font('Helvetica')
//          .fillColor(secondaryColor)
//          .text(`Invoice No: ${invoiceData.invoiceNumber}`, { align: 'center' })
//          .text(`Date: ${formatDate(invoiceData.date)}`, { align: 'center' })
//          .moveDown();
      
//       // Vendor & Customer Details
//       doc.fontSize(10)
//          .font('Helvetica-Bold')
//          .fillColor('#000000')
//          .text('Vendor Details:', 50, doc.y)
//          .font('Helvetica')
//          .fillColor(secondaryColor)
//          .text(invoiceData.vendor.name, 50, doc.y + 15)
//          .text(`GST: ${invoiceData.vendor.gstin}`, 50, doc.y + 25)
//          .font('Helvetica-Bold')
//          .fillColor('#000000')
//          .text('Customer Details:', 300, doc.y - 35)
//          .font('Helvetica')
//          .fillColor(secondaryColor)
//          .text(invoiceData.customer.name, 300, doc.y + 15)
//          .text(invoiceData.customer.email, 300, doc.y + 25)
//          .text(invoiceData.customer.phone, 300, doc.y + 35)
//          .moveDown();
      
//       // Rental Details Box
//       doc.rect(50, doc.y, 495, 80)
//          .stroke(primaryColor)
//          .fillColor('#f9fafb')
//          .fillAndStroke()
//          .fillColor('#000000');
      
//       doc.font('Helvetica-Bold')
//          .text('Rental Details', 60, doc.y - 70)
//          .font('Helvetica')
//          .fontSize(9)
//          .text(`Rental Number: ${invoiceData.rental.number}`, 60, doc.y - 55)
//          .text(`Period: ${formatDate(invoiceData.rental.startDate)} - ${formatDate(invoiceData.rental.endDate)}`, 60, doc.y - 45)
//          .text(`Product: ${invoiceData.product.name}`, 60, doc.y - 35)
//          .text(`SKU: ${invoiceData.product.sku}`, 60, doc.y - 25)
//          .moveDown();
      
//       // Charges Table
//       const tableTop = doc.y;
//       const col1X = 50;
//       const col2X = 400;
      
//       // Table Header
//       doc.rect(col1X, tableTop, 495, 25)
//          .fillColor(primaryColor)
//          .fillAndStroke()
//          .fillColor('#ffffff');
      
//       doc.font('Helvetica-Bold')
//          .fontSize(10)
//          .text('Description', col1X + 10, tableTop + 8)
//          .text('Amount', col2X + 10, tableTop + 8, { align: 'right' });
      
//       let y = tableTop + 25;
//       const items = [
//         { label: `Monthly Rent (${invoiceData.charges.monthlyRent}/month)`, value: invoiceData.charges.monthlyRent },
//         { label: `Subtotal (${invoiceData.charges.tenureMonths} months)`, value: invoiceData.charges.subtotal },
//         { label: 'Security Deposit', value: invoiceData.charges.securityDeposit },
//         { label: 'Delivery Charges', value: invoiceData.charges.deliveryCharges },
//       ];
      
//       if (invoiceData.charges.discount > 0) {
//         items.push({ label: 'Discount', value: -invoiceData.charges.discount });
//       }
      
//       items.forEach((item, index) => {
//         doc.font('Helvetica')
//            .fontSize(9)
//            .fillColor(index % 2 === 0 ? '#000000' : '#4b5563')
//            .text(item.label, col1X + 10, y)
//            .text(
//              item.value < 0 ? `-${formatCurrency(Math.abs(item.value))}` : formatCurrency(item.value), 
//              col2X + 10, 
//              y, 
//              { align: 'right' }
//            );
//         y += 20;
//       });
      
//       // Total Section
//       y += 10;
//       doc.rect(col1X, y, 495, 40)
//          .fillColor('#f3f4f6')
//          .fillAndStroke();
      
//       doc.font('Helvetica-Bold')
//          .fontSize(11)
//          .fillColor('#000000')
//          .text('Total Amount', col1X + 10, y + 12)
//          .text(formatCurrency(invoiceData.charges.total), col2X + 10, y + 12, { align: 'right' });
      
//       y += 45;
      
//       // Payment Status
//       doc.font('Helvetica-Bold')
//          .fontSize(10)
//          .fillColor('#000000')
//          .text('Payment Status', col1X, y)
//          .font('Helvetica')
//          .fontSize(9)
//          .fillColor(invoiceData.charges.due === 0 ? '#10b981' : '#ef4444')
//          .text(
//            invoiceData.charges.due === 0 ? 'Fully Paid' : `Due: ${formatCurrency(invoiceData.charges.due)}`, 
//            col2X, 
//            y, 
//            { align: 'right' }
//          );
      
//       // Payment History
//       if (invoiceData.payments && invoiceData.payments.length > 0) {
//         y += 30;
//         doc.font('Helvetica-Bold')
//            .fontSize(10)
//            .fillColor('#000000')
//            .text('Payment History', col1X, y);
        
//         y += 15;
        
//         // Payment table header
//         doc.font('Helvetica-Bold')
//            .fontSize(8)
//            .text('Date', col1X + 10, y)
//            .text('Amount', col1X + 150, y)
//            .text('Method', col1X + 250, y)
//            .text('Status', col1X + 350, y);
        
//         y += 10;
//         doc.moveTo(col1X, y).lineTo(col1X + 495, y).stroke();
//         y += 10;
        
//         invoiceData.payments.forEach((payment, index) => {
//           doc.font('Helvetica')
//              .fontSize(8)
//              .fillColor(index % 2 === 0 ? '#000000' : '#6b7280')
//              .text(formatDate(payment.date), col1X + 10, y)
//              .text(formatCurrency(payment.amount), col1X + 150, y)
//              .text(payment.method.replace(/_/g, ' ').toUpperCase(), col1X + 250, y)
//              .text(payment.status.toUpperCase(), col1X + 350, y);
//           y += 15;
//         });
//       }
      
//       // Footer
//       const footerY = doc.page.height - 50;
//       doc.fontSize(8)
//          .fillColor(secondaryColor)
//          .text('This is a computer-generated invoice and does not require a physical signature.', 
//                0, footerY, { align: 'center' })
//          .text('For any queries, please contact support@rentease.com or call +91 1800-123-4567', 
//                0, footerY + 12, { align: 'center' })
//          .text('Thank you for choosing RentEase!', 
//                0, footerY + 24, { align: 'center' });
      
//       doc.end();
      
//       stream.on('finish', () => resolve(outputPath));
//       stream.on('error', reject);
//     });
//   }
// }

// module.exports = PDFService;





// services/pdf.service.js
'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');

// ─── Brand tokens ─────────────────────────────────────────────────────────────
const C = {
  indigo:      '#4f46e5',
  indigoDark:  '#4338ca',
  indigoMid:   '#6366f1',
  indigoLight: '#eef2ff',
  indigoMute:  '#c7d2fe',
  slate700:    '#374151',
  slate500:    '#6b7280',
  slate300:    '#d1d5db',
  slate100:    '#f3f4f6',
  slate50:     '#f9fafb',
  white:       '#ffffff',
  black:       '#111827',
  green:       '#059669',
  greenLight:  '#d1fae5',
  red:         '#dc2626',
  redLight:    '#fee2e2',
  amber:       '#d97706',
  amberLight:  '#fef3c7',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hex(doc, color) { doc.fillColor(color); }
function strokeHex(doc, color) { doc.strokeColor(color); }

const A4_W = 595.28;
const A4_H = 841.89;
const ML = 36;          // margin left
const MR = A4_W - 36;  // margin right
const CW = MR - ML;    // content width

function fmtINR(n) {
  const neg = n < 0;
  const abs = Math.abs(n);
  const [int, dec] = abs.toFixed(2).split('.');
  // Indian grouping
  let out = '';
  const digits = int.split('').reverse();
  digits.forEach((d, i) => {
    if (i === 3 || (i > 3 && (i - 3) % 2 === 0)) out = ',' + out;
    out = d + out;
  });
  return (neg ? '-' : '') + '₹' + out + '.' + dec;
}

function fmtDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function roundRect(doc, x, y, w, h, r = 4) {
  doc.roundedRect(x, y, w, h, r);
}

function hLine(doc, x1, x2, y, color = C.slate300, lw = 0.4) {
  doc.moveTo(x1, y).lineTo(x2, y)
     .strokeColor(color).lineWidth(lw).stroke();
}

// Draw house/home icon in pure pdfkit primitives
function drawLogo(doc, x, y, sz = 28) {
  const s = sz / 48;
  // House body
  doc.save();
  doc.polygon(
    [x + 8*s,  y + 4*s],
    [x + 40*s, y + 4*s],
    [x + 40*s, y + 44*s],
    [x + 8*s,  y + 44*s]
  ).fillColor(C.indigo).fill();
  // Roof
  doc.polygon(
    [x + 24*s, y],
    [x + 48*s, y + 22*s],
    [x,        y + 22*s]
  ).fillColor(C.indigoDark).fill();
  // Door
  doc.roundedRect(x + 19*s, y + 28*s, 10*s, 16*s, 1.5*s)
     .fillColor(C.indigoMid).fill();
  // Windows
  [[10, 17], [30, 17]].forEach(([wx, wy]) => {
    doc.roundedRect(x + wx*s, y + wy*s, 9*s, 8*s, 1.5*s)
       .fillColor(C.white).fillOpacity(0.9).fill().fillOpacity(1);
  });
  doc.restore();
}

// Filled rounded rect helper
function fillRect(doc, x, y, w, h, color, radius = 4) {
  doc.roundedRect(x, y, w, h, radius).fillColor(color).fill();
}

// Stroked rounded rect
function strokeRect(doc, x, y, w, h, color, lw = 0.5, radius = 4) {
  doc.roundedRect(x, y, w, h, radius).strokeColor(color).lineWidth(lw).stroke();
}

// Inline status pill
function pill(doc, x, y, text, bg, fg = C.white, fontSize = 7) {
  doc.font('Helvetica-Bold').fontSize(fontSize);
  const tw = doc.widthOfString(text);
  const pw = tw + 10, ph = fontSize + 5;
  fillRect(doc, x, y - 1, pw, ph, bg, 3);
  doc.fillColor(fg).text(text, x + 5, y + 0.5, { lineBreak: false });
  return pw;
}

// ─── Section renderers ────────────────────────────────────────────────────────

function drawHeader(doc, inv) {
  const H = 120;
  // Background
  doc.rect(0, 0, A4_W, H).fillColor(C.indigo).fill();
  // Bottom accent stripe
  doc.rect(0, H - 3, A4_W, 3).fillColor(C.indigoDark).fill();

  // Logo
  drawLogo(doc, ML, 18, 32);

  // Brand name
  doc.font('Helvetica-Bold').fontSize(18).fillColor(C.white)
     .text('RentEase', ML + 40, 20, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(C.indigoMute)
     .text('Furniture & Appliance Rentals', ML + 40, 42, { lineBreak: false });

  // "TAX INVOICE" right
  doc.font('Helvetica-Bold').fontSize(22).fillColor(C.white)
     .text('TAX INVOICE', 0, 18, { align: 'right', width: MR, lineBreak: false });

  // Meta right
  const meta = [
    `Invoice No: ${inv.invoiceNumber}`,
    `Date: ${fmtDate(inv.date)}`,
    `GSTIN: ${inv.vendor.gstin}`,
  ];
  meta.forEach((line, i) => {
    doc.font('Helvetica').fontSize(8).fillColor(C.indigoMute)
       .text(line, 0, 46 + i * 13, { align: 'right', width: MR, lineBreak: false });
  });

  return H + 10;
}

function drawAddressBlock(doc, inv, y) {
  const H = 75, mid = ML + CW / 2;
  fillRect(doc, ML, y, CW, H, C.slate50, 5);
  strokeRect(doc, ML, y, CW, H, C.slate300, 0.5, 5);
  // Divider
  doc.moveTo(mid, y + 8).lineTo(mid, y + H - 8)
     .strokeColor(C.slate300).lineWidth(0.4).stroke();

  const left = ML + 10, right = mid + 10;

  // Vendor
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.slate500)
     .text('VENDOR', left, y + 10, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.black)
     .text(inv.vendor.name, left, y + 22, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(C.slate500)
     .text(`GSTIN: ${inv.vendor.gstin}`, left, y + 36, { lineBreak: false })
     .text('support@rentease.com  ·  1800-123-4567', left, y + 48, { lineBreak: false });

  // Customer
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.slate500)
     .text('BILL TO', right, y + 10, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.black)
     .text(inv.customer.name, right, y + 22, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(C.slate500)
     .text(inv.customer.email, right, y + 36, { lineBreak: false })
     .text(inv.customer.phone, right, y + 48, { lineBreak: false });

  return y + H + 8;
}

function drawRentalStrip(doc, inv, y) {
  const H = 52;
  fillRect(doc, ML, y, CW, H, C.indigoLight, 5);
  strokeRect(doc, ML, y, CW, H, C.indigoMute, 0.5, 5);

  const cols = [
    { label: 'RENTAL #',  val: inv.rental.number },
    { label: 'PRODUCT',   val: inv.product.name },
    { label: 'SKU',       val: inv.product.sku },
    { label: 'PERIOD',    val: `${fmtDate(inv.rental.startDate)} – ${fmtDate(inv.rental.endDate)}` },
  ];
  const segW = CW / cols.length;

  cols.forEach((col, i) => {
    const cx = ML + i * segW + 10;
    if (i > 0) {
      doc.moveTo(ML + i * segW, y + 6).lineTo(ML + i * segW, y + H - 6)
         .strokeColor(C.indigoMute).lineWidth(0.4).stroke();
    }
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.indigo)
       .text(col.label, cx, y + 11, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.slate700)
       .text(col.val, cx, y + 24, { width: segW - 14, lineBreak: false });
  });

  return y + H + 8;
}

function drawChargesTable(doc, inv, y) {
  const ch = inv.charges;
  const rows = [
    ['Monthly Rent',                          `@ ${fmtINR(ch.monthlyRent)}/mo`,  ch.monthlyRent],
    [`Subtotal (${ch.tenureMonths} months)`,  '',                                ch.subtotal],
    ['Security Deposit',                      'Refundable',                      ch.securityDeposit],
    ['Delivery Charges',                      'One-time',                        ch.deliveryCharges],
  ];
  if ((ch.discount || 0) > 0) {
    rows.push(['Discount', 'Applied', -ch.discount]);
  }

  const ROW_H = 22;
  const HDR_H = 24;
  const TOT_H = 28;
  const tableH = HDR_H + rows.length * ROW_H + TOT_H;

  // Outer card
  fillRect(doc, ML, y, CW, tableH, C.white, 5);
  strokeRect(doc, ML, y, CW, tableH, C.slate300, 0.5, 5);

  // Header
  fillRect(doc, ML, y, CW, HDR_H, C.indigo, 5);
  doc.rect(ML, y + HDR_H - 4, CW, 4).fillColor(C.indigo).fill(); // square bottom corners

  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white);
  doc.text('DESCRIPTION', ML + 10, y + 8, { lineBreak: false });
  doc.text('NOTE',        ML + 230, y + 8, { lineBreak: false });
  doc.text('AMOUNT',      0, y + 8, { align: 'right', width: MR - 6, lineBreak: false });

  // Rows
  let ry = y + HDR_H;
  rows.forEach(([desc, note, amt], i) => {
    if (i % 2 === 1) {
      doc.rect(ML + 1, ry, CW - 2, ROW_H).fillColor(C.slate50).fill();
    }
    // Description
    doc.font('Helvetica').fontSize(9).fillColor(C.slate700)
       .text(desc, ML + 10, ry + 7, { lineBreak: false });
    // Note
    doc.font('Helvetica').fontSize(7.5).fillColor(C.slate500)
       .text(note, ML + 230, ry + 7, { lineBreak: false });
    // Amount
    const amtColor = amt < 0 ? C.red : C.slate700;
    doc.font(i === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
       .fillColor(amtColor)
       .text(fmtINR(amt), 0, ry + 7, { align: 'right', width: MR - 6, lineBreak: false });
    hLine(doc, ML + 2, MR - 2, ry + ROW_H, C.slate300, 0.3);
    ry += ROW_H;
  });

  // Total row
  fillRect(doc, ML, ry, CW, TOT_H, C.indigo, 0);
  // round only bottom corners
  doc.roundedRect(ML, ry, CW, TOT_H, 5).fillColor(C.indigo).fill();
  doc.rect(ML, ry, CW, 5).fillColor(C.indigo).fill(); // square top

  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white)
     .text('TOTAL AMOUNT DUE', ML + 10, ry + 9, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.white)
     .text(fmtINR(ch.total), 0, ry + 8, { align: 'right', width: MR - 6, lineBreak: false });

  return y + tableH + 10;
}

function drawPaymentSection(doc, inv, y) {
  const ch = inv.charges;
  const isPaid = (ch.due || 0) === 0;

  // Status badge
  const statusText = isPaid ? '✓  PAID IN FULL' : `OUTSTANDING: ${fmtINR(ch.due)}`;
  const statusBg   = isPaid ? C.green : C.red;
  const badgeW = 140, badgeH = 22;
  fillRect(doc, ML, y, badgeW, badgeH, statusBg, 4);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
     .text(statusText, ML + 10, y + 7, { lineBreak: false });

  const payments = inv.payments || [];
  if (!payments.length) return y + badgeH + 8;

  // Payment history table
  const ty = y + badgeH + 12;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.slate700)
     .text('PAYMENT HISTORY', ML, ty - 10, { lineBreak: false });

  const PHR = 18, PHH_H = 18;
  const tableH = PHH_H + payments.length * PHR + 2;

  fillRect(doc, ML, ty, CW, tableH, C.slate50, 4);
  strokeRect(doc, ML, ty, CW, tableH, C.slate300, 0.4, 4);

  // PH header
  fillRect(doc, ML, ty, CW, PHH_H, C.slate100, 4);
  doc.rect(ML, ty + PHH_H - 4, CW, 4).fillColor(C.slate100).fill();

  const pcols = [ML+8, ML+90, ML+190, ML+285];
  const phdrs = ['DATE', 'AMOUNT', 'METHOD', 'STATUS'];
  phdrs.forEach((h, i) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.slate500)
       .text(h, pcols[i], ty + 5, { lineBreak: false });
  });

  let py = ty + PHH_H;
  payments.forEach((pmt, i) => {
    if (i % 2 === 0) {
      doc.rect(ML+1, py, CW-2, PHR).fillColor(C.white).fill();
    }
    doc.font('Helvetica').fontSize(8).fillColor(C.slate700);
    doc.text(fmtDate(pmt.date),   pcols[0], py + 5, { lineBreak: false });
    doc.text(fmtINR(pmt.amount),  pcols[1], py + 5, { lineBreak: false });
    doc.text(pmt.method.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase()), pcols[2], py + 5, { lineBreak: false });
    // status pill
    const sc = pmt.status === 'completed' ? C.green
             : pmt.status === 'pending'   ? C.amber : C.red;
    pill(doc, pcols[3], py + 4, pmt.status.toUpperCase(), sc, C.white, 6.5);
    py += PHR;
  });

  return py + 8;
}

function drawQRPlaceholder(doc, x, y) {
  const sz = 52;
  fillRect(doc, x, y, sz, sz, C.white, 3);
  strokeRect(doc, x, y, sz, sz, C.slate300, 0.5, 3);

  // Simulate QR grid
  const cell = sz / 9;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      // deterministic "random" fill
      const hash = Math.sin(r * 31 + c * 17 + 7) * 43758.5453;
      const val = hash - Math.floor(hash);
      if (val > 0.45) {
        doc.rect(x + c*cell + 0.5, y + r*cell + 0.5, cell-1, cell-1)
           .fillColor(C.indigoDark).fill();
      }
    }
  }
  // Corner finder patterns (3 corners)
  [[0,0],[6,0],[0,6]].forEach(([cr, cc]) => {
    doc.rect(x+cc*cell, y+cr*cell, 3*cell, 3*cell).fillColor(C.indigo).fill();
    doc.rect(x+cc*cell+cell*0.35, y+cr*cell+cell*0.35, 3*cell-cell*0.7, 3*cell-cell*0.7).fillColor(C.white).fill();
    doc.rect(x+cc*cell+cell, y+cr*cell+cell, cell, cell).fillColor(C.indigo).fill();
  });

  doc.font('Helvetica-Bold').fontSize(6).fillColor(C.slate500)
     .text('SCAN TO PAY', x, y + sz + 4, { width: sz, align: 'center', lineBreak: false });
}

function drawFooter(doc) {
  const fy = A4_H - 36;
  doc.rect(0, fy, A4_W, 36).fillColor(C.slate50).fill();
  doc.moveTo(0, fy).lineTo(A4_W, fy).strokeColor(C.slate300).lineWidth(0.4).stroke();

  doc.font('Helvetica').fontSize(7).fillColor(C.slate500)
     .text(
       'This is a computer-generated invoice and does not require a physical signature.',
       0, fy + 7, { align: 'center', width: A4_W, lineBreak: false }
     )
     .text(
       'Queries? support@rentease.com  ·  +91 1800-123-4567  ·  www.rentease.com',
       0, fy + 18, { align: 'center', width: A4_W, lineBreak: false }
     );
  doc.font('Helvetica').fontSize(6.5).fillColor(C.slate300)
     .text('Page 1 of 1', 0, fy + 26, { align: 'right', width: MR, lineBreak: false });
}

// ─── Public API ───────────────────────────────────────────────────────────────

class PDFService {
  /**
   * Generate a production-grade A4 Tax Invoice PDF using pdfkit.
   *
   * @param {Object} invoiceData
   * @param {string} outputPath
   * @returns {Promise<string>} resolves with outputPath
   */
  static generateInvoicePDF(invoiceData, outputPath) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 0,
        info: {
          Title:    `Invoice ${invoiceData.invoiceNumber}`,
          Author:   'RentEase Technologies Pvt. Ltd.',
          Subject:  'Tax Invoice',
          Keywords: 'invoice, rental, tax, GST',
        },
      });

      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      let y = drawHeader(doc, invoiceData);
      y = drawAddressBlock(doc, invoiceData, y);
      y = drawRentalStrip(doc, invoiceData, y);
      y = drawChargesTable(doc, invoiceData, y);

      // QR on right, payment section on left
      drawQRPlaceholder(doc, MR - 60, y);
      drawPaymentSection(doc, invoiceData, y);

      drawFooter(doc);

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    });
  }
}

module.exports = PDFService;


// ─── Quick test (node pdf.service.js) ────────────────────────────────────────
if (require.main === module) {
  const sample = {
    invoiceNumber: 'INV-2024-00847',
    date: '2024-03-15',
    vendor:   { name: 'RentEase Technologies Pvt. Ltd.', gstin: '27AABCR1234A1Z5' },
    customer: { name: 'Priya Sharma', email: 'priya.sharma@gmail.com', phone: '+91 98765 43210' },
    rental:   { number: 'RNT-2024-04521', startDate: '2024-01-01', endDate: '2024-06-30' },
    product:  { name: '3-Door French Door Refrigerator – Samsung 580L', sku: 'SAM-REF-580L-SS' },
    charges: {
      monthlyRent: 1499, tenureMonths: 6, subtotal: 8994,
      securityDeposit: 2998, deliveryCharges: 499,
      discount: 500, total: 11991, due: 0,
    },
    payments: [
      { date: '2024-01-01', amount: 3997, method: 'upi',         status: 'completed' },
      { date: '2024-02-01', amount: 1499, method: 'debit_card',  status: 'completed' },
      { date: '2024-03-01', amount: 1499, method: 'net_banking', status: 'completed' },
      { date: '2024-03-15', amount: 4996, method: 'upi',         status: 'completed' },
    ],
  };

  const out = '/mnt/user-data/outputs/rentease_invoice.pdf';
  PDFService.generateInvoicePDF(sample, out)
    .then(p => console.log('✓ PDF written →', p))
    .catch(e => { console.error('✗', e.message); process.exit(1); });
}