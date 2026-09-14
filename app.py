import re
from urllib.parse import quote
from flask import Flask, render_template, redirect, url_for, request
from bs4 import BeautifulSoup

app = Flask(__name__)

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
            # Skip static files, the search page itself, and rules requiring dynamic arguments
            if rule.endpoint in ('static', 'search', 'index') or rule.arguments:
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
                    # Extract up to 3 contextual snippets around matches
                    seen_spans = []
                    for match in matches[:3]:
                        # Snap start to word boundary
                        start = max(0, match.start() - 60)
                        if start > 0:
                            prev_space = full_text.rfind(' ', max(0, start - 20), start + 20)
                            if prev_space != -1:
                                start = prev_space + 1

                        # S
                        # nap end to word boundary
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

if __name__ == '__main__':
    # Run the application on localhost and port 2048
    print("Starting Flask application on http://localhost:2048...")
    app.run(host='localhost', port=2048, debug=True)

