"""Configure an unpacked test build for the shared Web OAuth client."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re

# Public test key pins the unpacked extension ID across machines and directories.
PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6PCdGkYsM9Q2GmItKDCgx47bEdBBv26MwvGVLy2zo0AFkhXBBIs+RuRUPQidEMT1KjDNjx9UL/UPHu656PjwE/WIXCOEMsZM49/3CAnYxncJNxXu3/vYtmGCDLtwdDfOc3GnE7BdSgJ03n8H0aX9E4zhXagF5kDOy16Jrth3BhhC9YBUhxHfunjJQv/RrZdk7apo8rWC7a+XToHzhbGe7HVOskjwQnL+oghxgoEZMnLybV9TymnsrjIEJsWH08LQvpqJ+VWbzSh/hVLLMuXQJMNPz6N22n6g9UWcE3wwWai3IsYW81UQ0AqLKk0Qg1mAacusfHKQ3MXdtI+9IVS9IQIDAQAB'
EXTENSION_ID = hashlib.sha256(base64.b64decode(PUBLIC_KEY)).hexdigest()[:32].translate(
    str.maketrans('0123456789abcdef', 'abcdefghijklmnop')
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path, help='Unpacked copy of the packaged extension')
    parser.add_argument('--client-id', required=True, help='Public Web OAuth client ID')
    args = parser.parse_args()
    folder = args.directory.resolve()
    if (folder / 'package.json').exists() or not (folder / 'dist/ui/options.js').is_file():
        parser.error('Choose an unpacked extension package, outside the source checkout.')
    manifest_path = folder / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('options_page') != 'src/ui/options/options.html' or manifest.get('key', PUBLIC_KEY) != PUBLIC_KEY:
        parser.error('Expected a Gemini Exporter development package.')
    if not re.fullmatch(r'\d+-[A-Za-z0-9-]+\.apps\.googleusercontent\.com', args.client_id):
        parser.error('Expected a public Web OAuth client ID ending in .apps.googleusercontent.com.')
    manifest['key'] = PUBLIC_KEY
    manifest.pop('oauth2', None)
    for field, permission in [('permissions', 'identity'), ('host_permissions', 'https://www.googleapis.com/*')]:
        if permission not in manifest[field]:
            manifest[field].append(permission)
    (folder / 'drive-account-client.json').write_text(json.dumps(args.client_id), encoding='utf-8')
    temporary = manifest_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(manifest_path)
    print(f'Chrome Extension ID: {EXTENSION_ID}')
    print('Drive configured. Load or reload this directory in chrome://extensions.')


if __name__ == '__main__':
    main()
