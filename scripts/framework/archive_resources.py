"""Resolve exported references exactly as a document-relative archive path."""
import posixpath
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


def resolve_archive_reference(document, reference):
    """Return an archive entry, None for external/fragment refs, or raise ValueError."""
    reference = reference.strip()
    if not reference or reference.startswith('#'):
        return None
    parsed = urlsplit(reference)
    if parsed.scheme.lower() in ('http', 'https', 'mailto', 'tel', 'data', 'blob') or parsed.netloc:
        return None
    if parsed.scheme:
        raise ValueError('unsupported resource scheme')
    path = unquote(parsed.path)
    if not path or path.startswith(('/', '\\')) or '\\' in path or '\x00' in path:
        raise ValueError('invalid archive-relative resource path')
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(document), path))
    if resolved == '..' or resolved.startswith('../') or resolved.startswith('/'):
        raise ValueError('resource escapes archive root')
    return resolved


def find_archive_resource(root, document, reference):
    entry = resolve_archive_reference(document, reference)
    if entry is None:
        return None
    root = Path(root).resolve()
    target = (root / entry).resolve()
    if not target.is_relative_to(root):
        raise ValueError('resource escapes archive root')
    if not target.is_file() or target.stat().st_size == 0:
        raise ValueError(f'missing or empty resource: {entry}')
    return str(target)


class _HtmlReferences(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.references = []

    def handle_starttag(self, tag, attrs):
        key = 'href' if tag == 'a' else 'src' if tag in ('img', 'video', 'audio', 'source') else None
        if key:
            self.references.extend(value for attr, value in attrs if attr == key and value)


def resource_references(content, html=False):
    if html:
        parser = _HtmlReferences()
        parser.feed(content)
        return parser.references
    # Fenced and inline code contain examples, not rendered resource references.
    content = re.sub(r'(?ms)^\s*(`{3,}|~{3,})[^\n]*\n.*?^\s*\1\s*$', '', content)
    content = re.sub(r'(`+).*?\1', '', content, flags=re.DOTALL)
    # Formula brackets and function application are not rendered Markdown links.
    content = re.sub(r'(?<!\\)\$\$.*?(?<!\\)\$\$', '', content, flags=re.DOTALL)
    content = re.sub(r'(?<!\\)\$(?!\$).*?(?<!\\)\$', '', content, flags=re.DOTALL)
    content = re.sub(r'\\\[.*?\\\]|\\\(.*?\\\)', '', content, flags=re.DOTALL)
    refs = []
    for match in re.finditer(r'!?\[(?:\\.|[^\]\\])*\]\(\s*(<[^>]*>|(?:\\.|[^\s)])+)\s*(?:["\'][^"\']*["\'])?\s*\)', content):
        dest = match.group(1)
        if dest.startswith('<'):
            dest = dest[1:-1]
        refs.append(re.sub(r'\\([!"#$%&\'()*+,\-./:;<=>?@\[\]\\^_`{|}~])', r'\1', dest))
    return refs


def validate_archive_resources(root, document, content, html=False):
    errors = []
    for reference in resource_references(content, html):
        try:
            find_archive_resource(root, document, reference)
        except ValueError as exc:
            errors.append(f'{reference}: {exc}')
    return errors
