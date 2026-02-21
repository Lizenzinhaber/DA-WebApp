/**
 * @file passwordGenerator.js
 * Generiert sichere 16-Zeichen-Passwörter für den AP
 */

const crypto = require('crypto');

/**
 * Generiere ein zufälliges 16-Zeichen-Passwort
 * Format: Großbuchstaben, Kleinbuchstaben, Zahlen, Sonderzeichen
 * 
 * @returns {string} Genau 16 charakters langes Passwort
 */
function generateAPPassword() {
  // Sichere Charset: Buchstaben, Zahlen, sichere Sonderzeichen
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  
  // Generiere 16 zufällige Bytes
  const randomBytes = crypto.randomBytes(16);
  
  let password = '';
  for (let i = 0; i < 16; i++) {
    // Nutze jeden Byte zum Index in charset
    password += charset[randomBytes[i] % charset.length];
  }
  
  return password;
}

/**
 * Validiere ein Passwort (muss genau 16 Zeichen sein)
 * 
 * @param {string} password - Zu validierendes Passwort
 * @returns {boolean} true wenn valid
 */
function validatePasswordLength(password) {
  return typeof password === 'string' && password.length === 16;
}

module.exports = {
  generateAPPassword,
  validatePasswordLength
};
