const { registerAppIpc } = require('./appIpc');
const { registerAuthIpc } = require('./authIpc');
const { registerContentIpc } = require('./contentIpc');
const { registerGameIpc } = require('./gameIpc');
const { registerProfileIpc } = require('./profileIpc');
const { registerServiceIpc } = require('./serviceIpc');

/**
 * Registers all modular IPC handlers across the launcher.
 */
function registerAllIpcHandlers(context) {
    registerAppIpc(context);
    registerAuthIpc(context);
    registerContentIpc(context);
    registerGameIpc(context);
    registerProfileIpc(context);
    registerServiceIpc(context);
    console.log('[IPC] Všech 74 IPC handlerů bylo úspěšně inicializováno a propojeno.');
}

module.exports = { registerAllIpcHandlers };
