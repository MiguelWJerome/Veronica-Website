/**
 * Veronica Website - Main JavaScript
 * Handles responsive navigation, dynamic link validation modal,
 * gallery image lightbox modal, and search keyword highlighting with auto-scroll.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Mobile Menu Toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const navMenu = document.getElementById('nav-menu');

    if (mobileMenuBtn && navMenu) {
        mobileMenuBtn.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            const icon = mobileMenuBtn.querySelector('i');
            if (icon) {
                if (navMenu.classList.contains('active')) {
                    icon.className = 'fa fa-times';
                } else {
                    icon.className = 'fa fa-bars';
                }
            }
        });
    }

    // 2. Dynamic Page Notice Modal (for non-existent links)
    function setupNoticeModal() {
        if (document.getElementById('page-notice-modal-overlay')) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'page-notice-modal-overlay';
        overlay.className = 'modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-hidden', 'true');

        overlay.innerHTML = `
            <div class="notice-modal-box" id="notice-modal-box">
                <button type="button" class="modal-close-btn" id="modal-close-btn" aria-label="Close modal">
                    <i class="fa fa-times"></i>
                </button>
                <div class="modal-body-content">
                    <div class="modal-icon-badge">
                        <i class="fa fa-compass"></i>
                    </div>
                    <h3 class="modal-heading">Under Construction</h3>
                    <p class="modal-message">
                        Sorry, the <span class="modal-highlight-page" id="modal-page-name"></span> page doesn't exist yet.
                    </p>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const closeBtn = overlay.querySelector('#modal-close-btn');
        const modalBox = overlay.querySelector('#notice-modal-box');

        // Only the X button can close the modal
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeNoticeModal();
        });

        // Clicking on the modal box itself will NOT close it
        modalBox.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Clicking on the background overlay will NOT close it (explicitly required)
        overlay.addEventListener('click', (e) => {
            // Do nothing when clicking backdrop
        });
    }

    setupNoticeModal();

    const noticeModalOverlay = document.getElementById('page-notice-modal-overlay');
    const noticeModalPageName = document.getElementById('modal-page-name');

    function openNoticeModal(pageName) {
        if (!noticeModalOverlay) return;
        if (noticeModalPageName) {
            noticeModalPageName.textContent = pageName || 'requested';
        }
        noticeModalOverlay.classList.add('active');
        noticeModalOverlay.setAttribute('aria-hidden', 'false');
    }

    function closeNoticeModal() {
        if (!noticeModalOverlay) return;
        noticeModalOverlay.classList.remove('active');
        noticeModalOverlay.setAttribute('aria-hidden', 'true');
    }

    // 3. Dynamic Navbar Links Validation
    const navLinks = document.querySelectorAll('.nav-menu .nav-link');

    navLinks.forEach((link) => {
        link.addEventListener('click', async (e) => {
            const rawHref = link.getAttribute('href');
            const pageName = link.textContent.trim();

            // Case A: Missing href or in-page anchor
            if (!rawHref || rawHref === '#') {
                e.preventDefault();
                openNoticeModal(pageName);
                return;
            }

            if (rawHref.startsWith('#')) {
                // If it's an anchor (e.g. #donate, #mass-times), check if element exists on current page
                const targetEl = document.querySelector(rawHref);
                if (!targetEl) {
                    e.preventDefault();
                    openNoticeModal(pageName);
                    return;
                }
                return;
            }

            // Case B: External link or special protocols
            if (
                rawHref.startsWith('mailto:') ||
                rawHref.startsWith('tel:') ||
                rawHref.startsWith('javascript:') ||
                rawHref.startsWith('http://') ||
                rawHref.startsWith('https://') ||
                rawHref.startsWith('//')
            ) {
                return;
            }

            // Case C: Relative / internal page route (e.g. /home, /contact, /beliefs, /gallery, /donate, etc.)
            const currentPath = window.location.pathname;
            if (rawHref === currentPath || (currentPath === '/' && rawHref === '/home')) {
                return;
            }

            // Check if route exists on server dynamically
            e.preventDefault();
            try {
                const response = await fetch(rawHref, { method: 'HEAD' });
                if (response.ok) {
                    window.location.href = rawHref;
                } else {
                    openNoticeModal(pageName);
                }
            } catch (err) {
                openNoticeModal(pageName);
            }
        });
    });

    // 4. Gallery Image Lightbox Modal
    function setupGalleryLightbox() {
        const galleryCards = document.querySelectorAll('.gallery-card');
        if (!galleryCards || galleryCards.length === 0) return;

        let lightboxOverlay = document.getElementById('gallery-lightbox-overlay');
        if (!lightboxOverlay) {
            lightboxOverlay = document.createElement('div');
            lightboxOverlay.id = 'gallery-lightbox-overlay';
            lightboxOverlay.className = 'gallery-lightbox-overlay';
            lightboxOverlay.setAttribute('role', 'dialog');
            lightboxOverlay.setAttribute('aria-modal', 'true');
            lightboxOverlay.setAttribute('aria-hidden', 'true');

            lightboxOverlay.innerHTML = `
                <div class="gallery-lightbox-box" id="gallery-lightbox-box">
                    <button type="button" class="gallery-close-btn" id="gallery-close-btn" aria-label="Close image lightbox">
                        <i class="fa fa-times"></i>
                    </button>
                    <div class="gallery-lightbox-img-wrapper">
                        <img src="" alt="" id="gallery-lightbox-img" class="gallery-lightbox-img">
                    </div>
                    <div class="gallery-lightbox-caption" id="gallery-lightbox-caption"></div>
                </div>
            `;

            document.body.appendChild(lightboxOverlay);

            const closeBtn = lightboxOverlay.querySelector('#gallery-close-btn');
            const modalBox = lightboxOverlay.querySelector('#gallery-lightbox-box');

            // Only X button closes the modal
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeLightbox();
            });

            // Clicking inside the modal does NOT close it
            modalBox.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Clicking outside on the overlay does NOT close it (as explicitly requested)
            lightboxOverlay.addEventListener('click', (e) => {
                // Do nothing
            });
        }

        const lightboxImg = lightboxOverlay.querySelector('#gallery-lightbox-img');
        const lightboxCaption = lightboxOverlay.querySelector('#gallery-lightbox-caption');

        function openLightbox(imgSrc, captionText) {
            if (!lightboxOverlay || !lightboxImg) return;
            lightboxImg.src = imgSrc;
            lightboxImg.alt = captionText;
            if (lightboxCaption) {
                lightboxCaption.textContent = captionText;
            }
            lightboxOverlay.classList.add('active');
            lightboxOverlay.setAttribute('aria-hidden', 'false');
        }

        function closeLightbox() {
            if (!lightboxOverlay) return;
            lightboxOverlay.classList.remove('active');
            lightboxOverlay.setAttribute('aria-hidden', 'true');
        }

        galleryCards.forEach((card) => {
            card.addEventListener('click', () => {
                const img = card.querySelector('.gallery-img');
                const caption = card.querySelector('.gallery-caption');
                if (img) {
                    const src = img.getAttribute('src');
                    const captionText = caption ? caption.textContent.trim() : (img.getAttribute('alt') || 'Gallery Image');
                    openLightbox(src, captionText);
                }
            });
        });
    }

    setupGalleryLightbox();

    // 5. Keyword Highlighting and Smooth Scrolling on Destination Pages
    function setupSearchHighlightAndScroll() {
        const urlParams = new URLSearchParams(window.location.search);
        const query = urlParams.get('q') || urlParams.get('highlight');
        if (!query || !query.trim()) return;

        // Skip on search results page itself
        if (window.location.pathname.includes('/search')) return;

        const searchTerm = query.trim();
        const contentArea = document.querySelector('.content-container') || document.querySelector('main');
        if (!contentArea) return;

        const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedTerm})`, 'gi');
        let firstMatch = null;

        function walkTextNodes(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.nodeValue;
                if (regex.test(text)) {
                    const span = document.createElement('span');
                    span.innerHTML = text.replace(regex, '<mark class="page-search-highlight glowing">$1</mark>');
                    node.parentNode.replaceChild(span, node);
                    if (!firstMatch) {
                        firstMatch = span.querySelector('.page-search-highlight');
                    }
                }
            } else if (
                node.nodeType === Node.ELEMENT_NODE &&
                !['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'BUTTON', 'NAV', 'HEADER', 'FOOTER'].includes(node.tagName.toUpperCase()) &&
                !node.classList.contains('page-search-highlight')
            ) {
                Array.from(node.childNodes).forEach(walkTextNodes);
            }
        }

        walkTextNodes(contentArea);

        if (firstMatch) {
            setTimeout(() => {
                firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 350);

            // Stop the glow animation when the user clicks anywhere on the page
            const stopGlow = () => {
                document.querySelectorAll('.page-search-highlight.glowing').forEach((el) => {
                    el.classList.remove('glowing');
                });
                document.removeEventListener('click', stopGlow);
            };

            setTimeout(() => {
                document.addEventListener('click', stopGlow);
            }, 100);
        }
    }

    setupSearchHighlightAndScroll();

    // 5. Client-Side Geolocation & Daily Visit Telemetry
    function setupClientVisitTelemetry() {
        if (window.location.pathname.startsWith('/maps') || window.location.pathname.startsWith('/api')) {
            return;
        }

        const todayStr = new Date().toISOString().slice(0, 10);
        const lastPingDate = localStorage.getItem('olmc_visit_beacon_date');

        // Only query external geolocation once per day per client
        if (lastPingDate === todayStr) {
            return;
        }

        // Fetch client-side IP and geolocation from ipapi.co (or fallback to ip-api)
        fetch('https://ipapi.co/json/')
            .then(res => {
                if (!res.ok) throw new Error('ipapi.co status ' + res.status);
                return res.json();
            })
            .then(data => {
                if (data && (data.ip || data.city)) {
                    localStorage.setItem('olmc_visit_beacon_date', todayStr);
                    fetch('/api/log_visit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ip: data.ip,
                            city: data.city,
                            region: data.region,
                            country: data.country_name || data.country,
                            postal: data.postal,
                            latitude: data.latitude,
                            longitude: data.longitude,
                            org: data.org,
                            page: window.location.pathname
                        })
                    }).catch(() => {});
                }
            })
            .catch(() => {
                // Fallback to ip-api.com if ipapi.co is blocked or unreachable
                fetch('https://api.ipify.org?format=json')
                    .then(r => r.json())
                    .then(ipData => {
                        if (ipData && ipData.ip) {
                            localStorage.setItem('olmc_visit_beacon_date', todayStr);
                            fetch('/api/log_visit', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    ip: ipData.ip,
                                    page: window.location.pathname
                                })
                            }).catch(() => {});
                        }
                    })
                    .catch(() => {});
            });
    }

    setupClientVisitTelemetry();
});

