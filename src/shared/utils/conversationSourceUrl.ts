/** Presentation URL derived from the Account provider and opaque conversation ID. */
export function conversationSourceUrl(providerId: string, conversationId: string): string | undefined {
    if (providerId === 'gemini') return `https://gemini.google.com/app/${encodeURIComponent(conversationId)}`;
    if (providerId === 'chatgpt') return `https://chatgpt.com/c/${encodeURIComponent(conversationId)}`;
    return undefined;
}
