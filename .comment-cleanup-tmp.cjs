'use strict';
function processFile(text, path) {
  const ext = path.split('.').pop().toLowerCase();
  const hash = /^(py|yml|yaml|sh|bash|ps1|cmd|gitignore)$/.test(ext) || path === '.gitignore';
  const isTex = ext === 'tex', isHtml = ext === 'html', isCss = ext === 'css';
  const script = /^(ts|tsx|js|mjs|cjs|typ)$/.test(ext);
  const tokens = [];
  function add(start, end, kind) {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEndPos = text.indexOf('\n', end);
    const lineEnd = lineEndPos < 0 ? text.length : lineEndPos;
    const prefix = text.slice(lineStart, start);
    const suffix = text.slice(end, lineEnd);
    tokens.push({start, end, kind, lineStart, lineEnd, full: !prefix.trim() && !suffix.trim(),
      indent: prefix.length, raw: text.slice(start, end)});
  }
  let i = 0;
  while (i < text.length) {
    const c = text[i], next = text[i + 1], triple = text.slice(i, i + 3);
    if (hash && (c === '"' || c === "'") && triple === c + c + c) {
      const end = text.indexOf(triple, i + 3);
      i = end === -1 ? text.length : end + 3; continue;
    }
    if (c === "'" || c === '"' || c.charCodeAt(0) === 96) {
      const delimiter = c; i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === delimiter) { i++; break; }
        if (delimiter.charCodeAt(0) !== 96 && text[i] === '\n') break;
        i++;
      }
      continue;
    }
    if (isHtml && text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4), nextIndex = end < 0 ? text.length : end + 3;
      add(i, nextIndex, 'block'); i = nextIndex; continue;
    }
    if (!hash && !isTex && c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2), nextIndex = end < 0 ? text.length : end + 2;
      add(i, nextIndex, 'block'); i = nextIndex; continue;
    }
    if (script && c === '/' && next !== '/' && next !== '*') {
      const prefix = text.slice(Math.max(0, i - 90), i).trimEnd();
      if (/(?:[=(:,\[{!?:;|&+*%~<>-]|\b(?:return|throw|case|yield|of|in))$/.test(prefix)) {
        let j = i + 1, inClass = false, end = -1;
        while (j < text.length && text[j] !== '\n') {
          if (text[j] === '\\') { j += 2; continue; }
          if (text[j] === '[') inClass = true;
          else if (text[j] === ']') inClass = false;
          else if (text[j] === '/' && !inClass) { end = j + 1; break; }
          j++;
        }
        if (end !== -1) { i = end; while (/[a-z]/i.test(text[i] || '') && i < text.length) i++; continue; }
      }
    }
    if (script && c === '/' && next === '/') {
      const end = text.indexOf('\n', i), nextIndex = end === -1 ? text.length : end;
      add(i, nextIndex, 'line'); i = nextIndex; continue;
    }
    if (hash && c === '#' && (i === 0 || /[\s;]/.test(text[i - 1]))) {
      const end = text.indexOf('\n', i), nextIndex = end === -1 ? text.length : end;
      add(i, nextIndex, 'line'); i = nextIndex; continue;
    }
    if (isTex && c === '%' && (i === 0 || text[i - 1] !== '\\')) {
      const end = text.indexOf('\n', i), nextIndex = end === -1 ? text.length : end;
      add(i, nextIndex, 'line'); i = nextIndex; continue;
    }
    i++;
  }
  const grouped = [];
  for (const comment of tokens) {
    const last = grouped[grouped.length - 1], prev = last && last[last.length - 1];
    if (last && prev.kind === 'line' && comment.kind === 'line'
        && prev.full && comment.full && prev.indent === comment.indent
        && prev.lineEnd + 1 === comment.lineStart && text[prev.lineEnd] === '\n') {
      last.push(comment);
    } else grouped.push([comment]);
  }
  const reason = /\b(?:because|otherwise|instead|rather|unlike|unless|except|therefore|hence|consequently|so that|in order to|in case|to avoid|to prevent|avoids?|prevents?|guarantees?|requires?|required|invariant|must|should|never|cannot|can't|don't|doesn't|do not|not allowed|not just|only if|only when|even if|even though|but not|without|fallback|compatib(?:ility|le)|risk|unsafe|danger|security|privacy|contract|workaround|regression|bug|race|stale|historical|legacy|breaks?|failure|fails?|forbid|protect|reason|why|important|warning|caution|note:|to keep|to retain|to ensure|in contrast|so the|so a|so an|so we|as a result|per design|by design|so it|as opposed to|independent(?:ly)?|authoritative|untrusted|trusted|bounded|different from|vs[.]?|despite|not\b|no longer|never|always)\b/i;
  const chinese = /(因为|否则|避免|防止|必须|不能|不要|不应|因此|而不是|相反|确保|兼容|依赖|风险|约束|限制|边界|禁止|严禁|保证|以免|需要|导致|只在|只有|独立于|不可|不会|不再|为防|保留|旧版|防止|优先|可信|权限|安全|隔离|阻止|失效)/;
  const directive = /(?:\b(?:SPDX|copyright|license|MIT|Apache|author|eslint|ts-ignore|ts-expect-error|ts-nocheck|ts-check|prettier-ignore|istanbul|coverage|c8 ignore|noqa|pylint|type:\s*ignore|pyright|mypy|shellcheck|pragma|sourceMappingURL|sourceURL|generated|DO NOT EDIT|@typedef|@type|@template|@satisfies|@deprecated|@preserve|@license|@jsx|@ts)\b|<reference|#\s*(?:end)?region|@param\b|@returns?\b|@property\b|@example\b|^#!|coding[:=]|TODO|FIXME|HACK|XXX|ported from|derived from|third.party)/i;
  const edits = [], removed = [], kept = [];
  for (const group of grouped) {
    const raw = group.map(t => t.raw).join('\n');
    const trimmed = raw.replace(/^(\s*\/\/\/?|\s*#|\s*\*|\s*\/\*+|\s*<!--)\s*/gm, ' ').trim();
    const preserve = reason.test(trimmed) || chinese.test(trimmed) || directive.test(raw)
      || /(?:\b(?:@link|@see|@internal|@public|@private|@package|@throws|@license|@preserve)\b)/i.test(raw)
      || /(?:^\s*#[!]|^\s*#\s*-{3,})/.test(raw);
    const first = group[0], last = group[group.length - 1];
    let start, end, replacement = '';
    if (first.full && last.full) {
      start = first.lineStart;
      end = last.lineEnd + (text[last.lineEnd] === '\n' ? 1 : 0);
    } else if (group.length === 1 && first.kind === 'line') {
      start = first.start; end = first.end;
    } else if (group.length === 1 && first.kind === 'block') {
      start = first.start; end = first.end;
      if (/[\w$]/.test(text[start - 1] || '') && /[\w$]/.test(text[end] || '')) replacement = ' ';
    } else { kept.push({raw, reason:'mixed comment'}); continue; }
    const inlineBlockWithCode = first.kind === 'block' && !first.full
      && (text.slice(first.lineStart, start).trim() || text.slice(end, first.lineEnd).trim());
    if (preserve || inlineBlockWithCode) {
      kept.push({raw, reason: preserve ? 'why/directive' : 'inline block'}); continue;
    }
    if (first.kind === 'line' && !first.full) {
      while (start > first.lineStart && /[ \t]/.test(text[start - 1])) start--;
    }
    edits.push({start, end, replacement}); removed.push(raw);
  }
  let output = text;
  for (const edit of edits.reverse()) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  return {content:output, changed:output !== text, removed, kept, comments:tokens.length};
}
module.exports = {processFile};