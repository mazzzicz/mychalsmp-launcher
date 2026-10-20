const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadConfig, saveConfig, BASE_DIR } = require('../config');
const { getValidMicrosoftSession } = require('./authIpc');
const {
    checkAudioDlcStatus,
    downloadAudioDlc,
    cancelAudioDlcDownload,
    setupOfflineCustomSkinAndCape,
    detectJavaPath,
    downloadAndInstallJava
} = require('../launcher');
const {
    getMojangProfile,
    uploadMojangSkin,
    resetMojangSkin,
    setMojangCape
} = require('../skinService');
const {
    scanProfileForBlacklistedMods,
    disableIllegalMod,
    disableAllIllegalMods
} = require('../wardenProbeChecker');
const {
    checkInstalledOptimizationMods,
    installOptimizationPack
} = require('../optimizer');
const { checkForUpdates, applyUpdate, getResourcesDir } = require('../updateService');
const { executeCrashFix } = require('../crashAnalyzer');
const { scanLauncherCache, cleanLauncherCache } = require('../cleaner');

function registerServiceIpc({ getMainWindow }) {
    // ── DLC Audio ─────────────────────────────────────────────────────────────
    ipcMain.handle('check-audio-dlc', async () => {
        return checkAudioDlcStatus(BASE_DIR);
    });

    ipcMain.handle('download-audio-dlc', async () => {
        const win = getMainWindow();
        return await downloadAudioDlc(BASE_DIR, (progress) => {
            if (win && !win.isDestroyed()) {
                win.webContents.send('audio-dlc-progress', progress);
            }
        });
    });

    ipcMain.handle('cancel-audio-dlc', () => {
        return cancelAudioDlcDownload();
    });

    // ── Optimizer ─────────────────────────────────────────────────────────────
    ipcMain.handle('apply-profile-optimization', async (event, profileId) => {
        try {
            const config = loadConfig();
            const targetProfile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
            const gameDir = targetProfile?.gameDir || BASE_DIR;
            const targetVer = targetProfile?.version || '26.2';

            const win = getMainWindow();
            return await installOptimizationPack(gameDir, targetVer, (progress) => {
                if (win && !win.isDestroyed()) {
                    win.webContents.send('optimization-progress', progress);
                }
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('check-optimization-status', async (event, profileId) => {
        const config = loadConfig();
        const targetProfile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const gameDir = targetProfile?.gameDir || BASE_DIR;
        return checkInstalledOptimizationMods(gameDir);
    });

    // ── Skins & Capes ─────────────────────────────────────────────────────────
    ipcMain.handle('select-skin-file', async () => {
        try {
            const res = await dialog.showOpenDialog({
                title: 'Vyber soubor skinu (.png)',
                filters: [{ name: 'Minecraft Skin', extensions: ['png'] }],
                properties: ['openFile']
            });
            if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
                return { canceled: true };
            }
            const filePath = res.filePaths[0];
            const buf = fs.readFileSync(filePath);
            const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
            return { canceled: false, filePath, dataUrl };
        } catch (e) {
            return { canceled: false, error: e.message };
        }
    });

    ipcMain.handle('select-cape-file', async () => {
        try {
            const res = await dialog.showOpenDialog({
                title: 'Vyber soubor pláště (.png)',
                filters: [{ name: 'Minecraft Cape', extensions: ['png'] }],
                properties: ['openFile']
            });
            if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
                return { canceled: true };
            }
            const filePath = res.filePaths[0];
            const buf = fs.readFileSync(filePath);
            const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
            return { canceled: false, filePath, dataUrl };
        } catch (e) {
            return { canceled: false, error: e.message };
        }
    });

    ipcMain.handle('save-offline-skin', async (event, skinData) => {
        try {
            const updates = {};
            if (skinData.customSkinPath) updates.customSkinPath = skinData.customSkinPath;
            if (skinData.customCapePath !== undefined) updates.customCapePath = skinData.customCapePath;
            if (skinData.customSkinVariant) updates.customSkinVariant = skinData.customSkinVariant;
            const cfg = saveConfig(updates);
            try {
                await setupOfflineCustomSkinAndCape(BASE_DIR, cfg, (m) => console.log(m), cfg.version);
            } catch (_) { }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('save-dragged-skin', async (event, filePath) => {
        try {
            if (!fs.existsSync(filePath)) return { success: false, error: 'Soubor neexistuje' };
            const dest = path.join(BASE_DIR, 'offline_skin.png');
            fs.copyFileSync(filePath, dest);
            const buf = fs.readFileSync(dest);
            const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
            const cfg = saveConfig({ customSkinPath: dest });
            try {
                await setupOfflineCustomSkinAndCape(BASE_DIR, cfg, (m) => console.log(m), cfg.version);
            } catch (_) { }
            return { success: true, customSkinPath: dest, skinDataUrl: dataUrl };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('get-mojang-profile', async () => {
        const authRes = await getValidMicrosoftSession(false);
        if (!authRes.success) return { success: false, error: authRes.error };

        let res = await getMojangProfile(authRes.token);
        if (!res.success && res.error && res.error.includes('401')) {
            const refreshAuth = await getValidMicrosoftSession(true);
            if (refreshAuth.success && refreshAuth.token !== authRes.token) {
                res = await getMojangProfile(refreshAuth.token);
            }
        }

        if (!res.success && res.error && res.error.includes('401')) {
            return {
                success: false,
                expired: true,
                error: 'Platnost Microsoft přihlášení vypršela. Klikni pro rychlé obnovení.'
            };
        }

        if (res.success && res.profile) {
            const currentCfg = loadConfig();
            if (currentCfg.microsoftAccount) {
                const activeSkin = (res.profile.skins || []).find(s => s.state === 'ACTIVE') || (res.profile.skins || [])[0];
                const updates = {
                    ...currentCfg.microsoftAccount,
                    name: res.profile.name,
                    username: res.profile.name,
                    uuid: res.profile.id,
                    skins: res.profile.skins || [],
                    capes: res.profile.capes || []
                };
                if (activeSkin && activeSkin.url) {
                    updates.skinUrl = activeSkin.url;
                }
                saveConfig({
                    username: res.profile.name,
                    microsoftAccount: updates
                });
            }
        }

        return res;
    });

    ipcMain.handle('upload-mojang-skin', async (event, filePath, variant) => {
        let authRes = await getValidMicrosoftSession(false);
        if (!authRes.success) return { success: false, error: authRes.error };

        let res = await uploadMojangSkin(authRes.token, filePath, variant);
        if (!res.success && res.error && res.error.includes('401')) {
            authRes = await getValidMicrosoftSession(true);
            if (authRes.success) {
                res = await uploadMojangSkin(authRes.token, filePath, variant);
            }
        }
        if (res.success && res.skin) {
            const config = loadConfig();
            if (config.microsoftAccount) {
                config.microsoftAccount.skinUrl = res.skin.url;
                saveConfig({ microsoftAccount: config.microsoftAccount });
            }
        }
        return res;
    });

    ipcMain.handle('reset-mojang-skin', async () => {
        let authRes = await getValidMicrosoftSession(false);
        if (!authRes.success) return { success: false, error: authRes.error };

        let res = await resetMojangSkin(authRes.token);
        if (!res.success && res.error && res.error.includes('401')) {
            authRes = await getValidMicrosoftSession(true);
            if (authRes.success) {
                res = await resetMojangSkin(authRes.token);
            }
        }
        return res;
    });

    ipcMain.handle('set-mojang-cape', async (event, capeId) => {
        let authRes = await getValidMicrosoftSession(false);
        if (!authRes.success) return { success: false, error: authRes.error };

        let res = await setMojangCape(authRes.token, capeId);
        if (!res.success && res.error && res.error.includes('401')) {
            authRes = await getValidMicrosoftSession(true);
            if (authRes.success) {
                res = await setMojangCape(authRes.token, capeId);
            }
        }
        return res;
    });

    // ── Warden Anticheat Probe ─────────────────────────────────────────────────
    ipcMain.handle('check-warden-probe', async (event, profileId) => {
        const config = loadConfig();
        const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const targetDir = (profile && profile.gameDir) ? profile.gameDir : (config.baseDir || BASE_DIR);
        return scanProfileForBlacklistedMods(targetDir);
    });

    ipcMain.handle('disable-illegal-mods', async (event, profileId, filename) => {
        const config = loadConfig();
        const profile = (config.profiles || []).find(p => p.id === profileId) || config.profiles[0];
        const targetDir = (profile && profile.gameDir) ? profile.gameDir : (config.baseDir || BASE_DIR);
        if (filename) {
            return disableIllegalMod(targetDir, filename);
        } else {
            return disableAllIllegalMods(targetDir);
        }
    });

    // ── Auto-Updater ──────────────────────────────────────────────────────────
    ipcMain.handle('check-for-updates', async () => {
        return await checkForUpdates();
    });

    ipcMain.handle('apply-update', async (event, assetUrl) => {
        return await applyUpdate(assetUrl, (data) => {
            try {
                event.sender.send('update-progress', data);
            } catch (e) { }
        });
    });

    ipcMain.handle('restart-launcher', () => {
        if (process.platform === 'win32') {
            const resourcesDir = getResourcesDir();
            let pendingAsar = path.join(resourcesDir, 'app.asar.pending');
            if (!fs.existsSync(pendingAsar)) {
                const tmpPending = path.join(os.tmpdir(), 'mychalsmp_app.asar.pending');
                if (fs.existsSync(tmpPending)) {
                    pendingAsar = tmpPending;
                }
            }
            const targetAsar = path.join(resourcesDir, 'app.asar');

            const isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE;
            const portableTarget = process.env.PORTABLE_EXECUTABLE_FILE;
            const portablePending = portableTarget ? portableTarget + '.pending' : null;
            const hasPortablePending = portablePending && fs.existsSync(portablePending);
            const hasAsarPending = fs.existsSync(pendingAsar);

            let pendingInstaller = path.join(resourcesDir, 'installer.pending.exe');
            if (!fs.existsSync(pendingInstaller)) {
                const tmpInstaller = path.join(os.tmpdir(), 'mychalsmp_installer_pending.exe');
                if (fs.existsSync(tmpInstaller)) {
                    pendingInstaller = tmpInstaller;
                }
            }
            const hasInstallerPending = fs.existsSync(pendingInstaller);

            if (hasInstallerPending) {
                const currentPid = process.pid;
                const timestamp = Date.now();
                const batPath = path.join(os.tmpdir(), `mychalsmp_install_${timestamp}.bat`);
                const cleanInstaller = pendingInstaller.replace(/%/g, '%%');

                const batLines = [
                    '@echo off',
                    'setlocal EnableExtensions EnableDelayedExpansion',
                    'chcp 65001 >nul',
                    `set "PID=${currentPid}"`,
                    `set "INSTALLER=${cleanInstaller}"`,
                    'set "LOG_FILE=%TEMP%\\mychalsmp_update.log"',
                    '',
                    'echo [%date% %time%] Spoustim instalator: %INSTALLER% >> "%LOG_FILE%"',
                    '',
                    'set WAIT_COUNT=0',
                    ':wait_loop',
                    'tasklist /fi "PID eq %PID%" 2>nul | findstr /c:"%PID%" >nul',
                    'if %ERRORLEVEL% equ 0 (',
                    '    set /a WAIT_COUNT+=1',
                    '    if !WAIT_COUNT! lss 30 (',
                    '        ping 127.0.0.1 -n 2 >nul',
                    '        goto wait_loop',
                    '    )',
                    '    taskkill /f /pid %PID% >nul 2>&1',
                    ')',
                    'ping 127.0.0.1 -n 2 >nul',
                    '',
                    'start "" "%INSTALLER%" /S',
                    'echo [%date% %time%] Instalator spusten >> "%LOG_FILE%"',
                    '(goto) 2>nul & del "%~f0"',
                    'exit /b 0'
                ];

                try {
                    fs.writeFileSync(batPath, batLines.join('\r\n') + '\r\n', 'utf8');
                    const { spawn } = require('child_process');
                    const child = spawn('cmd.exe', ['/c', 'start', '""', '/min', batPath], {
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: true
                    });
                    child.unref();

                    try { app.releaseSingleInstanceLock(); } catch (_) {}
                    setTimeout(() => { app.exit(0); }, 350);
                    return;
                } catch (err) {
                    console.error('[UPDATER] Nelze zapsat/spustit instalátor:', err);
                }
            }

            if (hasAsarPending || hasPortablePending) {
                const currentPid = process.pid;
                const isPortableSwap = isPortable && hasPortablePending;
                const targetPath = isPortableSwap ? portableTarget : targetAsar;
                const pendingPath = isPortableSwap ? portablePending : pendingAsar;
                const exePath = portableTarget || process.execPath;
                const exeDir = path.dirname(exePath);

                const timestamp = Date.now();
                const batPath = path.join(os.tmpdir(), `mychalsmp_update_${timestamp}.bat`);

                const cleanTarget = targetPath.replace(/%/g, '%%');
                const cleanPending = pendingPath.replace(/%/g, '%%');
                const cleanExe = exePath.replace(/%/g, '%%');
                const cleanExeDir = exeDir.replace(/%/g, '%%');
                const cleanOldMask = isPortableSwap ? `${cleanTarget}.old.*` : path.join(path.dirname(cleanTarget), 'app.asar.old.*');

                const batLines = [
                    '@echo off',
                    'setlocal EnableExtensions EnableDelayedExpansion',
                    'chcp 65001 >nul',
                    '',
                    `set "TARGET=${cleanTarget}"`,
                    `set "PENDING=${cleanPending}"`,
                    `set "EXE=${cleanExe}"`,
                    `set "EXE_DIR=${cleanExeDir}"`,
                    `set "PID=${currentPid}"`,
                    'set "LOG_FILE=%TEMP%\\mychalsmp_update.log"',
                    '',
                    'echo [%date% %time%] Zahajuji vymenu souboru pro PID %PID% >> "%LOG_FILE%"',
                    '',
                    'set WAIT_COUNT=0',
                    ':wait_loop',
                    'tasklist /fi "PID eq %PID%" 2>nul | findstr /c:"%PID%" >nul',
                    'if %ERRORLEVEL% equ 0 (',
                    '    set /a WAIT_COUNT+=1',
                    '    if !WAIT_COUNT! lss 30 (',
                    '        ping 127.0.0.1 -n 2 >nul',
                    '        goto wait_loop',
                    '    )',
                    '    taskkill /f /pid %PID% >nul 2>&1',
                    ')',
                    'ping 127.0.0.1 -n 2 >nul',
                    '',
                    'set SWAP_ATTEMPTS=0',
                    ':swap_loop',
                    'set /a SWAP_ATTEMPTS+=1',
                    '',
                    'if exist "%PENDING%" (',
                    '    if exist "%TARGET%" (',
                    '        del /f /q "%TARGET%" >nul 2>&1',
                    '        if exist "%TARGET%" (',
                    '            ren "%TARGET%" "app.asar.old.!RANDOM!" >nul 2>&1',
                    '        )',
                    '    )',
                    '',
                    '    move /y "%PENDING%" "%TARGET%" >> "%LOG_FILE%" 2>&1',
                    '',
                    '    if exist "%PENDING%" (',
                    '        copy /y "%PENDING%" "%TARGET%" >> "%LOG_FILE%" 2>&1',
                    '        if exist "%TARGET%" (',
                    '            del /f /q "%PENDING%" >nul 2>&1',
                    '        )',
                    '    )',
                    '',
                    '    if not exist "%PENDING%" if exist "%TARGET%" (',
                    '        echo [%date% %time%] Vymena souboru uspesna >> "%LOG_FILE%"',
                    '        goto launch_app',
                    '    )',
                    ')',
                    '',
                    'if !SWAP_ATTEMPTS! equ 5 (',
                    '    if exist "%PENDING%" (',
                    '        echo [%date% %time%] Pokus o elevovany presun s pravy spravce >> "%LOG_FILE%"',
                    '        powershell.exe -NoProfile -Command "Start-Process cmd.exe -ArgumentList \'/c move /y `"%PENDING%`" `"%TARGET%`"`" -Verb RunAs -WindowStyle Hidden -Wait" >nul 2>&1',
                    '        ping 127.0.0.1 -n 2 >nul',
                    '        if not exist "%PENDING%" if exist "%TARGET%" (',
                    '            echo [%date% %time%] Elevovany presun uspesny >> "%LOG_FILE%"',
                    '            goto launch_app',
                    '        )',
                    '    )',
                    ')',
                    '',
                    'if !SWAP_ATTEMPTS! lss 25 (',
                    '    ping 127.0.0.1 -n 2 >nul',
                    '    goto swap_loop',
                    ')',
                    '',
                    ':launch_app',
                    'ping 127.0.0.1 -n 2 >nul',
                    `del /f /q "${cleanOldMask}" >nul 2>&1`,
                    'ping 127.0.0.1 -n 2 >nul',
                    'cd /d "%EXE_DIR%"',
                    'echo [%date% %time%] Spoustim %EXE% >> "%LOG_FILE%"',
                    'start "" /d "%EXE_DIR%" "%EXE%" --no-sandbox',
                    'ping 127.0.0.1 -n 2 >nul',
                    '(goto) 2>nul & del "%~f0"',
                    'exit /b 0'
                ];

                const batContent = batLines.join('\r\n') + '\r\n';
                try {
                    fs.writeFileSync(batPath, batContent, 'utf8');
                    const { spawn } = require('child_process');
                    const child = spawn('cmd.exe', ['/c', 'start', '""', '/min', batPath], {
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: true
                    });
                    child.unref();

                    try { app.releaseSingleInstanceLock(); } catch (_) {}
                    setTimeout(() => { app.exit(0); }, 350);
                    return;
                } catch (err) {
                    console.error('[UPDATER] Nelze zapsat Windows swap skript:', err);
                    app.relaunch();
                    app.exit(0);
                    return;
                }
            }

            try { app.releaseSingleInstanceLock(); } catch (_) {}
            app.relaunch();
            app.exit(0);
            return;
        }

        const projectRoot = path.resolve(__dirname, '../..');
        let targetExe = path.join(os.homedir(), '.local', 'share', 'mychalsmp-launcher', 'SMPClient');
        if (!fs.existsSync(targetExe)) {
            targetExe = path.join(os.homedir(), '.local', 'share', 'mychalsmp-launcher', 'mychalsmp-launcher');
        }
        if (process.platform === 'linux') {
            const exeDir = path.dirname(process.execPath);
            if (!exeDir.startsWith('/tmp')) {
                if (fs.existsSync(path.join(exeDir, 'SMPClient'))) {
                    targetExe = path.join(exeDir, 'SMPClient');
                } else if (fs.existsSync(path.join(exeDir, 'mychalsmp-launcher'))) {
                    targetExe = path.join(exeDir, 'mychalsmp-launcher');
                }
            }

            const resourcesDir = getResourcesDir();
            let pendingAsar = path.join(resourcesDir, 'app.asar.pending');
            if (!fs.existsSync(pendingAsar)) {
                const tmpPending = path.join(os.tmpdir(), 'mychalsmp_app.asar.pending');
                if (fs.existsSync(tmpPending)) {
                    pendingAsar = tmpPending;
                }
            }
            const targetAsar = path.join(resourcesDir, 'app.asar');
            const currentPid = process.pid;

            let exeToRun = process.execPath;
            let argsToRun = ['--no-sandbox'];

            if (!app.isPackaged || process.execPath.includes('node_modules')) {
                exeToRun = process.execPath;
                argsToRun = [projectRoot, '--no-sandbox'];
            } else if (process.env.APPIMAGE && fs.existsSync(process.env.APPIMAGE)) {
                exeToRun = process.env.APPIMAGE;
                argsToRun = ['--no-sandbox'];
            } else if (process.execPath && !process.execPath.startsWith('/tmp') && fs.existsSync(process.execPath)) {
                exeToRun = process.execPath;
                argsToRun = ['--no-sandbox'];
            } else if (fs.existsSync(targetExe)) {
                exeToRun = targetExe;
                argsToRun = ['--no-sandbox'];
            }

            // ── 1. Blesková atomická výměna app.asar na Linuxu přímo v Node.js ────
            // POSIX rename funguje okamžitě a atomicky i za chodu procesu (přesměruje odkaz v adresáři).
            // Tím se vyhneme riziku, že systemd cgroup po ukončení Electronu zabije externí bash skript na pozadí!
            let swapSuccess = false;
            if (fs.existsSync(pendingAsar)) {
                try {
                    if (fs.existsSync(targetAsar)) {
                        try { fs.copyFileSync(targetAsar, targetAsar + '.bak'); } catch (_) {}
                    }
                    fs.renameSync(pendingAsar, targetAsar);
                    swapSuccess = true;
                    console.log('[UPDATER] Atomická výměna app.asar na Linuxu úspěšně provedena.');
                } catch (swapErr) {
                    try {
                        fs.copyFileSync(pendingAsar, targetAsar);
                        fs.unlinkSync(pendingAsar);
                        swapSuccess = true;
                    } catch (cpErr) {
                        console.warn('[UPDATER] Přímý přepis selhal (vyžadována externí elevace):', cpErr.message);
                    }
                }
            }

            // Pojistka proti chrome-sandbox crashe na Linuxu
            const targetDir = path.dirname(exeToRun);
            const sandboxBin = path.join(targetDir, 'chrome-sandbox');
            if (fs.existsSync(sandboxBin)) {
                try {
                    fs.renameSync(sandboxBin, path.join(targetDir, 'chrome-sandbox.disabled'));
                } catch (_) {}
            }

            // Vyčistit single instance zámky
            try {
                const home = os.homedir();
                for (const appDir of ['mychalsmp-launcher', 'SMPClient']) {
                    const cfgPath = path.join(home, '.config', appDir);
                    if (fs.existsSync(cfgPath)) {
                        const entries = fs.readdirSync(cfgPath);
                        for (const entry of entries) {
                            if (entry.startsWith('Singleton')) {
                                try { fs.unlinkSync(path.join(cfgPath, entry)); } catch (_) {}
                            }
                        }
                    }
                }
            } catch (_) {}

            // Pokud byla výměna úspěšná (nebo nebyl pending balíček), provedeme okamžitý nativní restart
            if (swapSuccess || !fs.existsSync(pendingAsar)) {
                try { app.releaseSingleInstanceLock(); } catch (_) {}
                app.relaunch({ execPath: exeToRun, args: argsToRun });
                setTimeout(() => { app.exit(0); }, 150);
                return;
            }

            // Fallback na externí bash runner pro případ, že resources složka vyžaduje root/sudo práva
            const envExports = [
                process.env.DISPLAY ? `export DISPLAY="${process.env.DISPLAY}"` : '',
                process.env.WAYLAND_DISPLAY ? `export WAYLAND_DISPLAY="${process.env.WAYLAND_DISPLAY}"` : '',
                process.env.XAUTHORITY ? `export XAUTHORITY="${process.env.XAUTHORITY}"` : '',
                process.env.XDG_RUNTIME_DIR ? `export XDG_RUNTIME_DIR="${process.env.XDG_RUNTIME_DIR}"` : '',
                process.env.DBUS_SESSION_BUS_ADDRESS ? `export DBUS_SESSION_BUS_ADDRESS="${process.env.DBUS_SESSION_BUS_ADDRESS}"` : ''
            ].filter(Boolean).join('\n');

            const logPath = path.join(os.tmpdir(), 'mychalsmp_update.log');

            const bashScript = [
                '#!/bin/bash',
                envExports,
                `TARGET_PID=${currentPid}`,
                `TARGET_ASAR="${targetAsar}"`,
                `PENDING_ASAR="${pendingAsar}"`,
                `RESOURCES_DIR="${resourcesDir}"`,
                `TARGET_EXE="${exeToRun}"`,
                `LOG_FILE="${logPath}"`,
                '',
                'echo "[$(date)] Updater runner spusten pro PID $TARGET_PID" >> "$LOG_FILE"',
                '',
                'WAIT_COUNT=0',
                'while kill -0 "$TARGET_PID" 2>/dev/null; do',
                '    sleep 0.1',
                '    WAIT_COUNT=$((WAIT_COUNT + 1))',
                '    if [ "$WAIT_COUNT" -ge 100 ]; then',
                '        echo "[$(date)] Vyprsel limit cekani na PID $TARGET_PID, vynucuji ukonceni" >> "$LOG_FILE"',
                '        kill -9 "$TARGET_PID" 2>/dev/null || true',
                '        break',
                '    fi',
                'done',
                'sleep 0.3',
                '',
                'if [ -f "$PENDING_ASAR" ]; then',
                '    echo "[$(date)] Nalezen pending asar: $PENDING_ASAR" >> "$LOG_FILE"',
                '    if [ -L "$RESOURCES_DIR/app" ]; then',
                '        rm -f "$RESOURCES_DIR/app" 2>/dev/null || true',
                '    fi',
                '    if [ -f "$TARGET_ASAR" ]; then',
                '        cp -f "$TARGET_ASAR" "${TARGET_ASAR}.bak" 2>/dev/null || true',
                '    fi',
                '    if mv -f "$PENDING_ASAR" "$TARGET_ASAR" >> "$LOG_FILE" 2>&1 || cp -f "$PENDING_ASAR" "$TARGET_ASAR" >> "$LOG_FILE" 2>&1; then',
                '        echo "[$(date)] Uspech: app.asar byl zaktualizovan" >> "$LOG_FILE"',
                '        rm -f "$PENDING_ASAR" 2>/dev/null || true',
                '    else',
                '        echo "[$(date)] CHYBA: Nelze prepsat $TARGET_ASAR" >> "$LOG_FILE"',
                '    fi',
                'fi',
                '',
                '# Pojistka: deaktivace chrome-sandbox pokud neni suid root (zabranuje SIGTRAP crashi)',
                'CHROME_SANDBOX="$(dirname "$TARGET_EXE")/chrome-sandbox"',
                'if [ -f "$CHROME_SANDBOX" ] && [ ! -u "$CHROME_SANDBOX" ]; then',
                '    mv -f "$CHROME_SANDBOX" "${CHROME_SANDBOX}.disabled" 2>/dev/null || true',
                'fi',
                '',
                '# Vymazat zámky jedné instance',
                'rm -f "$HOME/.config/mychalsmp-launcher/Singleton"* 2>/dev/null || true',
                'rm -f "$HOME/.config/SMPClient/Singleton"* 2>/dev/null || true',
                'sleep 0.3',
                '',
                'echo "[$(date)] Spoustim: $TARGET_EXE ${argsToRun.join(\' \')}" >> "$LOG_FILE"',
                'cd "$(dirname "$TARGET_EXE")" || true',
                `nohup "$TARGET_EXE" ${argsToRun.map(a => `"${a}"`).join(' ')} >> "$LOG_FILE" 2>&1 &`,
                'NEW_PID=$!',
                'echo "[$(date)] Proces spusten pod PID $NEW_PID" >> "$LOG_FILE"',
                'disown -a 2>/dev/null || true',
                'sleep 0.5',
                'exit 0'
            ].join('\n');

            const scriptPath = path.join(os.tmpdir(), `mychalsmp_restart_${Date.now()}.sh`);
            try {
                fs.writeFileSync(scriptPath, bashScript, { encoding: 'utf8', mode: 0o755 });
                const { spawn } = require('child_process');
                const child = spawn('/bin/bash', [scriptPath], {
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();

                try { app.releaseSingleInstanceLock(); } catch (_) {}
                setTimeout(() => { app.exit(0); }, 300);
                return;
            } catch (err) {
                console.error('[UPDATER] Selhalo spuštění Linux bash restart runneru:', err);
                try { app.releaseSingleInstanceLock(); } catch (_) {}
                app.relaunch({ execPath: exeToRun, args: argsToRun });
                app.exit(0);
                return;
            }
        }

        try { app.releaseSingleInstanceLock(); } catch (_) {}
        if (!app.isPackaged || process.execPath.includes('node_modules')) {
            app.relaunch({ execPath: process.execPath, args: [projectRoot, '--no-sandbox'] });
        } else if (fs.existsSync(targetExe)) {
            app.relaunch({ execPath: targetExe, args: ['--no-sandbox'] });
        } else {
            app.relaunch({ args: ['--no-sandbox'] });
        }
        app.exit(0);
    });

    // ── Crash Analyzer & Cleaner ──────────────────────────────────────────────
    ipcMain.handle('apply-crash-fix', async (event, autoFix, profileId) => {
        try {
            const config = loadConfig();
            const targetProfId = profileId || config.activeProfileId;
            const profile = (config.profiles || []).find(p => p.id === targetProfId) || config.profiles?.[0] || null;
            const gameDir = profile?.gameDir || config.baseDir || BASE_DIR;
            const effectiveConfig = {
                ...config,
                baseDir: config.baseDir || BASE_DIR,
                version: profile?.version || config.version || '26.2',
                loader: profile?.loader || config.loader || 'fabric',
                profileId: targetProfId,
                profileName: profile?.name || 'Minecraft'
            };
            return await executeCrashFix(autoFix, gameDir, effectiveConfig, saveConfig, detectJavaPath, downloadAndInstallJava);
        } catch (err) {
            console.error('Chyba při aplikaci opravy pádu:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('scan-launcher-cache', async () => {
        try {
            const config = loadConfig();
            return scanLauncherCache(config.baseDir, config.profiles || []);
        } catch (err) {
            console.error('Chyba při skenování cache:', err);
            return { fileCount: 0, totalBytes: 0, formattedSize: '0 B', breakdown: {} };
        }
    });

    ipcMain.handle('clean-launcher-cache', async () => {
        try {
            const config = loadConfig();
            return cleanLauncherCache(config.baseDir, config.profiles || []);
        } catch (err) {
            console.error('Chyba při čištění cache:', err);
            return { success: false, error: err.message };
        }
    });
}

module.exports = { registerServiceIpc };
