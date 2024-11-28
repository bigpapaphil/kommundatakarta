from flask import Flask, render_template, request, jsonify, send_from_directory
import requests
from flask_cors import CORS
import json
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_url_path='/static')
CORS(app)

kpi_cache = {
    'groups': None,
    'last_update': None
}

def fetch_all_kpis():
    """Fetch and cache all KPI groups and their members"""
    if kpi_cache['groups'] is not None:
        logger.info(f"Cache HIT - Returning {len(kpi_cache['groups'])} KPIs from cache. Last updated: {kpi_cache['last_update']}")
        return kpi_cache['groups']

    logger.info("Cache MISS - Fetching KPIs from API")
    try:
        response = requests.get('http://api.kolada.se/v2/kpi_groups')
        groups = response.json()['values']
        
        all_kpis = []
        for group in groups:
            for member in group.get('members', []):
                all_kpis.append({
                    'id': member['member_id'],
                    'title': member['member_title'],
                    'group_title': group['title'],
                    'group_id': group['id']
                })
        
        kpi_cache['groups'] = all_kpis
        kpi_cache['last_update'] = datetime.now().isoformat()
        logger.info(f"Cache UPDATED - Stored {len(all_kpis)} KPIs in cache")
        return all_kpis
    except Exception as e:
        logger.error(f"API ERROR - Failed to fetch KPIs: {e}")
        return []

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/kpi_data')
def get_kpi_data():
    # Get current year and return last 6 years
    current_year = datetime.now().year
    years = [str(year) for year in range(current_year, current_year - 6, -1)]
    return jsonify(years)

@app.route('/municipality_ids')
def get_municipality_ids():
    with open('static/data/municipality_id.json', 'r') as f:
        data = json.load(f)
    # Filter only type "K" municipalities
    k_municipalities = [m for m in data['values'] if m['type'] == 'K']
    return jsonify(k_municipalities)

@app.route('/municipality_data/<kpi_id>')
def get_municipality_data(kpi_id):
    year = request.args.get('year')
    if not year:
        return jsonify([])
    
    # Read municipality IDs
    with open('static/data/municipality_id.json', 'r') as f:
        muni_data = json.load(f)
    k_municipalities = [m['id'] for m in muni_data['values'] if m['type'] == 'K']
    
    # Get data for all municipalities
    municipality_ids = ','.join(k_municipalities)
    response = requests.get(f'http://api.kolada.se/v2/data/kpi/{kpi_id}/municipality/{municipality_ids}/year/{year}')
    data = response.json()
    return jsonify(data['values'])

@app.route('/search_kpis')
def search_kpis():
    search_term = request.args.get('term', '').lower()
    page = int(request.args.get('page', 1))
    per_page = 50
    
    all_kpis = fetch_all_kpis()
    
    # Filter out KPIs starting with "Enhetsdata" first
    filtered_kpis = [kpi for kpi in all_kpis if not kpi['title'].startswith('Enhets')]
    
    if search_term:
        matching_kpis = [
            kpi for kpi in filtered_kpis
            if search_term in kpi['title'].lower() or 
               search_term in kpi['group_title'].lower()
        ]
    else:
        matching_kpis = filtered_kpis
    
    # Calculate pagination
    start_idx = (page - 1) * per_page
    end_idx = start_idx + per_page
    paginated_kpis = matching_kpis[start_idx:end_idx]
    
    return jsonify({
        'results': paginated_kpis,
        'has_more': end_idx < len(matching_kpis)
    })

@app.route('/historical_data/<kpi_id>/<municipality_id>')
def get_historical_data(kpi_id, municipality_id):
    try:
        # Get years from 2017 to current year in format "2017,2018,2019,..."
        current_year = datetime.now().year
        years = ','.join(str(year) for year in range(2017, current_year + 1))
        
        # Use the correct API endpoint format
        response = requests.get(f'http://api.kolada.se/v2/data/kpi/{kpi_id}/municipality/{municipality_id}/year/{years}')
        data = response.json()
        
        # Process the data to get only total values per year
        historical_data = []
        for item in data['values']:
            for value in item['values']:
                if value['gender'] == 'T' and value['value'] is not None:  # Total (not gender-specific)
                    historical_data.append({
                        'year': item['period'],
                        'value': value['value']
                    })
        
        return jsonify(historical_data)
    except Exception as e:
        print(f"Error fetching historical data: {e}")  # Add logging
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)