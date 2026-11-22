"""Bounded media validation matching the reviewed R2A dom-private-v1 policy."""
import math
import re
import struct
import xml.etree.ElementTree as ET

NS = '{http://www.w3.org/2000/svg}'
TAGS = set('svg g path rect line polyline polygon ellipse circle'.split())
ATTRS = set('d x1 y1 x2 y2 points y x width height id transform cx cy rx ry r version viewBox'.split())
STYLE = set(('fill fill-rule fill-opacity clip-rule stroke stroke-width stroke-linecap stroke-linejoin '
             'stroke-miterlimit stroke-opacity stroke-dasharray stroke-dashoffset display opacity enable-background').split())


def require(ok):
    if not ok:
        raise ValueError('invalid_package_media')


def svg(raw):
    require(0 < len(raw) <= 2 * 1024 * 1024 and b'\0' not in raw)
    plain = raw.decode('utf-8-sig')
    plain = re.sub(r'''^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']utf-8["'])?\s*\?>''', '', plain, count=1, flags=re.I)
    require(not re.search(r'<\?|<!\s*(?:DOCTYPE|ENTITY|ATTLIST|ELEMENT|NOTATION)', plain, re.I))
    try:
        root = ET.fromstring(plain)
        require(root.tag == NS + 'svg')
        box = [float(x) for x in re.split(r'[\s,]+', root.attrib['viewBox'].strip())]
        require(len(box) == 4 and all(math.isfinite(v) for v in box) and all(0 < v <= 50000 for v in box[2:]))
        for count, elem in enumerate(root.iter(), 1):
            require(count <= 40000 and elem.tag.startswith(NS) and elem.tag[len(NS):] in TAGS
                    and not (elem.text or '').strip() and not (elem.tail or '').strip())
            for key, value in elem.attrib.items():
                if key == '{http://www.w3.org/XML/1998/namespace}space' and value in ('default', 'preserve'):
                    continue
                if key == 'style':
                    for declaration in filter(str.strip, value.split(';')):
                        name, separator, val = declaration.partition(':')
                        require(separator and name.strip() in STYLE and re.fullmatch(r'[a-zA-Z0-9#.,%+ \t-]+', val.strip()))
                elif key in STYLE:
                    require(re.fullmatch(r'[a-zA-Z0-9#.,%+ \t-]+', value))
                else:
                    require(key in ATTRS and not re.search(r'url\s*\(|@|\\|://|[<>&]', value, re.I))
    except (ET.ParseError, KeyError, OverflowError, RecursionError) as exc:
        raise ValueError('invalid_package_media') from exc


def webp(raw, *, legacy=False):
    require(20 < len(raw) <= 512 * 1024 and raw[:4] == b'RIFF' and raw[8:12] == b'WEBP'
            and int.from_bytes(raw[4:8], 'little') == len(raw) - 8)
    offset, frame = 12, None
    while offset + 8 <= len(raw):
        tag = raw[offset:offset+4]
        size = int.from_bytes(raw[offset+4:offset+8], 'little')
        chunk = raw[offset+8:offset+8+size]
        allowed = (b'VP8 ', b'VP8X', b'ALPH', b'VP8L') if legacy else (b'VP8 ', b'VP8X', b'ALPH')
        require(len(chunk) == size and tag in allowed)
        if tag == b'VP8 ':
            require(frame is None and size >= 10 and chunk[3:6] == b'\x9d\x01\x2a')
            frame = struct.unpack('<HH', chunk[6:10])
        elif tag == b'VP8L':
            require(legacy and frame is None and size >= 5 and chunk[0] == 0x2f)
            bits = int.from_bytes(chunk[1:5], 'little')
            require(bits >> 29 == 0)
            frame = ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
        offset += 8 + size + size % 2
    require(offset == len(raw) and frame and all(0 < v <= 960 for v in frame))
