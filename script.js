// State
const state = {
    flights: [],
    allFetchedFlights: [], // Store ALL fetched flights here
    loading: false,
    error: null,
    filterOrigin: '',
    filterNearby: false,
    userLocation: null,
    nearbyAirportCodes: new Set(), // Store codes of nearby airports
    nextPageLink: null,
    isFetchingBackground: false,
    homeBase: localStorage.getItem('lxj_home_base') || '',
    homeNearbySet: new Set() // Airports within 50mi of Home Base
};

// DOM Elements
const welcomePage = document.getElementById('welcomePage');
const app = document.getElementById('app');
const startSearchBtn = document.getElementById('startSearchBtn');
const flightListEl = document.getElementById('flightList');
const nearbyToggle = document.getElementById('nearbyToggle');
const airportFilter = document.getElementById('airportFilter');
const refreshBtn = document.getElementById('refreshBtn');
const homeBaseInput = document.getElementById('homeBaseInput');

// Set initial value for home base if saved
if (state.homeBase) {
    homeBaseInput.value = state.homeBase;
}

// Event Listeners
startSearchBtn.addEventListener('click', async () => {
    welcomePage.style.display = 'none';
    app.style.display = 'block';

    // Load data immediately so highlighting works
    loadAirportData().then(() => updateHomeBaseZone());

    fetchFlights();
});

refreshBtn.addEventListener('click', () => {
    fetchFlights();
});

nearbyToggle.addEventListener('change', async (e) => {
    state.filterNearby = e.target.checked;
    if (state.filterNearby) {
        await handleNearbyToggle();
    } else {
        render();
    }
});

airportFilter.addEventListener('input', (e) => {
    state.filterOrigin = e.target.value;
    render();
});

homeBaseInput.addEventListener('input', (e) => {
    state.homeBase = e.target.value.trim().toUpperCase();
    localStorage.setItem('lxj_home_base', state.homeBase);

    // Recalculate zone, then render
    updateHomeBaseZone().then(() => {
        render();
    });
});

// Helpers
function setControlsDisabled(disabled) {
    airportFilter.disabled = disabled;
    nearbyToggle.disabled = disabled;
    refreshBtn.disabled = disabled;

    if (disabled) {
        airportFilter.placeholder = "Search locked while flights are populating...";
        app.classList.add('controls-locked');
    } else {
        airportFilter.placeholder = "Search complete. Filter by Airport Code (e.g. KLAX)";
        app.classList.remove('controls-locked');
    }
}

function getDepartureTime(flight) {
    return flight.scheduled_out || flight.scheduled_off || flight.filed_off || flight.estimated_out;
}

function getArrivalTime(flight) {
    return flight.scheduled_in || flight.scheduled_on || flight.filed_in || flight.estimated_in;
}

function formatTime(isoString, timeZone) {
    if (!isoString) return 'TBD';
    const date = new Date(isoString);

    // Format for specific timezone (Local)
    const localOptions = {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timeZone
    };

    let localTime;
    try {
        localTime = date.toLocaleTimeString([], timeZone ? localOptions : {});
    } catch (e) {
        console.warn('Invalid timezone:', timeZone);
        localTime = date.toLocaleTimeString([], {});
    }

    // Format for UTC (Zulu)
    const zuluTime = date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        hour12: false // Zulu time is typically 24h
    });

    return { local: localTime, zulu: zuluTime };
}

function formatDate(isoString, timeZone) {
    if (!isoString) return '';
    const date = new Date(isoString);
    try {
        return date.toLocaleDateString([], {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: timeZone
        });
    } catch (e) {
        return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }
}

// Geolocation and Nearby Airports
async function handleNearbyToggle() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        nearbyToggle.checked = false;
        state.filterNearby = false;
        return;
    }

    state.loading = true;
    setControlsDisabled(true); // Lock controls during geo lookup
    render();

    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject);
        });

        state.userLocation = {
            lat: position.coords.latitude,
            lon: position.coords.longitude
        };

        await findNearbyAirportsFromCSV(state.userLocation.lat, state.userLocation.lon);
    } catch (error) {
        console.error("Geolocation error:", error);
        alert("Unable to retrieve your location. Please allow location access to use this feature.");
        nearbyToggle.checked = false;
        state.filterNearby = false;
    } finally {
        state.loading = false;
        setControlsDisabled(false); // Unlock controls
        render();
    }
}

// Load and Parse CSV (Using global variable from airports.js)
let airportData = [];

async function loadAirportData() {
    if (airportData.length > 0) return; // Already loaded

    try {
        if (typeof US_AIRPORTS !== 'undefined') {
            airportData = US_AIRPORTS;
            console.log(`Loaded ${airportData.length} airports from global variable.`);
        } else {
            throw new Error('US_AIRPORTS global variable not found. Make sure airports.js is loaded.');
        }
    } catch (err) {
        console.error('Error loading airport data:', err);
        state.error = `Data Load Error: ${err.message}`;
        alert('Failed to load local airport database.');
    }
}

// Haversine Formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959; // Radius of Earth in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function findNearbyAirportsFromCSV(lat, lon) {
    await loadAirportData();

    const RADIUS = 50; // miles
    const nearby = [];

    for (const airport of airportData) {
        const dist = calculateDistance(lat, lon, airport.lat, airport.lon);
        if (dist <= RADIUS) {
            nearby.push(airport.code);
        }
    }

    state.nearbyAirportCodes = new Set(nearby);
    console.log(`Found ${nearby.length} nearby airports.`);
}

// Calculate Home Base Zone (Airports within 50mi of Home)
async function updateHomeBaseZone() {
    state.homeNearbySet.clear();
    
    const homeCode = state.homeBase.trim().toUpperCase();
    if (!homeCode) return;

    // Ensure data is loaded
    await loadAirportData(); 

    // 1. Find the Home Airport object to get its Lat/Lon
    const homeAirport = airportData.find(a => a.code === homeCode);
    
    if (!homeAirport) {
        console.log("Home airport not found in database.");
        return;
    }

    // 2. Find all airports within 50 miles of Home
    const RADIUS = 50; 
    for (const airport of airportData) {
        // We include the home airport itself in this check (distance 0)
        if (calculateDistance(homeAirport.lat, homeAirport.lon, airport.lat, airport.lon) <= RADIUS) {
            state.homeNearbySet.add(airport.code);
        }
    }
    
    console.log(`Home Base is ${homeCode}. Found ${state.homeNearbySet.size} nearby airports.`);
}


// Fetch Flights
async function fetchFlights(isBackground = false) {
    if (!isBackground) {
        // Initial Load
        state.loading = true;
        state.error = null;
        state.allFetchedFlights = [];
        state.nextPageLink = null;
        state.isFetchingBackground = false;
        setControlsDisabled(true); // Lock controls
        render();
    } else {
        state.isFetchingBackground = true;
        render(); // Update UI to show loading indicator
    }

    try {
        let targetUrl;
        if (!isBackground) {
            const today = new Date().toISOString().split('T')[0];
            // Initial fetch: max_pages=1 to get data fast
            targetUrl = `${CONFIG.API_URL}/operators/${CONFIG.CALLSIGN}/flights/scheduled?start=${today}&max_pages=1`;
        } else {
            targetUrl = state.nextPageLink;
        }

        if (!targetUrl) return;

        console.log(`Fetching ${isBackground ? 'background' : 'initial'} batch:`, targetUrl);

        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        const response = await fetch(proxyUrl, {
            headers: {
                'x-apikey': CONFIG.API_KEY,
                'Accept': 'application/json; charset=UTF-8'
            }
        });
        if (!response.ok) {
            if (response.status === 429) {
                console.warn('Rate limit reached. Pausing background fetch.');
                state.isFetchingBackground = false;
                state.nextPageLink = null; // Stop fetching and allow unlock
                state.error = "Rate limit reached. Showing partial results.";
                render();
                return;
            }
            const text = await response.text();
            throw new Error(`API Error ${response.status}: ${text}`);
        }

        const data = await response.json();
        const pageFlights = data.scheduled || [];

        // Append new flights
        state.allFetchedFlights = [...state.allFetchedFlights, ...pageFlights];
        console.log(`Fetched ${pageFlights.length} flights. Total: ${state.allFetchedFlights.length}`);

        // Update next link
        if (data.links && data.links.next) {
            const nextLink = data.links.next;
            state.nextPageLink = nextLink.startsWith('http') ? nextLink : `${CONFIG.API_URL}${nextLink}`;

            // Trigger next background fetch after delay
            setTimeout(() => {
                fetchFlights(true);
            }, 6000); // 6 second delay to respect 10 req/min limit
        } else {
            state.nextPageLink = null;
            state.isFetchingBackground = false;
            console.log('All flights fetched.');
            render(); // Final render to show completion status
        }

    } catch (err) {
        console.error('Fetch Error:', err);
        if (!isBackground) {
            state.error = err.message || err.toString();
        } else {
            // If background fetch fails, just stop trying for now
            state.isFetchingBackground = false;
            state.nextPageLink = null; // Stop fetching and allow unlock
        }
    } finally {
        if (!isBackground) {
            state.loading = false;
        }

        // Strict Unlock: Only unlock when we are completely done fetching.
        // This ensures the user cannot filter partial data and cause issues.
        if (!state.nextPageLink || state.error) {
            setControlsDisabled(false);
        }

        // Only render if we are NOT about to trigger another background fetch immediately
        render();
    }
}

// Render
function getTimeUntilDeparture(flight) {
    const depTime = getDepartureTime(flight);
    if (!depTime) return null;

    const now = new Date();
    const dep = new Date(depTime);
    const diffMs = dep - now;

    if (diffMs < 0) return "Departed";

    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;

    if (hours > 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `Departs In ${days}d ${remainingHours}h`;
    }

    if (hours > 0) {
        return `Departs In ${hours}h ${mins}m`;
    }

    return `Departs In ${mins}m`;
}

function renderFlightCard(flight) {
    const rawDep = getDepartureTime(flight);
    const rawArr = getArrivalTime(flight);

    const originTz = flight.origin?.timezone;
    const destTz = flight.destination?.timezone;

    const depTimes = formatTime(rawDep, originTz);
    const arrTimes = formatTime(rawArr, destTz);
    const date = formatDate(rawDep, originTz);

    const aircraftInfo = flight.aircraft_type || 'Unknown';
    const aircraftHtml = `<span class="aircraft-type">${aircraftInfo}</span>`;

    const timeUntil = getTimeUntilDeparture(flight);
    const timeUntilHtml = timeUntil ? `<div class="flight-center-info"><span class="time-until-departure">${timeUntil}</span></div>` : '<div class="flight-center-info"></div>';

    // --- HOME HIGHLIGHT LOGIC ---
    const destCode = (flight.destination?.code || '').toUpperCase();
    
    // Check if destination is in our pre-calculated "Home Zone"
    const isHomeBound = state.homeNearbySet.has(destCode);
    
    const cardClass = isHomeBound ? 'flight-card home-bound' : 'flight-card';
    
    // Differentiate text: "Go Home" (exact) vs "Home Area" (nearby)
    let badgeText = '';
    if (isHomeBound) {
        badgeText = (destCode === state.homeBase) ? '🏠 Go Home' : '📍 Home Area';
    }
    const badgeHtml = isHomeBound ? `<div class="home-badge">${badgeText}</div>` : '';
    // -----------------------------

    return `
        <div class="${cardClass}">
            ${badgeHtml} 
            <div class="flight-header">
                <div class="flight-id">
                    <span class="flight-number">${flight.ident}</span>
                    <span class="flight-date">${date}</span>
                </div>
                ${timeUntilHtml}
                <div class="flight-meta">
                    ${aircraftHtml}
                    <span class="flight-status">${flight.status || 'Scheduled'}</span>
                </div>
            </div>
            <div class="route">
                <div class="location">
                    <span class="airport-code">${flight.origin?.code || '---'}</span>
                    <span class="airport-name">${flight.origin?.city || flight.origin?.name || 'Unknown'}</span>
                    <div class="time-group">
                        <span class="time local">Dep: ${depTimes.local}</span>
                        <span class="time zulu">${depTimes.zulu}Z</span>
                    </div>
                </div>
                <div class="plane-icon">✈</div>
                <div class="location arrival">
                    <span class="airport-code">${flight.destination?.code || '---'}</span>
                    <span class="airport-name">${flight.destination?.city || flight.destination?.name || 'Unknown'}</span>
                    <div class="time-group">
                        <span class="time local">Arr: ${arrTimes.local}</span>
                        <span class="time zulu">${arrTimes.zulu}Z</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function applyFilters() {
    const now = new Date();

    let filtered = state.allFetchedFlights.filter(f => {
        if (f.actual_off || f.actual_out) return false;

        const depTime = getDepartureTime(f);
        if (!depTime) return false;

        if (new Date(depTime) <= now) return false;

        if (state.filterOrigin && state.filterOrigin.trim() !== '') {
            const filter = state.filterOrigin.trim().toUpperCase();
            const originCode = (f.origin?.code || f.origin || '').toUpperCase();
            const originCity = (f.origin?.city || '').toUpperCase();

            if (!originCode.includes(filter) && !originCity.includes(filter)) return false;
        }

        if (state.filterNearby && state.nearbyAirportCodes.size > 0) {
            const originCode = f.origin?.code || f.origin;
            const codeToCheck = (typeof originCode === 'string' ? originCode : originCode?.code || '').toUpperCase();

            let match = false;
            if (state.nearbyAirportCodes.has(codeToCheck)) {
                match = true;
            }
            if (!match) return false;
        } else if (state.filterNearby && state.nearbyAirportCodes.size === 0) {
            return false;
        }

        return true;
    });

    filtered.sort((a, b) => {
        const timeA = new Date(getDepartureTime(a));
        const timeB = new Date(getDepartureTime(b));
        return timeA - timeB;
    });

    state.flights = filtered;
}

function render() {
    applyFilters();

    if (state.loading) {
        if (!flightListEl.innerHTML.includes('Loading')) {
            flightListEl.innerHTML = `
        <div class="loading">
            Loading flights...
    <div style="font-size: 0.85rem; opacity: 0.7; margin-top: 10px; font-weight: normal;">
        This may take a minute as we retrieve all scheduled data.
    </div>
                </div>`;
        }
        return;
    }

    if (state.error && state.flights.length === 0) {
        flightListEl.innerHTML = `<div class="error"> Error: ${state.error}</div>`;
        return;
    }

    let debugHtml = '';
    if (state.filterNearby) {
        const loc = state.userLocation ? `${state.userLocation.lat.toFixed(4)}, ${state.userLocation.lon.toFixed(4)} ` : 'Unknown';
        const airports = Array.from(state.nearbyAirportCodes).join(', ');
        let csvStatus = airportData.length > 0 ? `Loaded(${airportData.length} airports)` : 'Not Loaded';
        if (state.error && state.error.includes('CSV')) {
            csvStatus += ` <span class="warning"> (${state.error})</span> `;
        }

        debugHtml = `
        <div class="status-bar" style="font-size: 0.75rem; opacity: 0.8; margin-top: -0.5rem;">
                📍 Location: ${loc} <br>
        📂 CSV Status: ${csvStatus} <br>
            🛫 Nearby Airports: ${airports || 'None found'}
        </div>
        `;
    }

    if (state.flights.length === 0) {
        // If we have no flights BUT we have a next page link, it means we are still
        // fetching the initial set of data (just spread across pages).
        // Keep showing the loading message.
        if (state.nextPageLink) {
            if (!flightListEl.innerHTML.includes('Loading')) {
                flightListEl.innerHTML = `
                    <div class="loading">
                        Loading flights...
                        <div style="font-size: 0.85rem; opacity: 0.7; margin-top: 10px; font-weight: normal;">
                            This may take a minute as we retrieve all scheduled data.
                        </div>
                    </div>`;
            }
            return;
        }

        let msg = "No upcoming flights found.";
        if (state.filterOrigin) msg += ` (Filtered by "${state.filterOrigin}")`;
        if (state.filterNearby) msg += ` (Filtered by Nearby)`;

        flightListEl.innerHTML = `
        ${debugHtml}
        <div class="empty">${msg}</div>
        `;
        return;
    }

    flightListEl.innerHTML = `
        <div class="status-bar">
            Showing ${state.flights.length} upcoming flights from FlightAware AeroAPI
            ${state.error ? `<br><span class="warning">⚠️ ${state.error}</span>` : ''}
        </div>
        ${debugHtml}
        <div class="disclaimer">
            Powered by FlightAware AeroAPI
        </div>
        ${state.flights.map(renderFlightCard).join('')}
        `;

    if (state.isFetchingBackground) {
        const loadingMoreEl = document.createElement('div');
        loadingMoreEl.className = 'loading-more';
        loadingMoreEl.innerHTML = '<span class="spinner"></span> Loading more flights...';
        flightListEl.appendChild(loadingMoreEl);
    } else if (state.nextPageLink === null && state.flights.length > 0) {
        const doneEl = document.createElement('div');
        doneEl.className = 'loading-more'; // Reuse style for centering
        doneEl.style.fontStyle = 'normal';
        doneEl.style.opacity = '0.6';
        doneEl.innerHTML = '✓ All scheduled flights loaded.';
        flightListEl.appendChild(doneEl);
    }
}
