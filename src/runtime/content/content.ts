import { initBootstrap } from '../../l1/client/gemini/bootstrap.js';
import { MessageRouter } from './messageRouter.js';
import { MessageBridge } from '../../l1/sniffer/gemini/messageBridge.js';
import { LiveSaveCoordinator } from './liveSaveCoordinator.js';
import { startContentBootstrap } from './contentBootstrap.js';
import { configureAccountAdapter } from './accountContext.js';
import { createGeminiAccountAdapter } from './adapters/geminiAccountAdapter.js';

configureAccountAdapter(createGeminiAccountAdapter());
startContentBootstrap({
    label: 'Gemini',
    beforeRouteHooks: isActive => {
        initBootstrap();
        MessageRouter.init(isActive);
    },
});
MessageBridge.init({
    onDetailChanged: key => {
        void LiveSaveCoordinator.executeLiveSave(key).catch(error => console.warn('[Runtime] Live Save failed', error));
    },
    onStreamComplete: key => {
        void LiveSaveCoordinator.executeLiveSave(key, true).catch(error => console.warn('[Runtime] Live Save failed', error));
    },
});
