const fs = require('fs');
const file = 'D:/RentEase/backend/src/services/auth.service.js';
const original = fs.readFileSync(file, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n';
const lines = original.split(/\r?\n/);

const targets = [
  'sending verification email ',
  'resetToken-->',
  'resetTokenHash-->',
  'resetUrl11-->',
  'resetUrl22-->',
  'Received token:',
  'Received token length:',
  'hashedPassword-->',
  'passwordHistory-->',
  'user-> register vendor',
  'vendorId-> register vendor',
  'user created with ID:',
];

const removed = [];
const kept = lines.filter((line) => {
  const t = line.trim();
  if (!t.startsWith('console.log(')) return true;
  const hit = targets.find((k) => t.includes(k));
  if (hit) { removed.push(hit); return false; }
  return true;
});

fs.writeFileSync(file, kept.join(eol), 'utf8');
console.log('removed line count:', removed.length);
console.log('removed targets  :', removed.join(' | '));

const missing = targets.filter((k) => !removed.includes(k));
console.log('NOT removed      :', missing.length ? missing.join(' | ') : '(none — all targets matched)');
