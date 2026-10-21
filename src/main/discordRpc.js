const net = require('net');
const path = require('path');
const fs = require('fs');

/**
 * Native Zero-Dependency Discord Rich Presence (RPC) Client for Voldex Client (Voldex Studios)
 * Connects directly to Discord local IPC socket on Linux, Windows, and macOS.
 * Shows player username, server voldex.zasemazi.cz (VoldexSMP), active profile, and live elapsed playtime.
 */

const DEFAULT_CLIENT_ID = '1557874962956550154'; // Voldex Client Official Discord App

const OPCODES = {
    HANDSHAKE: 0,
    FRAME: 1,
    CLOSE: 2,
    PING: 3,
    PONG: 4
};

class DiscordRpcClient {
    constructor(clientId = DEFAULT_CLIENT_ID) {
        this.clientId = clientId;
        this.socket = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.currentActivity = null;
        this.lastPlayedServer = null;
        this.reconnectTimer = null;
        this.readBuffer = Buffer.alloc(0);
        this.isSleeping = false;
    }

    /**
     * Resolves the Discord IPC socket path on current OS
     */
    getAvailableSocketPath() {
        if (process.platform === 'win32') {
            for (let i = 0; i < 10; i++) {
                const pipePath = `\\\\?\\pipe\\discord-ipc-${i}`;
                // On Windows, named pipe path can be tried directly
                return pipePath;
            }
        } else {
            const runtimeDir = process.env.XDG_RUNTIME_DIR;
            const searchDirs = [
                runtimeDir,
                runtimeDir ? path.join(runtimeDir, 'app', 'com.discordapp.Discord') : null,
                runtimeDir ? path.join(runtimeDir, 'snap.discord') : null,
                process.env.TMPDIR,
                process.env.TMP,
                process.env.TEMP,
                '/tmp'
            ].filter(Boolean);

            for (const dir of searchDirs) {
                for (let i = 0; i < 10; i++) {
                    const socketPath = path.join(dir, `discord-ipc-${i}`);
                    try {
                        if (fs.existsSync(socketPath)) {
                            return socketPath;
                        }
                    } catch (e) {}
                }
            }
        }
        return null;
    }

    /**
     * Connects to the Discord local IPC
     */
    connect() {
        if (this.isConnected || this.isConnecting) return;
        this.isConnecting = true;

        const socketPath = this.getAvailableSocketPath();
        if (!socketPath) {
            this.isConnecting = false;
            this.scheduleReconnect(15000);
            return;
        }

        try {
            const socket = net.createConnection(socketPath);

            socket.on('connect', () => {
                this.socket = socket;
                this.isConnecting = false;
                this.readBuffer = Buffer.alloc(0);
                this.sendHandshake();
            });

            socket.on('data', (data) => {
                this.handleData(data);
            });

            socket.on('error', () => {
                this.cleanup();
                this.scheduleReconnect(20000);
            });

            socket.on('close', () => {
                this.cleanup();
                this.scheduleReconnect(15000);
            });
        } catch (err) {
            this.cleanup();
            this.scheduleReconnect(20000);
        }
    }

    scheduleReconnect(delay = 15000) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    }

    cleanup() {
        this.isConnected = false;
        this.isConnecting = false;
        if (this.socket) {
            try { this.socket.destroy(); } catch (e) {}
            this.socket = null;
        }
        this.readBuffer = Buffer.alloc(0);
    }

    sendPacket(opcode, payloadObj) {
        if (!this.socket || this.socket.destroyed) return;
        try {
            const jsonStr = JSON.stringify(payloadObj);
            const bodyBuffer = Buffer.from(jsonStr, 'utf-8');
            const header = Buffer.alloc(8);
            header.writeUInt32LE(opcode, 0);
            header.writeUInt32LE(bodyBuffer.length, 4);

            const packet = Buffer.concat([header, bodyBuffer]);
            this.socket.write(packet);
        } catch (e) {
            console.warn('[DISCORD RPC] Chyba při odesílání paketu:', e.message);
        }
    }

    sendHandshake() {
        this.sendPacket(OPCODES.HANDSHAKE, {
            v: 1,
            client_id: this.clientId
        });
    }

    handleData(chunk) {
        this.readBuffer = Buffer.concat([this.readBuffer, chunk]);

        while (this.readBuffer.length >= 8) {
            const opcode = this.readBuffer.readUInt32LE(0);
            const length = this.readBuffer.readUInt32LE(4);

            if (this.readBuffer.length < 8 + length) {
                // Wait for complete frame
                break;
            }

            const body = this.readBuffer.slice(8, 8 + length);
            this.readBuffer = this.readBuffer.slice(8 + length);

            try {
                const message = JSON.parse(body.toString('utf-8'));
                this.handleMessage(opcode, message);
            } catch (e) {}
        }
    }

    handleMessage(opcode, message) {
        if (opcode === OPCODES.FRAME) {
            if (message.cmd === 'DISPATCH' && message.evt === 'READY') {
                this.isConnected = true;
                // Resend current pending activity
                if (this.currentActivity) {
                    this.sendActivity(this.currentActivity);
                }
            } else if (message.evt === 'ERROR') {
                console.warn('[DISCORD RPC] Discord vrátil chybu aktivity:', message.data?.message || message);
            } else if (opcode === OPCODES.PING) {
                this.sendPacket(OPCODES.PONG, message.data || {});
            }
        }
    }

    sendActivity(activity) {
        this.sendPacket(OPCODES.FRAME, {
            cmd: 'SET_ACTIVITY',
            args: {
                pid: process.pid,
                activity: activity
            },
            nonce: Math.random().toString(36).substring(2, 15)
        });
    }

    /**
     * Updates Discord Rich Presence state
     * @param {Object} options
     * @param {string} options.username Player username
     * @param {string} options.server Name or IP of server (e.g. 'voldex.zasemazi.cz', 'mc.hypixel.net', 'Singleplayer', 'menu')
     * @param {string} [options.serverIcon] Optional explicit URL to server favicon
     * @param {string} options.profileName Active profile name (e.g. 'Minecraft 26.2')
     * @param {boolean} options.isPlaying Whether the game is actively running
     * @param {number} [options.startTime] Game session start timestamp ms
     */
    updateActivity(options = {}) {
        const {
            username = 'Hráč',
            server = 'voldex.zasemazi.cz',
            serverIcon = null,
            profileName = 'Minecraft 26.2',
            isPlaying = false,
            startTime = null
        } = options;

        const safeStr = (str, maxLen = 128) => {
            if (!str) return '';
            const s = String(str).trim();
            return s.length > maxLen ? s.substring(0, maxLen - 1) + '…' : s;
        };

        const isLocalOrPrivate = (host) => {
            if (!host) return false;
            const h = host.toLowerCase().trim().replace(/:\d+$/, '');
            if (h === 'localhost' || h === '127.0.0.1' || h.startsWith('127.')) return true;
            if (h.startsWith('192.168.') || h.startsWith('10.')) return true;
            if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
            return false;
        };

        const VOLDEX_ICON = 'https://api.mcstatus.io/v2/icon/voldex.zasemazi.cz';
        const LOGO_ICON = 'https://api.mcstatus.io/v2/icon/voldex.zasemazi.cz';

        let sRaw = (server || '').toString().trim();
        let sLower = sRaw.toLowerCase();

        // Bezpečnostní filtr: pokud se do serveru dostane 'voice' z logu voice chatu nebo jiné neplatné slovo
        const isDisallowedServer = ['voice', 'voicechat', 'server', 'chat', 'undefined', 'null'].includes(sLower) || sLower.startsWith('voice.');
        if (isDisallowedServer) {
            sRaw = this.lastPlayedServer || 'menu';
            sLower = sRaw.toLowerCase();
        } else if (isPlaying && sRaw && sRaw !== 'menu' && !sLower.includes('singleplayer')) {
            this.lastPlayedServer = sRaw;
        }

        const isSingleplayer = sLower === 'singleplayer' || sLower === 'režim jednoho hráče' || sLower === 'sp';
        const isMenu = !sRaw || sLower === 'menu' || sLower === 'main_menu';
        const isVoldex = !isSingleplayer && !isMenu && (sLower.includes('voldex') || sLower.includes('zasemazi'));

        let activity = null;

        if (isPlaying) {
            let detailsText = '';
            let largeImageUrl = LOGO_ICON;
            let largeImageText = `Voldex Client (${profileName})`;
            let smallImageUrl = LOGO_ICON;
            let smallImageText = `Voldex Client (${profileName})`;

            if (isVoldex) {
                const sLabel = 'voldex.zasemazi.cz';
                detailsText = `Hraje na: ${sLabel}`;
                largeImageUrl = VOLDEX_ICON;
                largeImageText = `VoldexSMP (${sLabel})`;
                smallImageUrl = LOGO_ICON;
                smallImageText = `Voldex Client (${profileName})`;
            } else if (isSingleplayer) {
                detailsText = 'Hraje: Singleplayer';
                largeImageUrl = LOGO_ICON;
                largeImageText = `Singleplayer (${profileName})`;
                smallImageUrl = VOLDEX_ICON;
                smallImageText = 'VoldexSMP';
            } else if (isMenu) {
                detailsText = 'V hlavním menu hry';
                largeImageUrl = LOGO_ICON;
                largeImageText = `Voldex Client (${profileName})`;
                smallImageUrl = VOLDEX_ICON;
                smallImageText = 'VoldexSMP';
            } else {
                detailsText = `Hraje na: ${sRaw}`;
                largeImageText = `Server: ${sRaw}`;

                if (serverIcon && typeof serverIcon === 'string' && serverIcon.startsWith('http')) {
                    largeImageUrl = serverIcon;
                } else if (!isLocalOrPrivate(sRaw)) {
                    largeImageUrl = `https://api.mcstatus.io/v2/icon/${encodeURIComponent(sRaw)}`;
                } else {
                    largeImageUrl = LOGO_ICON;
                }

                smallImageUrl = LOGO_ICON;
                smallImageText = `Voldex Client (${profileName})`;
            }

            activity = {
                details: safeStr(detailsText),
                state: safeStr(`Hráč: ${username} • ${profileName}`),
                timestamps: {
                    start: startTime || Date.now()
                },
                assets: {
                    large_image: largeImageUrl,
                    large_text: safeStr(largeImageText),
                    small_image: smallImageUrl,
                    small_text: safeStr(smallImageText)
                },
                buttons: [
                    { label: '🎮 VoldexSMP', url: 'https://voldex.zasemazi.cz' }
                ]
            };
        } else {
            const assets = {
                large_image: LOGO_ICON,
                large_text: `Voldex Client (${profileName})`,
                small_image: VOLDEX_ICON,
                small_text: 'VoldexSMP (voldex.zasemazi.cz)'
            };

            const userPart = username && username !== 'Hráč' ? `Hráč: ${username} • ` : '';
            activity = {
                details: 'Voldex Client • Voldex Studios',
                state: safeStr(`${userPart}${profileName}`),
                assets,
                buttons: [
                    { label: '🎮 VoldexSMP', url: 'https://voldex.zasemazi.cz' }
                ]
            };
        }

        this.currentActivity = activity;

        if (this.isConnected) {
            this.sendActivity(activity);
        } else {
            this.connect();
        }
    }

    clearActivity() {
        this.currentActivity = null;
        if (this.isConnected) {
            this.sendActivity(null);
        }
    }

    shutdown() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.clearActivity();
        this.cleanup();
    }
}

// Singleton instance
const discordRpc = new DiscordRpcClient();

module.exports = {
    discordRpc,
    DiscordRpcClient
};
