const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

let safeStorage = null;
try {
    const electron = require('electron');
    safeStorage = electron.safeStorage || null;
} catch (_) {}

/**
 * Universal Hardware & User Fingerprint for Linux (Ubuntu, Arch, CachyOS, Fedora, Debian, etc.)
 * Ensures that encrypted credentials cannot be stolen and decrypted on another machine.
 */
function getLinuxMachineId() {
    // 1. Standard systemd machine-id (Ubuntu, Arch, CachyOS, Fedora, Debian, etc.)
    try {
        if (fs.existsSync('/etc/machine-id')) {
            const id = fs.readFileSync('/etc/machine-id', 'utf8').trim();
            if (id.length > 0) return id;
        }
    } catch (_) {}

    // 2. D-Bus machine-id fallback
    try {
        if (fs.existsSync('/var/lib/dbus/machine-id')) {
            const id = fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
            if (id.length > 0) return id;
        }
    } catch (_) {}

    // 3. Motherboard / Product UUID fallback
    try {
        if (fs.existsSync('/sys/class/dmi/id/product_uuid')) {
            const id = fs.readFileSync('/sys/class/dmi/id/product_uuid', 'utf8').trim();
            if (id.length > 0) return id;
        }
    } catch (_) {}

    return '';
}

function getWindowsMachineId() {
    try {
        return process.env.COMPUTERNAME || os.hostname() || '';
    } catch (_) {
        return '';
    }
}

function getDeviceFingerprint() {
    let userInfo = '';
    try {
        const u = os.userInfo();
        userInfo = `${u.username}:${u.uid !== undefined ? u.uid : 0}:${u.homedir}`;
    } catch (_) {
        userInfo = `${process.env.USER || process.env.USERNAME || 'user'}:${os.homedir()}`;
    }

    const platform = process.platform;
    const machineId = platform === 'linux' ? getLinuxMachineId() : (platform === 'win32' ? getWindowsMachineId() : '');
    const cpus = os.cpus() || [];
    const cpuModel = cpus[0] ? cpus[0].model : 'generic-cpu';
    const arch = os.arch();

    return `${platform}::${machineId}::${userInfo}::${cpuModel}::${arch}`;
}

const VAULT_SALT = 'VoldexSMP_Vault_HardwareBound_Salt_v2_2026';
let cachedKey = null;

function getDerivedKey() {
    if (cachedKey) return cachedKey;
    const fingerprint = getDeviceFingerprint();
    cachedKey = crypto.pbkdf2Sync(fingerprint, VAULT_SALT, 100000, 32, 'sha256');
    return cachedKey;
}

/**
 * Encrypts sensitive credentials:
 * - On Windows: Uses DPAPI via safeStorage if available, otherwise AES-256-GCM.
 * - On Linux: Uses machine-and-user-bound AES-256-GCM (universal for Ubuntu, Arch, CachyOS, Fedora, etc.).
 */
function encryptSecret(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') return plaintext;
    if (plaintext.startsWith('enc:v2:')) {
        return plaintext; // Already encrypted
    }

    // 1. Windows DPAPI via Electron safeStorage (if supported and available)
    if (process.platform === 'win32' && safeStorage && typeof safeStorage.isEncryptionAvailable === 'function') {
        try {
            if (safeStorage.isEncryptionAvailable()) {
                const encrypted = safeStorage.encryptString(plaintext);
                return `enc:v2:dpapi:${encrypted.toString('base64')}`;
            }
        } catch (e) {
            console.warn('[VAULT] Windows safeStorage selhalo, přepínám na AES-256-GCM fallback:', e.message);
        }
    }

    // 2. Universal Linux (Ubuntu/Arch/CachyOS/Fedora) & Windows fallback: AES-256-GCM
    try {
        const key = getDerivedKey();
        const iv = crypto.randomBytes(12); // 96-bit IV standard for GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `enc:v2:aes-gcm:${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (err) {
        console.error('[VAULT] Chyba při šifrování tokenu:', err);
        return plaintext;
    }
}

/**
 * Decrypts sensitive credentials transparently.
 * Handles legacy plaintext, Windows DPAPI and Linux hardware-bound AES-256-GCM.
 */
function decryptSecret(ciphertext) {
    if (!ciphertext || typeof ciphertext !== 'string') return ciphertext;

    // Plaintext / legacy token
    if (!ciphertext.startsWith('enc:v2:')) {
        return ciphertext;
    }

    // Windows DPAPI
    if (ciphertext.startsWith('enc:v2:dpapi:')) {
        const base64Data = ciphertext.replace('enc:v2:dpapi:', '');
        if (safeStorage && typeof safeStorage.decryptString === 'function') {
            try {
                const buf = Buffer.from(base64Data, 'base64');
                return safeStorage.decryptString(buf);
            } catch (err) {
                console.error('[VAULT] Chyba dešifrování DPAPI:', err.message);
                return null;
            }
        }
        return null;
    }

    // Universal AES-256-GCM (Linux / Windows fallback)
    if (ciphertext.startsWith('enc:v2:aes-gcm:')) {
        try {
            const parts = ciphertext.split(':');
            // format: enc:v2:aes-gcm:<iv>:<tag>:<encrypted>
            if (parts.length !== 6) return null;
            const ivHex = parts[3];
            const tagHex = parts[4];
            const dataHex = parts[5];

            const key = getDerivedKey();
            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(tagHex, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(dataHex, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (err) {
            console.error('[VAULT] Chyba dešifrování AES-256-GCM:', err.message);
            return null;
        }
    }

    return ciphertext;
}

const SENSITIVE_KEYS = ['access_token', 'refreshToken', 'client_token'];

/**
 * Protects an account object for storage on disk.
 */
function protectAccount(account) {
    if (!account || typeof account !== 'object') return account;
    const cloned = { ...account };
    for (const key of SENSITIVE_KEYS) {
        if (typeof cloned[key] === 'string' && cloned[key]) {
            cloned[key] = encryptSecret(cloned[key]);
        }
    }
    if (cloned.meta && typeof cloned.meta === 'object') {
        cloned.meta = { ...cloned.meta };
        if (typeof cloned.meta.refresh === 'string' && cloned.meta.refresh) {
            cloned.meta.refresh = encryptSecret(cloned.meta.refresh);
        }
    }
    return cloned;
}

/**
 * Unprotects an account object for use in launcher memory.
 */
function unprotectAccount(account) {
    if (!account || typeof account !== 'object') return account;
    const cloned = { ...account };
    for (const key of SENSITIVE_KEYS) {
        if (typeof cloned[key] === 'string' && cloned[key]) {
            const dec = decryptSecret(cloned[key]);
            if (dec !== null) cloned[key] = dec;
        }
    }
    if (cloned.meta && typeof cloned.meta === 'object') {
        cloned.meta = { ...cloned.meta };
        if (typeof cloned.meta.refresh === 'string' && cloned.meta.refresh) {
            const dec = decryptSecret(cloned.meta.refresh);
            if (dec !== null) cloned.meta.refresh = dec;
        }
    }
    return cloned;
}

/**
 * Sanitizes an account object to remove all raw authentication secrets
 * before passing it to the renderer UI.
 */
function sanitizeAccountForRenderer(account) {
    if (!account || typeof account !== 'object') return null;
    return {
        name: account.name || account.username || 'Hráč',
        username: account.username || account.name || 'Hráč',
        uuid: account.uuid || account.id || '',
        skinUrl: account.skinUrl || null,
        skins: account.skins || [],
        capes: account.capes || [],
        authType: 'microsoft'
    };
}

module.exports = {
    encryptSecret,
    decryptSecret,
    protectAccount,
    unprotectAccount,
    sanitizeAccountForRenderer,
    getDeviceFingerprint
};
