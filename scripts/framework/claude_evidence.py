"""Claude source-to-disk oracle, independent of production parsers and renderers."""
from collections import Counter
import json
import re
import subprocess
import unicodedata

from scripts.framework.claude_live import completed_branch
from scripts.framework.html_evidence import TreeParser, read_message
from scripts.framework.cases.export import PdfExportDownloadCase
from scripts.framework.pdf_evidence import assert_pdf_turn_content


def compact(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text) if not c.isspace() and c not in '\u200b\ufeff')


def markdown_fact(root, text):
    result = subprocess.run(['node', str(root/'scripts/framework/markdown_evidence.mjs')],
        input=json.dumps({'text': text, 'segments': True}), capture_output=True, text=True, timeout=30, check=True)
    return json.loads(result.stdout)


def source_fragments(message):
    """Authored prose plus native question/Artifact facts; never private memory bodies."""
    fragments, codes = [], []
    blocks = message.get('content', [])
    if not blocks and message.get('text'):
        fragments.append(message['text'])
    for block in blocks:
        kind = block.get('type')
        if kind == 'text' and block.get('text'):
            fragments.append(block['text'])
        elif kind == 'tool_use':
            name, arguments = block.get('name', '').lower(), block.get('input') or {}
            if name == 'askuserquestion':
                for question in arguments.get('questions', []):
                    fragments.extend(question.get(k, '') for k in ('header', 'question'))
                    for option in question.get('options', []):
                        fragments.extend(option.get(k, '') for k in ('label', 'description'))
            elif name == 'write' and isinstance(arguments.get('content'), str):
                codes.append(arguments['content'].removesuffix('\n'))
            elif name == 'artifacts' and isinstance(arguments.get('content'), str):
                codes.append(arguments['content'].removesuffix('\n'))
        elif kind == 'tool_result' and block.get('name', '').lower() == 'askuserquestion':
            fragments.extend(b['text'] for b in block.get('content', []) if b.get('type') == 'text' and b.get('text'))
    return [f for f in fragments if f], codes


def assert_full_exports(root, output, conversation_ids):
    results = []
    for cid in conversation_ids:
        raw = json.loads((output/f'{cid}.source.json').read_text())
        expected = completed_branch(raw)
        documents = [p for p in (output/'downloads/json').rglob('*.json')
                     if json.loads(p.read_text()).get('conversation', {}).get('index', {}).get('key', {}).get('conversationId') == cid]
        if len(documents) != 1:
            raise ValueError(f'{cid}: missing or duplicate physical JSON conversation')
        document = documents[0]
        detail = json.loads(document.read_text())['conversation']['detail']
        if detail['quality']['status'] != 'complete':
            raise ValueError(f'{cid}: parser quality is not complete: {detail["quality"]}')
        if [m['id'] for m in detail['messages']] != [m['uuid'] for m in expected]:
            raise ValueError(f'{cid}: source branch/message identity mismatch')
        markdown = (output/'downloads/markdown'/(document.stem+'.md')).read_text()
        bodies = re.split(r'^## (?:👤|🤖)[^\n]*\n', markdown, flags=re.M)[1:]
        html = TreeParser((output/'downloads/html'/(document.stem+'.html')).read_text()).root
        html_bodies = [n for n in html.walk() if n.classes & {'gem-prompt-content', 'gem-model-content'}]
        if len(bodies) != len(expected) or len(html_bodies) != len(expected):
            raise ValueError(f'{cid}: physical Markdown/HTML message count mismatch')
        if any('katex-error' in n.classes for n in html.walk()):
            raise ValueError(f'{cid}: invalid exported formula')
        pdf = PdfExportDownloadCase._extract_pdf_info(str(output/'downloads/pdf'/(document.stem+'.pdf')))
        if pdf.get('error') or not pdf.get('contentRuns'):
            raise ValueError(f'{cid}: missing tagged PDF content')
        evidence, total_fragments, total_codes = [], 0, 0
        for index, (source, md, html_node) in enumerate(zip(expected, bodies, html_bodies)):
            role = 'user' if source['sender'] == 'human' else 'assistant'
            if detail['messages'][index]['role'] != role:
                raise ValueError(f'{cid}: exported role mismatch')
            fragments, tool_codes = source_fragments(source)
            source_facts = []
            blocks = source.get('content') or [{'type': 'text', 'text': source.get('text', '')}]
            for block in blocks:
                block_fragments, block_codes = source_fragments({'content': [block]})
                source_facts.extend(markdown_fact(root, f) for f in block_fragments)
                source_facts.extend({'text': code, 'codeBlocks': [code], 'segments': [{'kind': 'code', 'text': code}]} for code in block_codes)
            md_fact = markdown_fact(root, md)
            html_fact = read_message(html_node, '\n'.join(fragments))
            md_text, html_text = compact(md_fact['text']), compact(html_fact['text'])
            md_cursor = html_cursor = 0
            for fact in source_facts:
                wanted = compact(fact['text'])
                if not wanted:
                    continue
                md_position, html_position = md_text.find(wanted, md_cursor), html_text.find(wanted, html_cursor)
                if md_position < 0 or html_position < 0:
                    raise ValueError(f'{cid} message {index+1}: missing/out-of-order complete authored fragment {wanted[:100]!r}')
                md_cursor, html_cursor = md_position+len(wanted), html_position+len(wanted)
            # Markdown fences consume their final line ending; HTML code text
            # retains it. Normalize only this serializer boundary, never spaces.
            wanted_codes = Counter(code.removesuffix('\n') for fact in source_facts for code in fact['codeBlocks'])
            if wanted_codes - Counter(c.removesuffix('\n') for c in md_fact['codeBlocks']) or wanted_codes - Counter(c.removesuffix('\n') for c in html_fact['code_blocks']):
                raise ValueError(f'{cid} message {index+1}: code text/indentation changed')
            # PDF is checked against independent prose/math/code source, not against HTML.
            segments = [s for fact in source_facts for s in fact['segments']]
            if role == 'user':
                evidence.append({'prompt': ''.join(f['text'] for f in source_facts)})
            else:
                evidence[-1].update(response=''.join(s['text'] for s in segments), pdf_segments=segments)
            total_fragments += len(fragments)
            total_codes += sum(wanted_codes.values())
        ok, summary = assert_pdf_turn_content(pdf, evidence)
        if not ok:
            raise ValueError(f'{cid}: {summary}')
        results.append({'conversationId': cid, 'messages': len(expected), 'authoredFragments': total_fragments,
                        'codeBlocks': total_codes, 'pdfPages': pdf['pageCount']})
    return results
