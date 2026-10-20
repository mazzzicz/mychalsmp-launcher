/**
 * MYCHAL SMP Launcher - Performance & Profile Optimizer
 * Manages essential Fabric mods (Sodium, Lithium, Iris, Fabric API),
 * shaders (Complementary Reimagined), Minecraft GUI scale, and servers.dat.
 */

const fs = require('fs');
const path = require('path');
const { downloadModOrPack } = require('./modrinth');
const nativeLoader = require('./nativeLoader');

/**
 * Ensures guiScale:2 in Minecraft's options.txt.
 */
function ensureOptionsGuiScale(gameDir, scale = 2) {
    if (nativeLoader.isNativeActive()) {
        try {
            return nativeLoader.fastEnsureGuiScale(gameDir, scale);
        } catch (_) {}
    }

    try {
        if (!fs.existsSync(gameDir)) {
            fs.mkdirSync(gameDir, { recursive: true });
        }
        const optionsPath = path.join(gameDir, 'options.txt');
        let content = '';
        if (fs.existsSync(optionsPath)) {
            content = fs.readFileSync(optionsPath, 'utf8');
        }

        const scaleRegex = /^guiScale:\s*\d+/m;
        const currentMatch = content.match(scaleRegex);
        if (currentMatch && currentMatch[0] === `guiScale:${scale}`) {
            return true; // Již nastaveno, ušetříme synchronní diskový zápis
        }
        if (currentMatch) {
            content = content.replace(scaleRegex, `guiScale:${scale}`);
        } else {
            content = (content ? content.trimEnd() + '\n' : '') + `guiScale:${scale}\n`;
        }

        fs.writeFileSync(optionsPath, content, 'utf8');
        return true;
    } catch (e) {
        console.warn('[OPTIMIZER] Nepodařilo se zapsat guiScale do options.txt:', e.message);
        return false;
    }
}

/**
 * Builds an uncompressed NBT buffer representing Minecraft's servers.dat format.
 */
function buildServersDatBuffer(serverList) {
    const buffers = [];

    function writeString(str) {
        const strBuf = Buffer.from(str, 'utf8');
        const lenBuf = Buffer.alloc(2);
        lenBuf.writeUInt16BE(strBuf.length, 0);
        return Buffer.concat([lenBuf, strBuf]);
    }

    // Root TAG_Compound (id 0x0A, empty name length 0)
    buffers.push(Buffer.from([0x0a, 0x00, 0x00]));

    // TAG_List, name = "servers", item type = TAG_Compound (0x0A)
    const listName = Buffer.from('servers', 'utf8');
    const listHeader = Buffer.alloc(1 + 2 + listName.length + 1 + 4);
    let offset = 0;
    listHeader.writeUInt8(0x09, offset++);
    listHeader.writeUInt16BE(listName.length, offset); offset += 2;
    listName.copy(listHeader, offset); offset += listName.length;
    listHeader.writeUInt8(0x0a, offset++);
    listHeader.writeInt32BE(serverList.length, offset); offset += 4;
    buffers.push(listHeader);

    for (const srv of serverList) {
        const srvName = srv.name || 'Minecraft Server';
        const srvIp = srv.ip || srv.address || 'mychalsmp.xyz';

        // TAG_String name="name"
        const nameKey = Buffer.from('name', 'utf8');
        const nameTagHdr = Buffer.alloc(1 + 2 + nameKey.length);
        nameTagHdr.writeUInt8(0x08, 0);
        nameTagHdr.writeUInt16BE(nameKey.length, 1);
        nameKey.copy(nameTagHdr, 3);
        buffers.push(nameTagHdr, writeString(srvName));

        // TAG_String name="ip"
        const ipKey = Buffer.from('ip', 'utf8');
        const ipTagHdr = Buffer.alloc(1 + 2 + ipKey.length);
        ipTagHdr.writeUInt8(0x08, 0);
        ipTagHdr.writeUInt16BE(ipKey.length, 1);
        ipKey.copy(ipTagHdr, 3);
        buffers.push(ipTagHdr, writeString(srvIp));

        // TAG_Byte name="acceptTextures" value=1
        const texKey = Buffer.from('acceptTextures', 'utf8');
        const texTag = Buffer.alloc(1 + 2 + texKey.length + 1);
        texTag.writeUInt8(0x01, 0);
        texTag.writeUInt16BE(texKey.length, 1);
        texKey.copy(texTag, 3);
        texTag.writeUInt8(1, 3 + texKey.length);
        buffers.push(texTag);

        // TAG_End of server entry
        buffers.push(Buffer.from([0x00]));
    }

    // Root TAG_End
    buffers.push(Buffer.from([0x00]));

    return Buffer.concat(buffers);
}

/**
 * Parses existing servers from an uncompressed NBT servers.dat.
 */
function parseExistingServersDat(buffer) {
    const servers = [];
    try {
        if (!buffer || buffer.length < 10 || buffer[0] !== 0x0a) return servers;
        let offset = 1;
        const rootNameLen = buffer.readUInt16BE(offset); offset += 2 + rootNameLen;

        while (offset < buffer.length - 1) {
            const tagId = buffer.readUInt8(offset++);
            if (tagId === 0x00) break;
            const nameLen = buffer.readUInt16BE(offset); offset += 2;
            const tagName = buffer.toString('utf8', offset, offset + nameLen); offset += nameLen;

            if (tagId === 0x09 && tagName === 'servers') {
                const itemType = buffer.readUInt8(offset++);
                const count = buffer.readInt32BE(offset); offset += 4;
                if (itemType === 0x0a) {
                    for (let i = 0; i < count; i++) {
                        let sName = '';
                        let sIp = '';
                        let sAccept = 1;
                        while (offset < buffer.length) {
                            const subTag = buffer.readUInt8(offset++);
                            if (subTag === 0x00) break;
                            const subNameLen = buffer.readUInt16BE(offset); offset += 2;
                            const subTagName = buffer.toString('utf8', offset, offset + subNameLen); offset += subNameLen;

                            if (subTag === 0x08) {
                                const strLen = buffer.readUInt16BE(offset); offset += 2;
                                const strVal = buffer.toString('utf8', offset, offset + strLen); offset += strLen;
                                if (subTagName === 'name') sName = strVal;
                                else if (subTagName === 'ip') sIp = strVal;
                            } else if (subTag === 0x01) {
                                sAccept = buffer.readInt8(offset++);
                            } else if (subTag === 0x02) {
                                offset += 2;
                            } else if (subTag === 0x03) {
                                offset += 4;
                            } else if (subTag === 0x04) {
                                offset += 8;
                            } else if (subTag === 0x07) {
                                const len = buffer.readInt32BE(offset); offset += 4 + len;
                            } else {
                                break;
                            }
                        }
                        if (sIp) {
                            servers.push({ name: sName || sIp, ip: sIp, acceptTextures: sAccept });
                        }
                    }
                }
            }
        }
    } catch (_) {}
    return servers;
}

/**
 * Normalizes a Minecraft server address (strips default port 25565, trims, lowercases).
 */
function normalizeServerIp(rawIp) {
    if (!rawIp) return '';
    let ip = String(rawIp).trim().toLowerCase();
    if (ip.endsWith(':25565')) {
        ip = ip.slice(0, -6);
    }
    if (ip.endsWith('.')) {
        ip = ip.slice(0, -1);
    }
    return ip;
}

/**
 * Checks if two server addresses point to the same server,
 * taking aliases and default Minecraft ports into account.
 */
function isSameServerAddress(ipA, ipB) {
    const a = normalizeServerIp(ipA);
    const b = normalizeServerIp(ipB);
    if (!a || !b) return false;
    if (a === b) return true;

    // Známé síťové aliasy a záložní IP pro MYCHAL SMP
    const mychalAliases = ['mychalsmp.xyz', 'join.mychalsmp.xyz', '130.61.89.37'];
    if (mychalAliases.includes(a) && mychalAliases.includes(b)) {
        return true;
    }
    return false;
}

/**
 * Synchronizes servers.dat in gameDir without bloating or re-injecting servers the user removed.
 * - Deduplicates servers by normalized IP address (eliminates duplicates caused by quick play or :25565).
 * - For a brand new profile without servers.dat, initializes with MYCHAL SMP so new players can join immediately.
 * - If the player explicitly removed MYCHAL SMP from their servers.dat, respects their choice and does NOT force it back.
 * - Preserves custom names, texture settings, and server order.
 */
function syncServersDat(gameDir, additionalServers = []) {
    try {
        if (!fs.existsSync(gameDir)) {
            fs.mkdirSync(gameDir, { recursive: true });
        }
        const srvFile = path.join(gameDir, 'servers.dat');
        const fileExists = fs.existsSync(srvFile);
        let existing = [];
        if (fileExists) {
            existing = parseExistingServersDat(fs.readFileSync(srvFile));
        }

        // 1. Deduplikace stávajících serverů (oprava duplicit po starých verzích / Quick Play)
        const deduplicated = [];
        for (const s of existing) {
            if (!s || !s.ip) continue;
            const alreadyExists = deduplicated.some(d => isSameServerAddress(d.ip, s.ip));
            if (!alreadyExists) {
                // Zachováme čistou adresu bez zbytečného :25565
                const cleanIp = normalizeServerIp(s.ip);
                deduplicated.push({
                    name: s.name || cleanIp,
                    ip: cleanIp,
                    acceptTextures: s.acceptTextures !== undefined ? s.acceptTextures : 1
                });
            }
        }

        // 2. Pouze pokud soubor vůbec neexistoval (úplně nový profil), přidáme výchozí MYCHAL SMP
        if (!fileExists) {
            deduplicated.unshift({
                name: 'MYCHAL SMP',
                ip: 'mychalsmp.xyz',
                acceptTextures: 1
            });
        }

        // 3. Doplníme servery z konfigurace launcheru pouze v případě, že ještě nejsou v seznamu
        for (const s of (additionalServers || [])) {
            const sIp = (s.ip || s.subdomain || '').trim();
            if (!sIp) continue;
            const alreadyPresent = deduplicated.some(d => isSameServerAddress(d.ip, sIp));
            if (!alreadyPresent) {
                deduplicated.push({
                    name: s.name || sIp,
                    ip: normalizeServerIp(sIp),
                    acceptTextures: 1
                });
            }
        }

        if (nativeLoader.isNativeActive()) {
            try {
                if (nativeLoader.fastBuildServersDat(deduplicated, srvFile)) {
                    return true;
                }
            } catch (_) {}
        }

        const buf = buildServersDatBuffer(deduplicated);
        fs.writeFileSync(srvFile, buf);
        return true;
    } catch (err) {
        console.warn('[OPTIMIZER] Chyba při synchronizaci servers.dat:', err.message);
        return false;
    }
}

/**
 * Checks if essential optimization mods are already present in gameDir.
 */
function checkInstalledOptimizationMods(gameDir, version = '26.2') {
    const modsDir = path.join(gameDir, 'mods');
    const shaderDir = path.join(gameDir, 'shaderpacks');

    const result = {
        hasFabricApi: false,
        hasSodium: false,
        hasLithium: false,
        hasIris: false,
        hasComplementary: false,
        oldSodiumFilename: null
    };

    if (fs.existsSync(modsDir)) {
        let allEntries = [];
        try { allEntries = fs.readdirSync(modsDir); } catch (_) {}
        // Pouze aktivní .jar soubory (žádné .disabled)
        const jarFiles = allEntries.filter(f => {
            const l = f.toLowerCase();
            return l.endsWith('.jar') && !l.endsWith('.disabled');
        });

        result.hasFabricApi = jarFiles.some(f => {
            const l = f.toLowerCase();
            return l.includes('fabric-api') || l.includes('fabric_api');
        });

        // Sodium: nesmí to být deriváty (sodium-extra, rubidium, reeses options apod.)
        const sodiumFile = jarFiles.find(f => {
            const l = f.toLowerCase();
            if (l.includes('extra') || l.includes('options') || l.includes('menu')) return false;
            return l.startsWith('sodium-') || l.startsWith('sodium_') || l === 'sodium.jar';
        });

        if (sodiumFile) {
            // Pokud jsme na MC 26.2 a Iris striktně vyžaduje Sodium 0.9.x, ověříme kompatibilitu
            if (version === '26.2' || String(version).startsWith('26.')) {
                if (sodiumFile.toLowerCase().includes('0.9')) {
                    result.hasSodium = true;
                } else {
                    result.hasSodium = false;
                    result.oldSodiumFilename = sodiumFile;
                }
            } else {
                result.hasSodium = true;
            }
        } else {
            result.hasSodium = false;
        }

        result.hasLithium = jarFiles.some(f => {
            const l = f.toLowerCase();
            return l.startsWith('lithium-') || l.startsWith('lithium_') || l === 'lithium.jar';
        });

        result.hasIris = jarFiles.some(f => {
            const l = f.toLowerCase();
            return l.startsWith('iris-') || l.startsWith('iris_') || l === 'iris.jar';
        });

        result.hasSelfNametag = jarFiles.some(f => {
            const l = f.toLowerCase();
            return l.startsWith('selfnametag') || l.startsWith('self-nametag') || l.includes('selfnametag');
        });
    }

    if (fs.existsSync(shaderDir)) {
        let sFiles = [];
        try { sFiles = fs.readdirSync(shaderDir); } catch (_) {}
        const validShaders = sFiles.filter(f => !f.toLowerCase().endsWith('.disabled'));
        result.hasComplementary = validShaders.some(f => f.toLowerCase().includes('complementary'));
    }

    return result;
}

/**
 * Downloads essential optimization mods and shaders for the target version and loader.
 */
async function installOptimizationPack(gameDir, version = '26.2', onProgress) {
    const installed = checkInstalledOptimizationMods(gameDir, version);

    // Vždy zajistíme přítomnost a aktuálnost našeho F5 nametag módu
    const bundledSelfNametag = path.join(__dirname, '../../assets/mods/selfnametag-1.0.0.jar');
    const targetSelfNametag = path.join(gameDir, 'mods', 'selfnametag-1.0.0.jar');
    if (fs.existsSync(bundledSelfNametag)) {
        try {
            const mDir = path.join(gameDir, 'mods');
            if (!fs.existsSync(mDir)) fs.mkdirSync(mDir, { recursive: true });
            let copyNeeded = !fs.existsSync(targetSelfNametag);
            if (!copyNeeded) {
                try {
                    const bBuf = fs.readFileSync(bundledSelfNametag);
                    const tBuf = fs.readFileSync(targetSelfNametag);
                    if (bBuf.length !== tBuf.length || !bBuf.equals(tBuf)) {
                        copyNeeded = true;
                    }
                } catch (_) { copyNeeded = true; }
            }
            if (copyNeeded) {
                fs.copyFileSync(bundledSelfNametag, targetSelfNametag);
            }
        } catch (_) {}
    }

    const items = [
        { id: 'fabric-api', title: 'Fabric API', projectType: 'mod', needed: !installed.hasFabricApi },
        { id: 'sodium', title: 'Sodium', projectType: 'mod', needed: !installed.hasSodium, oldFilename: installed.oldSodiumFilename },
        { id: 'lithium', title: 'Lithium', projectType: 'mod', needed: !installed.hasLithium },
        { id: 'iris', title: 'Iris Shaders', projectType: 'mod', needed: !installed.hasIris },
        { id: 'complementary-reimagined', title: 'Complementary Reimagined', projectType: 'shader', needed: !installed.hasComplementary }
    ];

    const neededItems = items.filter(i => i.needed);
    const total = neededItems.length;

    if (total === 0) {
        if (onProgress) {
            onProgress({
                current: 0,
                total: 0,
                percent: 100,
                subPercent: 100,
                itemTitle: 'Hotovo',
                status: 'Optimalizační balíček je již nainstalován'
            });
        }
        return { success: true, installedCount: 0 };
    }

    let done = 0;

    for (const item of neededItems) {
        try {
            if (onProgress) {
                const startPct = Math.round((done / total) * 100);
                onProgress({
                    current: done + 1,
                    total,
                    percent: startPct,
                    subPercent: 0,
                    itemTitle: item.title,
                    status: `Stahuji ${item.title}...`
                });
            }

            await downloadModOrPack({
                id: item.id,
                title: item.title,
                projectType: item.projectType,
                version: version || '26.2',
                loader: 'fabric',
                oldFilename: item.oldFilename,
                onProgress: (received, totalBytes, subPercent) => {
                    if (onProgress) {
                        const safeSub = Math.max(0, Math.min(100, subPercent || 0));
                        const overallPct = Math.min(99, Math.round(((done + (safeSub / 100)) / total) * 100));
                        onProgress({
                            current: done + 1,
                            total,
                            percent: overallPct,
                            subPercent: safeSub,
                            itemTitle: item.title,
                            status: safeSub > 0 ? `Stahuji ${item.title}... ${safeSub}%` : `Stahuji ${item.title}...`
                        });
                    }
                }
            }, gameDir);

            done++;

            if (onProgress) {
                const afterPct = Math.round((done / total) * 100);
                onProgress({
                    current: done,
                    total,
                    percent: afterPct,
                    subPercent: 100,
                    itemTitle: item.title,
                    status: `Nainstalováno: ${item.title}`
                });
            }
        } catch (err) {
            console.warn(`[OPTIMIZER] Instalace ${item.title} selhala:`, err.message);
        }
    }

    if (onProgress) {
        onProgress({
            current: total,
            total,
            percent: 100,
            subPercent: 100,
            itemTitle: 'Dokončeno',
            status: 'Optimalizační balíček připraven'
        });
    }

    return { success: true, installedCount: done };
}

module.exports = {
    ensureOptionsGuiScale,
    syncServersDat,
    checkInstalledOptimizationMods,
    installOptimizationPack
};
