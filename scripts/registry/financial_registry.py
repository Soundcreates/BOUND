#!/usr/bin/env python3
"""Read-only financial-site discovery and public JS evidence capture. No signing."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / 'fixtures/financial-registry/sites.json'
MAX_BYTES = 2 * 1024 * 1024
SOURCES = ['https://api.llama.fi/protocols', 'https://ethereum.org/en/defi/', 'https://ethereum.org/en/dapps/']
EVM = {'Ethereum', 'Arbitrum', 'Base', 'Optimism', 'Polygon', 'Binance', 'Avalanche', 'Linea', 'Scroll', 'Mantle', 'Sonic', 'Gnosis', 'xDai', 'Unichain'}
CATEGORIES = {'Lending', 'Dexs', 'Liquid Staking', 'Liquid Restaking', 'Restaking', 'CDP', 'Yield', 'Yield Aggregator', 'Derivatives', 'Bridge', 'RWA', 'RWA Lending', 'Options', 'Staking Pool', 'Farm', 'Leveraged Farming', 'DEX Aggregator', 'Cross Chain Bridge'}


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class Markup(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.scripts, self.links, self.inline = [], [], 0
        self.base = None

    def handle_starttag(self, tag, attributes):
        a = dict(attributes)
        if tag == 'base' and a.get('href') and self.base is None:
            self.base = a['href']
        if tag == 'script':
            if a.get('src'):
                self.scripts.append(a['src'])
            else:
                self.inline += 1
        if tag == 'a' and a.get('href'):
            self.links.append(a['href'])


def check_url(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme != 'https' or not u.hostname or u.username or u.password or u.port not in (None, 443):
        raise ValueError('Only public HTTPS URLs on port 443 are supported')
    addresses = socket.getaddrinfo(u.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Nonpublic network destination refused')
    return u


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(url, max_bytes=MAX_BYTES, same_origin=None):
    # Use the system CA bundle on macOS Python installations without bundled roots.
    context = ssl.create_default_context(cafile='/etc/ssl/cert.pem') if Path('/etc/ssl/cert.pem').exists() else ssl.create_default_context()
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), NoRedirect())
    for _ in range(5):
        u = check_url(url)
        if same_origin and (u.scheme, u.netloc) != same_origin:
            raise ValueError('Cross-origin redirect refused')
        try:
            response = opener.open(urllib.request.Request(url, headers={'User-Agent': 'BOUND-Registry/1.0 (public asset observation)', 'Accept-Encoding': 'identity'}), timeout=8)
        except urllib.error.HTTPError as error:
            if error.code in (301, 302, 303, 307, 308) and error.headers.get('Location'):
                url = urllib.parse.urljoin(url, error.headers['Location'])
                continue
            raise
        with response:
            data = response.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise ValueError('Response exceeds byte limit')
            if response.headers.get('Content-Encoding', 'identity') != 'identity':
                raise ValueError('Unexpected content encoding')
            return data, response.geturl(), response.headers.get_content_type()
    raise ValueError('Too many redirects')


def discover():
    data, _, _ = fetch(SOURCES[0], 32 * 1024 * 1024)
    protocols = json.loads(data)
    directories, source_results = set(), []
    for source in SOURCES[1:]:
        try:
            body, final, _ = fetch(source)
            parser = Markup(); parser.feed(body.decode('utf-8', errors='replace'))
            for link in parser.links:
                u = urllib.parse.urlsplit(urllib.parse.urljoin(final, link))
                if u.scheme == 'https':
                    directories.add(u.hostname)
            source_results.append({'url': source, 'status': 'read', 'publicLinkCount': len(parser.links), 'sha256': hashlib.sha256(body).hexdigest()})
        except Exception as error:
            source_results.append({'url': source, 'status': 'unavailable', 'error': str(error)[:200]})
    sites, seen = [], set()
    for p in sorted(protocols, key=lambda p: float(p.get('tvl') or 0), reverse=True):
        if p.get('category') not in CATEGORIES or not EVM.intersection(p.get('chains', [])):
            continue
        try:
            u = urllib.parse.urlsplit(p.get('url', ''))
            if u.scheme != 'https' or not u.hostname or u.username or u.password or u.port not in (None, 443):
                continue
        except ValueError:
            continue
        if u.hostname in seen:
            continue
        seen.add(u.hostname)
        sites.append({'priority': len(sites) + 1, 'name': p['name'], 'site': u.hostname, 'candidateUrl': p['url'], 'category': p['category'], 'chainsReported': p.get('chains', []), 'tvlUsdObserved': p['tvl'], 'moneyInvolvement': p.get('description') or p['category'], 'sources': [SOURCES[0], 'https://defillama.com/protocol/' + p['slug']], 'ethereumDirectoryHostMatch': u.hostname in directories, 'reviewStatus': 'candidate-not-trusted', 'frontendUrlReview': 'required', 'ensAttestation': None})
        if len(sites) == 50:
            break
    if len(sites) != 50:
        raise ValueError('Could not find 50 matching unique hosts')
    document = {'version': 1, 'generatedAt': timestamp(), 'method': 'Top 50 unique candidate HTTPS hosts by reported protocol TVL within selected financial categories and EVM-supported chains. Not transaction-volume ranking, proof of safety, or verified app frontend inventory.', 'sources': [{'url': SOURCES[0], 'sha256': hashlib.sha256(data).hexdigest(), 'protocolCount': len(protocols)}, *source_results], 'sites': sites}
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY.write_text(json.dumps(document, indent=2) + '\n')
    rows = ['# Financial website candidates', '', document['method'], '', f"Retrieved: {document['generatedAt']}", '', '| Priority | Platform | Candidate website | Category | TVL observed (USD) |', '| --- | --- | --- | --- | --- |']
    rows += [f"| {s['priority']} | {s['name']} | [{s['site']}]({s['candidateUrl']}) | {s['category']} | {s['tvlUsdObserved']:,.0f} |" for s in sites]
    (REGISTRY.parent / 'SITES.md').write_text('\n'.join(rows) + '\n')
    print(f'Discovered {len(sites)} candidate sites; no trust records published.')


def capture(site):
    result = {'site': site['site'], 'requestedUrl': site['candidateUrl'], 'capturedAt': timestamp(), 'status': 'unavailable', 'trust': 'unreviewed-observation', 'scripts': []}
    try:
        html, final, mime = fetch(site['candidateUrl'])
        if mime != 'text/html':
            raise ValueError('Not HTML')
        parser = Markup(); parser.feed(html.decode('utf-8', errors='replace'))
        base = urllib.parse.urljoin(final, parser.base) if parser.base else final
        origin_url = urllib.parse.urlsplit(final)
        origin = (origin_url.scheme, origin_url.netloc)
        result.update(finalUrl=final, finalSite=origin_url.netloc, htmlSha256=hashlib.sha256(html).hexdigest(), inlineScriptsExcluded=parser.inline)
        assets = list(dict.fromkeys(urllib.parse.urljoin(base, src) for src in parser.scripts))
        result['declaredExternalScripts'] = len(assets)
        result['overLimitScripts'] = max(0, len(assets) - 12)
        for asset in assets[:12]:
            u = urllib.parse.urlsplit(asset)
            row = {'url': asset, 'path': u.path, 'status': 'excluded'}
            if (u.scheme, u.netloc) != origin:
                row['reason'] = 'cross-origin'
            elif u.query or u.fragment:
                row['reason'] = 'query-or-fragment (not compatible with current collector)'
            else:
                try:
                    raw, served, kind = fetch(asset, same_origin=origin)
                    if kind not in ('application/javascript', 'text/javascript', 'application/x-javascript'):
                        raise ValueError('Not JavaScript MIME')
                    row.update(status='observed', servedUrl=served, bytes=len(raw), hash='sha256-' + base64.b64encode(hashlib.sha256(raw).digest()).decode())
                except Exception as error:
                    row.update(status='unavailable', reason=str(error)[:200])
            result['scripts'].append(row)
        result['status'] = 'observed' if any(s['status'] == 'observed' for s in result['scripts']) else 'no-comparable-scripts'
        result['coverage'] = 'partial: initial HTML scripts only; modules, lazy chunks, inline and runtime code not covered'
    except Exception as error:
        result['error'] = str(error)[:200]
    return result


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('action', choices=['discover', 'capture'])
    args.add_argument('--site', help='Capture one registry hostname')
    args.add_argument('--output', default='.bound/financial-registry/captures.json')
    options = args.parse_args()
    if options.action == 'discover':
        discover(); return
    sites = json.loads(REGISTRY.read_text())['sites']
    if options.site:
        sites = [s for s in sites if s['site'] == options.site]
        if not sites:
            args.error('Hostname is not in the registry')
    with ThreadPoolExecutor(max_workers=3) as pool:
        captured = list(pool.map(capture, sites))
    output = Path(options.output); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'version': 1, 'generatedAt': timestamp(), 'sites': captured}, indent=2) + '\n')
    print(json.dumps({'sites': len(captured), 'sitesWithScripts': sum(s['status'] == 'observed' for s in captured), 'output': str(output)}))


if __name__ == '__main__':
    main()
