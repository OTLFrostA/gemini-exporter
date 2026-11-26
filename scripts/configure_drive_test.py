"""Configure an unpacked test build for a Chrome Extension OAuth client."""
import argparse
import base64
from getpass import getpass
import hashlib
import json
from pathlib import Path
import re
import secrets

# Public test key pins the unpacked extension ID across machines and directories.
PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6PCdGkYsM9Q2GmItKDCgx47bEdBBv26MwvGVLy2zo0AFkhXBBIs+RuRUPQidEMT1KjDNjx9UL/UPHu656PjwE/WIXCOEMsZM49/3CAnYxncJNxXu3/vYtmGCDLtwdDfOc3GnE7BdSgJ03n8H0aX9E4zhXagF5kDOy16Jrth3BhhC9YBUhxHfunjJQv/RrZdk7apo8rWC7a+XToHzhbGe7HVOskjwQnL+oghxgoEZMnLybV9TymnsrjIEJsWH08LQvpqJ+VWbzSh/hVLLMuXQJMNPz6N22n6g9UWcE3wwWai3IsYW81UQ0AqLKk0Qg1mAacusfHKQ3MXdtI+9IVS9IQIDAQAB'
SCOPE = 'https://www.googleapis.com/auth/drive.file'
EXTENSION_ID = hashlib.sha256(base64.b64decode(PUBLIC_KEY)).hexdigest()[:32].translate(
    str.maketrans('0123456789abcdef', 'abcdefghijklmnop')
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path, help='Unpacked copy of the packaged extension')
    parser.add_argument('--client-id', help='Public Chrome Extension OAuth client ID')
    parser.add_argument('--picker-config', type=Path, help='Create a private local Picker host configuration outside the extension')
    args = parser.parse_args()
    folder = args.directory.resolve()
    if (folder / 'package.json').exists() or not (folder / 'dist/ui/options.js').is_file():
        parser.error('Choose an unpacked extension package, outside the source checkout.')
    manifest_path = folder / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('options_page') != 'src/ui/options/options.html' or manifest.get('key', PUBLIC_KEY) != PUBLIC_KEY:
        parser.error('Expected a Gemini Exporter development package.')
    if args.client_id and not re.fullmatch(r'[A-Za-z0-9-]+\.apps\.googleusercontent\.com', args.client_id):
        parser.error('Expected a public client ID ending in .apps.googleusercontent.com.')
    manifest['key'] = PUBLIC_KEY
    if args.client_id:
        manifest['oauth2'] = {'client_id': args.client_id, 'scopes': [SCOPE]}
        for field, permission in [('permissions', 'identity'), ('host_permissions', 'https://www.googleapis.com/*')]:
            if permission not in manifest[field]:
                manifest[field].append(permission)
    if args.picker_config:
        match = re.fullmatch(r'(\d+)-[A-Za-z0-9]+\.apps\.googleusercontent\.com', manifest.get('oauth2', {}).get('client_id', ''))
        if not match or args.picker_config.resolve().is_relative_to(folder):
            parser.error('Configure a Chrome OAuth client and choose a host config outside the extension.')
        key = getpass('Google Picker browser API key: ').strip()
        if not re.fullmatch(r'AIza[\w-]{35}', key):
            parser.error('Expected a Google browser API key.')
        proof = secrets.token_urlsafe(32)
        with args.picker_config.open('x', encoding='utf-8') as output:
            args.picker_config.chmod(0o600)
            json.dump({'key': key, 'project': match[1], 'proof': proof}, output)
        (folder / 'drive-picker.json').write_text(json.dumps({'proof': proof}), encoding='utf-8')
    temporary = manifest_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(manifest_path)
    print(f'Chrome Extension ID: {EXTENSION_ID}')
    if args.client_id:
        print('Drive configured. Load or reload this directory in chrome://extensions.')
    else:
        print('Register this ID in Google Cloud, then run again with --client-id.')


if __name__ == '__main__':
    main()
