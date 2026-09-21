/**
 * Veronica Website - Admin Visitor Maps Dashboard Controller
 * Implements wireframe specifications:
 * 1. Removes .hero-banner on /maps so the navigation bar sits directly at top.
 * 2. Interactive Timeline Dual-Slider with 5% edge padding and clickable ticks per visit.
 * 3. Visitor Portfolio / Details Card directly under timeline with [x] deselect.
 * 4. Displaying max [N] filter showing newest visits in timeline range, backed by system_variables.db.
 * 5. Bidirectional selection (tick <-> marker <-> portfolio) with Marian Blue glowing tick.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Remove .hero-banner from DOM on /maps to keep navbar clean and at the top
    const heroBanner = document.querySelector('.hero-banner');
    if (heroBanner) {
        heroBanner.remove();
    }

    // State & Data
    let visits = Array.isArray(window.VISITS_DATA) ? window.VISITS_DATA : [];
    let isAuthenticated = Boolean(window.SERVER_IS_AUTHENTICATED);
    let defaultMax = Number(window.DEFAULT_MAP_MAX) || 50;
    let selectedVisitId = null;

    // Normalize timestamps to epoch_ms
    visits.forEach((v) => {
        if (!v.epoch_ms) {
            const parsed = v.timestamp ? Date.parse(v.timestamp.replace(' ', 'T')) : NaN;
            v.epoch_ms = !isNaN(parsed) ? parsed : Date.now();
        }
    });

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

    // Dashboard Topbar Stats Elements
    const statTotalVisits = document.getElementById('stat-total-visits');
    const statUniqueIps = document.getElementById('stat-unique-ips');
    const statLocations = document.getElementById('stat-locations');

    // Timeline Elements
    const timelineRangeLabel = document.getElementById('timeline-range-label');
    const timelineVisitsCount = document.getElementById('timeline-visits-count');
    const timelineHighlight = document.getElementById('timeline-highlight-range');
    const timelineTicksContainer = document.getElementById('timeline-ticks-container');
    const sliderStart = document.getElementById('timeline-range-start');
    const sliderEnd = document.getElementById('timeline-range-end');
    const resetTimelineBtn = document.getElementById('timeline-reset-btn');

    // Portfolio Elements
    const portfolioCard = document.getElementById('portfolio-card');
    const portfolioPlaceholder = document.getElementById('portfolio-placeholder');
    const portfolioContent = document.getElementById('portfolio-content');
    const portfolioCloseBtn = document.getElementById('portfolio-close-btn');
    const inspectLocationTitle = document.getElementById('inspect-location-title');
    const inspectPostalBadge = document.getElementById('inspect-postal-badge');
    const inspectTime = document.getElementById('inspect-time');
    const inspectIp = document.getElementById('inspect-ip');
    const inspectPage = document.getElementById('inspect-page');
    const inspectCoords = document.getElementById('inspect-coords');
    const inspectOrg = document.getElementById('inspect-org');
    const inspectUa = document.getElementById('inspect-ua');
    const inspectGmapsLink = document.getElementById('inspect-gmaps-link');

    // Map Elements & Controls
    const mapMaxInput = document.getElementById('map-max-input');
    const mapStatusBadge = document.getElementById('map-status-badge');
    const interactiveMapEl = document.getElementById('interactive-map');

    let map = null;
    let markers = [];
    let minEpoch = 0;
    let maxEpoch = 0;
    let saveMaxTimeout = null;

    // --- 2. Password Visibility Toggle ---
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

    // --- 3. Seamless In-Page Login Handler ---
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = (pwInput ? pwInput.value : '').trim();
            if (!password) return;

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Checking...';
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
                    visits = data.visits || [];
                    defaultMax = Number(data.default_max) || 50;

                    // Normalize timestamps
                    visits.forEach((v) => {
                        if (!v.epoch_ms) {
                            const parsed = v.timestamp ? Date.parse(v.timestamp.replace(' ', 'T')) : NaN;
                            v.epoch_ms = !isNaN(parsed) ? parsed : Date.now();
                        }
                    });

                    if (data.stats) {
                        if (statTotalVisits) statTotalVisits.textContent = data.stats.total_visits;
                        if (statUniqueIps) statUniqueIps.textContent = data.stats.unique_ips;
                        if (statLocations) statLocations.textContent = data.stats.unique_locations;
                    }

                    if (mapMaxInput) {
                        mapMaxInput.value = defaultMax;
                    }

                    if (loginContainer) loginContainer.style.display = 'none';
                    if (dashboardContainer) dashboardContainer.style.display = 'block';

                    isAuthenticated = true;
                    initDashboard();
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
                loginForm.submit();
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Submit';
                }
            }
        });
    }

    // --- 4. Initialize Dashboard ---
    function initDashboard() {
        if (!interactiveMapEl) return;

        computeTimelineBounds();
        initLeafletMap();
        renderTimelineTicks();
        updateTimelineAndMap();

        // Default to deselect placeholder
        clearSelection();
    }

    // Compute min and max epoch timestamps across visits
    function computeTimelineBounds() {
        if (!visits || visits.length === 0) {
            const now = Date.now();
            minEpoch = now - 7 * 24 * 3600 * 1000;
            maxEpoch = now;
            return;
        }

        const epochs = visits.map(v => v.epoch_ms).filter(Boolean);
        minEpoch = Math.min(...epochs);
        maxEpoch = Math.max(...epochs);

        // If min equals max (e.g., only 1 visit), pad by +/- 24 hours
        if (minEpoch === maxEpoch) {
            minEpoch -= 24 * 3600 * 1000;
            maxEpoch += 24 * 3600 * 1000;
        }
    }

    // --- 5. Leaflet Map Initialization ---
    function initLeafletMap() {
        if (map) return;

        let initialLat = 37.7640;
        let initialLng = -84.8436;

        if (visits.length > 0 && visits[0].latitude && visits[0].longitude) {
            initialLat = Number(visits[0].latitude);
            initialLng = Number(visits[0].longitude);
        }

        map = L.map('interactive-map', {
            center: [initialLat, initialLng],
            zoom: visits.length > 1 ? 4 : 11,
            zoomControl: true
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(map);

        // Resize fix
        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 300);
    }

    // --- 6. Render Timeline Ticks ---
    // The timeline ticks container has left: 5% and right: 5% (effective 90% width),
    // giving each tick a built-in 5% time cushion on both ends.
    function renderTimelineTicks() {
        if (!timelineTicksContainer) return;
        timelineTicksContainer.innerHTML = '';

        if (!visits || visits.length === 0) return;

        const timeSpan = maxEpoch - minEpoch;
        if (timeSpan <= 0) return;

        visits.forEach((v) => {
            const pct = Math.max(0, Math.min(100, ((v.epoch_ms - minEpoch) / timeSpan) * 100));
            const tick = document.createElement('div');
            tick.className = 'timeline-tick';
            tick.dataset.id = v.id;
            tick.style.left = `${pct}%`;

            const visitDate = new Date(v.epoch_ms).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            tick.title = `${v.city || 'Visitor'} (${v.ip_address || '127.0.0.1'}) • ${visitDate}`;

            if (selectedVisitId === v.id) {
                tick.classList.add('glowing');
            }

            // Clicking any tick mark illuminates it in Marian blue glow and populates the portfolio card
            tick.addEventListener('click', (e) => {
                e.stopPropagation();
                selectVisit(v.id, { panMap: true });
            });

            timelineTicksContainer.appendChild(tick);
        });
    }

    // --- 7. Dual Range Timeline Logic & Map Filtering ---
    function updateTimelineAndMap() {
        if (!sliderStart || !sliderEnd) return;

        let startVal = parseInt(sliderStart.value, 10);
        let endVal = parseInt(sliderEnd.value, 10);

        // Prevent handles from crossing each other
        if (startVal > endVal) {
            const temp = startVal;
            startVal = endVal;
            endVal = temp;
            sliderStart.value = startVal;
            sliderEnd.value = endVal;
        }

        // Update visual highlight bar spanning between handles (track has 5% padding)
        const pctStart = (startVal / 1000) * 90 + 5;
        const pctEnd = (endVal / 1000) * 90 + 5;
        if (timelineHighlight) {
            timelineHighlight.style.left = `${pctStart}%`;
            timelineHighlight.style.width = `${Math.max(0, pctEnd - pctStart)}%`;
        }

        // Calculate time range
        const windowStart = minEpoch + (maxEpoch - minEpoch) * (startVal / 1000);
        const windowEnd = minEpoch + (maxEpoch - minEpoch) * (endVal / 1000);

        // Format date/time labels
        const formatDate = (ms) => {
            return new Date(ms).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        };

        if (timelineRangeLabel) {
            timelineRangeLabel.textContent = `${formatDate(windowStart)} – ${formatDate(windowEnd)}`;
        }

        // Filter visits falling within current timeline window
        const inWindowVisits = visits.filter(v => v.epoch_ms >= windowStart && v.epoch_ms <= windowEnd);

        if (timelineVisitsCount) {
            timelineVisitsCount.textContent = `${inWindowVisits.length} visits`;
        }

        // Update visual dimming of ticks outside window
        const allTicks = timelineTicksContainer.querySelectorAll('.timeline-tick');
        allTicks.forEach(tick => {
            const id = parseInt(tick.dataset.id, 10);
            const v = visits.find(item => item.id === id);
            if (v) {
                if (v.epoch_ms >= windowStart && v.epoch_ms <= windowEnd) {
                    tick.style.opacity = '1';
                } else {
                    tick.style.opacity = '0.35';
                }
            }
        });

        // "Displaying Max [N]" logic:
        // Sort visits in window descending by epoch_ms (newest first)
        const sortedInWindow = [...inWindowVisits].sort((a, b) => b.epoch_ms - a.epoch_ms);

        let maxN = defaultMax;
        if (mapMaxInput) {
            const parsed = parseInt(mapMaxInput.value, 10);
            if (!isNaN(parsed) && parsed > 0) {
                maxN = parsed;
            }
        }

        const displayedVisits = sortedInWindow.slice(0, maxN);

        if (mapStatusBadge) {
            mapStatusBadge.textContent = `Showing ${displayedVisits.length} of ${inWindowVisits.length}`;
        }

        // Refresh Map Markers
        renderMapMarkers(displayedVisits);
    }

    // --- 8. Render Map Markers with Custom Marian Blue Style ---
    function renderMapMarkers(displayedVisits) {
        if (!map) return;

        // Clear existing markers
        markers.forEach(m => map.removeLayer(m.marker));
        markers = [];

        displayedVisits.forEach((v) => {
            if (!v.latitude || !v.longitude) return;

            const isSelected = (v.id === selectedVisitId);

            const marianIcon = L.divIcon({
                className: `custom-marian-marker ${isSelected ? 'selected' : ''}`,
                html: `<div class="marian-marker-pin" id="marker-pin-${v.id}"><i class="fa fa-map-pin"></i></div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 32],
                popupAnchor: [0, -32]
            });

            const marker = L.marker([v.latitude, v.longitude], { icon: marianIcon }).addTo(map);

            const popupContent = `
                <div class="map-popup-card">
                    <h5 class="popup-title">${v.city || 'Visitor Location'}${v.region ? ', ' + v.region : ''}</h5>
                    <p class="popup-sub"><i class="fa fa-network-wired icon-secondary"></i> ${v.ip_address || '127.0.0.1'}</p>
                    <p class="popup-sub"><i class="fa fa-file-code icon-secondary"></i> ${v.page_visited || '/home'}</p>
                    <p class="popup-sub"><i class="fa fa-clock icon-secondary"></i> ${v.timestamp || ''}</p>
                </div>
            `;
            marker.bindPopup(popupContent);

            // Selecting a pin selects the visit and populates portfolio card
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                selectVisit(v.id, { panMap: false });
            });

            markers.push({ id: v.id, marker: marker, data: v });
        });

        // Reopen popup for selected visit if visible
        if (selectedVisitId) {
            const selectedMarkerObj = markers.find(m => m.id === selectedVisitId);
            if (selectedMarkerObj) {
                selectedMarkerObj.marker.openPopup();
            }
        }
    }

    // --- 9. Selection & Deselection Logic ---
    // User specification:
    // "Selecting any tick or pin opens the portfolio card and illuminates the tick in glowing Marian blue.
    // Clicking elsewhere will not accidentally deselect it; only clicking the card's [x] close button
    // or the timeline's 'Reset Full Range' button will deselect."
    function selectVisit(id, options = {}) {
        const panMap = options.panMap !== false;
        selectedVisitId = id;

        const v = visits.find(item => item.id === id);
        if (!v) return;

        // 1. Highlight Tick mark in glowing Marian Blue
        const allTicks = timelineTicksContainer.querySelectorAll('.timeline-tick');
        allTicks.forEach(tick => {
            if (parseInt(tick.dataset.id, 10) === id) {
                tick.classList.add('glowing');
            } else {
                tick.classList.remove('glowing');
            }
        });

        // 2. Highlight Map Pin
        markers.forEach(m => {
            const el = m.marker.getElement();
            if (m.id === id) {
                if (el) el.classList.add('selected');
                m.marker.openPopup();
            } else {
                if (el) el.classList.remove('selected');
            }
        });

        // Pan map smoothly if requested
        if (panMap && map && v.latitude && v.longitude) {
            map.flyTo([v.latitude, v.longitude], Math.max(map.getZoom(), 12), { duration: 0.6 });
        }

        // 3. Populate Visitor Portfolio Card
        if (portfolioPlaceholder) portfolioPlaceholder.style.display = 'none';
        if (portfolioContent) portfolioContent.style.display = 'block';

        const locString = `${v.city || 'Harrodsburg'}${v.region ? ', ' + v.region : ''}, ${v.country || 'United States'}`;
        if (inspectLocationTitle) inspectLocationTitle.textContent = locString;
        if (inspectPostalBadge) {
            inspectPostalBadge.textContent = v.postal ? `Postal: ${v.postal}` : 'Postal: N/A';
        }
        if (inspectTime) inspectTime.textContent = v.timestamp || new Date(v.epoch_ms).toLocaleString();
        if (inspectIp) inspectIp.textContent = v.ip_address || '127.0.0.1';
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
    }

    // Deselect function: Only called by [x] close button or "Reset Full Range" button
    function clearSelection() {
        selectedVisitId = null;

        // Remove glowing class from all ticks
        if (timelineTicksContainer) {
            const allTicks = timelineTicksContainer.querySelectorAll('.timeline-tick');
            allTicks.forEach(tick => tick.classList.remove('glowing'));
        }

        // Remove selected class from map markers and close popup
        markers.forEach(m => {
            const el = m.marker.getElement();
            if (el) el.classList.remove('selected');
        });
        if (map) map.closePopup();

        // Show idle placeholder in portfolio card
        if (portfolioContent) portfolioContent.style.display = 'none';
        if (portfolioPlaceholder) portfolioPlaceholder.style.display = 'block';
    }

    // Portfolio [x] close button
    if (portfolioCloseBtn) {
        portfolioCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearSelection();
        });
    }

    // Reset Full Range button
    if (resetTimelineBtn) {
        resetTimelineBtn.addEventListener('click', () => {
            if (sliderStart) sliderStart.value = 0;
            if (sliderEnd) sliderEnd.value = 1000;
            clearSelection();
            updateTimelineAndMap();
        });
    }

    // --- 10. Bind Timeline Range Sliders ---
    if (sliderStart && sliderEnd) {
        const onSliderInput = () => {
            updateTimelineAndMap();
        };

        sliderStart.addEventListener('input', onSliderInput);
        sliderEnd.addEventListener('input', onSliderInput);
        sliderStart.addEventListener('change', onSliderInput);
        sliderEnd.addEventListener('change', onSliderInput);
    }

    // --- 11. Bind "Displaying Max [N]" Input ---
    if (mapMaxInput) {
        mapMaxInput.addEventListener('input', () => {
            let val = parseInt(mapMaxInput.value, 10);
            if (!isNaN(val) && val > 0) {
                defaultMax = val;
                updateTimelineAndMap();

                // Persist new max value to system_variables.db via debounced API call
                clearTimeout(saveMaxTimeout);
                saveMaxTimeout = setTimeout(() => {
                    fetch('/api/set_map_max', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ max: val })
                    }).catch(() => {});
                }, 600);
            }
        });
    }

    // --- 13. Auto-initialize if authenticated ---
    if (isAuthenticated) {
        initDashboard();
    }
});
