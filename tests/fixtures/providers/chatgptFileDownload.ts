/** Raw GET /backend-api/files/download/:id JSON responses. */
interface FileDownloadResponse {
    status?: string;
    download_url?: string;
    file_name?: string;
    file_size_bytes?: number;
    mime_type?: string;
}

const fixtureMap = {
    'C_FILE_DOWNLOAD_HELPERS_01': () => ({
        status: 'success', download_url: 'https://x/dl', file_name: 'a.png', file_size_bytes: 10,
    }),
    'C_FILE_DOWNLOAD_HELPERS_02': () => ({ status: 'error' }),
    'C_FILE_DOWNLOAD_ACQUIRE_01': () => ({
        status: 'success', download_url: 'https://dl/img.png', file_name: 'cat.png',
    }),
    'C_FILE_DOWNLOAD_ACQUIRE_02': () => ({ status: 'error' }),
};

export function fileDownloadGen(key: keyof typeof fixtureMap): FileDownloadResponse {
    return fixtureMap[key]();
}
