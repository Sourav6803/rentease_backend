const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/**
 * Encryption utilities for sensitive data
 */
class Encryption {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.secretKey = process.env.ENCRYPTION_KEY;
    this.saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    
    if (!this.secretKey && process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY is required in production');
    }
    
    // Derive key if needed
    if (this.secretKey && this.secretKey.length !== 32) {
      this.secretKey = crypto
        .createHash('sha256')
        .update(this.secretKey)
        .digest('base64')
        .substring(0, 32);
    }
  }

  /**
   * Hash password using bcrypt
   */
  async hashPassword(password) {
    return bcrypt.hash(password, this.saltRounds);
  }

  /**
   * Compare password with hash
   */
  async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate random token
   */
  generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate OTP
   */
  generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }

  /**
   * Encrypt text
   */
  encrypt(text) {
    if (!this.secretKey) return text; // Fallback for development
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      this.algorithm,
      Buffer.from(this.secretKey, 'utf8'),
      iv
    );

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  /**
   * Encrypt and return a value safe for Mongoose `String` fields (`encrypt()` returns an object).
   */
  encryptToString(text) {
    const payload = this.encrypt(text);
    if (typeof payload === 'string') return payload;
    return JSON.stringify(payload);
  }

  /**
   * Decrypt a value stored via `encryptToString` (JSON) or plaintext dev fallback.
   */
  decryptFromString(stored) {
    if (stored == null || stored === '') return stored;
    if (typeof stored !== 'string') return stored;
    if (!this.secretKey) return stored;

    try {
      const obj = JSON.parse(stored);
      if (obj && typeof obj.encrypted === 'string' && obj.iv && obj.authTag) {
        return this.decrypt(obj);
      }
    } catch {
      /* not JSON — legacy plaintext */
    }
    return stored;
  }

  /**
   * Decrypt text
   */
  decrypt(encryptedData) {
    if (!this.secretKey) return encryptedData; // Fallback for development

    const decipher = crypto.createDecipheriv(
      this.algorithm,
      Buffer.from(this.secretKey, 'utf8'),
      Buffer.from(encryptedData.iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Hash data (one-way)
   */
  hash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate HMAC
   */
  generateHmac(data, key = this.secretKey) {
    return crypto
      .createHmac('sha256', key)
      .update(data)
      .digest('hex');
  }

  /**
   * Generate random string
   */
  randomString(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate UUID v4
   */
  generateUUID() {
    return crypto.randomUUID();
  }

  /**
   * Encrypt object
   */
  encryptObject(obj) {
    const jsonString = JSON.stringify(obj);
    return this.encrypt(jsonString);
  }

  /**
   * Decrypt object
   */
  decryptObject(encryptedData) {
    const decrypted = this.decrypt(encryptedData);
    return JSON.parse(decrypted);
  }

  /**
   * Mask sensitive data (for logging)
   */
  maskSensitiveData(data, fields = ['password', 'token', 'secret']) {
    if (!data) return data;
    
    const masked = { ...data };
    
    const maskField = (obj, field) => {
      if (obj[field]) {
        obj[field] = '********';
      }
    };
    
    if (Array.isArray(masked)) {
      masked.forEach(item => {
        fields.forEach(field => maskField(item, field));
      });
    } else {
      fields.forEach(field => maskField(masked, field));
    }
    
    return masked;
  }

  /**
   * Generate JWT secret
   */
  generateJWTSecret() {
    return this.randomString(64);
  }

  /**
   * Create signature
   */
  createSignature(data, secret) {
    return crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(data))
      .digest('hex');
  }

  /**
   * Verify signature
   */
  verifySignature(data, signature, secret) {
    const expectedSignature = this.createSignature(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Generate key pair for encryption
   */
  generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    return { publicKey, privateKey };
  }

  /**
   * Encrypt with public key
   */
  encryptWithPublicKey(text, publicKey) {
    const buffer = Buffer.from(text, 'utf8');
    const encrypted = crypto.publicEncrypt(publicKey, buffer);
    return encrypted.toString('base64');
  }

  /**
   * Decrypt with private key
   */
  decryptWithPrivateKey(encrypted, privateKey) {
    const buffer = Buffer.from(encrypted, 'base64');
    const decrypted = crypto.privateDecrypt(privateKey, buffer);
    return decrypted.toString('utf8');
  }
}

module.exports = new Encryption();