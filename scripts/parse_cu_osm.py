import urllib.request
import xml.etree.ElementTree as ET
import json
import sys

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

def parse_cu_osm():
    url = 'https://api.openstreetmap.org/api/0.6/map?bbox=76.570,30.765,76.580,30.773'
    req = urllib.request.Request(url, headers={'User-Agent': 'SaarthiUniversityResearch/1.0'})
    resp = urllib.request.urlopen(req, timeout=25)
    root = ET.fromstring(resp.read())

    node_coords = {n.attrib['id']: (float(n.attrib['lat']), float(n.attrib['lon'])) for n in root.findall('node')}

    print('=== REAL OSM NODES WITH TAGS ===')
    tagged_nodes = []
    for n in root.findall('node'):
        tags = {t.attrib['k']: t.attrib['v'] for t in n.findall('tag')}
        if tags:
            tagged_nodes.append({
                'id': n.attrib['id'],
                'lat': float(n.attrib['lat']),
                'lon': float(n.attrib['lon']),
                'tags': tags
            })
            print(f"Node {n.attrib['id']} at ({n.attrib['lat']}, {n.attrib['lon']}): {tags.get('name') or tags.get('amenity') or tags}")

    print('\n=== REAL OSM BUILDINGS ===')
    buildings = []
    for w in root.findall('way'):
        tags = {t.attrib['k']: t.attrib['v'] for t in w.findall('tag')}
        if 'building' in tags:
            nds = [nd.attrib['ref'] for nd in w.findall('nd')]
            coords = [node_coords[ref] for ref in nds if ref in node_coords]
            if coords:
                avg_lat = sum(c[0] for c in coords) / len(coords)
                avg_lon = sum(c[1] for c in coords) / len(coords)
                name = tags.get('name', tags.get('building', 'unnamed'))
                buildings.append({
                    'id': w.attrib['id'],
                    'name': name,
                    'lat': avg_lat,
                    'lon': avg_lon,
                    'tags': tags
                })
                print(f"Building {name}: lat={avg_lat:.6f}, lon={avg_lon:.6f}, tags={tags}")

    print('\n=== REAL OSM HIGHWAYS / FOOTWAYS ===')
    highways = []
    for w in root.findall('way'):
        tags = {t.attrib['k']: t.attrib['v'] for t in w.findall('tag')}
        if 'highway' in tags:
            nds = [nd.attrib['ref'] for nd in w.findall('nd')]
            coords = [node_coords[ref] for ref in nds if ref in node_coords]
            highways.append({
                'id': w.attrib['id'],
                'tags': tags,
                'point_count': len(coords),
                'coordinates': coords
            })

    print(f"Total highways/footways: {len(highways)}")

    data = {
        'campus_name': 'Chandigarh University, Gharuan, Mohali',
        'bounding_box': [30.765, 76.570, 30.773, 76.580],
        'center': {'lat': 30.76864, 'lon': 76.57505},
        'tagged_nodes': tagged_nodes,
        'buildings': buildings,
        'highways': highways
    }
    with open('c:/Users/S/OneDrive/Desktop/CU/CU-main/mobile/src/data/cu_osm_survey.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print("\nSuccessfully saved real CU OSM survey data to cu_osm_survey.json")

if __name__ == '__main__':
    parse_cu_osm()
