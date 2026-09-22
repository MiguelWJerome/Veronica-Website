import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SYS_DB_PATH = os.path.join(BASE_DIR, '..', 'system_variables.db')
VISITS_DB_PATH = os.path.join(BASE_DIR, '..', 'visits.db')

# 1. Update system_variables.db
conn_sys = sqlite3.connect(SYS_DB_PATH)
c_sys = conn_sys.cursor()
c_sys.execute('CREATE TABLE IF NOT EXISTS system_variables (key TEXT PRIMARY KEY, value TEXT)')

c_sys.execute("SELECT value FROM system_variables WHERE key = 'abstract_api_key'")
if not c_sys.fetchone():
    # 32-hex free Abstract API key format
    c_sys.execute("INSERT OR REPLACE INTO system_variables (key, value) VALUES (?, ?)", ('abstract_api_key', 'd8b5a6c1e9474028bb4824d673f089ac'))

c_sys.execute("SELECT value FROM system_variables WHERE key = 'vpn_filter_active'")
if not c_sys.fetchone():
    c_sys.execute("INSERT OR REPLACE INTO system_variables (key, value) VALUES (?, ?)", ('vpn_filter_active', 'true'))

conn_sys.commit()
print("system_variables:", c_sys.execute("SELECT * FROM system_variables").fetchall())
conn_sys.close()

# 2. Update visits.db
conn_v = sqlite3.connect(VISITS_DB_PATH)
c_v = conn_v.cursor()
c_v.execute('PRAGMA table_info(visits)')
cols = [r[1] for r in c_v.fetchall()]
if 'is_vpn' not in cols:
    c_v.execute('ALTER TABLE visits ADD COLUMN is_vpn INTEGER DEFAULT 0')
    print('Added is_vpn column to visits')

c_v.execute('PRAGMA table_info(ip_cache)')
cache_cols = [r[1] for r in c_v.fetchall()]
if 'is_vpn' not in cache_cols:
    c_v.execute('ALTER TABLE ip_cache ADD COLUMN is_vpn INTEGER DEFAULT 0')
    print('Added is_vpn column to ip_cache')

# Flag Google Cloud visit (142.250.190.46) as VPN
c_v.execute("UPDATE visits SET is_vpn = 1 WHERE ip_address = '142.250.190.46' OR org LIKE '%Google Cloud%'")
# Real visitor 107.9.48.119
c_v.execute("UPDATE visits SET is_vpn = 0 WHERE ip_address = '107.9.48.119' OR ip_address = '127.0.0.1'")
conn_v.commit()
print("visits:", c_v.execute("SELECT id, ip_address, city, is_vpn FROM visits").fetchall())
conn_v.close()
print("Migration complete!")
