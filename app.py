import os
import re
import json
import sqlite3
import threading
import urllib.request
from datetime import datetime
from urllib.parse import quote
from flask import Flask, render_template, redirect, url_for, request, session, jsonify
from bs4 import BeautifulSoup

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'olmc-veronica-secret-key-2026-speray')

DB_PATH = os.path.join(os.path.dirname(__file__), 'visits.db')
SYS_DB_PATH = os.path.join(os.path.dirname(__file__), 'system_variables.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visit_date TEXT,
            timestamp TEXT,
            ip_address TEXT,
            page_visited TEXT,
            city TEXT,
            region TEXT,
            country TEXT,
            postal TEXT,
            latitude REAL,
            longitude REAL,
            org TEXT,
            user_agent TEXT
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ip_cache (
            ip TEXT PRIMARY KEY,
            city TEXT,
            region TEXT,
            country TEXT,
            postal TEXT,
            latitude REAL,
            longitude REAL,
            org TEXT
        )
    ''')
    conn.commit()
    conn.close()

def init_system_variables():
    conn = sqlite3.connect(SYS_DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS system_variables (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')
    cursor.execute("SELECT value FROM system_variables WHERE key = 'admin_password'")
    if not cursor.fetchone():
        cursor.execute("INSERT OR REPLACE INTO system_variables (key, value) VALUES (?, ?)", ('admin_password', 'speray'))
    
    cursor.execute("SELECT value FROM system_variables WHERE key = 'map_default_max'")
    if not cursor.fetchone():
        cursor.execute("INSERT OR REPLACE INTO system_variables (key, value) VALUES (?, ?)", ('map_default_max', '50'))
    
    conn.commit()
    conn.close()

init_db()
init_system_variables()

def get_system_variable(key, default=None):
    try:
        conn = sqlite3.connect(SYS_DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM system_variables WHERE key = ?", (key,))
        row = cursor.fetchone()
        conn.close()
        if row and row[0] is not None:
            return row[0]
    except Exception as e:
        app.logger.error(f"Error reading system variable {key}: {e}")
    return default

def set_system_variable(key, value):
    try:
        conn = sqlite3.connect(SYS_DB_PATH)
        cursor = conn.cursor()
        cursor.execute("INSERT OR REPLACE INTO system_variables (key, value) VALUES (?, ?)", (key, str(value)))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        app.logger.error(f"Error setting system variable {key}: {e}")
        return False

def get_admin_password():
    return get_system_variable('admin_password', 'speray')

LOCAL_PUBLIC_IP = None

def resolve_ip_geo(ip):
    global LOCAL_PUBLIC_IP
    is_local = not ip or ip in ('127.0.0.1', '::1', 'localhost', '0.0.0.0')
    lookup_key = LOCAL_PUBLIC_IP if (is_local and LOCAL_PUBLIC_IP) else ip

    # Check cache first
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT city, region, country, postal, latitude, longitude, org FROM ip_cache WHERE ip = ?", (lookup_key,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {
                'ip': lookup_key,
                'city': row[0],
                'region': row[1],
                'country': row[2],
                'postal': row[3],
                'latitude': row[4],
                'longitude': row[5],
                'org': row[6]
            }
    except Exception:
        pass

    geo_data = {
        'ip': lookup_key,
        'city': 'Fairfield',
        'region': 'Ohio',
        'country': 'United States',
        'postal': '45014',
        'latitude': 39.3202,
        'longitude': -84.5520,
        'org': 'Local Area Visitor'
    }

    try:
        url = "http://ip-api.com/json/?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query" if is_local else f"http://ip-api.com/json/{ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query"
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if data.get('status') == 'success' and 'lat' in data and 'lon' in data:
                resolved_ip = data.get('query') or ip
                if is_local:
                    LOCAL_PUBLIC_IP = resolved_ip
                geo_data = {
                    'ip': resolved_ip,
                    'city': data.get('city') or 'Fairfield',
                    'region': data.get('regionName') or data.get('region') or 'Ohio',
                    'country': data.get('country') or 'United States',
                    'postal': data.get('zip') or '45014',
                    'latitude': float(data.get('lat')),
                    'longitude': float(data.get('lon')),
                    'org': data.get('org') or data.get('isp') or 'Internet Service'
                }
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT OR REPLACE INTO ip_cache VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (ip, geo_data['city'], geo_data['region'], geo_data['country'], geo_data['postal'], geo_data['latitude'], geo_data['longitude'], geo_data['org'])
                )
                if resolved_ip != ip:
                    cursor.execute(
                        "INSERT OR REPLACE INTO ip_cache VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (resolved_ip, geo_data['city'], geo_data['region'], geo_data['country'], geo_data['postal'], geo_data['latitude'], geo_data['longitude'], geo_data['org'])
                    )
                conn.commit()
                conn.close()
    except Exception as e:
        app.logger.error(f"Geo lookup error: {e}")

    return geo_data

def log_visit_async(ip, page, user_agent):
    def worker():
        try:
            geo = resolve_ip_geo(ip)
            effective_ip = geo.get('ip') or ip
            today = datetime.now().strftime('%Y-%m-%d')
            timestamp = datetime.now().strftime('%b %d, %Y %I:%M %p')

            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM visits WHERE ip_address = ? AND visit_date = ?", (effective_ip, today))
            existing = cursor.fetchone()
            if existing:
                # Update latest activity for today's visitor without creating duplicate rows
                cursor.execute(
                    "UPDATE visits SET timestamp = ?, page_visited = ?, user_agent = ? WHERE id = ?",
                    (timestamp, page, user_agent, existing[0])
                )
            else:
                cursor.execute('''
                    INSERT INTO visits (visit_date, timestamp, ip_address, page_visited, city, region, country, postal, latitude, longitude, org, user_agent)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (today, timestamp, effective_ip, page, geo['city'], geo['region'], geo['country'], geo['postal'], geo['latitude'], geo['longitude'], geo['org'], user_agent))
            conn.commit()
            conn.close()
        except Exception as e:
            app.logger.error(f"Error logging visit: {e}")

    threading.Thread(target=worker, daemon=True).start()

@app.before_request
def track_visitor():
    path = request.path
    # Do not track static files, maps admin portal, or internal APIs
    if path.startswith('/static') or path.startswith('/maps') or path.startswith('/favicon') or path.startswith('/api'):
        return

    forwarded = request.headers.get('X-Forwarded-For')
    ip = forwarded.split(',')[0].strip() if forwarded else request.remote_addr
    user_agent = request.headers.get('User-Agent', '')[:250]
    log_visit_async(ip, path, user_agent)

@app.route('/')
def index():
    # Redirect base URL to /home as requested
    return redirect(url_for('home'))

@app.route('/home')
def home():
    return render_template('home.html')

@app.route('/contact')
def contact():
    return render_template('contact.html')

@app.route('/gallery')
def gallery():
    return render_template('gallery.html')

@app.route('/beliefs')
def beliefs():
    return render_template('beliefs.html')

@app.route('/search')
def search():
    query = request.args.get('q', '').strip()
    results = []

    if query:
        query_pattern = re.compile(re.escape(query), re.IGNORECASE)
        test_client = app.test_client()

        # Dynamically discover all registered GET routes in the application
        seen_endpoints = set()
        for rule in app.url_map.iter_rules():
            # Skip static files, search page, admin maps, internal APIs, and rules requiring dynamic arguments
            if rule.endpoint in ('static', 'search', 'index', 'maps', 'maps_logout', 'api_log_visit', 'api_admin_login', 'map') or rule.arguments:
                continue
            if 'GET' not in rule.methods or rule.endpoint in seen_endpoints:
                continue
            seen_endpoints.add(rule.endpoint)

            try:
                response = test_client.get(rule.rule)
                if response.status_code != 200:
                    continue

                soup = BeautifulSoup(response.get_data(as_text=True), 'html.parser')

                # Clean non-content elements
                for tag in soup(['script', 'style', 'nav', 'header', 'footer']):
                    tag.decompose()

                # Extract page title
                title = ''
                if soup.title and soup.title.string:
                    title = soup.title.string.split('|')[0].strip()
                elif soup.find('h1'):
                    title = soup.find('h1').get_text(strip=True)
                else:
                    title = rule.endpoint.replace('_', ' ').capitalize()

                # Search within main content area or general body
                content_area = soup.find('main') or soup.find(class_='content-container') or soup.body
                if not content_area:
                    continue

                full_text = content_area.get_text(separator=' ', strip=True)
                
                # Check for match
                matches = list(query_pattern.finditer(full_text))
                if matches:
                    snippets = []
                    seen_spans = []
                    for match in matches[:3]:
                        # Snap start to word boundary
                        start = max(0, match.start() - 60)
                        if start > 0:
                            prev_space = full_text.rfind(' ', max(0, start - 20), start + 20)
                            if prev_space != -1:
                                start = prev_space + 1

                        # Snap end to word boundary
                        end = min(len(full_text), match.end() + 60)
                        if end < len(full_text):
                            next_space = full_text.find(' ', max(0, end - 20), min(len(full_text), end + 20))
                            if next_space != -1:
                                end = next_space

                        # Avoid duplicate or heavily overlapping snippets
                        if any(abs(start - s) < 30 for s in seen_spans):
                            continue
                        seen_spans.append(start)

                        raw_snippet = full_text[start:end].strip()

                        if start > 0:
                            raw_snippet = '...' + raw_snippet
                        if end < len(full_text):
                            raw_snippet = raw_snippet + '...'

                        # Highlight matching query in snippet
                        highlighted = query_pattern.sub(
                            lambda m: f'<mark class="search-highlight">{m.group(0)}</mark>',
                            raw_snippet
                        )
                        snippets.append(highlighted)

                    results.append({
                        'title': title,
                        'endpoint': rule.endpoint,
                        'url': url_for(rule.endpoint) + f'?q={quote(query)}',
                        'snippets': snippets,
                        'match_count': len(matches)
                    })
            except Exception as e:
                app.logger.error(f"Error indexing {rule.endpoint}: {e}")

    return render_template('search.html', query=query, results=results, total_results=len(results))

def fetch_visits_data():
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM visits ORDER BY id DESC")
        rows = cursor.fetchall()
        conn.close()
        visits = [dict(row) for row in rows]
        
        # Calculate milliseconds epoch timestamp for reliable timeline ordering
        for v in visits:
            epoch_ms = 0
            ts_str = v.get('timestamp') or ''
            if ts_str:
                for fmt in ('%b %d, %Y %I:%M %p', '%b %d, %Y %H:%M', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %I:%M %p'):
                    try:
                        dt = datetime.strptime(ts_str, fmt)
                        epoch_ms = int(dt.timestamp() * 1000)
                        break
                    except Exception:
                        continue
            v['epoch_ms'] = epoch_ms

        total_visits = len(visits)
        unique_ips = len(set(v['ip_address'] for v in visits))
        unique_locations = len(set(f"{v['city']}, {v['region']}" for v in visits if v['city']))
        return visits, total_visits, unique_ips, unique_locations
    except Exception as e:
        app.logger.error(f"Error fetching visits data: {e}")
        return [], 0, 0, 0

@app.route('/maps', methods=['GET', 'POST', 'HEAD'])
@app.route('/map', methods=['GET', 'POST', 'HEAD'])
@app.route('/maps/', methods=['GET', 'POST', 'HEAD'])
@app.route('/map/', methods=['GET', 'POST', 'HEAD'])
def maps():
    admin_password = get_admin_password()
    error = None

    if request.method == 'POST':
        entered = request.form.get('password', '').strip()
        if entered.lower() == admin_password.lower():
            session['admin_authenticated'] = True
            return redirect(url_for('maps'))
        else:
            error = "Invalid Speray Admin Password. Please try again."

    authenticated = bool(session.get('admin_authenticated'))

    if authenticated:
        visits, total_visits, unique_ips, unique_locations = fetch_visits_data()
    else:
        visits, total_visits, unique_ips, unique_locations = [], 0, 0, 0

    default_max = int(get_system_variable('map_default_max', '50'))

    return render_template(
        'maps.html',
        authenticated=authenticated,
        error=error,
        visits=visits,
        total_visits=total_visits,
        unique_ips=unique_ips,
        unique_locations=unique_locations,
        default_max=default_max,
        visits_json=json.dumps(visits)
    )

@app.route('/api/admin_login', methods=['POST'])
def api_admin_login():
    data = request.get_json(silent=True) or {}
    entered = data.get('password', '').strip()
    admin_password = get_admin_password()

    if entered.lower() == admin_password.lower():
        session['admin_authenticated'] = True
        visits, total_visits, unique_ips, unique_locations = fetch_visits_data()
        default_max = int(get_system_variable('map_default_max', '50'))
        return jsonify({
            'status': 'ok',
            'visits': visits,
            'default_max': default_max,
            'stats': {
                'total_visits': total_visits,
                'unique_ips': unique_ips,
                'unique_locations': unique_locations
            }
        })
    return jsonify({'status': 'error', 'message': 'Invalid Speray Admin Password. Please try again.'}), 401

@app.route('/api/set_map_max', methods=['POST'])
def api_set_map_max():
    if not session.get('admin_authenticated'):
        return jsonify({'status': 'error', 'message': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    new_max = data.get('max')
    if new_max and str(new_max).isdigit() and int(new_max) > 0:
        set_system_variable('map_default_max', str(new_max))
        return jsonify({'status': 'ok', 'max': int(new_max)})
    return jsonify({'status': 'error', 'message': 'Invalid max value'}), 400

@app.route('/maps/logout')
@app.route('/map/logout')
def maps_logout():
    session.pop('admin_authenticated', None)
    return redirect(url_for('maps'))

@app.route('/api/log_visit', methods=['POST'])
def api_log_visit():
    try:
        data = request.get_json(silent=True) or {}
        ip = data.get('ip') or request.remote_addr
        page = data.get('page') or '/home'
        city = data.get('city') or 'Fairfield'
        region = data.get('region') or 'Ohio'
        country = data.get('country') or 'United States'
        postal = data.get('postal') or '45014'
        latitude = float(data.get('latitude', 39.3202))
        longitude = float(data.get('longitude', -84.5520))
        org = data.get('org') or 'Local Visitor'
        user_agent = request.headers.get('User-Agent', '')[:250]
        today = datetime.now().strftime('%Y-%m-%d')
        timestamp = datetime.now().strftime('%b %d, %Y %I:%M %p')

        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM visits WHERE ip_address = ? AND visit_date = ?", (ip, today))
        existing = cursor.fetchone()
        if existing:
            cursor.execute(
                "UPDATE visits SET timestamp = ?, page_visited = ?, user_agent = ? WHERE id = ?",
                (timestamp, page, user_agent, existing[0])
            )
        else:
            cursor.execute('''
                INSERT INTO visits (visit_date, timestamp, ip_address, page_visited, city, region, country, postal, latitude, longitude, org, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (today, timestamp, ip, page, city, region, country, postal, latitude, longitude, org, user_agent))
        conn.commit()
        conn.close()
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

if __name__ == '__main__':
    # Run the application on localhost and port 2048
    print("Starting Flask application on http://localhost:2048...")
    app.run(host='localhost', port=2048, debug=True)
