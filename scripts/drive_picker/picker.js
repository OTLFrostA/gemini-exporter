'use strict';

(async () => {
    const extension = 'chrome-extension://kipakimegljfgbjchpljlmiahgnalfdj';
    const config = await (await fetch('/config')).json();
    function ready(event) {
        if (!window.opener || event.source !== window.opener || event.origin !== extension || event.data !== 'picker-ready') return;
        window.removeEventListener('message', ready);
        const channel = new MessageChannel();
        const port = channel.port1;
        port.onmessage = ({ data }) => {
            port.onmessage = null;
            const fail = () => port.postMessage({ action: 'error' });
            const script = document.createElement('script');
            script.onerror = fail;
            script.onload = () => gapi.load('picker', {
                onerror: fail, timeout: 20000, ontimeout: fail,
                callback() {
                    try {
                        const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
                            .setIncludeFolders(true).setSelectFolderEnabled(true)
                            .setMimeTypes('application/vnd.google-apps.folder');
                        new google.picker.PickerBuilder().addView(view).setOrigin(location.origin)
                            .setDeveloperKey(config.key).setAppId(config.project).setOAuthToken(data.token)
                            .setCallback(result => {
                                if (result.action === google.picker.Action.CANCEL) port.postMessage({ action: 'cancel' });
                                if (result.action === google.picker.Action.PICKED) port.postMessage({ action: 'pick', id: result.docs[0]?.id });
                            }).build().setVisible(true);
                    } catch { fail(); }
                },
            });
            script.src = 'https://apis.google.com/js/api.js';
            document.head.append(script);
        };
        window.opener.postMessage({ proof: config.proof }, extension, [channel.port2]);
        window.opener = null;
    }
    window.addEventListener('message', ready);
})();
