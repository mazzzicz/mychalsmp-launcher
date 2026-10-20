const { ipcMain } = require('electron');
const { loadConfig, saveConfig } = require('../config');
const { getOfflineUUID, createOfflineAuth, loginMicrosoft, refreshMicrosoftSession } = require('../auth');

/**
 * Validates whether a Minecraft access token is valid by testing Mojang API.
 */
async function isMinecraftTokenValid(token) {
    if (!token) return false;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const resp = await fetch('https://api.minecraftservices.com/minecraft/profile', {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: controller.signal
        });
        clearTimeout(timeout);
        return resp.ok;
    } catch (e) {
        return true;
    }
}

/**
 * Validates and refreshes Microsoft OAuth tokens before Mojang API calls or game launch.
 */
async function getValidMicrosoftSession(forceRefresh = false) {
    const config = loadConfig();
    if (config.authType !== 'microsoft' || !config.microsoftAccount) {
        return { success: false, error: 'Nejsi přihlášen k Microsoft účtu.' };
    }

    const msAcc = config.microsoftAccount;
    const refreshToken = msAcc.refreshToken || msAcc.meta?.refresh;
    const exp = msAcc.meta?.exp;
    const isExpiredByTime = exp ? (Date.now() >= (exp - 60000)) : false;

    let isTokenDead = false;
    if (!isExpiredByTime && !forceRefresh && msAcc.access_token) {
        const isValid = await isMinecraftTokenValid(msAcc.access_token);
        if (!isValid) {
            console.log('[AUTH] Přístupový token je neplatný u Mojang API (401), spouštím obnovení...');
            isTokenDead = true;
        }
    }

    if ((isExpiredByTime || isTokenDead || forceRefresh) && refreshToken) {
        console.log('[AUTH] Obnovuji Microsoft token...');
        const refreshRes = await refreshMicrosoftSession(refreshToken);
        if (refreshRes.success) {
            const updatedAccount = {
                ...config.microsoftAccount,
                ...refreshRes.auth,
                username: refreshRes.profile.name,
                name: refreshRes.profile.name,
                uuid: refreshRes.profile.id,
                refreshToken: refreshRes.auth.refreshToken,
                skinUrl: refreshRes.profile.skinUrl || config.microsoftAccount.skinUrl,
                skins: refreshRes.profile.skins?.length ? refreshRes.profile.skins : (config.microsoftAccount.skins || []),
                capes: refreshRes.profile.capes?.length ? refreshRes.profile.capes : (config.microsoftAccount.capes || [])
            };
            saveConfig({
                username: refreshRes.profile.name,
                microsoftAccount: updatedAccount
            });
            console.log('[AUTH] Microsoft token úspěšně obnoven.');
            return { success: true, token: updatedAccount.access_token, account: updatedAccount };
        } else {
            console.warn('[AUTH] Automatické obnovení selhalo:', refreshRes.error);
            if (msAcc.access_token || msAcc.name || msAcc.username) {
                console.log('[AUTH] Aktivován 100% offline fallback pro Microsoft účet (spuštění offline bez pádu).');
                const fallbackName = msAcc.name || msAcc.username || config.username || 'Hrac';
                const fallbackUuid = msAcc.uuid || msAcc.id || getOfflineUUID(fallbackName);
                const fallbackAccount = {
                    ...msAcc,
                    name: fallbackName,
                    username: fallbackName,
                    uuid: fallbackUuid,
                    access_token: msAcc.access_token || ('offline_token_' + fallbackUuid),
                    client_token: msAcc.client_token || ('offline_client_' + fallbackUuid),
                    user_properties: msAcc.user_properties || '{}'
                };
                return {
                    success: true,
                    token: fallbackAccount.access_token,
                    account: fallbackAccount,
                    isOfflineFallback: true
                };
            }
            return {
                success: false,
                sessionExpired: true,
                error: 'Platnost Microsoft účtu vypršela a nelze se připojit k internetu pro obnovení. Přihlas se prosím znovu ke svému účtu.'
            };
        }
    }

    if (!msAcc.access_token) {
        if (msAcc.name || msAcc.username) {
            console.log('[AUTH] Přístupový token chybí, ale hráč má profil – použit offline fallback.');
            const fallbackName = msAcc.name || msAcc.username || config.username || 'Hrac';
            const fallbackUuid = msAcc.uuid || msAcc.id || getOfflineUUID(fallbackName);
            const fallbackAccount = {
                ...msAcc,
                name: fallbackName,
                username: fallbackName,
                uuid: fallbackUuid,
                access_token: 'offline_token_' + fallbackUuid,
                client_token: 'offline_client_' + fallbackUuid,
                user_properties: '{}'
            };
            return { success: true, token: fallbackAccount.access_token, account: fallbackAccount, isOfflineFallback: true };
        }
        return { success: false, error: 'Chybí přístupový token Microsoft účtu.' };
    }

    return { success: true, token: msAcc.access_token, account: msAcc };
}

function registerAuthIpc({ getMainWindow }) {
    ipcMain.handle('login-offline', (event, username) => {
        const config = loadConfig();
        const auth = createOfflineAuth(username);
        saveConfig({ username: auth.name, offlineUsername: auth.name, authType: 'offline' });
        return {
            success: true,
            auth,
            profile: {
                name: auth.name,
                skinUrl: config.customSkinPath || auth.skinUrl,
                customSkinPath: config.customSkinPath,
                customSkinVariant: config.customSkinVariant || 'classic',
                customCapePath: config.customCapePath
            }
        };
    });

    ipcMain.handle('login-microsoft', async () => {
        const win = getMainWindow();
        const res = await loginMicrosoft(win);
        if (res.success) {
            saveConfig({
                username: res.profile.name,
                authType: 'microsoft',
                microsoftAccount: {
                    ...res.auth,
                    username: res.profile.name,
                    name: res.profile.name,
                    uuid: res.profile.id,
                    refreshToken: res.auth.refreshToken,
                    skinUrl: res.profile.skinUrl,
                    skins: res.profile.skins || [],
                    capes: res.profile.capes || []
                }
            });
            return {
                ...res,
                auth: {
                    name: res.profile.name,
                    username: res.profile.name,
                    uuid: res.profile.id
                }
            };
        }
        return res;
    });
}

module.exports = {
    registerAuthIpc,
    getValidMicrosoftSession,
    isMinecraftTokenValid
};
