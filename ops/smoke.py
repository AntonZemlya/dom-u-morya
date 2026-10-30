#!/usr/bin/env python3
"""Read-only smoke of the exact deployed package; never submits lead data."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None

opener=urllib.request.build_opener(NoRedirect())
origin='https://zhk-dom-umorya.ru'

def get(url,headers=None):
    request=urllib.request.Request(url,headers=headers or {})
    try:
        response=opener.open(request,timeout=20)
    except urllib.error.HTTPError as e:
        response=e
    with response:
        body=response.read()
        if response.headers.get('Content-Encoding')=='gzip':
            body=gzip.decompress(body)
        return response.status,response.headers,body

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--all-files',action='store_true')
    parser.add_argument('--allow-http-302',action='store_true',help='Intermediate check before panel redirect migration')
    parser.add_argument('--form-enabled',action='store_true')
    args=parser.parse_args()
    root=Path(__file__).resolve().parent.parent
    metadata=json.loads((root/'.release-output/package.json').read_text())
    import tarfile
    with tarfile.open(metadata['archive'],'r:gz') as tar:
        manifest=json.load(tar.extractfile('manifest.json'))
    report={'package_sha256':metadata['sha256'],'checks':[]}
    for url in ['http://zhk-dom-umorya.ru/','https://www.zhk-dom-umorya.ru/','http://www.zhk-dom-umorya.ru/']:
        status,headers,_=get(url)
        assert status==301 or (args.allow_http_302 and url.startswith('http:') and status==302),(url,status)
        assert headers.get('Location')==origin+'/',(url,headers.get('Location'))
        report['checks'].append({'url':url,'status':status})
    names=['index.html','privacy.html','consent-personal-data.html','robots.txt','sitemap.xml','styles.css','script.js','content-model.js','favicon.png','assets/og-project.jpg','assets/hero-mobile.webp','assets/fonts/font-1.woff2']
    names += [next(n for n in manifest['files'] if n.endswith('.svg'))]
    if args.all_files:
        names=[n for n in manifest['files'] if not n.endswith('.php') and n!='.htaccess']
    for name in names:
        status,headers,body=get(origin+'/'+('' if name=='index.html' else name),{'Accept-Encoding':'gzip'})
        assert status==200,(name,status)
        assert hashlib.sha256(body).hexdigest()==manifest['files'][name],('Remote bytes differ',name)
        if name.endswith('.html'):
            text=body.decode()
            canonical=origin+'/'+('' if name=='index.html' else name)
            assert 'rel="canonical" href="'+canonical+'"' in text
            assert 'property="og:url" content="'+canonical+'"' in text
            assert 'application/ld+json' in text
        if name=='sitemap.xml':
            ET.fromstring(body)
        report['checks'].append({'path':name,'status':status,'content_type':headers.get('Content-Type'),'encoding':headers.get('Content-Encoding'),'sha256_verified':True})
    for name,expected in [('api/lead.php',405),('api/lead-core.php',404),('missing-release-001-resource',404)]:
        status,headers,body=get(origin+'/'+name)
        assert status==expected,(name,status)
        if name.startswith('api/'):
            assert 'no-store' in headers.get('Cache-Control','')
        report['checks'].append({'path':name,'status':status})
    status,headers,body=get(origin+'/api/form-status.php')
    assert status==200 and 'no-store' in headers.get('Cache-Control','')
    state=json.loads(body)
    assert state['enabled']==args.form_enabled and state['consentVersion']=='2026-10-30'
    report['form_enabled']=state['enabled']
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
