import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoiYWtleTMiLCJhIjoiY21hcHZrMDBsMDB6eTJrcTM3cWtnZGs4ZSJ9._A0eYS_MnaXaQSUiTQlsmA';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

console.log('Mapbox GL JS Loaded:', mapboxgl);

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Arrays to store trips by minute for efficient filtering
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;
  if (minMinute > maxMinute) {
    return tripsByMinute.slice(minMinute).concat(tripsByMinute.slice(0, maxMinute)).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  const svg = d3.select('#map svg')
    .style('position', 'absolute')
    .style('width', '100%')
    .style('height', '100%')
    .style('z-index', 1)
    .style('pointer-events', 'none');

  const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  const jsonData = await d3.json(jsonurl);
  let stations = jsonData.data.stations;

  let trips = await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv', (trip) => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
    
    // Add trips to minute buckets for efficient filtering
    const startMinute = minutesSinceMidnight(trip.started_at);
    const endMinute = minutesSinceMidnight(trip.ended_at);
    
    departuresByMinute[startMinute].push(trip);
    arrivalsByMinute[endMinute].push(trip);
    
    return trip;
  });

  function computeStationTraffic(stations, timeFilter = -1) {
    const departures = d3.rollup(
      filterByMinute(departuresByMinute, timeFilter),
      v => v.length,
      d => d.start_station_id
    );

    const arrivals = d3.rollup(
      filterByMinute(arrivalsByMinute, timeFilter),
      v => v.length,
      d => d.end_station_id
    );

    return stations.map(station => {
      let id = station.short_name;
      station.departures = departures.get(id) ?? 0;
      station.arrivals = arrivals.get(id) ?? 0;
      station.totalTraffic = station.arrivals + station.departures;
      return station;
    });
  }

  let stationsData = computeStationTraffic(stations);

  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stationsData, d => d.totalTraffic)])
    .range([0, 25]);

  const stationFlow = d3.scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

  const circles = svg.selectAll('circle')
    .data(stationsData, d => d.short_name)
    .enter()
    .append('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .attr('fill', d => {
        if (d.totalTraffic === 0) return '#999';
        const ratio = d.departures / d.totalTraffic;
        if (ratio > 0.6) return 'steelblue';
        if (ratio < 0.4) return 'orange';
        return '#999';
    })
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    .style('pointer-events', 'auto')
    .each(function (d) {
      d3.select(this).append('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });

  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }
  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
  }

  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(timeFilter);
  }

  function updateScatterPlot(timeFilter) {
    let filteredStations = computeStationTraffic(stations, timeFilter);
    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);
    
    circles.data(filteredStations, d => d.short_name)
      .join('circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .attr('fill', d => {
        if (d.totalTraffic === 0) return '#999';
        const ratio = d.departures / d.totalTraffic;
        if (ratio > 0.6) return 'steelblue';
        if (ratio < 0.4) return 'orange';
        return '#999';
      })
      .each(function (d) {
        d3.select(this).select('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});