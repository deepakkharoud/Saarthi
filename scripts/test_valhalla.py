import urllib.request
import json

def test_routing():
    # Valhalla route query
    url = 'https://valhalla1.openstreetmap.de/route'
    body = {
        'locations': [
            {'lat': 30.770726, 'lon': 76.576329, 'type': 'break'},
            {'lat': 30.769660, 'lon': 76.575543, 'type': 'break'}
        ],
        'costing': 'pedestrian',
        'directions_options': {'units': 'kilometers', 'language': 'en-US'}
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'User-Agent': 'SaarthiWalkingRouter/1.0'}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            res = json.loads(resp.read().decode('utf-8'))
            trip = res.get('trip', {})
            print('Valhalla success! Summary:', trip.get('summary'))
            legs = trip.get('legs', [])
            if legs:
                print(f"Maneuvers ({len(legs[0].get('maneuvers', []))}):")
                for m in legs[0].get('maneuvers', []):
                    print(f" - {m.get('instruction')} ({m.get('length', 0)*1000:.1f}m)")
                print(f"Shape: {legs[0].get('shape')[:30]}...")
            return True
    except Exception as e:
        print('Valhalla test error:', e)
        return False

if __name__ == '__main__':
    test_routing()
