import urllib.request
import urllib.parse
import json

def fetch_campus_osm():
    query = """[out:json][timeout:30];
(
  way["building"](30.763,76.568,30.776,76.582);
  way["highway"](30.763,76.568,30.776,76.582);
  node["amenity"](30.763,76.568,30.776,76.582);
  node["barrier"="gate"](30.763,76.568,30.776,76.582);
);
out center;
"""
    endpoints = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
    ]
    elems = []
    for url in endpoints:
        data = urllib.parse.urlencode({"data": query}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"User-Agent": "SaarthiCampusSurvey/1.0"}
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                elems = result.get("elements", [])
                print(f"Success with {url}! Total elements: {len(elems)}")
                break
        except Exception as e:
            print(f"Failed {url}: {e}")
            continue
    else:
        print("All Overpass endpoints failed")
        return

    buildings = [e for e in elems if "building" in e.get("tags", {})]
    highways = [e for e in elems if "highway" in e.get("tags", {})]
    gates = [e for e in elems if e.get("tags", {}).get("barrier") == "gate"]
    amenities = [e for e in elems if "amenity" in e.get("tags", {})]
    print(f"Buildings: {len(buildings)}, Highways: {len(highways)}, Gates: {len(gates)}, Amenities: {len(amenities)}")
    print("\n--- BUILDINGS ---")
    for b in buildings:
        tags = b.get("tags", {})
        name = tags.get("name") or tags.get("name:en") or tags.get("building")
        center = b.get("center", {})
        print(f"Building: {name} (ID: {b.get('id')}) | lat: {center.get('lat')}, lon: {center.get('lon')} | tags: {tags}")
    print("\n--- GATES ---")
    for g in gates:
        center = g.get("center") or {"lat": g.get("lat"), "lon": g.get("lon")}
        print(f"Gate: {g.get('tags')} | lat: {center.get('lat')}, lon: {center.get('lon')}")
    print("\n--- HIGHWAYS / FOOTWAYS ---")
    for h in highways[:20]:
        tags = h.get("tags", {})
        print(f"Highway: {tags.get('name')} | type: {tags.get('highway')} | foot: {tags.get('foot')} | surface: {tags.get('surface')}")

if __name__ == "__main__":
    fetch_campus_osm()
