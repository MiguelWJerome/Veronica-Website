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

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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

init_db()

def get_admin_password():
    try:
        pw_file = os.path.join(os.path.dirname(__file__), 'password.txt')
        with open(pw_file, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except Exception:
        return 'speray'

def resolve_ip_geo(ip):
    # Check cache first
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT city, region, country, postal, latitude, longitude, org FROM ip_cache WHERE ip = ?", (ip,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {
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
        'city': 'Harrodsburg',
        'region': 'Kentucky',
        'country': 'United States',
        'postal': '40330',
        'latitude': 37.7640,
        'longitude': -84.8436,
        'org': 'Local Area Visitor'
    }

    try:
        is_local = not ip or ip in ('127.0.0.1', '::1', 'localhost', '0.0.0.0')
        url = "https://ipapi.co/json/" if is_local else f"https://ipapi.co/{ip}/json/"
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if 'latitude' in data and 'longitude' in data and data['latitude'] is not None:
                geo_data = {
                    'city': data.get('city') or 'Harrodsburg',
                    'region': data.get('region') or 'Kentucky',
                    'country': data.get('country_name') or data.get('country') or 'United States',
                    'postal': data.get('postal') or '40330',
                    'latitude': float(data.get('latitude', 37.7640)),
                    'longitude': float(data.get('longitude', -84.8436)),
                    'org': data.get('org') or 'Internet Service'
                }
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT OR REPLACE INTO ip_cache VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (ip, geo_data['city'], geo_data['region'], geo_data['country'], geo_data['postal'], geo_data['latitude'], geo_data['longitude'], geo_data['org'])
                )
                conn.commit()
                conn.close()
    except Exception:
        pass

    return geo_data

def log_visit_async(ip, page, user_agent):
    def worker():
        try:
            geo = resolve_ip_geo(ip)
            timestamp = datetime.now().strftime('%b %d, %Y %I:%M %p')
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO visits (timestamp, ip_address, page_visited, city, region, country, postal, latitude, longitude, org, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (timestamp, ip, page, geo['city'], geo['region'], geo['country'], geo['postal'], geo['latitude'], geo['longitude'], geo['org'], user_agent))
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

    return render_template(
        'maps.html',
        authenticated=authenticated,
        error=error,
        visits=visits,
        total_visits=total_visits,
        unique_ips=unique_ips,
        unique_locations=unique_locations,
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
        return jsonify({
            'status': 'ok',
            'visits': visits,
            'stats': {
                'total_visits': total_visits,
                'unique_ips': unique_ips,
                'unique_locations': unique_locations
            }
        })
    return jsonify({'status': 'error', 'message': 'Invalid Speray Admin Password. Please try again.'}), 401

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
        city = data.get('city') or 'Harrodsburg'
        region = data.get('region') or 'Kentucky'
        country = data.get('country') or 'United States'
        postal = data.get('postal') or '40330'
        latitude = float(data.get('latitude', 37.7640))
        longitude = float(data.get('longitude', -84.8436))
        org = data.get('org') or 'Local Visitor'
        user_agent = request.headers.get('User-Agent', '')[:250]
        timestamp = datetime.now().strftime('%b %d, %Y %I:%M %p')

        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO visits (timestamp, ip_address, page_visited, city, region, country, postal, latitude, longitude, org, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (timestamp, ip, page, city, region, country, postal, latitude, longitude, org, user_agent))
        conn.commit()
        conn.close()
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

if __name__ == '__main__':
    # Run the application on localhost and port 2048
    print("Starting Flask application on http://localhost:2048...")
    app.run(host='localhost', port=2048, debug=True)
