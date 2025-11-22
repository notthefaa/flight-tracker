// State
const state = {
    flights: [],
    allFetchedFlights: [], 
    loading: false,
    error: null,
    filterOrigin: '',
    filterNearby: false,
    filterHomeOnly: false,
    userLocation: null,
    nearbyAirportCodes: new Set(), 
    nextPageLink: null,
    isFetchingBackground: false,
    homeBase: '', 
    homeNearbySet: new Set() 
};

// DOM Elements
const welcomePage = document.getElementById('welcomePage');
const app = document.getElementById('app');
const startSearchBtn = document.getElementById('startSearchBtn');
const flightListEl = document.getElementById('flightList');
const nearbyToggle = document.getElementById('nearbyToggle');
const homeOnlyToggle = document.getElementById('homeOnlyToggle');
const airportFilter = document.getElementById('airportFilter');
const refreshBtn = document.getElementById('refreshBtn');
const homeBaseInput = document.getElementById('homeBaseInput');

// Ensure inputs/toggles are cleared on reload
homeBaseInput.value = '';
airportFilter.value = '';
nearbyToggle.checked = false;
homeOnlyToggle.checked = false;

// Event Listeners
startSearchBtn.addEventListener('click', async () => {
    welcomePage.style.display = 'none';
    app.style.display = 'block';
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

homeOnlyToggle.addEventListener('change', (e) => {
    if (e.target.checked && !state.homeBase) {
        alert("Please enter a Home Base airport code first (e.g. KDAL).");
        e.target.checked = false; 
        return;
    }
    state.filterHomeOnly = e.target.checked;
    render();
});

airportFilter.addEventListener('input', (e) => {
    state.filterOrigin = e.target.value;
    render();
});

homeBaseInput.addEventListener('input', (e) => {
    state.homeBase = e.target.value.trim().toUpperCase();
    updateHomeBaseZone().then(() => {
        if (!state.homeBase && state.filterHomeOnly) {
            state.filterHomeOnly = false;
            homeOnlyToggle.checked = false;
        }
        render();
    });
});

// Helpers
function setControlsDisabled(disabled) {
    airportFilter.disabled = disabled;
    homeBaseInput.disabled = disabled;
    nearbyToggle.disabled = disabled;
    homeOnlyToggle.disabled = disabled;
    refreshBtn.disabled = disabled;

    if (disabled) {
        app.classList.add('controls-locked');
        if(airportFilter.placeholder.indexOf("Loading") === -1) {
             airportFilter.setAttribute('data-prev-placeholder', airportFilter.placeholder);
             airportFilter.placeholder = "Loading data...";
        }
    } else {
        app.classList.remove('controls-locked');
        const prev = airportFilter.getAttribute('data-prev-placeholder');
        if(prev) airportFilter.placeholder = prev;
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

    const zuluTime = date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        hour12: false
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
    setControlsDisabled(true);
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
        alert("Unable to retrieve location.");
        nearbyToggle.checked = false;
        state.filterNearby = false;
    } finally {
        state.loading = false;
        setControlsDisabled(false);
        render();
    }
}

// Load Data
let airportData = [];

async function loadAirportData() {
    if (airportData.length > 0) return;

    try {
        if (typeof US_AIRPORTS !== 'undefined') {
            airportData = US_AIRPORTS;
            console.log(`Loaded ${airportData.length} airports.`);
        } else {
            throw new Error('US_AIRPORTS global variable not found.');
        }
    } catch (err) {
        console.error('Error:', err);
        state.error = `Data Load Error: ${err.message}`;
    }
}

// Haversine
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959;
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
    const RADIUS = 50;
    const nearby = [];
    for (const airport of airportData) {
        const dist = calculateDistance(lat, lon, airport.lat, airport.lon);
        if (dist <= RADIUS) {
            nearby.push(airport.code);
        }
    }
    state.nearbyAirportCodes = new Set(nearby);
}

async function updateHomeBaseZone() {
    state.homeNearbySet.clear();
    let homeCode = state.homeBase.trim().toUpperCase();
    if (!homeCode) return;

    await loadAirportData();
    
    // Try exact match
    let homeAirport = airportData.find(a => a.code === homeCode);
    
    // Smart Fallback: If user types "DAL" but CSV has "KDAL"
    if (!homeAirport && homeCode.length === 3) {
         const kCode = "K" + homeCode;
         homeAirport = airportData.find(a => a.code === kCode);
         if (homeAirport) {
             console.log(`Found home airport using fallback: ${kCode}`);
             // Optionally update state to matches
             // state.homeBase = kCode; 
         }
    }

    if (!homeAirport) {
        console.warn("Home airport not found in DB.");
        return;
    }

    const RADIUS = 50;
    for (const airport of airportData) {
        if (calculateDistance(homeAirport.lat, homeAirport.lon, airport.lat, airport.lon) <= RADIUS) {
            state.homeNearbySet.add(airport.code);
        }
    }
    console.log(`Home Zone calculated: ${state.homeNearbySet.size} airports.`);
}

// Fetch Flights
async function fetchFlights(isBackground = false) {
    if (!isBackground) {
        state.loading = true;
        state.error = null;
        state.allFetchedFlights = [];
        state.nextPageLink = null;
        state.isFetchingBackground = false;
        setControlsDisabled(true); // Locks EVERYTHING
        render();
    } else {
        state.isFetchingBackground = true;
        render();
    }

    try {
        let targetUrl;
        if (!isBackground) {
            const today = new Date().toISOString().split('T')[0];
            targetUrl = `${CONFIG.API_URL}/operators/${CONFIG.CALLSIGN}/flights/scheduled?start=${today}&max_pages=1`;
        } else {
            targetUrl = state.nextPageLink;
        }

        if (!targetUrl) return;

        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        const response = await fetch(proxyUrl, {
            headers: {
                'x-apikey': CONFIG.API_KEY,
                'Accept': 'application/json; charset=UTF-8'
            }
        });

        if (!response.ok) {
            if (response.status === 429) {
                state.isFetchingBackground = false;
                state.nextPageLink = null;
                state.error = "Rate limit reached. Partial results shown.";
                render();
                return;
            }
            const text = await response.text();
            throw new Error(`API Error ${response.status}: ${text}`);
        }

        const data = await response.json();
        const pageFlights = data.scheduled || [];

        state.allFetchedFlights = [...state.allFetchedFlights, ...pageFlights];

        if (data.links && data.links.next) {
            const nextLink = data.links.next;
            state.nextPageLink = nextLink.startsWith('http') ? nextLink : `${CONFIG.API_URL}${nextLink}`;
            setTimeout(() => {
                fetchFlights(true);
            }, 6000);
        } else {
            state.nextPageLink = null;
            state.isFetchingBackground = false;
            render();
        }

    } catch (err) {
        console.error('Fetch Error:', err);
        if (!isBackground) state.error = err.message;
        else {
            state.isFetchingBackground = false;
            state.nextPageLink = null;
        }
    } finally {
        if (!isBackground) state.loading = false;
        if (!isBackground) setControlsDisabled(false);
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
        return `In ${Math.floor(hours / 24)}d ${hours % 24}h`;
    }
    if (hours > 0) return `In ${hours}h ${mins}m`;
    return `In ${mins}m`;
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

    // Urgency
    const timeUntil = getTimeUntilDeparture(flight);
    let timeUntilHtml = '';
    if (timeUntil && timeUntil !== "Departed") {
        const dep = new Date(rawDep);
        const now = new Date();
        const diffMins = (dep - now) / 60000;
        let urgencyClass = '';
        if (diffMins < 60) urgencyClass = 'urgency-high';
        else if (diffMins < 120) urgencyClass = 'urgency-medium';
        else if (diffMins < 240) urgencyClass = 'urgency-low';
        
        timeUntilHtml = `<div class="flight-center-info"><span class="time-until-departure ${urgencyClass}">${timeUntil}</span></div>`;
    } else if (timeUntil === "Departed") {
        timeUntilHtml = `<div class="flight-center-info"><span class="time-until-departure" style="color: #999; background: transparent;">${timeUntil}</span></div>`;
    }

    // Home Logic
    const destCode = (flight.destination?.code || '').toUpperCase();
    const isHomeBound = state.homeNearbySet.has(destCode);
    const cardClass = isHomeBound ? 'flight-card home-bound' : 'flight-card';
    let badgeText = '';
    if (isHomeBound) {
        badgeText = (destCode === state.homeBase) ? '🏠 Go Home' : '📍 Home Area';
    }
    const badgeHtml = isHomeBound ? `<div class="home-badge">${badgeText}</div>` : '';

    return `
        <div class="${cardClass}">
            ${badgeHtml} 
            
            <div class="flight-header">
                <div class="flight-id">
                    <span class="flight-number">${flight.ident}</span>
                    <span class="flight-date">${date}</span>
                </div>
                <!-- Time Aligned Right -->
                ${timeUntilHtml}
            </div>
            
            <div class="route">
                <div class="location">
                    <span class="airport-code">${flight.origin?.code || '---'}</span>
                    <span class="airport-name">${flight.origin?.city || 'Unknown'}</span>
                    <div class="time-group">
                        <span class="time local">${depTimes.local}</span>
                        <span class="time zulu">${depTimes.zulu}Z</span>
                    </div>
                </div>
                <div class="plane-icon">✈</div>
                <div class="location arrival">
                    <span class="airport-code">${flight.destination?.code || '---'}</span>
                    <span class="airport-name">${flight.destination?.city || 'Unknown'}</span>
                    <div class="time-group">
                        <span class="time local">${arrTimes.local}</span>
                        <span class="time zulu">${arrTimes.zulu}Z</span>
                    </div>
                </div>
            </div>
            <!-- Centered Footer Meta -->
            <div class="flight-meta">
                ${aircraftHtml}
                <span class="flight-status">${flight.status || 'Scheduled'}</span>
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

        // 1. Filter by Departure (Origin)
        if (state.filterOrigin && state.filterOrigin.trim() !== '') {
            const filter = state.filterOrigin.trim().toUpperCase();
            const originCode = (f.origin?.code || f.origin || '').toUpperCase();
            const originCity = (f.origin?.city || '').toUpperCase();
            if (!originCode.includes(filter) && !originCity.includes(filter)) return false;
        }

        // 2. Filter by Nearby (Origin)
        if (state.filterNearby && state.nearbyAirportCodes.size > 0) {
            const originCode = f.origin?.code || f.origin;
            const codeToCheck = (typeof originCode === 'string' ? originCode : originCode?.code || '').toUpperCase();
            if (!state.nearbyAirportCodes.has(codeToCheck)) return false;
        } else if (state.filterNearby && state.nearbyAirportCodes.size === 0) {
            return false;
        }

        // 3. Filter by Home Only (Destination)
        if (state.filterHomeOnly) {
            const destCode = (f.destination?.code || '').toUpperCase();
            // Check exact match with Home Set
            if (!state.homeNearbySet.has(destCode)) return false;
        }

        return true;
    });
    filtered.sort((a, b) => {
        return new Date(getDepartureTime(a)) - new Date(getDepartureTime(b));
    });
    state.flights = filtered;
}

function render() {
    applyFilters();
    if (state.loading) {
        if (!flightListEl.innerHTML.includes('Loading')) {
            flightListEl.innerHTML = `<div class="loading"><span class="spinner"></span><br>Loading flights...</div>`;
        }
        return;
    }
    if (state.error && state.flights.length === 0) {
        flightListEl.innerHTML = `<div class="error">Error: ${state.error}</div>`;
        return;
    }

    let debugHtml = '';
    if (state.filterNearby) {
        const loc = state.userLocation ? `${state.userLocation.lat.toFixed(2)},${state.userLocation.lon.toFixed(2)}` : 'Locating...';
        debugHtml = `<div class="status-bar">📍 Location: ${loc} (${state.nearbyAirportCodes.size} nearby)</div>`;
    }

    if (state.flights.length === 0) {
        if (state.nextPageLink) {
             flightListEl.innerHTML = `<div class="loading"><span class="spinner"></span><br>Loading schedule...</div>`;
             return;
        }
        
        let msg = "No upcoming flights found.";
        if (state.filterHomeOnly) msg = "No flights found going to your Home Base.";
        
        flightListEl.innerHTML = `${debugHtml}<div class="empty">${msg}</div>`;
        return;
    }

    flightListEl.innerHTML = `
        <div class="status-bar">Showing ${state.flights.length} upcoming flights</div>
        ${debugHtml}
        ${state.flights.map(renderFlightCard).join('')}
    `;

    if (state.isFetchingBackground) {
        const loadingMoreEl = document.createElement('div');
        loadingMoreEl.className = 'loading-more';
        loadingMoreEl.innerHTML = '<span class="spinner"></span> Loading more...';
        flightListEl.appendChild(loadingMoreEl);
    } else if (!state.nextPageLink) {
        const doneEl = document.createElement('div');
        doneEl.className = 'loading-more';
        doneEl.innerHTML = 'All flights loaded.';
        flightListEl.appendChild(doneEl);
    }
}
