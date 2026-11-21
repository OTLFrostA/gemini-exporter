export const GEMINI_RPC_CREDENTIALS = 'geminiRpcCredentials';

export interface GeminiRpcCredentialsMessage {
    action: typeof GEMINI_RPC_CREDENTIALS;
    requestId: string | null;
    payload: { sid: string; at: string; bl: string; accountSlot?: string };
}
