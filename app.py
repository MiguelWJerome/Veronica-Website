from flask import Flask, render_template, redirect, url_for

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

if __name__ == '__main__':
    # Run the application on localhost and port 2048
    print("Starting Flask application on http://localhost:2048...")
    app.run(host='localhost', port=2048, debug=True)
