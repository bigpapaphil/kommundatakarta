// Initialize map
const map = L.map('map').setView([63, 16], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Initialize variables
let geojsonLayer;
let currentKpiData = {};
let municipalityData = null;  // Will store the GeoJSON data
let isHighToLow = true; // Controls if high values are "good" (green) or "bad" (red)
let searchTimeout = null;
let selectedKpi = null;
let currentChart = null; // Add at the start of the file
let isLoadingHistory = false;
let lastMunicipalityId = null;

// Load GeoJSON data first
fetch('/static/data/sweden_municipalities.geojson')
    .then(response => response.json())
    .then(data => {
        municipalityData = data;
        console.log('GeoJSON loaded:', municipalityData.features[0]);  // Debug first feature
    })
    .catch(error => console.error('Error loading GeoJSON:', error));

// Add info control
const info = L.control();
info.onAdd = function() {
    this._div = L.DomUtil.create('div', 'info');
    this.update();
    return this._div;
};
info.update = function(props) {
    this._div.innerHTML = props ? 
        `<b>${props.kom_namn}</b><br />Value: ${currentKpiData[props.id] || 'No data'}` :
        'Hover over a municipality';
};
info.addTo(map);

// Load KPI groups
fetch('/kpi_groups')
    .then(response => response.json())
    .then(groups => {
        const select = document.getElementById('kpiGroup');
        groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.title;
            select.appendChild(option);
        });
    });

document.getElementById('searchInput').addEventListener('input', function(e) {
    const searchTerm = e.target.value;
    
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }

    searchTimeout = setTimeout(() => {
        fetch(`/search_kpis?term=${encodeURIComponent(searchTerm)}&page=1`)
            .then(response => response.json())
            .then(data => {
                const resultsDiv = document.getElementById('searchResults');
                resultsDiv.innerHTML = '';
                resultsDiv.style.display = 'block'; // Always show the dropdown
                resultsDiv.dataset.page = '1';
                resultsDiv.dataset.hasMore = data.has_more;
                resultsDiv.dataset.searchTerm = searchTerm;
                
                displayResults(data.results);
            });
    }, 300);
});

// Add scroll event listener to search results
document.getElementById('searchResults').addEventListener('scroll', function(e) {
    const div = e.target;
    if (div.scrollTop + div.clientHeight >= div.scrollHeight - 20) { // Near bottom
        if (div.dataset.hasMore === 'true') {
            const nextPage = parseInt(div.dataset.page) + 1;
            const searchTerm = div.dataset.searchTerm;
            
            fetch(`/search_kpis?term=${encodeURIComponent(searchTerm)}&page=${nextPage}`)
                .then(response => response.json())
                .then(data => {
                    div.dataset.page = nextPage;
                    div.dataset.hasMore = data.has_more;
                    displayResults(data.results);
                });
        }
    }
});

function displayResults(results) {
    const resultsDiv = document.getElementById('searchResults');
    results.forEach(kpi => {
        const div = document.createElement('div');
        div.innerHTML = `
            <div class="search-result-title">${kpi.title}</div>
            <div class="search-result-group">From: ${kpi.group_title}</div>
        `;
        div.addEventListener('click', () => selectKpi(kpi));
        resultsDiv.appendChild(div);
    });
}

function populateYearSelect(years) {
    const yearSelect = document.getElementById('yearSelect');
    const currentYear = new Date().getFullYear();
    const defaultYear = (currentYear - 1).toString();
    
    yearSelect.innerHTML = '<option value="">Select Year</option>';
    years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === defaultYear) {
            option.selected = true;
        }
        yearSelect.appendChild(option);
    });
    yearSelect.style.display = 'inline-block';
    
    // Trigger change event if we set a default year
    if (yearSelect.value) {
        yearSelect.dispatchEvent(new Event('change'));
    }
}

function selectKpi(kpi) {
    selectedKpi = {
        id: kpi.id,
        title: `${kpi.title} (${kpi.group_title})`
    };
    
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('searchInput').value = selectedKpi.title;
    
    showLoading();
    fetch(`/kpi_data`)
        .then(response => response.json())
        .then(years => {
            // Keep the currently selected year if one exists
            const yearSelect = document.getElementById('yearSelect');
            const currentSelectedYear = yearSelect.value;
            
            populateYearSelect(years);
            
            // If there was a previously selected year that's still in the list, use it
            if (currentSelectedYear && years.includes(currentSelectedYear)) {
                yearSelect.value = currentSelectedYear;
                yearSelect.dispatchEvent(new Event('change'));
            }
            hideLoading();
        })
        .catch(error => {
            console.error('Error:', error);
            hideLoading();
        });
}

function showLoading() {
    document.getElementById('loadingIndicator').style.display = 'block';
}

function hideLoading() {
    document.getElementById('loadingIndicator').style.display = 'none';
}

// Update your fetch calls to show/hide loading
document.getElementById('yearSelect').addEventListener('change', function(e) {
    if (!selectedKpi) return;
    
    const year = e.target.value;
    if (year) {
        showLoading();
        fetch(`/municipality_data/${selectedKpi.id}?year=${year}`)
            .then(response => response.json())
            .then(data => {
                currentKpiData = {};
                data.forEach(d => {
                    if (d.values && d.values.length > 0) {
                        const totalValue = d.values.find(v => v.gender === 'T');
                        if (totalValue && totalValue.value !== null) {
                            const municipalityId = d.municipality;
                            currentKpiData[municipalityId] = totalValue.value;
                        }
                    }
                });
                updateMap();
                hideLoading();
            })
            .catch(error => {
                console.error('Error:', error);
                hideLoading();
            });
    }
});

function updateMap() {
    const values = Object.values(currentKpiData).filter(v => v !== null);
    values.sort((a, b) => a - b);
    
    const percentiles = [];
    for (let i = 1; i < 9; i++) {
        const index = Math.floor(values.length * (i / 10));
        percentiles.push(values[index]);
    }
    
    console.log('Percentiles:', percentiles);  // Debug

    if (geojsonLayer) {
        map.removeLayer(geojsonLayer);
    }

    geojsonLayer = L.geoJSON(municipalityData, {
        style: feature => {
            const value = currentKpiData[feature.properties.id];
            return {
                fillColor: getColor(value, percentiles),
                weight: 1,
                opacity: 1,
                color: '#666',
                fillOpacity: value ? 0.7 : 0.1
            };
        },
        onEachFeature: (feature, layer) => {
            layer.on({
                mouseover: e => {
                    const layer = e.target;
                    const municipalityId = feature.properties.id;
                    
                    // Only fetch if we're not already loading and it's a different municipality
                    if (!isLoadingHistory && lastMunicipalityId !== municipalityId) {
                        lastMunicipalityId = municipalityId;
                        
                        layer.setStyle({
                            weight: 2,
                            color: '#333',
                            fillOpacity: 0.9
                        });
                        
                        showHistoricalData(municipalityId, feature.properties.kom_namn);
                    }
                    
                    info.update({
                        kom_namn: feature.properties.kom_namn,
                        id: municipalityId,
                        value: currentKpiData[municipalityId]
                    });
                },
                mouseout: e => {
                    geojsonLayer.resetStyle(e.target);
                    info.update();
                    if (currentChart) {
                        currentChart.destroy();
                        currentChart = null;
                    }
                    lastMunicipalityId = null;  // Reset the last municipality
                    isLoadingHistory = false;    // Reset the loading state
                }
            });
            
            const value = currentKpiData[feature.properties.id];
            layer.bindTooltip(`
                <strong>${feature.properties.kom_namn}</strong><br>
                Value: ${value ? value.toFixed(2) : 'No data'}
            `);
        }
    }).addTo(map);

    // Update legend
    if (map.legend) {
        map.removeControl(map.legend);
    }
    
    const legend = L.control({position: 'bottomright'});
    legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'info legend');
        div.innerHTML = '<h4>Values</h4>';
        
        // Add percentile ranges to legend
        for (let i = 0; i < percentiles.length; i++) {
            const from = i === 0 ? Math.floor(values[0]) : Math.floor(percentiles[i-1]);
            const to = Math.floor(percentiles[i]);
            div.innerHTML +=
                `<i style="background:${getColor(percentiles[i], percentiles)}"></i> ` +
                `${from}&ndash;${to}<br>`;
        }
        
        // Add the highest range
        div.innerHTML +=
            `<i style="background:${getColor(values[values.length-1], percentiles)}"></i> ` +
            `>${Math.floor(percentiles[percentiles.length-1])}`;
        
        return div;
    };
    legend.addTo(map);
    map.legend = legend;
}

// Update the info control to show values correctly
info.update = function(props) {
    this._div.innerHTML = props ? 
        `<b>${props.kom_namn}</b><br />Value: ${props.value ? props.value.toFixed(2) : 'No data'}` :
        'Hover over a municipality';
};

// Update color function for better visualization
function getColor(value, percentiles) {
    if (!value) return '#CCCCCC';  // Gray for no data
    
    // Find which percentile the value belongs to
    for (let i = 0; i < percentiles.length; i++) {
        if (value <= percentiles[i]) {
            // Colors from red to green
            const colors = [
                '#d73027', '#f46d43', '#fdae61', '#fee08b',
                '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850'
            ];
            return isHighToLow ? colors[i] : colors[colors.length - 1 - i];
        }
    }
    return isHighToLow ? '#1a9850' : '#d73027';  // For values above highest percentile
}

// Add legend styles
const style = document.createElement('style');
style.textContent = `
    .legend {
        background: white;
        padding: 10px;
        border-radius: 5px;
        line-height: 18px;
        color: #555;
    }
    .legend i {
        width: 18px;
        height: 18px;
        float: left;
        margin-right: 8px;
        opacity: 0.7;
    }
    .legend h4 {
        margin: 0 0 5px;
        color: #777;
    }
`;
document.head.appendChild(style);

// Close search results when clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.search-wrapper')) {
        document.getElementById('searchResults').style.display = 'none';
    }
});

// Add click handler to search input to show all KPIs
document.getElementById('searchInput').addEventListener('click', function(e) {
    fetch(`/search_kpis?term=&page=1`)
        .then(response => response.json())
        .then(data => {
            const resultsDiv = document.getElementById('searchResults');
            resultsDiv.innerHTML = '';
            resultsDiv.style.display = data.results.length ? 'block' : 'none';
            resultsDiv.dataset.page = '1';
            resultsDiv.dataset.hasMore = data.has_more;
            resultsDiv.dataset.searchTerm = '';
            
            displayResults(data.results);
        });
});

// Add click handler for sort direction button
document.getElementById('sortDirection').addEventListener('click', function() {
    isHighToLow = !isHighToLow;
    this.innerHTML = `🔄 ${isHighToLow ? 'High is Good' : 'Low is Good'}`;
    if (Object.keys(currentKpiData).length > 0) {
        updateMap();
    }
});

// Add new function to handle historical data
async function showHistoricalData(municipalityId, municipalityName) {
    if (!selectedKpi || isLoadingHistory) return;
    
    try {
        isLoadingHistory = true;
        
        // Cleanup any existing chart first
        if (currentChart) {
            currentChart.destroy();
            currentChart = null;
        }

        const response = await fetch(`/historical_data/${selectedKpi.id}/${municipalityId}`);
        const data = await response.json();
        
        data.sort((a, b) => a.year - b.year);
        
        const chartHtml = `
            <b>${municipalityName}</b><br/>
            <small>Value: ${currentKpiData[municipalityId] || 'No data'}</small><br/>
            <div style="height: 120px">
                <canvas id="historyChart"></canvas>
            </div>
        `;
        
        info._div.innerHTML = chartHtml;
        
        const ctx = document.getElementById('historyChart');
        currentChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => d.year),
                datasets: [{
                    label: 'Historical Values',
                    data: data.map(d => d.value),
                    borderColor: '#0071e3',
                    tension: 0.1,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: {
                            font: {
                                size: 10
                            }
                        }
                    },
                    x: {
                        ticks: {
                            font: {
                                size: 10
                            }
                        }
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('Error fetching historical data:', error);
    } finally {
        isLoadingHistory = false;
    }
}

