import { SignatureKind, type Checker } from 'typescript/unstable/sync';
import { type Node, type SourceFile, isIdentifier, isPropertyAccessExpression, isElementAccessExpression,
    isStringLiteral, isParenthesizedExpression, isNonNullExpression, isImportSpecifier, isExportSpecifier, isVariableDeclaration, isBindingElement,
    isTypeAliasDeclaration, isCallExpression, isAsExpression, isTypeAssertion, isTypePredicateNode,
    isFunctionDeclaration, isReturnStatement, isObjectLiteralExpression, isPropertyAssignment, isArrowFunction, isFunctionExpression } from 'typescript/unstable/ast';

const validator = 'core/domain/runtimeValidation.ts';
const parserOwners = new Set(['core/parsers/gemini/rpc/parseConversation.ts', 'core/parsers/gemini/dom/parseConversation.ts',
    'core/parsers/gemini/takeout/parseConversation.ts', 'core/parsers/gemini/rpc/mergePages.ts', 'core/compatibility/record/parseConversationRecord.ts']);
// Source builders finalize new graphs; only the repository restores disk/write snapshots.
const entries = new Map<string, Set<string>>([
    ['assertSchema', new Set([validator])], ['assertDomainClosure', new Set([validator])],
    ['validateParserDomain', parserOwners], ['restoreDomainSnapshot', new Set(['core/storage/domain/validate.ts'])],
    ['readStorageDomain', new Set(['core/storage/domain/domainStore.ts'])],
    ['requestNativeDetail', new Set(['background/batchFetcher.ts', 'core/engine/export/batchWorker.ts', 'ui/popup/popup.ts'])],
    ['requestNativeBatch', new Set(['core/engine/export/batchWorker.ts'])],
    ['callDomainBroker', new Set(['core/storage/domain/domainStore.ts'])],
]);
const trustedTypes = new Set(['TrustedDomain', 'ConversationParseResult', 'ResourceConversationParseResult',
    'GeminiRpcParseResult', 'GeminiDomParseResult', 'GeminiTakeoutParseResult', 'TrustedDomainStorageRecord',
    'DomainStorageWireRecord', 'NativeConversationInput', 'WorkerChatResolveInput', 'ChatExportInput', 'PopupExportInput']);
// The brand is confined to the validator. Only current-version authenticated transport adapters
// reattach the publisher's existing trust after Chrome serialization; neither is a raw/page reader.
const castOwners = new Map<string, Set<string>>([
    ['TrustedDomain', new Set([validator])],
    ['ResourceConversationParseResult', new Set(['core/utils/nativeDetailTransport.ts'])],
    ['DomainStorageWireRecord', new Set(['core/storage/domain/transport.ts'])],
]);
const castFunctions = new Map([['TrustedDomain', new Set(['validateParserDomain', 'restoreDomainSnapshot'])],
    ['ResourceConversationParseResult', new Set(['nativeResult'])], ['DomainStorageWireRecord', new Set(['callDomainBroker'])]]);
function walk(node: Node, visit: (node: Node) => void): void { visit(node); node.forEachChild(child => { walk(child, visit); }); }

/** Inspect real compiler nodes, retaining aliases and excluding comment/string contents. */
export function trustBoundaryViolations(source: SourceFile, owner: string, checker?: Checker): string[] {
    const nodes: Node[] = []; walk(source, n => nodes.push(n));
    const aliases = new Map<string, string>();
    const unwrap = (node: Node): Node => isParenthesizedExpression(node) || isNonNullExpression(node) ? unwrap(node.expression) : node;
    const jsonParse = (node: Node): boolean => {
        node = unwrap(node);
        return isCallExpression(node) && isPropertyAccessExpression(node.expression)
            && isIdentifier(node.expression.expression) && node.expression.expression.text === 'JSON' && node.expression.name.text === 'parse';
    };
    const symbol = (node: Node | undefined): string | undefined => {
        if (!node) return undefined;
        node = unwrap(node);
        if (isIdentifier(node)) return aliases.get(node.text) ?? node.text;
        if (isPropertyAccessExpression(node)) return aliases.get(node.name.text) ?? node.name.text;
        if (isElementAccessExpression(node) && isStringLiteral(node.argumentExpression)) return node.argumentExpression.text;
        return undefined;
    };
    const typeNames = (node: Node | undefined): Set<string> => {
        const result = new Set<string>();
        if (node) walk(node, child => { if (isIdentifier(child)) result.add(aliases.get(child.text) ?? child.text); });
        return result;
    };
    // Imports, local aliases, destructuring, and type aliases cannot hide a guarded operation.
    for (let pass = 0; pass < nodes.length; pass++) {
        let changed = false;
        const set = (name: string, target: string | undefined) => { if (target && aliases.get(name) !== target) { aliases.set(name, target); changed = true; } };
        for (const node of nodes) {
            if (isImportSpecifier(node)) set(node.name.text, symbol(node.propertyName ?? node.name));
            else if (isVariableDeclaration(node) && isIdentifier(node.name)) set(node.name.text, symbol(node.initializer));
            else if (isBindingElement(node) && node.name && isIdentifier(node.name)) set(node.name.text, symbol(node.propertyName));
            else if (isTypeAliasDeclaration(node) && !trustedTypes.has(node.name.text)) {
                const target = [...typeNames(node.type)].find(name => trustedTypes.has(name) || name === 'DomainConversationDetail');
                set(node.name.text, target);
            }
        }
        if (!changed) break;
    }
    const issues: string[] = [];
    const report = (node: Node, message: string) => issues.push(`${owner}:${node.getStart()} ${message}`);
    const entry = (node: Node, name: string | undefined) => {
        if (name && entries.has(name) && owner !== validator && !entries.get(name)!.has(owner)) report(node, `unauthorized ${name}`);
        if (name === 'assertDomainClosure' && owner !== validator) report(node, 'Closure belongs only to the shared validator');
    };
    for (const node of nodes) {
        if (isImportSpecifier(node)) entry(node, symbol(node.propertyName ?? node.name));
        if (isExportSpecifier(node)) entry(node, symbol(node.propertyName ?? node.name));
        if (isCallExpression(node)) entry(node, symbol(node.expression));
        if (isAsExpression(node) || isTypeAssertion(node)) {
            const types = typeNames(node.type);
            let ancestor = node.parent;
            while (ancestor && !isFunctionDeclaration(ancestor)) ancestor = ancestor.parent;
            const functionName = ancestor && isFunctionDeclaration(ancestor) ? ancestor.name?.text : undefined;
            for (const name of types) if (trustedTypes.has(name) || name === 'DomainConversationDetail') {
                if (!castOwners.get(name)?.has(owner) || !functionName || !castFunctions.get(name)?.has(functionName)) report(node, `unauthorized trust assertion ${name}`);
                if (isAsExpression(unwrap(node.expression)) || isTypeAssertion(unwrap(node.expression))) report(node, 'double trust assertion');
            }
        }
        if (isTypePredicateNode(node)) {
            const types = typeNames(node.type);
            if ([...types].some(name => trustedTypes.has(name) || name === 'DomainConversationDetail')) {
                const parent = node.parent;
                const internal = owner === 'core/parsers/parsingResult.ts' && parent && isFunctionDeclaration(parent)
                    && parent.name?.text === 'isResourceConversationParseResult'
                    && parent.parameters[0]?.type?.getText() === 'NativeConversationInput';
                const schema = owner === validator && parent && isFunctionDeclaration(parent) && parent.name?.text === 'assertSchema' && types.has('DomainConversationDetail');
                if (!schema && !internal) report(node, 'unauthorized trust-producing predicate');
            }
        }
        if (owner !== validator && isObjectLiteralExpression(node)) {
            const properties = new Map(node.properties.filter(isPropertyAssignment).map(p => [p.name.getText(), p.initializer]));
            const fields = ['providerId', 'id', 'title', 'timestamp', 'messages', 'assets'];
            if (fields.every(key => properties.has(key)) && fields.every(key => {
                const value = properties.get(key)!;
                if (isArrowFunction(value) || isFunctionExpression(value)) return true;
                const type = checker?.getTypeAtLocation(value);
                return type ? checker!.getSignaturesOfType(type, SignatureKind.Call).length > 0 : false;
            })) report(node, 'copied full Domain schema descriptor');
        }
        // JSON.parse must stay unknown until an authorized boundary, never directly supply a brand.
        if (isVariableDeclaration(node) && node.initializer && jsonParse(node.initializer)
            && [...typeNames(node.type)].some(name => trustedTypes.has(name))) report(node, 'JSON cannot manufacture trust');
        if (isReturnStatement(node) && node.expression && jsonParse(node.expression)) {
            let enclosing = node.parent;
            while (enclosing && !isFunctionDeclaration(enclosing) && !isFunctionExpression(enclosing) && !isArrowFunction(enclosing)) enclosing = enclosing.parent;
            if (enclosing && (isFunctionDeclaration(enclosing) || isFunctionExpression(enclosing) || isArrowFunction(enclosing))
                && [...typeNames(enclosing.type)].some(name => trustedTypes.has(name))) report(node, 'JSON cannot return manufactured trust');
        }
        if (isArrowFunction(node) && jsonParse(node.body)
            && [...typeNames(node.type)].some(name => trustedTypes.has(name))) report(node, 'JSON cannot return manufactured trust');
    }
    return [...new Set(issues)];
}
