/**
 * Veronica Website - Admin Visitor Maps Dashboard Controller
 * Handles seamless in-page authentication, session filtering,
 * interactive Leaflet map rendering, Google Maps embed sync, and live visitor inspection.
 */

document.addEventListener('DOMContentLoaded', () => {
    let visits = Array.isArray(window.VISITS_DATA) ? window.VISITS_DATA : [];
    let isAuthenticated = Boolean(window.SERVER_IS_AUTHENTICATED);

    // Auth Elements
    const loginContainer = document.getElementById('maps-login-container');
    const dashboardContainer = document.getElementById('maps-dashboard-container');
    const loginForm = document.getElementById('maps-login-form');
    const pwInput = document.getElementById('admin-password');
    const toggleBtn = document.getElementById('toggle-pw-btn');
    const pwIcon = document.getElementById('toggle-pw-icon');
    const errorAlert = document.getElementById('login-error-alert');
    const errorText = document.getElementById('login-error-text');
    const submitBtn = document.getElementById('login-submit-btn');

    // Dashboard UI Elements
    const filterInput = document.getElementById('session-filter-input');
    const sessionCounter = document.getElementById('session-counter');
    const sessionsList = document.getElementById('sessions-list');
    const statTotalVisits = document.getElementById('stat-total-visits');
    const statUniqueIps = document.getElementById('stat-unique-ips');
    const statLocations = document.getElementById('stat-locations');
    const btnLeaflet = document.getElementById('btn-leaflet-view');
    const btnGoogle = document.getElementById('btn-google-view');
    const interactiveMapEl = document.getElementById('interactive-map');
    const googleMapContainer = document.getElementById('google-maps-frame-container');
    const googleMapIframe = document.getElementById('google-map-iframe');

    // Inspector elements
    const inspectTitle = document.getElementById('inspect-location-title');
    const inspectGmapsLink = document.getElementById('inspect-gmaps-link');
    const inspectIp = document.getElementById('inspect-ip');
    const inspectTime = document.getElementById('inspect-time');
    const inspectPage = document.getElementById('inspect-page');
    const inspectCoords = document.getElementById('inspect-coords');
    const inspectOrg = document.getElementById('inspect-org');
    const inspectUa = document.getElementById('inspect-ua');

    let map = null;
    let markers = [];
    let currentMode = 'leaflet';
    let currentSelectedVisit = null;

    // 1. Password Visibility Toggle
    if (toggleBtn && pwInput && pwIcon) {
        toggleBtn.addEventListener('click', () => {
            if (pwInput.type === 'password') {
                pwInput.type = 'text';
                pwIcon.className = 'fa fa-eye-slash';
            } else {
                pwInput.type = 'password';
                pwIcon.className = 'fa fa-eye';
            }
        });
    }

    // 2. Seamless In-Page Login Handler
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = (pwInput ? pwInput.value : '').trim();
            if (!password) return;

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Unlocking...';
            }
            if (errorAlert) errorAlert.style.display = 'none';

            try {
                const res = await fetch('/api/admin_login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: password })
                });

                const data = await res.json();

                if (res.ok && data.status === 'ok') {
                    // Update dataset and stats
                    visits = data.visits || [];
                    if (data.stats) {
                        if (statTotalVisits) statTotalVisits.textContent = data.stats.total_visits;
                        if (statUniqueIps) statUniqueIps.textContent = data.stats.unique_ips;
                        if (statLocations) statLocations.textContent = data.stats.unique_locations;
                    }

                    // Seamless in-page transition: Hide login form and show dashboard
                    if (loginContainer) loginContainer.style.display = 'none';
                    if (dashboardContainer) dashboardContainer.style.display = 'block';

                    isAuthenticated = true;
                    renderSessionsList(visits);
                    initOrRefreshDashboard();
                } else {
                    if (errorAlert) {
                        errorText.textContent = data.message || 'Invalid Speray Admin Password. Please try again.';
                        errorAlert.style.display = 'flex';
                    }
                    if (pwInput) {
                        pwInput.focus();
                        pwInput.select();
                    }
                }
            } catch (err) {
                // Fallback to standard form submission if fetch is interrupted
                loginForm.submit();
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fa fa-key"></i> Unlock Dashboard';
                }
            }
        });
    }

    // 3. Render Session Cards dynamically
    function renderSessionsList(items) {
        if (!sessionsList) return;
        sessionsList.innerHTML = '';

        if (!items || items.length === 0) {
            sessionsList.innerHTML = `
                <div class="no-sessions-empty" id="no-sessions-empty">
                    <i class="fa fa-chart-line-down empty-icon"></i>
                    <p>No visitor sessions logged yet.</p>
                    <small>Visits to public pages will automatically appear here in real time.</small>
                </div>
            `;
            if (sessionCounter) sessionCounter.textContent = '0';
            return;
        }

        if (sessionCounter) sessionCounter.textContent = items.length;

        items.forEach((v, index) => {
            const card = document.createElement('div');
            card.className = `session-card ${index === 0 ? 'active' : ''}`;
            card.dataset.id = v.id;
            card.dataset.ip = v.ip_address || '';
            card.dataset.city = v.city || '';
            card.dataset.region = v.region || '';
            card.dataset.country = v.country || '';
            card.dataset.lat = v.latitude;
            card.dataset.lng = v.longitude;
            card.dataset.page = v.page_visited || '';
            card.dataset.time = v.timestamp || '';
            card.dataset.org = v.org || '';
            card.dataset.ua = v.user_agent || '';

            const latDisplay = typeof v.latitude === 'number' ? v.latitude.toFixed(2) : (v.latitude || '0.00');
            const lngDisplay = typeof v.longitude === 'number' ? v.longitude.toFixed(2) : (v.longitude || '0.00');

            card.innerHTML = `
                <div class="session-card-top">
                    <span class="session-ip"><i class="fa fa-network-wired"></i> ${v.ip_address || '127.0.0.1'}</span>
                    <span class="session-time">${v.timestamp || ''}</span>
                </div>
                <div class="session-location">
                    <i class="fa fa-location-dot icon-accent"></i>
                    <strong>${v.city || 'Unknown'}${v.region ? ', ' + v.region : ''}</strong>
                    <span class="session-country">(${v.country || 'US'})</span>
                </div>
                <div class="session-card-bottom">
                    <span class="session-page-badge"><i class="fa fa-file-code"></i> ${v.page_visited || '/home'}</span>
                    <span class="session-coords">${latDisplay}, ${lngDisplay}</span>
                </div>
            `;

            card.addEventListener('click', () => {
                selectVisit(v, true);
            });

            sessionsList.appendChild(card);
        });
    }

    // 4. Initialize or Refresh Map & Live Inspector
    function initOrRefreshDashboard() {
        if (!visits || visits.length === 0) return;
        currentSelectedVisit = visits[0];

        if (!map && interactiveMapEl) {
            const defaultLat = currentSelectedVisit.latitude || 37.7640;
            const defaultLng = currentSelectedVisit.longitude || -84.8436;

            map = L.map('interactive-map', {
                center: [defaultLat, defaultLng],
                zoom: 12,
                zoomControl: true
            });

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 19
            }).addTo(map);
        }

        // Refresh markers
        if (map) {
            markers.forEach(m => map.removeLayer(m.marker));
            markers = [];

            const goldIcon = L.divIcon({
                className: 'custom-gold-marker',
                html: `<div class="marker-pin-outer"><div class="marker-pin-inner"><i class="fa fa-church"></i></div></div>`,
                iconSize: [34, 42],
                iconAnchor: [17, 42],
                popupAnchor: [0, -38]
            });

            visits.forEach((v) => {
                if (v.latitude && v.longitude) {
                    const marker = L.marker([v.latitude, v.longitude], { icon: goldIcon }).addTo(map);
                    const popupContent = `
                        <div class="map-popup-card">
                            <h4 class="popup-title">${v.city || 'Unknown'}${v.region ? ', ' + v.region : ''}</h4>
                            <p class="popup-sub"><i class="fa fa-network-wired"></i> ${v.ip_address}</p>
                            <p class="popup-sub"><i class="fa fa-file-lines"></i> ${v.page_visited}</p>
                            <p class="popup-time">${v.timestamp}</p>
                        </div>
                    `;
                    marker.bindPopup(popupContent);
                    marker.on('click', () => {
                        selectVisit(v, false);
                    });
                    markers.push({ id: v.id, marker: marker, data: v });
                }
            });

            setTimeout(() => {
                map.invalidateSize();
                if (markers.length > 0) {
                    markers[0].marker.openPopup();
                }
            }, 250);
        }

        selectVisit(currentSelectedVisit, false);
    }

    // 5. Select & Inspect Visit
    function selectVisit(v, panMap = true) {
        if (!v) return;
        currentSelectedVisit = v;

        // Highlight active card in sidebar
        const allCards = document.querySelectorAll('.session-card');
        allCards.forEach(c => {
            if (parseInt(c.dataset.id) === v.id) {
                c.classList.add('active');
                c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                c.classList.remove('active');
            }
        });

        // Update Live Inspector Card
        const locString = `${v.city || 'Harrodsburg'}${v.region ? ', ' + v.region : ''}, ${v.country || 'United States'}`;
        if (inspectTitle) inspectTitle.textContent = locString;
        if (inspectIp) inspectIp.textContent = v.ip_address || '127.0.0.1';
        if (inspectTime) inspectTime.textContent = v.timestamp || 'N/A';
        if (inspectPage) inspectPage.textContent = v.page_visited || '/home';
        if (inspectCoords) {
            const lat = Number(v.latitude) || 37.7640;
            const lng = Number(v.longitude) || -84.8436;
            inspectCoords.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }
        if (inspectOrg) inspectOrg.textContent = v.org || 'Local Network / ISP';
        if (inspectUa) inspectUa.textContent = v.user_agent || 'Mozilla/5.0 Web Browser';
        if (inspectGmapsLink) {
            inspectGmapsLink.href = `https://www.google.com/maps/search/?api=1&query=${v.latitude},${v.longitude}`;
        }

        // Update Google Maps iframe
        if (googleMapIframe && v.latitude && v.longitude) {
            googleMapIframe.src = `https://maps.google.com/maps?q=${v.latitude},${v.longitude}&z=12&output=embed`;
        }

        // Pan Leaflet map
        if (panMap && map && v.latitude && v.longitude) {
            map.flyTo([v.latitude, v.longitude], 13, { duration: 0.8 });
            const m = markers.find(m => m.id === v.id);
            if (m) {
                m.marker.openPopup();
            }
        }
    }

    // 6. Real-time Search Filter for Sessions
    if (filterInput) {
        filterInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            let visibleCount = 0;
            const allCards = document.querySelectorAll('.session-card');

            allCards.forEach(card => {
                const ip = (card.dataset.ip || '').toLowerCase();
                const city = (card.dataset.city || '').toLowerCase();
                const region = (card.dataset.region || '').toLowerCase();
                const country = (card.dataset.country || '').toLowerCase();
                const page = (card.dataset.page || '').toLowerCase();
                const org = (card.dataset.org || '').toLowerCase();

                const matches = ip.includes(query) || city.includes(query) || region.includes(query) || country.includes(query) || page.includes(query) || org.includes(query);
                if (matches) {
                    card.style.display = 'block';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });

            if (sessionCounter) {
                sessionCounter.textContent = visibleCount;
            }
        });
    }

    // 7. Toggle between Leaflet Map and Google Maps Embed
    if (btnLeaflet && btnGoogle) {
        btnLeaflet.addEventListener('click', () => {
            currentMode = 'leaflet';
            btnLeaflet.classList.add('active');
            btnGoogle.classList.remove('active');
            if (interactiveMapEl) interactiveMapEl.style.display = 'block';
            if (googleMapContainer) googleMapContainer.style.display = 'none';
            if (map) {
                setTimeout(() => map.invalidateSize(), 100);
            }
        });

        btnGoogle.addEventListener('click', () => {
            currentMode = 'google';
            btnGoogle.classList.add('active');
            btnLeaflet.classList.remove('active');
            if (interactiveMapEl) interactiveMapEl.style.display = 'none';
            if (googleMapContainer) googleMapContainer.style.display = 'block';

            if (currentSelectedVisit && currentSelectedVisit.latitude && currentSelectedVisit.longitude && googleMapIframe) {
                googleMapIframe.src = `https://maps.google.com/maps?q=${currentSelectedVisit.latitude},${currentSelectedVisit.longitude}&z=12&output=embed`;
            }
        });
    }

    // If already authenticated on server load, attach click events & initialize map
    if (isAuthenticated) {
        const existingCards = document.querySelectorAll('.session-card');
        existingCards.forEach(card => {
            card.addEventListener('click', () => {
                const id = parseInt(card.dataset.id);
                const v = visits.find(item => item.id === id);
                if (v) selectVisit(v, true);
            });
        });
        initOrRefreshDashboard();
    }
});
