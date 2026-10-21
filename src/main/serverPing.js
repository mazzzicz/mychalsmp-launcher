let util = null;
try {
    util = require('minecraft-server-util');
} catch (e) {
    console.warn('[SERVER PING] Knihovna minecraft-server-util není dostupná, používám HTTP fallback:', e.message);
}

async function pingServer(host = 'voldex.zasemazi.cz', port = 25565) {
    // 1. Try direct Minecraft protocol TCP Ping
    if (util && typeof util.status === 'function') {
        try {
            const result = await util.status(host, port, {
                timeout: 3500,
                enableSRV: true
            });

            return {
                online: true,
                host,
                port,
                isBackup: false,
                players: {
                    online: result.players.online || 0,
                    max: result.players.max || 100
                },
                version: result.version ? result.version.name : '26.2 / 1.21.11',
                motd: result.motd ? (result.motd.clean || result.motd.raw) : 'VoldexSMP • Voldex Studios',
                latency: result.roundTripLatency || 14,
                favicon: result.favicon || null
            };
        } catch (directErr) {
            // Pokračujeme na HTTP fallback níže
        }
    }

    // 2. Fallback to global mcstatus.io API
    try {
        const res = await fetch(`https://api.mcstatus.io/v2/status/java/${host}:${port}`);
        if (res.ok) {
            const data = await res.json();
            if (data.online) {
                return {
                    online: true,
                    host,
                    port,
                    isBackup: false,
                    players: {
                        online: data.players ? data.players.online : 0,
                        max: data.players ? data.players.max : 100
                    },
                    version: data.version ? data.version.name_clean : '26.2',
                    motd: data.motd ? data.motd.clean : 'VoldexSMP • Voldex Studios',
                    latency: 18,
                    favicon: data.icon || null
                };
            }
        }
    } catch (apiErr) {
        // Both failed
    }

    return {
        online: false,
        host,
        port,
        isBackup: false,
        players: { online: 0, max: 0 },
        version: 'Offline',
        motd: 'VoldexSMP (voldex.zasemazi.cz)',
        latency: -1,
        favicon: null
    };
}

module.exports = { pingServer };
