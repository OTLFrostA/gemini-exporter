# Domain final semantic cleanup

## Outcome and scope

Domain contract **2** has one representation per canonical fact. All requested candidate deletions are implemented in one change. IndexedDB/storage version remains 2; the versioned Domain contract and JSON export envelope are now 2. No candidate Domain field was retained as an exception.

## Deletion accounting

Counts compare this change against its parent commit. Fields count named properties at the specified contract level, not children of an entirely removed object or the properties of the removed ThoughtBlock type.

| Category | Count | Evidence |
| --- | ---: | --- |
| Removed Domain properties | 22 | Conversation 6; asset 4; asset.document 5; generation identity 2; message provenance 1; citation 1; code 1; completeness wrapper 2 |
| Added replacement scalar | 1 | `sourceUri`, replacing `source` wrapper |
| Removed Domain types | 3 | DomainConversationProvenance, DomainConversationCompleteness, ThoughtBlock |
| Removed redundant state forms | 5 | absent completeness as another unknown; generated boolean; thought AST; explicit default alignment; Domain title candidate map |
| Removed helpers/factories | 9 | normalizeMessageProvenance, nullable, dictionary, generationSchema, documentSchema, assetSchema, normalizeLegacyAsset, asSpreadSource, mergeTitleSources |
| Removed fallback paths | 8 | Markdown creation aliases, update alias, URL alias; index creation aliases, update aliases; source-specific archive destination reuse; independent list legacy-title fallback; repeated Takeout-title fallback |
| Production lines (`git diff --numstat -- src`) | +256 / −352, net **-96** | Excludes tests/docs/generated output |

The 22 properties are `Conversation.{timestamp,chatTime,lastSeen,href,titles,provenance}`, `Asset.{origin,dimensions,generated,source}`, `Asset.document.{createdAt,chipUrl,sections,links,candidates}`, `Generation.{chatId,turnId}`, `Message.provenance.providerRequestId`, `Citation.kind`, `Code.filename`, and `completeness.{status,reason}`. The completeness property itself becomes a required scalar.

One private version-1 converter and its nested AST extractor replace the old resource-time recovery helper and three dual-schema factories. They run only on explicitly versioned historical reads, never on new writes or document/export consumers. RPC decoder aliases and the unused decoder title map are also removed. Counts above do not claim every deleted `if` or test fixture is a separate semantic simplification.

## Final Domain schema

The following is the complete current contract from `core/domain/conversationDetail.ts` and Content AST definitions. Numbers representing time are finite Unix epoch milliseconds. Unknown optional facts are absent, with no null/string alternative. `createdAt` and `updatedAt` are independent.

```ts

/** Provider-neutral description of a complete conversation detail. */
export type DomainMessageRole =
    | 'user'
    | 'assistant'
    | 'system'
    | 'developer'
    | 'unknown';

/** Semantic resource identity, shared across the conversation. No export destination or layout. */
export type DomainAssetKind = 'image' | 'file' | 'audio' | 'video' | 'other';

export interface DomainAsset {
    id: string;
    kind: DomainAssetKind;
    name?: string;
    mediaType?: string;
    byteLength?: number;
    /** Original acquisition URI, never an export destination or legacy localName. */
    sourceUri?: string;
    dataBase64?: string;
    failureReason?: string;
    generation?: Partial<DomainGeneratedMediaIdentity>;
    document?: {
        id?: string;
        contentMarkdown?: string;
        hasFabricatedText?: boolean;
    };
}

export interface DomainGeneratedMediaIdentity {
    providerRequestId?: string;
    /** Unix epoch milliseconds; omit when unknown. */
    time?: number;
    prompt?: string;
    generationOrdinal: number;
    imageCount?: number;
    imageOrdinal?: number;
}

export interface DomainCitation {
    /** Message-local identity referenced by content/reasoning citationRef nodes. */
    id: string;
    /** Source-authored citation number, when present (for example a grounding reference). */
    number?: number;
    url?: string;
    title?: string;
}

/** Provider-originated metadata, never a Domain relationship key. */
export interface DomainMessageProvenance {
    /** Source-authored role when it cannot be normalized to a known role. */
    rawRole?: string;
}

/** Authored media-generation event; output files may be absent from the source. */
export interface DomainGenerationEvent {
    mediaKind: 'image' | 'audio' | 'video' | 'other';
    outputCount?: number;
}

export interface DomainMessage {
    /** Optional stable message identity; never synthesized from array position. */
    id?: string;
    role: DomainMessageRole;
    /** Provider-authored model name, when supplied. */
    model?: string;
    content: BlockNode[];
    /** Unix epoch milliseconds; omit when missing or unknown. */
    timestamp?: number;
    provenance?: DomainMessageProvenance;
    /** Explicit message-owned resources, in source order; every ID belongs to conversation.assets. */
    attachmentIds?: string[];
    /** A source-recorded generation event remains meaningful even when its output files are absent. */
    generation?: DomainGenerationEvent;
    /** Provider-exposed reasoning parsed before Domain; resource nodes use registry IDs. */
    reasoning?: BlockNode[];
    citations?: DomainCitation[];
}

/** Canonical conversation facts, independent of acquisition and presentation. */
export interface DomainConversationDetail {
    providerId: string;
    completeness: 'complete' | 'partial' | 'unknown';
    /** One record per semantic resource; body/reasoning assetId values refer to these IDs. */
    assets: DomainAsset[];
    id: string;
    title: string;
    /** Unix epoch milliseconds; omit when unknown. */
    updatedAt?: number;
    /** Unix epoch milliseconds; omit when unknown. */
    createdAt?: number;
    url?: string;
    messages: DomainMessage[];
    titleSource?: string;
}
```

```ts

export type BlockNode =
    | ParagraphBlock
    | HeadingBlock
    | ListBlock
    | QuoteBlock
    | CodeBlock
    | MathBlock
    | TableBlock
    | ImageBlock
    | FileBlock
    | ThematicBreakBlock
    | UnknownBlock;

export interface ParagraphBlock {
    type: 'paragraph';
    children: InlineNode[];
}

export interface HeadingBlock {
    type: 'heading';
    level: 1 | 2 | 3 | 4 | 5 | 6;
    children: InlineNode[];
}

export interface ListItem {
    blocks: BlockNode[];
}

export interface ListBlock {
    type: 'list';
    ordered: boolean;
    start?: number;
    items: ListItem[];
}

export interface QuoteBlock {
    type: 'quote';
    blocks: BlockNode[];
}

export interface CodeBlock {
    type: 'code';
    code: string;
    language?: string;
    meta?: string;
}

export interface MathBlock {
    type: 'math';
    source: string;
}

export type TableAlignment = 'left' | 'center' | 'right';

export interface TableColumn {
    align?: TableAlignment;
}

export interface TableCell {
    children: InlineNode[];
    colSpan?: number;
    rowSpan?: number;
}

export interface TableRow {
    cells: TableCell[];
}

export interface TableBlock {
    type: 'table';
    caption?: InlineNode[];
    columns?: TableColumn[];
    headerRows?: TableRow[];
    rows: TableRow[];
}

export interface ImageBlock {
    type: 'image';
    assetId: string;
    alt?: string;
    caption?: InlineNode[];
}

export interface FileBlock {
    type: 'file';
    assetId: string;
    label?: string;
    description?: InlineNode[];
}

export interface ThematicBreakBlock {
    type: 'thematicBreak';
}

/** Unsupported content remains visible as plain text. */
export interface UnknownBlock {
    type: 'unknown';
    sourceType: string;
    text: string;
}
```

```ts
export type InlineNode =
    | TextInline
    | StrongInline
    | EmphasisInline
    | StrikethroughInline
    | InlineCode
    | LinkInline
    | ImageInline
    | InlineMath
    | CitationRefInline
    | LineBreakInline;

export interface TextInline {
    type: 'text';
    text: string;
}

export interface StrongInline {
    type: 'strong';
    children: InlineNode[];
}

export interface EmphasisInline {
    type: 'emphasis';
    children: InlineNode[];
}

export interface StrikethroughInline {
    type: 'strikethrough';
    children: InlineNode[];
}

export interface InlineCode {
    type: 'inlineCode';
    code: string;
}

export interface LinkInline {
    type: 'link';
    href: string;
    title?: string;
    children: InlineNode[];
}

export interface ImageInline {
    type: 'image';
    assetId: string;
    alt?: string;
    title?: string;
}

export interface InlineMath {
    type: 'inlineMath';
    source: string;
}

export interface CitationRefInline {
    type: 'citationRef';
    citationId: string;
    label?: string;
}

export interface LineBreakInline {
    type: 'lineBreak';
    kind: 'soft' | 'hard';
}
```

## Decisions and preservation evidence

- **Titles:** `domain/titleAuthority.ts` owns ranking and tie-breaking. `utils/titleUtils.ts` delegates arbitration to it; the list index alone keeps source slots. Parser boundaries resolve their confirmed title. `domainStore.ts` selects title independently of body, so a partial observation can upgrade a title without replacing a complete transcript.
- **Completeness:** native RPC is unknown without positive coverage evidence, partial with remaining pages/rejected turns; DOM observation is unknown; Takeout activity logs are partial. Complete bodies cannot be replaced by larger partial/unknown observations. Parser diagnostics carry truncation explanations outside Domain.
- **Times:** DOM and pagination do not manufacture conversation dates from message timestamps. RPC no longer produces minimum-observed creation time or timestamp/chatTime aliases. Takeout records the latest authored activity as update evidence. Message dates, list `lastSeen` and export-record `chatTime` retain their separate semantics.
- **Documents:** parser resource finalization combines canonical Markdown with independent sections/links before Domain. Already-contained sections/URLs are not appended again. Repeated source-authored section entries are preserved. The resulting Domain contains one body. Candidate download URLs stay in acquisition context.
- **Generation:** resources retain request/time/prompt/ordinal/count evidence; messages retain authored generation events even if images are missing. Resource matching receives conversation context, treats shared parent IDs as opaque, rejects conflicting requests/events/positions and requires bidirectional unique matches. Gemini ID normalization occurs in provider-aware storage/Takeout calls.
- **Citations:** source number/identity remain unchanged in Domain. The composer assigns one conversation-wide display sequence for body, reasoning and Sources. Explicit numeric labels are rewritten to that sequence; authored custom labels and source titles remain visible. References without URLs remain visible.
- **Content:** reasoning has one Domain location. Code language/meta/body, all other Content variants, attachments, math and table layouts remain supported. Default table layout is represented by absent alignment.

## Historical persistence and safety

New parser finalization and detached storage writes reject deleted fields at every schema level. `restoreDomainSnapshot(value, 1)` is the sole converter for old Domain records, selected by persisted envelope version; default/new writes require v2. Successful reads return v2 snapshots without rewriting the physical original. Unknown versions/fields fail closed.

Recovery extracts nested historical thoughts into reasoning and preserves resource references; it flattens URI/completeness and arbitrates historical title candidates. A historical generated resource with no identity may recover a request ID only from an unambiguous message that explicitly owns that asset. It never infers ownership/identity from array position or a filename. Missing/conflicting identity evidence, conflicting parent IDs or report sections/links not demonstrably present in canonical Markdown cause an explicit error while retaining the original row. This deliberate rejection is a compatibility cost, not a claim that old content was successfully migrated.

Real IndexedDB browser checks cover v1 read conversion, original-row preservation, v2 rejection of old writes, rejected unsafe recovery, restart/byte durability and account-scoped cleanup.

## Retention exceptions

**None of the requested candidate fields/types/states remain in Domain.** The required list `lastSeen`, export-record `chatTime`, message `timestamp`, raw unknown role, resource identity facts and message generation events remain as explicitly requested.

Presentation AST may use a renderer default alignment value after composition; it is layout, not a second Domain state. Source parsers/acquisition hints still read provider wire fields such as chat/turn IDs and candidate URLs to establish identity/download bytes. They are not serialized back into Domain under another name.

## Validation

The complete `npm test` gate exited 0. The final source was additionally checked with the full Node test runner.

- TypeScript type-check: PASS.
- Scoped zero-any gate: PASS through `npm test`.
- Repository lint (`npm run lint`, Oxlint type-aware rules): 0 errors; 1478 warnings versus 1484 on clean main. Comparing per-file/rule/message after removing line/column differences found zero new warnings (6 removed).
- Supplemental ESLint 10.12.0: 0 errors / 0 warnings on `src/`, using an isolated TypeScript parser and the rules `no-dupe-keys`, `no-duplicate-case`, `no-unreachable`, `no-unsafe-negation`, `valid-typeof`, `no-loss-of-precision`, `no-self-assign`, `constructor-super`, `no-async-promise-executor`. This is an additional structural audit; the repository's configured type-aware lint gate is Oxlint. No dependency/config was added to the project merely for this audit.
- Complete unit, parser, Domain contract, storage recovery and HTML/Markdown/PDF/JSON export suites: PASS (265 TypeScript unit suite files through the Python runner; the final full Node invocation passed all 2023 checks, 0 skipped). Python harness/architecture checks also passed.
- Production build: PASS (6 bundles, 0 production build warnings).
- Complete Playwright suite: PASS (95/95, 0 skipped), including actual downloads, rendering/compilation, extension transport and physical IndexedDB recovery.
- Targeted added recovery/resource/numbering/completeness regressions: PASS.
- Scenario pool: 20/20; no live scenarios consumed.
- **Tier 2: NOT RUN.** `http://localhost:9222/json/version` was unreachable (curl exit 7). Offline E2E is not a Tier 2 pass.
- **Tier 3: NOT RUN**, outside this cleanup's requested execution scope. Unit checks of the visual harness are not a live visual audit.

## Remaining complexity and limits

There is no second Domain title authority, completeness representation, reasoning AST or time/URL alias path after the strict v2 boundary, as verified by schema rejection tests and source searches. This does not assert the entire application has no complexity:

1. Version-1 restoration remains one explicitly gated historical path. It is conservative and can reject older rows instead of guessing semantics.
2. Historical pre-Domain list/detail migration still interprets its own source grammar. It is a separate input format, not an alternative Domain model or a runtime export fallback.
3. List UI normalization/placeholder filtering remains application/provider-specific; its rank/tie decision delegates to the common authority.
4. Acquisition still has candidate URLs, archive bindings and provider request-token normalization. These are source access/identity concerns outside Domain. Future provider inputs need their own source evidence contracts; the current source resolver primarily serves Gemini and characterized historical records.
5. The existing linear transcript does not model branching/tool execution beyond actual supported producers. This cleanup does not manufacture such facts or claim coverage for future wire variants.

The lack of a live Tier 2 run is the material verification limit for this refactor. Historical live acceptance reports elsewhere in the repository describe their original code revisions.
